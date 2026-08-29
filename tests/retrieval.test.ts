/**
 * Retrieval and contract behaviour.
 *
 * The scope gate gets the most attention here, because it is the mechanism the
 * whole gap system rests on: if `no_match` is unreliable, an agent either
 * hallucinates (gate too loose) or refuses to answer things it knows (too tight).
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { defineMemoryConfig } from '../src/config.ts'
import { loadMemory } from '../src/loader.ts'
import { normalize, stem, tokenize } from '../src/score.ts'
import { searchMemory } from '../src/search.ts'
import { validateAtom } from '../src/schema.ts'
import { MemoryContractError } from '../src/types.ts'
import type { MemoryFileRaw } from '../src/types.ts'

const config = defineMemoryConfig({
  categories: ['pricing', 'product', 'scope'],
  intents: ['pricing', 'capability'],
  contextCategories: { '/pricing': ['pricing'] },
})

function atom(id: string, category: string, extra: string, body: string): MemoryFileRaw {
  return {
    path: `${category}/${id.split('.').at(-1)}.md`,
    content: `---\nid: ${id}\ntitle: "${id}"\ncategory: ${category}\nlang: en\n${extra}\n---\n\n${body}\n`,
  }
}

const FILES: MemoryFileRaw[] = [
  atom('pricing.plans', 'pricing', 'keywords: [price, cost, preis, kosten]\nrelated: [product.limits]\nsummary: "Plan prices."', 'Starter costs 49 EUR per month.'),
  atom('product.limits', 'product', 'keywords: [limits, quota, grenzen]\nsummary: "Plan limits."', 'Starter includes 5 seats.'),
  atom('product.webseite', 'product', 'keywords: [webseite, website]\nsummary: "Website build."', 'We build websites.'),
  {
    path: '_index.md',
    content: '---\nid: index.scope\ntitle: "Scope"\ncategory: scope\nlang: en\nkeywords: [topics, scope]\nsummary: "Map."\nalwaysInclude: true\n---\n\nPricing, product.\n',
  },
]

const { base } = loadMemory(FILES, config)

describe('scope gate', () => {
  it('matches an in-scope question', () => {
    const result = searchMemory(base, 'what does it cost')
    assert.equal(result.scopeStatus, 'match')
    assert.equal(result.chunks[0]!.id, 'pricing.plans')
  })

  it('reports no_match for an off-topic question', () => {
    const result = searchMemory(base, 'give me a recipe for strawberry jam')
    assert.equal(result.scopeStatus, 'no_match')
    assert.deepEqual(result.chunks, [])
  })

  it('never returns always-include atoms as chunks', () => {
    const result = searchMemory(base, 'price')
    assert.ok(!result.chunks.some((chunk) => chunk.id === 'index.scope'))
    assert.equal(base.alwaysInclude[0]!.id, 'index.scope')
  })
})

describe('edge expansion', () => {
  it('pulls in a related atom the query never named', () => {
    const result = searchMemory(base, 'what does it cost')
    const edge = result.chunks.find((chunk) => chunk.viaEdge)
    assert.ok(edge, 'expected an edge-derived chunk')
    assert.equal(edge.id, 'product.limits')
  })

  it('scores edge chunks below their seed', () => {
    const result = searchMemory(base, 'what does it cost')
    const seed = result.chunks.find((chunk) => !chunk.viaEdge)!
    const edge = result.chunks.find((chunk) => chunk.viaEdge)!
    assert.ok(edge.score < seed.score, `${edge.score} should be below ${seed.score}`)
  })

  it('respects the edge cap', () => {
    const result = searchMemory(base, 'what does it cost')
    assert.ok(result.chunks.filter((chunk) => chunk.viaEdge).length <= config.edgeMaxChunks)
  })
})

describe('context boost', () => {
  const scoreOf = (result: ReturnType<typeof searchMemory>, id: string) =>
    result.chunks.find((chunk) => chunk.id === id)?.score ?? 0

  it('lifts the configured categories by exactly contextBoost', () => {
    const plain = searchMemory(base, 'price limits')
    const boosted = searchMemory(base, 'price limits', { context: '/pricing' })
    assert.equal(
      scoreOf(boosted, 'pricing.plans') - scoreOf(plain, 'pricing.plans'),
      config.contextBoost,
    )
  })

  it('reorders results in favour of the boosted category', () => {
    const boosted = searchMemory(base, 'price limits', { context: '/pricing' })
    assert.equal(boosted.chunks[0]!.id, 'pricing.plans')
  })

  it('leaves unconfigured categories untouched', () => {
    const plain = searchMemory(base, 'price limits')
    const boosted = searchMemory(base, 'price limits', { context: '/pricing' })
    assert.equal(scoreOf(boosted, 'product.limits'), scoreOf(plain, 'product.limits'))
  })

  it('strips a locale prefix before matching', () => {
    const prefixed = searchMemory(base, 'price limits', { context: '/en/pricing' })
    const plain = searchMemory(base, 'price limits', { context: '/pricing' })
    assert.equal(scoreOf(prefixed, 'pricing.plans'), scoreOf(plain, 'pricing.plans'))
  })

  it('ignores an unknown context instead of failing', () => {
    const unknown = searchMemory(base, 'price limits', { context: '/nowhere' })
    const plain = searchMemory(base, 'price limits')
    assert.equal(scoreOf(unknown, 'pricing.plans'), scoreOf(plain, 'pricing.plans'))
  })
})

describe('language handling', () => {
  it('folds umlauts', () => {
    assert.equal(normalize('Größe', base.language), 'groesse')
  })

  it('stems conservatively and never below the guard length', () => {
    assert.equal(stem('kosten', base.language), 'kost')
    assert.equal(stem('cost', base.language), 'cost')
  })

  it('drops stopwords and bare years', () => {
    const tokens = tokenize('what is the price in 2026', base.language)
    assert.ok(!tokens.has('the'))
    assert.ok(!tokens.has('2026'))
    assert.ok(tokens.has('price'))
  })

  it('matches German compound variants via the prefix heuristic', () => {
    const result = searchMemory(base, 'webseiten')
    assert.equal(result.scopeStatus, 'match')
    assert.equal(result.chunks[0]!.id, 'product.webseite')
  })
})

describe('contract enforcement', () => {
  it('rejects a missing core field', () => {
    assert.throws(
      () => loadMemory([{ path: 'a/b.md', content: '---\nid: a.b\ntitle: "T"\nlang: en\n---\n\nBody.\n' }], config),
      MemoryContractError,
    )
  })

  it('rejects a dangling related target loudly', () => {
    assert.throws(
      () => loadMemory([atom('a.b', 'product', 'related: [does.not.exist]', 'Body.')], config),
      /does not exist/,
    )
  })

  it('rejects a duplicate id', () => {
    assert.throws(
      () => loadMemory([atom('a.b', 'product', 'summary: "x"', 'One.'), { ...atom('a.b', 'product', 'summary: "y"', 'Two.'), path: 'other/b.md' }], config),
      /duplicate id/,
    )
  })

  it('only warns about an unregistered category — forward compatibility', () => {
    const report = loadMemory([atom('future.thing', 'future', 'keywords: [a, b]\nsummary: "x"', 'Body.')], config)
    assert.equal(report.base.atoms.length, 1)
    assert.ok(report.warnings.some((warning) => warning.message.includes('unregistered category')))
  })

  it('passes unknown fields through as extensions without scoring them', () => {
    const result = validateAtom(
      { id: 'a.b', title: 'T', category: 'product', lang: 'en', region: 'emea', validFrom: 2026 },
      'Body.',
      { knownCategories: ['product'] },
    )
    assert.deepEqual(result.atom!.extensions, { region: 'emea', validFrom: 2026 })
    assert.ok(result.issues.every((issue) => issue.severity !== 'error'))
  })

  it('skips underscore-prefixed meta directories but keeps _index.md', () => {
    const report = loadMemory([
      ...FILES,
      { path: '_kit/TEMPLATE.md', content: '---\nnot: an atom\n---\n' },
    ], config)
    assert.ok(report.base.byId.has('index.scope'))
    assert.ok(report.skipped.includes('_kit/TEMPLATE.md'))
  })

  it('accepts reciprocal edges without calling them a cycle', () => {
    const report = loadMemory([
      atom('a.one', 'product', 'related: [a.two]\nkeywords: [x, y]', 'One.'),
      atom('a.two', 'product', 'related: [a.one]\nkeywords: [x, y]', 'Two.'),
    ], config)
    assert.ok(!report.warnings.some((warning) => warning.message.includes('cycle')))
  })

  it('warns about a real three-atom cycle', () => {
    const report = loadMemory([
      atom('c.one', 'product', 'related: [c.two]\nkeywords: [x, y]', 'One.'),
      atom('c.two', 'product', 'related: [c.three]\nkeywords: [x, y]', 'Two.'),
      atom('c.three', 'product', 'related: [c.one]\nkeywords: [x, y]', 'Three.'),
    ], config)
    assert.ok(report.warnings.some((warning) => warning.message.includes('cycle')))
  })
})

describe('budget discipline', () => {
  it('always admits the top hit even when it exceeds the budget', () => {
    const tight = defineMemoryConfig({ ...config, charBudget: 10 })
    const { base: tightBase } = loadMemory(FILES, tight)
    const result = searchMemory(tightBase, 'what does it cost')
    assert.equal(result.chunks.length >= 1, true)
  })

  it('honours maxChunks', () => {
    const capped = defineMemoryConfig({ ...config, maxChunks: 1, edgeMaxChunks: 0 })
    const { base: cappedBase } = loadMemory(FILES, capped)
    assert.equal(searchMemory(cappedBase, 'price limits').chunks.length, 1)
  })
})
