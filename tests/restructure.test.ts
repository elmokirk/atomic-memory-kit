/**
 * The inbound direction: material -> atoms.
 *
 * The property under test is not "the split is good" — nothing here understands
 * content, and pretending otherwise is the failure mode this module is designed
 * against. The property is: **an agent cannot write an invalid memory through
 * this path, no matter what it proposes.**
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { defineMemoryConfig } from '../src/config.ts'
import { loadMemory } from '../src/loader.ts'
import { draftFromMarkdown, materialize, planApply } from '../src/restructure.ts'
import type { AtomProposal } from '../src/restructure.ts'
import type { MemoryFileRaw } from '../src/types.ts'

const config = defineMemoryConfig({ categories: ['pricing', 'product'], intents: [] })

const FILES: MemoryFileRaw[] = [
  {
    path: 'pricing/plans.md',
    content: '---\nid: pricing.plans\ntitle: "Plans"\ncategory: pricing\nlang: en\nkeywords: [price, cost]\nsummary: "Plan prices."\n---\n\nStarter costs 49 EUR.\n',
  },
  {
    path: 'product/limits.md',
    content: '---\nid: product.limits\ntitle: "Limits"\ncategory: product\nlang: en\nkeywords: [limits, seats]\nsummary: "Plan limits."\n---\n\nStarter includes 5 seats.\n',
  },
]

const { base } = loadMemory(FILES, config)

const proposal = (over: Partial<AtomProposal> = {}): AtomProposal => ({
  id: 'product.sso',
  title: 'SSO',
  category: 'product',
  lang: 'en',
  keywords: ['sso', 'single sign on'],
  summary: 'SSO is available on Growth and above.',
  body: 'SSO uses SAML 2.0.',
  ...over,
})

describe('planApply', () => {
  it('classifies a new atom as create and renders its file', () => {
    const plan = planApply(base, [proposal()])
    assert.equal(plan.ok, true)
    assert.equal(plan.summary.create, 1)
    assert.equal(plan.plans[0].path, 'product/sso.md')
    assert.match(plan.plans[0].content!, /^---\nid: product\.sso/)
  })

  it('classifies an identical re-submission as unchanged, not update', () => {
    // Idempotence matters: an agent re-running the same proposal must not
    // produce a diff, or every retry looks like a change.
    const plan = planApply(base, [{
      id: 'pricing.plans',
      title: 'Plans',
      category: 'pricing',
      lang: 'en',
      keywords: ['price', 'cost'],
      summary: 'Plan prices.',
      body: 'Starter costs 49 EUR.',
    }])
    assert.equal(plan.summary.unchanged, 1)
    assert.deepEqual(plan.plans[0].changedFields, [])
  })

  it('names exactly the fields that changed', () => {
    const plan = planApply(base, [{
      id: 'pricing.plans',
      title: 'Plans',
      category: 'pricing',
      lang: 'en',
      keywords: ['price', 'cost', 'preis'],
      summary: 'Plan prices.',
      body: 'Starter costs 59 EUR.',
    }])
    assert.equal(plan.summary.update, 1)
    assert.deepEqual(plan.plans[0].changedFields.sort(), ['body', 'keywords'])
  })

  it('rejects a proposal that violates the contract, and blocks the batch', () => {
    const plan = planApply(base, [proposal({ id: 'product.sso', link: 'relative/path' })])
    assert.equal(plan.ok, false)
    assert.equal(plan.plans[0].verdict, 'rejected')
    assert.ok(plan.plans[0].issues.some((issue) => issue.code === 'E_LINK_FORM'))
    assert.equal(plan.plans[0].content, undefined, 'a rejected proposal must not render a file')
  })

  it('resolves edges against the batch, so A and B can be added together', () => {
    const plan = planApply(base, [
      proposal({ id: 'product.sso', related: ['product.scim'] }),
      proposal({ id: 'product.scim', title: 'SCIM', related: ['product.sso'] }),
    ])
    assert.equal(plan.ok, true)
    assert.equal(plan.summary.create, 2)
  })

  it('still rejects an edge to something that exists nowhere', () => {
    const plan = planApply(base, [proposal({ related: ['product.ghost'] })])
    assert.equal(plan.ok, false)
    assert.ok(plan.plans[0].issues.some((issue) => issue.code === 'E_EDGE_DANGLING'))
  })

  it('blocks a batch that proposes the same id twice', () => {
    const plan = planApply(base, [proposal(), proposal({ title: 'SSO again' })])
    assert.equal(plan.ok, false)
    assert.match(plan.blockers[0], /duplicate id/)
  })
})

describe('materialize', () => {
  it('merges proposals into the file set and proves the result still loads', () => {
    const plan = planApply(base, [proposal()])
    const { files, verified } = materialize(FILES, plan, config)
    assert.equal(verified, true)
    assert.equal(files.length, 3)
    const reloaded = loadMemory(files, config).base
    assert.ok(reloaded.byId.has('product.sso'))
    assert.equal(reloaded.byId.get('product.sso')!.keywords[0], 'sso')
  })

  it('refuses to materialize a plan that is not ok', () => {
    const plan = planApply(base, [proposal({ link: 'nope' })])
    assert.throws(() => materialize(FILES, plan, config), /refusing to materialize/)
  })

  it('round-trips: the written bytes reload to the proposed values', () => {
    const source = proposal({ priority: 10, keywords: ['sso', '2500'], extensions: { region: 'eu' } })
    const plan = planApply(base, [source])
    const { files } = materialize(FILES, plan, config)
    const atom = loadMemory(files, config).base.byId.get('product.sso')!
    assert.equal(atom.priority, 10)
    assert.deepEqual(atom.keywords, ['sso', '2500'], 'a numeric-looking keyword must survive as a string')
    assert.equal(atom.extensions.region, 'eu')
  })
})

describe('draftFromMarkdown', () => {
  const submitted = [
    'Here are my notes.',
    '',
    '## Refund window',
    '',
    'Refunds are possible within 14 days.',
    '',
    '## Data location',
    '',
    'All data is stored in Frankfurt.',
    '',
  ].join('\n')

  it('splits on headings and keeps the author\'s boundaries', () => {
    const drafts = draftFromMarkdown(submitted, { category: 'product', lang: 'en' })
    assert.equal(drafts.length, 2)
    assert.deepEqual(drafts.map((draft) => draft.id), ['product.refund-window', 'product.data-location'])
    assert.equal(drafts[0].body, 'Refunds are possible within 14 days.')
  })

  it('never invents keywords, and says what is missing', () => {
    const [draft] = draftFromMarkdown(submitted, { category: 'product', lang: 'en' })
    assert.equal(draft.keywords, undefined)
    assert.equal(draft.summary, undefined)
    assert.deepEqual(draft.needs, ['keywords', 'summary'])
    assert.equal(draft.confidence, 'structural')
  })

  it('reports low confidence when there was nothing to split on', () => {
    const drafts = draftFromMarkdown('Just one paragraph of prose.', { category: 'product', lang: 'en' })
    assert.equal(drafts.length, 1)
    assert.equal(drafts[0].confidence, 'fallback')
  })

  it('does not split on a heading inside a fenced code block', () => {
    const withFence = '## Real\n\n```md\n## Not a heading\n```\n\nbody\n'
    const drafts = draftFromMarkdown(withFence, { category: 'product', lang: 'en' })
    assert.equal(drafts.length, 1)
  })

  it('folds umlauts into ids instead of dropping them', () => {
    const drafts = draftFromMarkdown('## Größe der Datei\n\nMax 10 MB.\n', { category: 'product', lang: 'de' })
    assert.equal(drafts[0].id, 'product.groesse-der-datei')
  })

  it('honours idPrefix so submitted material can land in an inbox', () => {
    const drafts = draftFromMarkdown(submitted, { category: 'product', lang: 'en', idPrefix: 'inbox' })
    assert.equal(drafts[0].id, 'inbox.refund-window')
  })

  it('produces drafts that are plan-clean apart from thin keywords', () => {
    // A structural draft must never be rejected outright — it should load with
    // warnings, so a human can fix keywords rather than rewrite the atom.
    const drafts = draftFromMarkdown(submitted, { category: 'product', lang: 'en' })
    const plan = planApply(base, drafts)
    assert.equal(plan.ok, true)
    assert.ok(plan.plans.every((entry) => entry.verdict === 'create'))
    assert.ok(plan.plans[0].issues.some((issue) => issue.code === 'W_KEYWORDS_NONE'))
  })
})
