/**
 * Retrieval evaluation.
 *
 * The evaluator is the ruler every other retrieval change is measured with, so
 * its own failure mode is the worst one in the repo: a defect it hides is a
 * defect nobody looks for. Every metric is checked against its stated range on
 * fixtures built to push it out of that range.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, it } from 'node:test'

import { defineMemoryConfig } from '../src/config.ts'
import { checkThresholds, runEval } from '../src/eval.ts'
import type { EvalCase, EvalSummary } from '../src/eval.ts'
import { loadMemory } from '../src/loader.ts'
import { searchMemory } from '../src/search.ts'
import type { MemoryFileRaw } from '../src/types.ts'

const CLI = fileURLToPath(new URL('../cli/amk.mjs', import.meta.url))

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

describe('empty denominators and empty expectations', () => {
  const lenient = { scopeAccuracy: 0, hitRate: 0, precision: 0 }

  it('zero cases measure nothing: metrics are vacuously 1 and the run still fails', () => {
    const summary = runEval(base, [])
    assert.deepEqual([summary.total, summary.scopeAccuracy, summary.hitRate, summary.precision], [0, 1, 1, 1])
    assert.deepEqual(checkThresholds(summary, lenient), ['no eval cases: nothing was measured'])
  })

  it('a suite of only negative cases cannot pass on an unmeasured hit rate', () => {
    const summary = runEval(base, [{ q: 'give me a recipe for strawberry jam', expectScope: 'no_match' }])
    assert.deepEqual([summary.scopeAccuracy, summary.hitRate, summary.precision], [1, 1, 1])
    assert.deepEqual(checkThresholds(summary, lenient), ['no match cases: hitRate not measured'])
  })

  it('a match case with no expectations hits on any retrieval but declares nothing relevant', () => {
    const summary = runEval(base, [{ q: 'what does it cost', expectScope: 'match' }])
    assert.equal(summary.hitRate, 1)
    assert.equal(summary.precision, 0)
    assert.deepEqual(summary.failures, [])
  })
})

// Every aggregate is perfect, yet the edge drags in an atom the case forbids.
const FORBIDDEN: EvalCase[] = [{
  q: 'what does it cost',
  expectScope: 'match',
  expectIds: ['pricing.plans'],
  expectCategories: ['pricing', 'product'],
  mustNotRetrieve: ['product.limits'],
}]

describe('forbidden retrievals', () => {
  it('a forbidden retrieval fails the run even when every aggregate is perfect', () => {
    const summary = runEval(base, FORBIDDEN)
    assert.deepEqual([summary.scopeAccuracy, summary.hitRate, summary.precision], [1, 1, 1])
    assert.deepEqual(summary.confusionPairs, ['what does it cost → product.limits'])
    const violations = checkThresholds(summary, { scopeAccuracy: 0, hitRate: 0, precision: 0 })
    assert.deepEqual(violations, ['forbidden retrieval: what does it cost → product.limits'])
  })

  describe('amk eval', () => {
    let root: string
    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'amk-eval-'))
      for (const file of FILES) {
        mkdirSync(join(root, 'memory', dirname(file.path)), { recursive: true })
        writeFileSync(join(root, 'memory', file.path), file.content)
      }
      mkdirSync(join(root, 'memory', '_kit'), { recursive: true })
      writeFileSync(join(root, 'memory', '_kit', 'eval-cases.json'), JSON.stringify(FORBIDDEN))
      writeFileSync(join(root, 'memory.config.json'), JSON.stringify({
        root: 'memory',
        retrieval: { categories: ['pricing', 'product', 'scope'], intents: ['pricing', 'capability'] },
      }))
    })
    afterEach(() => rmSync(root, { recursive: true, force: true }))

    const run = (...args: string[]) => spawnSync(process.execPath, [CLI, 'eval', ...args], { cwd: root, encoding: 'utf8' })

    it('exits non-zero on a forbidden retrieval with no baseline present', () => {
      const result = run()
      assert.equal(result.status, 1, result.stdout + result.stderr)
      assert.match(result.stderr, /forbidden retrieval: what does it cost → product\.limits/)
    })

    it('a baseline that already contains the confusion cannot absorb it', () => {
      run('--update-baseline')
      const result = run()
      assert.equal(result.status, 1, result.stdout + result.stderr)
    })
  })
})
