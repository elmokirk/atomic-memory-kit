/**
 * Retrieval evaluation.
 *
 * The evaluator is the ruler every other retrieval change is measured with, so
 * its own failure mode is the worst one in the repo: a defect it hides is a
 * defect nobody looks for. Every metric is checked against its stated range on
 * fixtures built to push it out of that range.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { defineMemoryConfig } from '../src/config.ts'
import { checkThresholds, runEval } from '../src/eval.ts'
import type { EvalCase, EvalSummary } from '../src/eval.ts'
import { loadMemory } from '../src/loader.ts'
import { searchMemory } from '../src/search.ts'
import type { MemoryFileRaw } from '../src/types.ts'

const config = defineMemoryConfig({
  categories: ['pricing', 'product', 'scope'],
  intents: ['pricing', 'capability'],
})

function atom(id: string, category: string, extra: string, body: string): MemoryFileRaw {
  return {
    path: `${category}/${id.split('.').at(-1)}.md`,
    content: `---\nid: ${id}\ntitle: "${id}"\ncategory: ${category}\nlang: en\n${extra}\n---\n\n${body}\n`,
  }
}

const FILES: MemoryFileRaw[] = [
  atom('pricing.plans', 'pricing', 'keywords: [price, cost]\nrelated: [product.limits]\nsummary: "Plan prices."', 'Starter costs 49 EUR per month.'),
  atom('product.limits', 'product', 'keywords: [limits, quota, seats]\nsummary: "Plan limits."', 'Starter includes 5 seats.'),
]

const { base } = loadMemory(FILES, config)

function assertInRange(summary: EvalSummary): void {
  for (const metric of ['scopeAccuracy', 'hitRate', 'precision'] as const) {
    assert.ok(summary[metric] >= 0 && summary[metric] <= 1, `${metric} = ${summary[metric]} is outside [0, 1]`)
  }
}

describe('metric ranges', () => {
  it('fixture premise: the cost question matches and pulls the limits atom in over the edge', () => {
    const ids = searchMemory(base, 'what does it cost').chunks.map((chunk) => chunk.id)
    assert.deepEqual(ids, ['pricing.plans', 'product.limits'])
  })

  it('hit rate stays at or below 1 when a negative case unexpectedly matches', () => {
    const cases: EvalCase[] = [
      { q: 'what does it cost', expectScope: 'match', expectIds: ['pricing.plans'] },
      { q: 'what does it cost', expectScope: 'no_match' },
    ]
    const summary = runEval(base, cases)
    assertInRange(summary)
    assert.equal(summary.hitRate, 1)
    assert.equal(summary.scopeAccuracy, 0.5)
  })

  it('duplicate expected ids neither inflate a metric nor repeat in the failure reason', () => {
    const cases: EvalCase[] = [
      { q: 'what does it cost', expectScope: 'match', expectIds: ['pricing.plans', 'pricing.plans', 'product.limits', 'product.limits'] },
      { q: 'how many seats', expectScope: 'match', expectIds: ['pricing.missing', 'pricing.missing'] },
    ]
    const summary = runEval(base, cases)
    assertInRange(summary)
    assert.equal(summary.hitRate, 0.5)
    assert.deepEqual(summary.failures.map((failure) => failure.reason), ['missing expected ids: pricing.missing'])
  })
})
