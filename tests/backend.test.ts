/**
 * Backend wrapper: gap recording, eval and write validation over a search the
 * host supplies. Every test runs against an in-process fake whose answers are
 * fixed in advance, so the oracle is the fixture, never the wrapper.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { runBackendEval, searchBackend, writeValidated } from '../src/backend.ts'
import type { BackendCandidate, MemoryBackend } from '../src/backend.ts'
import { checkThresholds, evalToGaps } from '../src/eval.ts'
import { createGapLedger, gapId } from '../src/gaps.ts'
import type { MemoryAtom } from '../src/types.ts'

/** Answers from a fixed table; unknown queries return nothing, like Mem0. */
function fakeBackend(table: Record<string, BackendCandidate[]>): MemoryBackend & { queries: string[] } {
  const queries: string[] = []
  return {
    queries,
    search: async (query: string) => {
      queries.push(query)
      return table[query] ?? []
    },
  }
}

const HOURS = { id: 'support.hours', text: 'Support is open 9-17.', score: 0.69 }
const SHIPPING = { id: 'shipping.eu', text: 'Shipping inside the EU is free.', score: 0.62 }

const backend = fakeBackend({
  'when is support open': [HOURS, { ...SHIPPING, score: 0.3 }],
  'shipping to norway': [{ ...HOURS, score: 0.41 }],
  'shipping costs': [SHIPPING, { ...HOURS, score: 0.58 }],
  'nothing at all': [],
})

describe('searchBackend', () => {
  it('keeps only candidates at or above the threshold, best first', async () => {
    const result = await searchBackend(backend, 'shipping costs', { threshold: 0.6 })
    assert.equal(result.scopeStatus, 'match')
    assert.deepEqual(result.candidates.map((candidate) => candidate.id), ['shipping.eu'])
    assert.equal(result.bestScore, 0.62)
    assert.equal(result.gap, undefined)
  })

  it('records a scope gap when the backend returns candidates but none clears the threshold', async () => {
    const ledger = createGapLedger()
    const result = await searchBackend(backend, 'shipping to norway', { threshold: 0.55, ledger })
    assert.equal(result.scopeStatus, 'no_match')
    assert.deepEqual(result.candidates, [])
    assert.equal(result.bestScore, 0.41)
    const [record] = ledger.open()
    assert.equal(record?.id, gapId('scope', 'shipping to norway'))
    assert.match(record?.detail ?? '', /0\.41 < 0\.55/)
  })

  it('records a scope gap when the backend returns nothing at all', async () => {
    const ledger = createGapLedger()
    const result = await searchBackend(backend, 'nothing at all', { threshold: 0.5, ledger })
    assert.equal(result.bestScore, 0)
    assert.equal(ledger.open().length, 1)
  })

  it('a repeated miss is one ledger record with a rising count', async () => {
    const ledger = createGapLedger()
    await searchBackend(backend, 'shipping to norway', { threshold: 0.55, ledger })
    await searchBackend(backend, 'shipping to norway', { threshold: 0.55, ledger })
    assert.equal(ledger.open()[0]?.count, 2)
  })

  it('scores exactly at the threshold match, the same rule as searchMemory', async () => {
    const result = await searchBackend(backend, 'when is support open', { threshold: 0.69 })
    assert.equal(result.scopeStatus, 'match')
  })

  it('returns the observation even without a ledger so the host can store it elsewhere', async () => {
    const result = await searchBackend(backend, 'nothing at all', { threshold: 0.5, source: 'mem0' })
    assert.equal(result.gap?.kind, 'scope')
    assert.equal(result.gap?.source, 'mem0')
  })
})

