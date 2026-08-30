/**
 * Anthropic memory-tool bridge — the contract, wired underneath `/memories`.
 *
 * The memory tool (`memory_20250818`) is client-side by design: the model only
 * *requests* file operations, and the application executes them. Almost every
 * implementation makes that handler a thin wrapper over a filesystem, which
 * means whatever the model writes is what the store contains — malformed
 * frontmatter, a reference to a note that was renamed, two atoms claiming the
 * same id. All accepted, all discovered later, if ever.
 *
 * This module puts the contract in that gap. Same six commands, same return
 * strings the model was trained on, but:
 *
 *   - a write that violates the contract is **refused with its diagnostic**, so
 *     the model corrects itself in the same turn instead of memorising rules;
 *   - a `delete` that would orphan an inbound edge is **refused with the list of
 *     referrers**, because a dangling edge fails the whole load later;
 *   - a `rename` **rewrites every inbound `related[]` reference atomically**, so
 *     the id can move without breaking the graph;
 *   - a `view` of a path that does not exist is **recorded as a gap** — the
 *     model guessed a filename, and a wrong guess is a statement about what it
 *     expected to find.
 *
 * That last one is the point of the whole file. It makes the store report its
 * own holes to the agent using it.
 *
 * Pure by construction: no I/O, no clock, no randomness. It returns the text to
 * hand back plus the mutations to perform; `adapters/memory-tool.ts` performs
 * them. That keeps this usable in a Worker, a Lambda, or a test.
 */
import { pathForId, serializeAtom } from './compile.ts'
import type { GapObservation } from './gaps.ts'
import { parseFrontmatter } from './parse-frontmatter.ts'
import { validateAtom } from './schema.ts'
import type { ValidationIssue } from './schema.ts'
import type { MemoryBase, MemoryFileRaw } from './types.ts'

/** The path prefix the model always uses. Mapped onto the memory root. */
export const MEMORY_ROOT = '/memories'

/** Text views longer than this are truncated; the model pages with view_range. */
const VIEW_CHAR_LIMIT = 16_000
const MAX_LINES = 999_999

export interface MemoryToolInput {
  command: string
  path?: string
  file_text?: string
  old_str?: string
  new_str?: string
  insert_line?: number
  insert_text?: string
  old_path?: string
  new_path?: string
  view_range?: [number, number]
}

export interface MemoryToolOutcome {
  /** Text for the `tool_result` block. */
  content: string
  /** Set `is_error` on the tool result from this. */
  isError: boolean
  /** Files to write, keyed by memory-root-relative path. Apply atomically. */
  writes: MemoryFileRaw[]
  /** Memory-root-relative paths to remove. Apply atomically with `writes`. */
  deletes: string[]
  /** Gap observations to record. Never a reason to fail the command. */
  gaps: GapObservation[]
  /** Contract diagnostic when a write was refused. */
  code?: string
}

export interface MemoryToolContext {
  /** The loaded memory. `null` when the memory currently fails to load. */
  base: MemoryBase | null
  /** Every file under the memory root, including ones the loader skipped. */
  files: MemoryFileRaw[]
  /** Why the base is null, surfaced to the model so it can help fix it. */
  loadError?: string
}

const empty = (): Pick<MemoryToolOutcome, 'writes' | 'deletes' | 'gaps'> =>
  ({ writes: [], deletes: [], gaps: [] })

const ok = (content: string, extra: Partial<MemoryToolOutcome> = {}): MemoryToolOutcome =>
  ({ ...empty(), content, isError: false, ...extra })

const err = (content: string, extra: Partial<MemoryToolOutcome> = {}): MemoryToolOutcome =>
  ({ ...empty(), content, isError: true, ...extra })

/* ------------------------------------------------------------------ *
 * Paths
 * ------------------------------------------------------------------ */

/**
 * Map a `/memories/...` path to a memory-root-relative one.
 *
 * Rejects anything that could escape the root. The checks run against both the
 * raw string and its percent-decoded form, because `%2e%2e%2f` is `../` to a
 * filesystem and not to a naive substring check.
 *
 * Returns `null` for a rejected path — never a partially sanitized one, since
 * "sanitize and continue" is how traversal bugs survive review.
 */
