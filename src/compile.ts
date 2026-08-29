/**
 * Bidirectional compile — the defining capability of this kit.
 *
 * Three surfaces are generated from ONE loader source (so drift is impossible):
 *
 *   1. BUNDLE  (markdown, lossless, round-trippable)
 *      The whole memory as a single file: every atom verbatim inside
 *      `<!-- amk:atom id -->` … `<!-- amk:end id -->` fences, wrapped in prose
 *      a human can read. Hand it to a person or an agent, let them edit it,
 *      parse it back into atoms. This is the human-in-the-loop channel.
 *
 *   2. COMPILED (JSON, lossless, machine transport)
 *      Same content, structured. For other agents, RAG pipelines, MCP tools,
 *      A2A exchange. Also round-trippable via `decompile()`.
 *
 *   3. DIGEST  (markdown, lossy, read-only)
 *      Table + crosslinks + summaries. For skimming and review. Explicitly NOT
 *      re-importable, and it says so in its own header.
 *
 * Round-trip invariant (enforced by tests/round-trip.test.ts):
 *   loadMemory(decompile(compile(base))) deep-equals base, for all atoms.
 *
 * Anything that breaks that invariant is a bug, not a formatting preference.
 */
import { parseFrontmatter } from './parse-frontmatter.ts'
import type { GapRecord } from './gaps.ts'
import type { MemoryAtom, MemoryBase, MemoryFileRaw } from './types.ts'

export const BUNDLE_VERSION = 1
export const CONTRACT_VERSION = 1

const ATOM_OPEN = /^<!--\s*amk:atom\s+([^\s]+)\s*-->$/
const ATOM_CLOSE = /^<!--\s*amk:end\s+([^\s]+)\s*-->$/

export interface CompiledAtom {
  id: string
  title: string
  category: string
  lang: string
  summary: string
  alwaysInclude: boolean
  intents: string[]
  keywords: string[]
  synonyms: string[]
  related: string[]
  priority?: number
  link?: string
  linkLabel?: string
  body: string
  extensions?: Record<string, unknown>
}

export interface CompiledMemory {
  generatedAt: string
  contractVersion: number
  atomCount: number
  categories: string[]
  atoms: CompiledAtom[]
  /** Open gaps travel WITH the memory — that is the point (see CONCEPT.md §4). */
  gaps?: GapRecord[]
}

/* ------------------------------------------------------------------ *
 * Compile: atoms -> transport
 * ------------------------------------------------------------------ */

export function compileMemory(base: MemoryBase, gaps: GapRecord[] = []): CompiledMemory {
  return {
    generatedAt: new Date().toISOString(),
    contractVersion: CONTRACT_VERSION,
    atomCount: base.atoms.length,
    categories: [...new Set(base.atoms.map((atom) => atom.category))].sort(),
    atoms: base.atoms.map(toCompiledAtom),
    ...(gaps.length > 0 ? { gaps } : {}),
  }
}

function toCompiledAtom(atom: MemoryAtom): CompiledAtom {
  return {
    id: atom.id,
    title: atom.title,
    category: atom.category,
    lang: atom.lang,
    summary: atom.summary,
    alwaysInclude: atom.alwaysInclude,
    intents: atom.intents,
    keywords: atom.keywords,
    synonyms: atom.synonyms,
    related: atom.related ?? [],
    ...(typeof atom.priority === 'number' ? { priority: atom.priority } : {}),
    ...(atom.link ? { link: atom.link } : {}),
    ...(atom.linkLabel ? { linkLabel: atom.linkLabel } : {}),
    body: atom.body,
    ...(Object.keys(atom.extensions).length > 0 ? { extensions: atom.extensions } : {}),
  }
}

/* ------------------------------------------------------------------ *
 * Serialization: one atom -> markdown file content
 * ------------------------------------------------------------------ */

/**
 * Emit a scalar the minimal frontmatter parser can read back verbatim.
 * The parser has no escape handling, so quoting is chosen by content:
 *   contains newline, or both quote kinds -> block scalar
 *   contains `"` -> single-quoted · contains `'` -> double-quoted
 */
