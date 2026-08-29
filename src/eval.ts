/**
 * Retrieval evaluation — deterministic, no model involved.
 *
 * Why this exists: an atom that exists but is never retrieved is functionally
 * absent. Content quality and retrieval quality are different problems, and
 * only the second one can be measured cheaply. Eval cases are the curated
 * question set that pins retrieval behaviour in place.
 *
 * The contract rule that makes it work: every new atom ships with at least two
 * eval cases, one positive and one negative. Without that, precision silently
 * rots as the memory grows.
 *
 * Failures are not just test output — they are converted into `eval` gap
 * observations and land in the same ledger as everything else.
 */
import { searchMemory } from './search.ts'
import type { GapObservation } from './gaps.ts'
import type { MemoryBase } from './types.ts'

export interface EvalCase {
  /** The question, phrased the way a real user would type it. */
  q: string
  expectScope: 'match' | 'no_match'
  /** Atom ids that must be retrieved (or be always-include). */
  expectIds?: string[]
  /** A retrieved chunk counts as relevant when its id OR its category matches. */
  expectCategories?: string[]
  /** Atom ids that must NOT be retrieved — catches confusable neighbours. */
  mustNotRetrieve?: string[]
  /** Optional situational context passed to searchMemory. */
  context?: string
}

export interface EvalThresholds {
  scopeAccuracy: number
  hitRate: number
  precision: number
}

export const defaultThresholds: EvalThresholds = {
  scopeAccuracy: 0.95,
  hitRate: 0.85,
  precision: 0.6,
}

export interface EvalSummary {
  total: number
  /** Share of cases where the scope gate (match/no_match) was right. */
  scopeAccuracy: number
  /** Share of match-cases where all expected ids were available. */
  hitRate: number
  /** Share of retrieved chunks that were relevant. */
  precision: number
  confusionPairs: string[]
  failures: Array<{ q: string, reason: string }>
}

const round = (value: number): number => Math.round(value * 1000) / 1000

export function runEval(base: MemoryBase, cases: EvalCase[]): EvalSummary {
  const failures: EvalSummary['failures'] = []
  const confusionPairs = new Set<string>()
  let correctScope = 0
  let hits = 0
  let retrievedRelevant = 0
  let retrievedTotal = 0

  const alwaysIds = base.alwaysInclude.map((atom) => atom.id)

  for (const testCase of cases) {
    const result = searchMemory(base, testCase.q, { context: testCase.context })
    const ids = result.chunks.map((chunk) => chunk.id)
    // always-include atoms are injected by the consumer, not returned as
    // chunks — correctness checks consider both surfaces.
    const available = new Set([...ids, ...alwaysIds])

    if (result.scopeStatus === testCase.expectScope) correctScope++
    else failures.push({ q: testCase.q, reason: `expected scope ${testCase.expectScope}, got ${result.scopeStatus} (best=${result.bestScore})` })

    if (result.scopeStatus !== 'match') continue

    const expectIds = testCase.expectIds ?? []
    const missingIds = expectIds.filter((id) => !available.has(id))
    if (missingIds.length === 0 && ids.length > 0) hits++
    else if (missingIds.length > 0) failures.push({ q: testCase.q, reason: `missing expected ids: ${missingIds.join(', ')}` })

    for (const id of testCase.mustNotRetrieve ?? []) {
      if (ids.includes(id)) confusionPairs.add(`${testCase.q} → ${id}`)
    }

    const categories = new Set(testCase.expectCategories ?? [])
    retrievedTotal += ids.length
    retrievedRelevant += base.atoms
      .filter((atom) => ids.includes(atom.id))
      .filter((atom) => expectIds.includes(atom.id) || categories.has(atom.category)).length
  }

  const matchTotal = Math.max(1, cases.filter((entry) => entry.expectScope === 'match').length)
  return {
    total: cases.length,
    scopeAccuracy: round(cases.length === 0 ? 1 : correctScope / cases.length),
    hitRate: round(hits / matchTotal),
    precision: round(retrievedTotal === 0 ? 1 : retrievedRelevant / retrievedTotal),
    confusionPairs: [...confusionPairs],
    failures,
  }
}

/** Every eval failure and confusion pair becomes a gap observation. */
export function evalToGaps(summary: EvalSummary, source = 'amk eval'): GapObservation[] {
  return [
    ...summary.failures.map((failure) => ({
      kind: 'eval' as const,
      topic: failure.q,
      detail: failure.reason,
      source,
    })),
    ...summary.confusionPairs.map((pair) => ({
      kind: 'eval' as const,
      topic: pair,
      detail: 'retrieved an atom listed under mustNotRetrieve',
      source,
    })),
  ]
}

export function checkThresholds(summary: EvalSummary, thresholds: EvalThresholds = defaultThresholds): string[] {
  const violations: string[] = []
  if (summary.scopeAccuracy < thresholds.scopeAccuracy) violations.push(`scopeAccuracy ${summary.scopeAccuracy} < ${thresholds.scopeAccuracy}`)
  if (summary.hitRate < thresholds.hitRate) violations.push(`hitRate ${summary.hitRate} < ${thresholds.hitRate}`)
  if (summary.precision < thresholds.precision) violations.push(`precision ${summary.precision} < ${thresholds.precision}`)
  return violations
}

/**
 * Regression guard against a committed baseline. Absolute thresholds catch bad
 * memories; the baseline catches *getting worse*, which is the failure mode
 * that actually happens as a memory grows.
 */
export function compareBaseline(summary: EvalSummary, baseline: EvalSummary, precisionTolerance = 0.01): string[] {
  const regressions: string[] = []
  if (summary.hitRate < baseline.hitRate) regressions.push(`hitRate dropped ${baseline.hitRate} → ${summary.hitRate}`)
  if (summary.precision < baseline.precision - precisionTolerance) regressions.push(`precision dropped ${baseline.precision} → ${summary.precision}`)
  for (const pair of summary.confusionPairs) {
    if (!baseline.confusionPairs.includes(pair)) regressions.push(`new confusion: ${pair}`)
  }
  return regressions
}