export function toRelativePath(input: string): string | null {
  if (typeof input !== 'string' || input === '') return null

  let decoded = input
  try {
    // Repeat until stable: a double-encoded sequence decodes in two passes.
    for (let pass = 0; pass < 3; pass += 1) {
      const next = decodeURIComponent(decoded)
      if (next === decoded) break
      decoded = next
    }
  } catch {
    return null // malformed percent-encoding is not something to guess about
  }

  for (const candidate of [input, decoded]) {
    const normalized = candidate.replace(/\\/g, '/')
    if (normalized !== MEMORY_ROOT && !normalized.startsWith(`${MEMORY_ROOT}/`)) return null
    if (normalized.split('/').includes('..')) return null
    if (normalized.includes('\0')) return null
  }

  const normalized = decoded.replace(/\\/g, '/')
  if (normalized === MEMORY_ROOT) return ''
  return normalized.slice(MEMORY_ROOT.length + 1).replace(/\/+$/, '')
}

const isRoot = (relative: string) => relative === ''

/** Human-readable size in the shape the model's tool description describes. */
function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`
}

/** Derive a gap topic from a path the model guessed at. */
function topicFromPath(relative: string): string {
  return relative
    .replace(/\.md$/, '')
    .split('/')
    .join(' ')
    .replace(/[-_]+/g, ' ')
    .trim()
}

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

/**
 * Directory listing in the documented format, followed by an annotated scope
 * section.
 *
 * The listing keeps the exact shape the model was trained on. The annotation
 * below it is the affordance a plain filesystem cannot offer: titles and
 * summaries, so the model can decide what to open without opening anything.
 * Sizes alone force it to guess from filenames — which is precisely the guess
 * that produces a wrong `view` and, now, a gap.
 */
function renderListing(relative: string, files: MemoryFileRaw[], base: MemoryBase | null): string {
  const prefix = isRoot(relative) ? '' : `${relative}/`
  const inScope = files
    .filter((file) => isRoot(relative) || file.path === relative || file.path.startsWith(prefix))
    .sort((a, b) => a.path.localeCompare(b.path))

  const displayPath = isRoot(relative) ? MEMORY_ROOT : `${MEMORY_ROOT}/${relative}`
  const lines = [
    `Here're the files and directories up to 2 levels deep in ${displayPath}, `
    + 'excluding hidden items and node_modules:',
    `${humanSize(inScope.reduce((total, file) => total + file.content.length, 0))}\t${displayPath}`,
  ]
  for (const file of inScope) {
    lines.push(`${humanSize(file.content.length)}\t${MEMORY_ROOT}/${file.path}`)
  }

  if (base) {
    const atoms = base.atoms
      .filter((atom) => atom.sourcePath && (isRoot(relative) || atom.sourcePath.startsWith(prefix)))
      .sort((a, b) => a.id.localeCompare(b.id))
    if (atoms.length > 0) {
      lines.push('', `Contract-managed memory: ${atoms.length} atoms. Titles and summaries, so you`)
      lines.push('do not have to open a file to know whether it is the one you want:')
      for (const atom of atoms) {
        lines.push(`  ${atom.id} — ${atom.title}${atom.summary ? `: ${atom.summary}` : ''}`)
      }
      lines.push('', 'If none of these covers what you were asked, say so plainly. Do not answer')
      lines.push('from general knowledge — view the path you expected and the miss is recorded.')
    }
  }

  return lines.join('\n')
}

/** File contents with the documented header, 1-indexed, 6-wide, tab-separated. */
function renderFile(displayPath: string, content: string, range?: [number, number]): string {
  const all = content.replace(/\n$/, '').split('\n')
  if (all.length > MAX_LINES) {
    return `File ${displayPath} exceeds maximum line limit of ${MAX_LINES} lines.`
  }

  let start = 1
  let end = all.length
  if (range) {
    start = Math.max(1, range[0])
    end = range[1] === -1 ? all.length : Math.min(all.length, range[1])
  }

  const selected = all.slice(start - 1, end)
  const numbered = selected.map((line, index) => `${String(start + index).padStart(6, ' ')}\t${line}`)
  let body = numbered.join('\n')
  let note = ''
  if (!range && body.length > VIEW_CHAR_LIMIT) {
    const kept: string[] = []
    let size = 0
    for (const line of numbered) {
      if (size + line.length > VIEW_CHAR_LIMIT) break
      kept.push(line)
      size += line.length + 1
    }
    body = kept.join('\n')
    note = `\n\n[truncated at ${VIEW_CHAR_LIMIT} characters — use view_range to page through the rest]`
  }

  return `Here's the content of ${displayPath} with line numbers:\n${body}${note}`
}