function emitScalar(key: string, value: string, lines: string[]): void {
  const hasDouble = value.includes('"')
  const hasSingle = value.includes('\'')
  if (value.includes('\n') || (hasDouble && hasSingle)) {
    lines.push(`${key}: |`)
    for (const line of value.split('\n')) lines.push(line === '' ? '' : `  ${line}`)
    return
  }
  lines.push(`${key}: ${hasDouble ? `'${value}'` : `"${value}"`}`)
}

function emitArrayItem(entry: string): string {
  const needsQuote = /^[\d\-+]/.test(entry) || entry.includes(',') || entry.includes('[') || entry.includes(']')
  if (!needsQuote) return entry
  return entry.includes('"') ? `'${entry}'` : `"${entry}"`
}

function emitArray(key: string, values: string[], lines: string[]): void {
  if (values.length === 0) return
  lines.push(`${key}: [${values.map(emitArrayItem).join(', ')}]`)
}

/** Serialize a compiled atom back to markdown (the import direction). */
export function serializeAtom(atom: CompiledAtom): string {
  const lines: string[] = ['---']
  lines.push(`id: ${atom.id}`)
  emitScalar('title', atom.title, lines)
  lines.push(`category: ${atom.category}`)
  lines.push(`lang: ${atom.lang}`)
  emitArray('intents', atom.intents, lines)
  emitArray('keywords', atom.keywords, lines)
  emitArray('synonyms', atom.synonyms, lines)
  emitArray('related', atom.related, lines)
  if (atom.summary !== '') emitScalar('summary', atom.summary, lines)
  if (atom.alwaysInclude) lines.push('alwaysInclude: true')
  if (typeof atom.priority === 'number') lines.push(`priority: ${atom.priority}`)
  if (atom.link) lines.push(`link: ${atom.link}`)
  if (atom.linkLabel) emitScalar('linkLabel', atom.linkLabel, lines)
  for (const [key, value] of Object.entries(atom.extensions ?? {})) {
    if (typeof value === 'string') emitScalar(key, value, lines)
    else if (typeof value === 'number' || typeof value === 'boolean') lines.push(`${key}: ${value}`)
    else if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) emitArray(key, value, lines)
  }
  lines.push('---', '', atom.body.trim(), '')
  return lines.join('\n')
}

/**
 * File path for an atom id — the inverse of the naming scheme.
 * `services.pricing.audit` -> `services/pricing/audit.md`
 * `index.scope`            -> `_index.md` (reserved)
 */
export function pathForId(id: string, indexAtomId = 'index.scope'): string {
  if (id === indexAtomId) return '_index.md'
  const segments = id.split('.')
  if (segments.length === 1) return `${segments[0]}.md`
  return `${segments.slice(0, -1).join('/')}/${segments.at(-1)}.md`
}

/** Compiled transport -> writable atom files. Pure; the host does the writing. */
export function decompile(compiled: CompiledMemory, indexAtomId = 'index.scope'): MemoryFileRaw[] {
  return compiled.atoms.map((atom) => ({
    path: pathForId(atom.id, indexAtomId),
    content: serializeAtom(atom),
  }))
}

/* ------------------------------------------------------------------ *
 * Bundle: the human-in-the-loop surface (lossless, round-trippable)
 * ------------------------------------------------------------------ */

export interface BundleOptions {
  /** Shown in the header, e.g. "Kirk Enterprises — sales memory". */
  name?: string
  /** Open gaps rendered as an actionable checklist at the top. */
  gaps?: GapRecord[]
  /** Skip the usage instructions block (for machine consumers). */
  omitInstructions?: boolean
}

const BUNDLE_INSTRUCTIONS = `## How to work with this file

This is the complete memory as one editable document. Everything between
\`<!-- amk:atom … -->\` and \`<!-- amk:end … -->\` is a real atom and will be
written back to disk on import. Everything outside those fences is prose for
you and is discarded on import — edit it freely.

To close a gap:

1. Find it in **Open gaps** below.
2. Either extend an existing atom's body, or add a whole new atom by pasting a
   new fence block anywhere in this file:

   \`\`\`
   <!-- amk:atom category.topic -->
   ---
   id: category.topic
   title: "Human readable title"
   category: category
   lang: en
   keywords: [term one, term two]
   summary: "One sentence that fully describes this atom."
   ---

   - Fact one.
   - Fact two.
   <!-- amk:end category.topic -->
   \`\`\`

3. Tick the gap's checkbox: \`- [x]\`.
4. Run \`amk import <this-file>\` then \`amk validate\`.

Rules that will bite you if ignored: \`id\` must equal the fence id · numbers in
inline arrays must be quoted (\`["1500"]\`) · every \`related\` target must exist.`

