/**
 * Foreign memory backends — gap recording, eval and write validation around a
 * search somebody else owns.
 *
 * Why this exists: a team already running Mem0 (or anything with a vector
 * search) gets AMK's two checks without moving its records. The backend stays
 * authoritative; AMK only watches the calls. Mem0 returns an empty list, or a
 * weak unrelated hit, and records nothing either way — the miss is lost unless
 * the caller keeps it.
 *
 * The interface is the host's search function and nothing else, so this file
 * knows no backend, does no I/O and runs against an in-process fake in tests.
 * HTTP clients live in adapters/.
 */
import type { EvalCase, EvalSummary } from './eval.ts'
import type { GapLedger, GapObservation } from './gaps.ts'
import { validateAtom } from './schema.ts'
import type { ValidateOptions, ValidationIssue } from './schema.ts'
import type { MemoryAtom, ScopeStatus } from './types.ts'

export interface BackendCandidate {
  /** The backend's own id, or whatever stable id the adapter maps it to. */
  id: string
  text: string
  /** Backend-specific scale. Only comparable to a threshold tuned on the same backend and embedder. */
  score: number
}

export interface MemoryBackend {
  search: (query: string) => Promise<BackendCandidate[]>
  /** Optional; only ever called through `writeValidated`. */
  write?: (atom: MemoryAtom) => Promise<unknown>
}

export interface BackendSearchOptions {
  /** Minimum score that counts as an answer. No default: it depends on the embedder. */
  threshold: number
  /** Receives the scope gap when nothing clears the threshold. */
  ledger?: GapLedger
  /** Recorded on the gap, e.g. "mem0". Default "backend". */
  source?: string
}

export interface BackendSearchResult {
  /** Candidates at or above the threshold, best first. */
  candidates: BackendCandidate[]
  scopeStatus: ScopeStatus
  bestScore: number
  /** Set exactly when `scopeStatus` is `no_match`. */
  gap?: GapObservation
}

/**
 * Search the backend and keep what clears the threshold. A miss becomes a
 * `scope` observation: the same kind and the same ledger as a miss in a local
 * memory, so one gap report covers both.
 */
export async function searchBackend(
  backend: MemoryBackend,
  query: string,
  options: BackendSearchOptions,
): Promise<BackendSearchResult> {
  const all = await backend.search(query)
  const bestScore = all.reduce((best, candidate) => Math.max(best, candidate.score), 0)
  // `>=` like searchMemory's minScore, so one threshold means the same thing in both.
  const candidates = all
    .filter((candidate) => candidate.score >= options.threshold)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
  if (candidates.length > 0) return { candidates, scopeStatus: 'match', bestScore }

  const gap: GapObservation = {
    kind: 'scope',
    topic: query,
    detail: all.length === 0
      ? 'backend returned no candidates'
      : `best score ${bestScore} < ${options.threshold} across ${all.length} candidate(s)`,
    source: options.source ?? 'backend',
  }
  options.ledger?.observe(gap)
  return { candidates, scopeStatus: 'no_match', bestScore, gap }
}

const round = (value: number): number => Math.round(value * 1000) / 1000

/**
 * `runEval` with the backend in place of `searchMemory`, by candidate id. Same
 * rules: hit rate is a share of match-cases only, a forbidden id becomes a
 * confusion pair that `checkThresholds` fails on its own, an empty denominator
 * is vacuously 1. `expectCategories` and `context` are ignored — a backend
 * candidate has no category and the query is sent as written.
 *
 * Kept beside, not inside, eval.ts: runEval is synchronous and its local
 * callers should not become async for a backend they do not use.
 */
export async function runBackendEval(
  backend: MemoryBackend,
  cases: EvalCase[],
  options: Omit<BackendSearchOptions, 'ledger'>,
): Promise<EvalSummary> {
  const failures: EvalSummary['failures'] = []
  const confusionPairs = new Set<string>()
  let correctScope = 0
  let hits = 0
  let retrievedRelevant = 0
  let retrievedTotal = 0

  for (const testCase of cases) {
    const result = await searchBackend(backend, testCase.q, options)
    const ids = [...new Set(result.candidates.map((candidate) => candidate.id))]

    if (result.scopeStatus === testCase.expectScope) correctScope++
    else failures.push({ q: testCase.q, reason: `expected scope ${testCase.expectScope}, got ${result.scopeStatus} (best=${result.bestScore})` })

    if (result.scopeStatus !== 'match') continue

    const expectIds = [...new Set(testCase.expectIds ?? [])]
    const missingIds = expectIds.filter((id) => !ids.includes(id))
    if (missingIds.length === 0) {
      if (testCase.expectScope === 'match') hits++
    } else failures.push({ q: testCase.q, reason: `missing expected ids: ${missingIds.join(', ')}` })

    for (const id of testCase.mustNotRetrieve ?? []) {
      if (ids.includes(id)) confusionPairs.add(`${testCase.q} → ${id}`)
    }

    retrievedTotal += ids.length
    retrievedRelevant += ids.filter((id) => expectIds.includes(id)).length
  }

  const matchCases = cases.filter((entry) => entry.expectScope === 'match').length
  const share = (part: number, whole: number): number => round(whole === 0 ? 1 : part / whole)
  return {
    total: cases.length,
    matchCases,
    scopeAccuracy: share(correctScope, cases.length),
    hitRate: share(hits, matchCases),
    precision: share(retrievedRelevant, retrievedTotal),
    confusionPairs: [...confusionPairs],
    failures,
  }
}

export type WriteOutcome =
  | { written: true, atom: MemoryAtom, issues: ValidationIssue[], result: unknown }
  | { written: false, issues: ValidationIssue[] }

/**
 * The opt-in write path: a candidate fact must pass the atom contract,
 * durability included, before the host's write runs. A refusal returns the
 * validator's diagnostics and calls nothing. Errors block, warnings travel
 * with the result — severity is contract (CONTRACT.md R4.4).
 *
 * `fact` is frontmatter fields plus `body`, the shape an agent already
 * produces for `memory_apply`.
 */
export async function writeValidated(
  backend: MemoryBackend & Required<Pick<MemoryBackend, 'write'>>,
  fact: Record<string, unknown>,
  options: Pick<ValidateOptions, 'knownCategories' | 'knownIntents'> = {},
): Promise<WriteOutcome> {
  const { body, ...data } = fact
  const { atom, issues } = validateAtom(data, typeof body === 'string' ? body : '', options)
  if (!atom || issues.some((issue) => issue.severity === 'error')) return { written: false, issues }
  return { written: true, atom, issues, result: await backend.write(atom) }
}