/* ------------------------------------------------------------------ *
 * Contract gate
 * ------------------------------------------------------------------ */

interface GateResult {
  ok: boolean
  message?: string
  code?: string
  id?: string
}

/**
 * The whole reason this module exists: no bytes reach the store without passing
 * the same contract the loader enforces.
 *
 * On refusal the message is written *for the model*: what broke, which rule,
 * and what to do instead. A diagnostic the model can act on turns the write
 * path into a teaching loop; a bare "invalid" turns it into a retry loop.
 */
function gate(relative: string, content: string, base: MemoryBase | null): GateResult {
  let data: Record<string, unknown>
  let body: string
  try {
    ({ data, body } = parseFrontmatter(content, relative))
  } catch (error) {
    return {
      ok: false,
      code: 'E_PARSE',
      message:
        `${(error as Error).message}\n\n`
        + 'This memory stores contract-managed atoms. Every file needs YAML frontmatter '
        + 'with at least: id, title, category, lang. The frontmatter grammar is a subset — '
        + 'scalars, inline arrays, block scalars, comments. No nested maps, no anchors.',
    }
  }

  const { atom, issues } = validateAtom(data, body, {
    knownCategories: base?.config.categories,
    knownIntents: base?.config.intents,
  })

  const errors = issues.filter((issue: ValidationIssue) => issue.severity === 'error')
  if (errors.length > 0 || !atom) {
    return {
      ok: false,
      code: errors[0]?.code,
      message: `The write was refused by the memory contract:\n${
        errors.map((issue) => `  [${issue.code}] ${issue.message}`).join('\n')
      }\n\nFix the frontmatter and try again. Nothing was written.`,
    }
  }

  // R1.5: the id/path mapping is total and reversible. Letting them disagree
  // would make `pathForId` a lie and break every consumer that derives one from
  // the other.
  const expected = pathForId(atom.id)
  if (expected !== relative) {
    return {
      ok: false,
      code: 'E_ID_DUPLICATE',
      message:
        `The id "${atom.id}" maps to ${MEMORY_ROOT}/${expected}, but you wrote to `
        + `${MEMORY_ROOT}/${relative}. Dots in an id are directories. Either write to the `
        + 'expected path or change the id to match this one. Nothing was written.',
    }
  }

  // Edges resolve against the post-write world: an atom may link to itself being
  // created, and to anything already present.
  if (base) {
    const known = new Set([...base.byId.keys(), atom.id])
    const dangling = (atom.related ?? []).filter((target) => !known.has(target))
    if (dangling.length > 0) {
      return {
        ok: false,
        code: 'E_EDGE_DANGLING',
        message:
          `related[] points at ${dangling.map((id) => `"${id}"`).join(', ')}, which `
          + `${dangling.length === 1 ? 'does' : 'do'} not exist. A dangling edge fails the whole `
          + 'memory load, so the write was refused. Create the target first, or drop the edge. '
          + 'Nothing was written.',
      }
    }
  }

  const warnings = issues.filter((issue) => issue.severity === 'warning')
  const advice = warnings.length > 0
    ? `\n\nAccepted with warnings — worth fixing:\n${
      warnings.map((issue) => `  [${issue.code}] ${issue.message}`).join('\n')}`
    : ''

  return { ok: true, id: atom.id, message: advice }
}

/** Every atom that links *to* `id`. The reason a delete or rename is dangerous. */
function referrersOf(id: string, base: MemoryBase | null): string[] {
  if (!base) return []
  return base.atoms.filter((atom) => (atom.related ?? []).includes(id)).map((atom) => atom.id)
}

/* ------------------------------------------------------------------ *
 * Commands
 * ------------------------------------------------------------------ */

/**
 * Execute one memory-tool command against the contract-managed store.
 *
 * Return strings follow the documented reference behaviour so the model's
 * trained expectations hold; extra guidance is appended, never substituted.
 */