export function renderBundle(base: MemoryBase, options: BundleOptions = {}): string {
  const gaps = (options.gaps ?? []).filter((gap) => gap.status === 'open')
  const lines: string[] = [
    `<!-- amk:bundle v${BUNDLE_VERSION} atoms=${base.atoms.length} generated=${new Date().toISOString()} -->`,
    `# Memory Bundle${options.name ? ` — ${options.name}` : ''}`,
    '',
    `${base.atoms.length} atoms · ${new Set(base.atoms.map((a) => a.category)).size} categories · ${gaps.length} open gaps`,
    '',
  ]

  if (!options.omitInstructions) lines.push(BUNDLE_INSTRUCTIONS, '')

  lines.push('## Open gaps', '')
  if (gaps.length === 0) {
    lines.push('_None recorded._')
  } else {
    for (const gap of gaps) {
      const seen = gap.count > 1 ? ` _(seen ${gap.count}×)_` : ''
      const where = gap.atomId ? ` → \`${gap.atomId}\`` : ''
      lines.push(`- [ ] \`${gap.id}\` **${gap.kind}**: ${gap.topic}${where}${seen}`)
      if (gap.detail) lines.push(`      ${gap.detail}`)
    }
  }
  lines.push('')

  const byCategory = groupByCategory(base.atoms)
  lines.push('## Atoms', '')
  for (const [category, atoms] of byCategory) {
    lines.push(`### ${category}`, '')
    for (const atom of atoms) {
      lines.push(`<!-- amk:atom ${atom.id} -->`)
      lines.push(serializeAtom(toCompiledAtom(atom)).trimEnd())
      lines.push(`<!-- amk:end ${atom.id} -->`, '')
    }
  }

  return lines.join('\n')
}

export interface ParsedBundle {
  files: MemoryFileRaw[]
  /** Gap ids the editor ticked off as done (`- [x] \`gap-id\``). */
  closedGapIds: string[]
  /** Fence blocks whose frontmatter id disagrees with the fence id. */
  problems: string[]
}

/**
 * Parse an edited bundle back into atom files.
 *
 * Deliberately forgiving about prose and strict about fences: a mismatch
 * between the fence id and the frontmatter id is reported rather than guessed,
 * because guessing here silently corrupts memory.
 */
