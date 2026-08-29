/**
 * Deterministic retrieval over the loaded memory base.
 *
 * Two-layer scope detection — this is the mechanism that makes gap spotlighting
 * possible at all:
 *   1. Code gate — best score below config.minScore => `no_match`. Cheap,
 *      deterministic, reproducible. The consumer (agent/prompt) is told that
 *      the memory does not cover the question at all.
 *   2. Consumer gate — even on a match, the agent is instructed to check
 *      whether the retrieved atoms actually answer the question, and to emit a
 *      gap marker when they do not. See src/gaps.ts.
 *
 * Layer 1 catches "we have nothing on this topic".
 * Layer 2 catches "we have the topic but not this detail".
 * Both are logged. That pair is the whole trick.
 */
import { scoreAtom, tokenize } from './score.ts'
import type {
  MemoryAtom,
  MemoryBase,
  MemoryConfig,
  MemorySearchResult,
  RetrievedChunk,
} from './types.ts'

export interface SearchOptions {
  /** Trailing conversation/history turns used to enrich the query. */
  history?: Array<{ role: 'user' | 'assistant', content: string }>
  /**
   * Caller-reported situational context that boosts categories: a route
   * (`/pricing`), a workspace, a task type. Matched against config.contextCategories.
   */
  context?: string
  /** Override maxChunks for this call (e.g. a bigger budget for a compile run). */
  maxChunks?: number
  /** Override charBudget for this call. */
  charBudget?: number
}

const DEFAULT_CONTEXT_BOOST = 2

/** Strip a leading locale segment (`/en/pricing` -> `/pricing`). */
export function normalizeContext(context: string): string {
  return context.replace(/^\/[a-z]{2}(?=\/)/, '')
}

function matchContextCategories(context: string | undefined, config: MemoryConfig): string[] | undefined {
  if (!context) return undefined
  const table = config.contextCategories ?? {}
  if (table[context]) return table[context]
  const normalized = normalizeContext(context)
  if (table[normalized]) return table[normalized]
  const trimmed = normalized.replace(/\/$/, '')
  return trimmed === normalized ? undefined : table[trimmed]
}

/** Query = current message + trailing user messages from history. */
export function buildQuery(message: string, base: MemoryBase, options: SearchOptions = {}): string {
  const contextMessages = (options.history ?? [])
    .filter((entry) => entry.role === 'user')
    .slice(-base.config.historyContextMessages)
    .map((entry) => entry.content)
  return [...contextMessages, message].join('\n')
}

/**
 * Retrieve the most relevant atoms.
 *
 * `alwaysInclude` atoms are NOT returned as chunks — they are injected
 * unconditionally by the consumer (see compile.ts / your prompt builder) and
 * excluded here so they never consume the retrieval budget.
 */
export function searchMemory(base: MemoryBase, message: string, options: SearchOptions = {}): MemorySearchResult {
  const query = buildQuery(message, base, options)
  const queryTokens = tokenize(query, base.language)
  const boostedCategories = matchContextCategories(options.context, base.config)
  const maxChunks = options.maxChunks ?? base.config.maxChunks
  const charBudget = options.charBudget ?? base.config.charBudget

  const scored = base.atoms
    .filter((atom) => !atom.alwaysInclude)
    .map((atom) => ({
      atom,
      score: scoreAtom(atom, base.config, base.language, query, queryTokens, base.tokenCache.get(atom.id)),
    }))

  // Context boost lands after normal scoring but before sort/threshold, so it
  // can both reorder results and lift an atom across minScore.
  if (boostedCategories) {
    const boost = base.config.contextBoost ?? DEFAULT_CONTEXT_BOOST
    for (const entry of scored) {
      if (boostedCategories.includes(entry.atom.category)) entry.score += boost
    }
  }

  scored.sort((a, b) => b.score - a.score || a.atom.id.localeCompare(b.atom.id))

  const bestScore = scored[0]?.score ?? 0
  const scopeStatus = bestScore >= base.config.minScore ? 'match' : 'no_match'

  const chunks: RetrievedChunk[] = []
  let usedChars = 0

  if (scopeStatus === 'match') {
    const maxEdges = base.config.edgeMaxChunks ?? 0
    // Reserve budget for the edge chunk BEFORE seeds fill it — a curated edge
    // must not lose to seed volume. The candidate is picked deterministically:
    // the first valid neighbour of the highest-scoring seeds.
    let reservedChars = 0
    if (maxEdges > 0) {
      for (const entry of scored) {
        if (entry.score < base.config.minScore) break
        for (const target of entry.atom.related ?? []) {
          const candidate = base.byId.get(target)
          if (!candidate || candidate.alwaysInclude || candidate.id === entry.atom.id) continue
          reservedChars = Math.min(candidate.body.length, base.config.edgeReserveChars)
          break
        }
        if (reservedChars > 0) break
      }
    }
    const seedBudget = charBudget - reservedChars

    for (const entry of scored) {
      if (chunks.length >= maxChunks) break
      if (entry.score < base.config.minScore) break
      const length = entry.atom.body.length
      // The first chunk is always admitted, even if oversized: returning a
      // truncated-but-relevant answer beats returning nothing.
      if (chunks.length > 0 && usedChars + length > seedBudget) continue
      chunks.push({
        id: entry.atom.id,
        title: entry.atom.title,
        category: entry.atom.category,
        content: entry.atom.body,
        score: entry.score,
      })
      usedChars += length
    }
    usedChars = expandEdges(base, chunks, scored, usedChars, charBudget, maxEdges)
  }

  return { chunks, scopeStatus, bestScore }
}

/**
 * 1-hop edge expansion: neighbours of seed chunks join the context with a
 * reduced score, producing multi-atom answers without the user naming both
 * topics. Hard-capped and budget-bound so edges dilute, never replace, primary
 * hits. Edge chunks are marked `viaEdge` so the consumer can trace them.
 */
function expandEdges(
  base: MemoryBase,
  chunks: RetrievedChunk[],
  scored: Array<{ atom: MemoryAtom, score: number }>,
  usedChars: number,
  hardBudget: number,
  maxEdges: number,
): number {
  if (maxEdges <= 0) return usedChars
  const edgeBoost = base.config.edgeBoost ?? 0.4

  const present = new Set([...chunks.map((chunk) => chunk.id), ...base.alwaysInclude.map((atom) => atom.id)])
  const candidates = new Map<string, number>()

  for (const seed of scored) {
    if (seed.score < base.config.minScore) break
    const boosted = seed.score * edgeBoost
    for (const target of seed.atom.related ?? []) {
      if (present.has(target)) continue
      const atom = base.byId.get(target)
      if (!atom || atom.alwaysInclude) continue
      candidates.set(target, Math.max(candidates.get(target) ?? 0, boosted))
    }
  }

  let edgesUsed = 0
  for (const [id, score] of [...candidates.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    if (edgesUsed >= maxEdges) break
    const atom = base.byId.get(id)!
    if (usedChars + atom.body.length > hardBudget) continue
    chunks.push({
      id: atom.id,
      title: atom.title,
      category: atom.category,
      content: atom.body,
      score: Math.round(score * 100) / 100,
      viaEdge: true,
    })
    usedChars += atom.body.length
    edgesUsed++
  }
  return usedChars
}