export function runMemoryToolCommand(input: MemoryToolInput, ctx: MemoryToolContext): MemoryToolOutcome {
  const { base, files } = ctx
  const byPath = new Map(files.map((file) => [file.path, file]))

  const resolve = (raw: string | undefined) => (raw === undefined ? null : toRelativePath(raw))
  const reject = (raw: string | undefined) =>
    err(`Error: the path ${raw ?? '(missing)'} is outside ${MEMORY_ROOT} and was rejected.`)

  switch (input.command) {
    /* ---------------------------------------------------------- view */
    case 'view': {
      const relative = resolve(input.path)
      if (relative === null) return reject(input.path)
      const display = `${MEMORY_ROOT}${relative ? `/${relative}` : ''}`

      if (isRoot(relative)) {
        let content = renderListing(relative, files, base)
        if (ctx.loadError) {
          content += `\n\nWARNING: this memory does not currently load: ${ctx.loadError}\n`
            + 'Retrieval is unavailable until it is fixed. Repairing that file comes first.'
        }
        return ok(content)
      }

      const file = byPath.get(relative)
      if (file) return ok(renderFile(display, file.content, input.view_range))

      const isDirectory = files.some((entry) => entry.path.startsWith(`${relative}/`))
      if (isDirectory) return ok(renderListing(relative, files, base))

      // The model expected something here and it is not there. That is a
      // statement about demand, and it is the one signal a plain filesystem
      // handler throws away.
      return err(
        `The path ${display} does not exist. Please provide a valid path.\n\n`
        + 'Recorded as a gap. Use view on /memories to see what this memory actually covers, '
        + 'and if nothing does, say so rather than answering from general knowledge.',
        {
          gaps: [{
            kind: 'scope',
            topic: topicFromPath(relative) || relative,
            detail: `memory-tool view of ${display} found nothing`,
            source: 'memory-tool',
          }],
        },
      )
    }

    /* -------------------------------------------------------- create */
    case 'create': {
      const relative = resolve(input.path)
      if (relative === null) return reject(input.path)
      if (isRoot(relative)) return err(`Error: ${MEMORY_ROOT} is a directory, not a file.`)
      if (typeof input.file_text !== 'string') return err('Error: create requires file_text.')

      const verdict = gate(relative, input.file_text, base)
      if (!verdict.ok) return err(verdict.message!, { code: verdict.code })

      const existed = byPath.has(relative)
      return ok(
        `File ${existed ? 'updated' : 'created'} successfully at: ${MEMORY_ROOT}/${relative}`
        + `${verdict.message ?? ''}`,
        { writes: [{ path: relative, content: input.file_text }] },
      )
    }

    /* --------------------------------------------------- str_replace */
    case 'str_replace': {
      const relative = resolve(input.path)
      if (relative === null) return reject(input.path)
      const file = byPath.get(relative)
      if (!file) {
        return err(`Error: The path ${MEMORY_ROOT}/${relative} does not exist. Please provide a valid path.`)
      }
      if (typeof input.old_str !== 'string') return err('Error: str_replace requires old_str.')

      const occurrences: number[] = []
      const lines = file.content.split('\n')
      for (let index = 0; index < lines.length; index += 1) {
        if (lines[index].includes(input.old_str)) occurrences.push(index + 1)
      }
      const first = file.content.indexOf(input.old_str)
      if (first === -1) {
        return err(
          `No replacement was performed, old_str \`${input.old_str}\` did not appear verbatim `
          + `in ${MEMORY_ROOT}/${relative}.`,
        )
      }
      const total = file.content.split(input.old_str).length - 1
      if (total > 1) {
        return err(
          'No replacement was performed. Multiple occurrences of old_str '
          + `\`${input.old_str}\` in lines: ${occurrences.join(', ')}. Please ensure it is unique`,
        )
      }

      const next = file.content.slice(0, first)
        + (input.new_str ?? '')
        + file.content.slice(first + input.old_str.length)

      const verdict = gate(relative, next, base)
      if (!verdict.ok) return err(verdict.message!, { code: verdict.code })

      return ok(
        `The memory file has been edited.${verdict.message ?? ''}\n\n`
        + renderFile(`${MEMORY_ROOT}/${relative}`, next),
        { writes: [{ path: relative, content: next }] },
      )
    }

    /* -------------------------------------------------------- insert */
    case 'insert': {
      const relative = resolve(input.path)
      if (relative === null) return reject(input.path)
      const file = byPath.get(relative)
      if (!file) return err(`Error: The path ${MEMORY_ROOT}/${relative} does not exist`)
      if (typeof input.insert_line !== 'number') return err('Error: insert requires insert_line.')

      const lines = file.content.split('\n')
      if (input.insert_line < 0 || input.insert_line > lines.length) {
        return err(
          `Error: Invalid \`insert_line\` parameter: ${input.insert_line}. It should be within `
          + `the range of lines of the file: [0, ${lines.length}]`,
        )
      }
      lines.splice(input.insert_line, 0, (input.insert_text ?? '').replace(/\n$/, ''))
      const next = lines.join('\n')

      const verdict = gate(relative, next, base)
      if (!verdict.ok) return err(verdict.message!, { code: verdict.code })

      return ok(
        `The file ${MEMORY_ROOT}/${relative} has been edited.${verdict.message ?? ''}`,
        { writes: [{ path: relative, content: next }] },
      )
    }

    /* -------------------------------------------------------- delete */
    case 'delete': {
      const relative = resolve(input.path)
      if (relative === null) return reject(input.path)
      if (isRoot(relative)) return err(`Error: ${MEMORY_ROOT} cannot be deleted.`)

      const targets = byPath.has(relative)
        ? [relative]
        : files.filter((file) => file.path.startsWith(`${relative}/`)).map((file) => file.path)
      if (targets.length === 0) return err(`Error: The path ${MEMORY_ROOT}/${relative} does not exist`)

      // A dangling edge fails the entire load. Refusing here is cheaper than
      // discovering it on the next cold start, and the referrer list tells the
      // model exactly what to fix first.
      const going = new Set(
        targets.map((path) => base?.atoms.find((atom) => atom.sourcePath === path)?.id).filter(Boolean) as string[],
      )
      const blocking: string[] = []
      for (const id of going) {
        for (const referrer of referrersOf(id, base)) {
          if (!going.has(referrer)) blocking.push(`${referrer} -> ${id}`)
        }
      }
      if (blocking.length > 0) {
        return err(
          `Refused: deleting this would leave ${blocking.length} dangling edge`
          + `${blocking.length === 1 ? '' : 's'}, which fails the whole memory load:\n`
          + `${blocking.map((edge) => `  ${edge}`).join('\n')}\n\n`
          + 'Remove those related[] entries first, or rename instead of deleting. Nothing was deleted.',
          { code: 'E_EDGE_DANGLING' },
        )
      }

      return ok(`Successfully deleted ${MEMORY_ROOT}/${relative}`, { deletes: targets })
    }

    /* -------------------------------------------------------- rename */
    case 'rename': {
      const from = resolve(input.old_path)
      const to = resolve(input.new_path)
      if (from === null) return reject(input.old_path)
      if (to === null) return reject(input.new_path)
      if (isRoot(from)) return err(`Error: ${MEMORY_ROOT} cannot be renamed.`)
      if (isRoot(to)) return err(`Error: ${MEMORY_ROOT} is not a valid destination.`)

      const file = byPath.get(from)
      if (!file) return err(`Error: The path ${MEMORY_ROOT}/${from} does not exist`)
      if (byPath.has(to)) return err(`Error: The destination ${MEMORY_ROOT}/${to} already exists`)

      const atom = base?.atoms.find((entry) => entry.sourcePath === from)
      if (!atom || !base) {
        // Not a loadable atom — move the bytes and stay out of the way.
        return ok(`Successfully renamed ${MEMORY_ROOT}/${from} to ${MEMORY_ROOT}/${to}`, {
          writes: [{ path: to, content: file.content }],
          deletes: [from],
        })
      }

      // The path determines the id (R1.5), so a move is an id change, and an id
      // change breaks every inbound edge. Rewriting them here is the difference
      // between a rename that works and one that fails the next load.
      const newId = to.replace(/\.md$/, '').split('/').join('.')

      // R1.5 is only total if the mapping round-trips. A destination like
      // `b.markdown` or `a.b/c.md` yields an id that maps somewhere else, which
      // would leave `pathForId` lying about where the atom lives.
      if (!to.endsWith('.md') || pathForId(newId) !== to) {
        return err(
          `Refused: ${MEMORY_ROOT}/${to} does not round-trip through the id mapping. `
          + `It implies the id "${newId}", which maps back to ${MEMORY_ROOT}/${pathForId(newId)}. `
          + 'Destinations must end in .md, and every path segment becomes one dotted id segment.',
          { code: 'E_ID_DUPLICATE' },
        )
      }
      const idCheck = validateAtom({ ...frontmatterOf(atom), id: newId }, atom.body, {
        knownCategories: base.config.categories,
        knownIntents: base.config.intents,
      })
      const idErrors = idCheck.issues.filter((issue) => issue.severity === 'error')
      if (idErrors.length > 0) {
        return err(
          `Refused: ${MEMORY_ROOT}/${to} implies the id "${newId}", which the contract rejects:\n`
          + `${idErrors.map((issue) => `  [${issue.code}] ${issue.message}`).join('\n')}`,
          { code: idErrors[0].code },
        )
      }
      if (base.byId.has(newId)) {
        return err(`Error: an atom with id "${newId}" already exists`, { code: 'E_ID_DUPLICATE' })
      }
      // R1.4: a deviant id warns rather than fails, so the rename proceeds —
      // but silently swallowing the warning would make the convention
      // unenforceable in practice. Surface it.
      const idWarnings = idCheck.issues
        .filter((issue) => issue.severity === 'warning' && issue.code === 'W_ID_FORM')
        .map((issue) => `  [${issue.code}] ${issue.message}`)

      const writes: MemoryFileRaw[] = [{
        path: to,
        content: serializeAtom({ ...toCompiled(atom), id: newId }),
      }]

      const rewritten: string[] = []
      for (const referrer of base.atoms) {
        if (!(referrer.related ?? []).includes(atom.id) || referrer.sourcePath === from) continue
        rewritten.push(referrer.id)
        writes.push({
          path: referrer.sourcePath!,
          content: serializeAtom({
            ...toCompiled(referrer),
            related: (referrer.related ?? []).map((target) => (target === atom.id ? newId : target)),
          }),
        })
      }

      return ok(
        `Successfully renamed ${MEMORY_ROOT}/${from} to ${MEMORY_ROOT}/${to}\n\n`
        + `The id changed from "${atom.id}" to "${newId}".`
        + (rewritten.length > 0
          ? ` ${rewritten.length} inbound related[] reference${rewritten.length === 1 ? '' : 's'} `
            + `${rewritten.length === 1 ? 'was' : 'were'} rewritten so the graph stays intact: `
            + `${rewritten.join(', ')}.`
          : ' Nothing referenced it, so no edges needed rewriting.')
        + (idWarnings.length > 0 ? `\n\nAccepted with warnings:\n${idWarnings.join('\n')}` : '')
        + '\n\nAnything outside this memory that cited the old id — a transcript, another '
        + 'system, a gap ledger entry — still points at it. Ids are permanent citation targets; '
        + 'prefer creating a new atom over renaming one that has been quoted.',
        { writes, deletes: [from] },
      )
    }

    default:
      return err(
        `Error: unknown command ${input.command}. Supported: view, create, str_replace, `
        + 'insert, delete, rename.',
      )
  }
}

/** Reconstruct the frontmatter map for revalidation. */
function frontmatterOf(atom: MemoryBase['atoms'][number]): Record<string, unknown> {
  return {
    id: atom.id,
    title: atom.title,
    category: atom.category,
    lang: atom.lang,
    summary: atom.summary,
    keywords: atom.keywords,
    synonyms: atom.synonyms,
    intents: atom.intents,
    ...(atom.related ? { related: atom.related } : {}),
    alwaysInclude: atom.alwaysInclude,
    ...(typeof atom.priority === 'number' ? { priority: atom.priority } : {}),
    ...(atom.link ? { link: atom.link } : {}),
    ...(atom.linkLabel ? { linkLabel: atom.linkLabel } : {}),
    ...atom.extensions,
  }
}

/** Loaded atom -> serializable shape. Mirrors compile.ts's private converter. */
function toCompiled(atom: MemoryBase['atoms'][number]) {
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