export function parseBundle(markdown: string, indexAtomId = 'index.scope'): ParsedBundle {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const files: MemoryFileRaw[] = []
  const problems: string[] = []
  const closedGapIds: string[] = []
  const seenIds = new Set<string>()

  let open: string | null = null
  let buffer: string[] = []
  let inCodeFence = false

  for (const line of lines) {
    const trimmed = line.trim()

    if (open === null) {
      // Outside atoms, ``` blocks are documentation (the bundle's own how-to
      // shows a sample fence). Never treat their contents as real atoms.
      if (/^(```|~~~)/.test(trimmed)) {
        inCodeFence = !inCodeFence
        continue
      }
      if (inCodeFence) continue

      const start = ATOM_OPEN.exec(trimmed)
      if (start) {
        open = start[1]!
        buffer = []
        continue
      }
      const done = /^-\s*\[[xX]\]\s*`([^`]+)`/.exec(trimmed)
      if (done) closedGapIds.push(done[1]!)
      continue
    }

    const end = ATOM_CLOSE.exec(trimmed)
    if (end) {
      if (end[1] !== open) problems.push(`fence mismatch: opened "${open}", closed "${end[1]}"`)
      const content = `${buffer.join('\n').trim()}\n`
      let frontmatterId: string | undefined
      try {
        frontmatterId = parseFrontmatter(content, open).data.id as string
      } catch (error) {
        problems.push(`${open}: unparseable — ${error instanceof Error ? error.message : String(error)}`)
        open = null
        continue
      }
      if (frontmatterId !== open) {
        problems.push(`${open}: frontmatter id is "${frontmatterId}" — fence and id must agree`)
      } else if (seenIds.has(open)) {
        problems.push(`${open}: appears twice in the bundle`)
      } else {
        seenIds.add(open)
        files.push({ path: pathForId(open, indexAtomId), content })
      }
      open = null
      continue
    }

    buffer.push(line)
  }

  if (open !== null) problems.push(`unterminated fence for "${open}" — missing <!-- amk:end ${open} -->`)

  return { files, closedGapIds, problems }
}

/* ------------------------------------------------------------------ *
 * Digest + scope index (read-only, generated)
 * ------------------------------------------------------------------ */

function groupByCategory(atoms: MemoryAtom[]): Map<string, MemoryAtom[]> {
  const byCategory = new Map<string, MemoryAtom[]>()
  for (const atom of [...atoms].sort((a, b) => a.id.localeCompare(b.id))) {
    byCategory.set(atom.category, [...(byCategory.get(atom.category) ?? []), atom])
  }
  return new Map([...byCategory.entries()].sort((a, b) => a[0].localeCompare(b[0])))
}

/** Skimmable overview. Lossy by design — never import this back. */
export function renderDigest(compiled: CompiledMemory): string {
  const lines: string[] = [
    '<!-- GENERATED by `amk compile` — read-only, do not hand-edit, not importable. -->',
    `# Memory Digest (${compiled.atoms.length} atoms)`,
    '',
    `Generated: ${compiled.generatedAt} · Contract v${compiled.contractVersion}`,
    '',
    '| id | title | category | lang | link | keywords | related |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ]
  for (const atom of compiled.atoms) {
    lines.push(`| ${atom.id} | ${atom.title} | ${atom.category} | ${atom.lang} | ${atom.link ?? '—'} | ${atom.keywords.join(' · ')} | ${atom.related.join(' · ') || '—'} |`)
  }

  const edges = compiled.atoms.filter((atom) => atom.related.length > 0)
  lines.push('', '## Crosslinks', '')
  if (edges.length === 0) lines.push('- none')
  for (const atom of edges) lines.push(`- ${atom.id} → ${atom.related.join(', ')}`)

  lines.push('', '## Summaries', '')
  for (const atom of compiled.atoms) lines.push(`- **${atom.id}** — ${atom.summary || '_(no summary)_'}`)

  if (compiled.gaps?.length) {
    lines.push('', '## Open gaps', '')
    for (const gap of compiled.gaps.filter((gap) => gap.status === 'open')) {
      lines.push(`- ${gap.kind}: ${gap.topic}${gap.count > 1 ? ` (${gap.count}×)` : ''}`)
    }
  }

  lines.push('')
  return lines.join('\n')
}

/**
 * Regenerate the scope index atom (`_index.md`) — the map of what this memory
 * knows about. It carries `alwaysInclude: true`, so every consumer sees it on
 * every query; that is what lets an agent recognise "not my territory" instead
 * of hallucinating.
 */
export function buildScopeIndex(base: MemoryBase, options: { id?: string, title?: string, lang?: string, outro?: string } = {}): string {
  const id = options.id ?? 'index.scope'
  const lines = [
    '<!-- GENERATED by `amk index` — do not hand-edit. -->',
    '---',
    `id: ${id}`,
    `title: "${options.title ?? 'Scope index'}"`,
    'category: scope',
    `lang: ${options.lang ?? 'en'}`,
    'keywords: [topics, scope, index, overview]',
    'summary: "Map of every knowledge area covered by this memory."',
    'alwaysInclude: true',
    '---',
    '',
    `# ${options.title ?? 'Scope index'}`,
    '',
  ]
  for (const [category, atoms] of groupByCategory(base.atoms)) {
    if (atoms.every((atom) => atom.id === id)) continue
    lines.push(`## ${category}`, '')
    for (const atom of atoms) {
      if (atom.id === id) continue
      lines.push(`- ${atom.title}: ${atom.summary || '(no summary)'}`)
    }
    lines.push('')
  }
  lines.push(options.outro ?? 'Anything beyond this list is outside the scope of this memory.', '')
  return lines.join('\n')
}