describe('runBackendEval', () => {
  const options = { threshold: 0.55 }

  it('a fully passing case set scores 1 everywhere and passes the shared thresholds', async () => {
    const summary = await runBackendEval(backend, [
      { q: 'when is support open', expectScope: 'match', expectIds: ['support.hours'] },
      { q: 'shipping to norway', expectScope: 'no_match' },
    ], options)
    assert.deepEqual(
      [summary.scopeAccuracy, summary.hitRate, summary.precision, summary.failures.length],
      [1, 1, 1, 0],
    )
    assert.deepEqual(checkThresholds(summary), [])
  })

  it('a forbidden candidate fails the run on its own, whatever the averages say', async () => {
    const summary = await runBackendEval(backend, [
      { q: 'shipping costs', expectScope: 'match', expectIds: ['shipping.eu'], mustNotRetrieve: ['support.hours'] },
    ], options)
    assert.deepEqual(summary.confusionPairs, ['shipping costs → support.hours'])
    assert.ok(checkThresholds(summary).some((violation) => violation.startsWith('forbidden retrieval')))
    assert.equal(evalToGaps(summary).length, 1)
  })

  it('a missing expected id is a named failure and lowers the hit rate', async () => {
    const summary = await runBackendEval(backend, [
      { q: 'when is support open', expectScope: 'match', expectIds: ['support.hours'] },
      { q: 'shipping costs', expectScope: 'match', expectIds: ['shipping.de'] },
    ], options)
    assert.equal(summary.hitRate, 0.5)
    assert.match(summary.failures[0]?.reason ?? '', /missing expected ids: shipping\.de/)
  })

  it('metrics stay in [0, 1] when a negative case unexpectedly matches', async () => {
    const summary = await runBackendEval(backend, [
      { q: 'when is support open', expectScope: 'match', expectIds: ['support.hours'] },
      { q: 'when is support open', expectScope: 'no_match' },
    ], options)
    assert.equal(summary.hitRate, 1)
    assert.equal(summary.scopeAccuracy, 0.5)
  })

  it('precision counts every retrieved candidate that was not expected', async () => {
    const summary = await runBackendEval(backend, [
      { q: 'shipping costs', expectScope: 'match', expectIds: ['shipping.eu'] },
    ], options)
    assert.equal(summary.precision, 0.5)
  })

  it('no cases fails the run', async () => {
    const summary = await runBackendEval(backend, [], options)
    assert.deepEqual(checkThresholds(summary), ['no eval cases: nothing was measured'])
  })
})

describe('writeValidated', () => {
  function recordingBackend(): MemoryBackend & { written: MemoryAtom[] } {
    const written: MemoryAtom[] = []
    return {
      written,
      search: async () => [],
      write: async (atom: MemoryAtom) => {
        written.push(atom)
        return { stored: atom.id }
      },
    }
  }

  const FACT = {
    id: 'support.hours',
    title: 'Support hours',
    category: 'support',
    lang: 'en',
    keywords: ['support', 'hours', 'open'],
    durability: 'stable',
    body: 'Support is open Monday to Friday, 9:00 to 17:00 Berlin time.',
  }

  it('a valid fact reaches the host write as a validated atom', async () => {
    const target = recordingBackend()
    const outcome = await writeValidated(target, FACT)
    assert.equal(outcome.written, true)
    assert.deepEqual(outcome.result, { stored: 'support.hours' })
    assert.equal(target.written[0]?.body, FACT.body)
    assert.equal(target.written[0]?.durability, 'stable')
  })

  it('a volatile fact is refused with the contract diagnostic and the host write is never called', async () => {
    const target = recordingBackend()
    const outcome = await writeValidated(target, { ...FACT, durability: 'volatile' })
    assert.equal(outcome.written, false)
    assert.deepEqual(target.written, [])
    assert.ok(outcome.issues.some((issue) => issue.code === 'E_DURABILITY_VOLATILE'))
    assert.match(outcome.issues.find((issue) => issue.severity === 'error')?.message ?? '', /Nothing was written/)
  })

  it('a fact missing a core field is refused and nothing is written', async () => {
    const target = recordingBackend()
    const { lang: _lang, ...withoutLang } = FACT
    const outcome = await writeValidated(target, withoutLang)
    assert.equal(outcome.written, false)
    assert.ok(outcome.issues.some((issue) => issue.code === 'E_CORE_MISSING'))
    assert.deepEqual(target.written, [])
  })

  it('warnings are reported but do not block the write', async () => {
    const target = recordingBackend()
    const { keywords: _keywords, ...withoutKeywords } = FACT
    const outcome = await writeValidated(target, withoutKeywords)
    assert.equal(outcome.written, true)
    assert.ok(outcome.issues.some((issue) => issue.code === 'W_KEYWORDS_NONE'))
  })

  it('an unknown category warns only when the host passes its categories', async () => {
    const target = recordingBackend()
    const outcome = await writeValidated(target, FACT, { knownCategories: ['pricing'] })
    assert.equal(outcome.written, true)
    assert.ok(outcome.issues.some((issue) => issue.code === 'W_CATEGORY_UNKNOWN'))
  })
})
