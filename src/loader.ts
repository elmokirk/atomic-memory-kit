/**
 * Memory loader — parse + validate + index + verify the graph.
 *
 * Pure function over an injected file list, so hosts differ only in HOW they
 * read files (node:fs, Nitro serverAssets, CMS API, HTTP, S3). See adapters/.
 *
 * The loader is the trust boundary of the whole kit: after `loadMemory`
 * returns without throwing, every atom satisfies the core contract and every
 * `related[]` edge resolves. Everything downstream may assume that.
 */
import { parseFrontmatter } from './parse-frontmatter.ts'
import { resolveLanguageProfile } from './config.ts'
import { tokenize } from './score.ts'
import { validateAtom } from './schema.ts'
import type {
  LanguageProfile,
  MemoryAtom,
  MemoryAtomTokenSets,
  MemoryBase,
  MemoryConfig,
  MemoryFileRaw,
} from './types.ts'
import { MemoryContractError } from './types.ts'

export interface LoadIssue {
  path: string
  message: string
}

export interface LoadReport {
  base: MemoryBase
  /** Non-fatal contract findings (unknown category/intent, thin keywords, cycles). */
  warnings: LoadIssue[]
  /** Informational findings (extension fields). Never a gate failure. */
  infos: LoadIssue[]
  /** Files skipped because they are meta content (`_`-prefixed). */
  skipped: string[]
}

/**
 * Content-file rule: `_`-prefixed directories and files are meta content
 * (`_kit/`, `_drafts/`, `_archive/`) and are never ingested — except the
 * reserved root `_index.md`, which is the generated scope map.
 */
export function isContentFile(path: string): boolean {
  const segments = path.replace(/\\/g, '/').split('/')
  const fileName = segments.at(-1)!
  if (segments.slice(0, -1).some((segment) => segment.startsWith('_'))) return false
  if (!fileName.endsWith('.md')) return false
  return !fileName.startsWith('_') || fileName === '_index.md'
}

/**
 * Tokenize title/summary/body of every atom in a single pass so scoring never
 * re-tokenizes atom fields at query time. Cost is paid once per cold start.
 */
export function buildTokenCache(atoms: MemoryAtom[], language: LanguageProfile): Map<string, MemoryAtomTokenSets> {
  const cache = new Map<string, MemoryAtomTokenSets>()
  for (const atom of atoms) {
    cache.set(atom.id, {
      title: tokenize(atom.title, language),
      summary: tokenize(atom.summary, language),
      body: tokenize(atom.body, language),
    })
  }
  return cache
}

/**
 * Build the searchable memory base.
 * @throws MemoryContractError when any atom violates a core contract rule.
 */
export function loadMemory(files: MemoryFileRaw[], config: MemoryConfig): LoadReport {
  const atoms: MemoryAtom[] = []
  const byId = new Map<string, MemoryAtom>()
  const alwaysInclude: MemoryAtom[] = []
  const warnings: LoadIssue[] = []
  const infos: LoadIssue[] = []
  const skipped: string[] = []

  for (const file of files) {
    const normalizedPath = file.path.replace(/\\/g, '/')
    if (!isContentFile(normalizedPath)) {
      skipped.push(normalizedPath)
      continue
    }

    let data: Record<string, unknown>
    let body: string
    try {
      ({ data, body } = parseFrontmatter(file.content, normalizedPath))
    } catch (error) {
      throw new MemoryContractError(error instanceof Error ? error.message : String(error), normalizedPath)
    }

    const { atom, issues } = validateAtom(data, body, {
      knownCategories: config.categories,
      knownIntents: config.intents,
    })

    for (const issue of issues) {
      if (issue.severity === 'error') throw new MemoryContractError(issue.message, normalizedPath)
      if (issue.severity === 'warning') warnings.push({ path: normalizedPath, message: issue.message })
      else infos.push({ path: normalizedPath, message: issue.message })
    }

    if (!atom) continue

    if (byId.has(atom.id)) {
      throw new MemoryContractError(
        `duplicate id "${atom.id}" (also in ${byId.get(atom.id)!.sourcePath})`,
        normalizedPath,
      )
    }
    atom.sourcePath = normalizedPath
    byId.set(atom.id, atom)
    atoms.push(atom)
    if (atom.alwaysInclude) alwaysInclude.push(atom)
  }

  validateEdges(atoms, warnings)

  const language = resolveLanguageProfile(config.language)

  return {
    base: { atoms, byId, alwaysInclude, config, language, tokenCache: buildTokenCache(atoms, language) },
    warnings,
    infos,
    skipped,
  }
}

/**
 * Graph integrity: `related[]` edges are a trust contract, so broken edges fail
 * LOUDLY (dangling target or self-reference = contract error). Cycles only
 * degrade answer quality, so they surface as warnings and land in the gap report.
 */
function validateEdges(atoms: MemoryAtom[], warnings: LoadIssue[]): void {
  const ids = new Set(atoms.map((atom) => atom.id))

  for (const atom of atoms) {
    for (const target of atom.related ?? []) {
      if (target === atom.id) {
        throw new MemoryContractError('self-reference in related[]', atom.sourcePath ?? atom.id)
      }
      if (!ids.has(target)) {
        throw new MemoryContractError(
          `related target "${target}" does not exist — create the atom or remove the edge`,
          atom.sourcePath ?? atom.id,
        )
      }
    }
  }

  // Directed DFS cycle detection — each cycle reported once as a warning.
  //
  // Reciprocal pairs (A -> B and B -> A) are NOT cycles for our purposes: two
  // atoms pointing at each other is good graph hygiene, and edge expansion is
  // capped at 1 hop so it cannot loop. Only cycles of three or more atoms are
  // reported, because those usually mean the author lost track of the topology.
  const state = new Map<string, 1 | 2>()
  const path: string[] = []
  const reported = new Set<string>()
  const byId = new Map(atoms.map((atom) => [atom.id, atom]))
  const visit = (id: string): void => {
    const marker = state.get(id)
    if (marker === 2) return
    if (marker === 1) {
      const cycleStart = path.indexOf(id)
      const cycle = path.slice(cycleStart)
      if (cycle.length < 3) return
      const signature = [...cycle].sort().join('|')
      if (reported.has(signature)) return
      reported.add(signature)
      warnings.push({ path: id, message: `related[] cycle: ${[...cycle, id].join(' -> ')}` })
      return
    }
    state.set(id, 1)
    path.push(id)
    for (const target of byId.get(id)?.related ?? []) visit(target)
    path.pop()
    state.set(id, 2)
  }
  for (const atom of atoms) visit(atom.id)
}

/** Atoms that nothing links to and that link to nothing — graph islands. */
export function findOrphanAtoms(base: MemoryBase): MemoryAtom[] {
  const incoming = new Set<string>()
  for (const atom of base.atoms) {
    for (const target of atom.related ?? []) incoming.add(target)
  }
  return base.atoms.filter((atom) =>
    !atom.alwaysInclude && (atom.related ?? []).length === 0 && !incoming.has(atom.id))
}
