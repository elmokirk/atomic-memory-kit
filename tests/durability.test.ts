/**
 * Durability and provenance — release 0.3.0.
 *
 * The oracle for durability is total and needs no judgement: a `volatile` write
 * either reaches disk or it does not. Every path that can write has to be
 * checked, because the gate is only worth anything if it has no back door.
 *
 * For expiry the oracle is an injected clock. `src/` has no `Date.now()`, which
 * is what lets these tests assert exact day counts instead of ranges.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'

import { createMemoryToolHandler } from '../adapters/memory-tool.ts'
import { serializeAtom } from '../src/compile.ts'
import { defineMemoryConfig } from '../src/config.ts'
import { DURABILITY, DURABILITY_DEFAULT, describeContract } from '../src/contract.ts'
import { expiryToGaps, findExpiring, findUnboundedProvenance } from '../src/expiry.ts'
import { createGapLedger } from '../src/gaps.ts'
import { loadMemory } from '../src/loader.ts'
import { runMemoryToolCommand } from '../src/memory-tool.ts'
import { materialize, planApply } from '../src/restructure.ts'
import { validateAtom } from '../src/schema.ts'
import { MemoryContractError } from '../src/types.ts'
import type { MemoryFileRaw } from '../src/types.ts'

const config = defineMemoryConfig({ categories: ['pricing', 'product', 'research'], intents: [] })

const atomFile = (id: string, extra = ''): MemoryFileRaw => ({
  path: `${id.split('.').join('/')}.md`,
  content: `---\nid: ${id}\ntitle: "T"\ncategory: ${id.split('.')[0]}\nlang: en\n`
    + `keywords: [alpha, beta]\nsummary: "S."\n${extra}---\n\nBody.\n`,
})

const BASE_FILES = [atomFile('pricing.plans'), atomFile('product.limits')]
const base = () => loadMemory(BASE_FILES, config).base

const core = { id: 'product.x', title: 'T', category: 'product', lang: 'en' }

/* ================================================================== *
 * The gate
 * ================================================================== */

describe('durability, the entry criterion', () => {
  it('defaults to stable when absent', () => {
    const { atom } = validateAtom(core, 'Body.')
    assert.equal(atom!.durability, DURABILITY_DEFAULT)
    assert.equal(atom!.durability, 'stable')
  })

  it('accepts fixed and stable', () => {
    for (const value of ['fixed', 'stable']) {
      const { atom, issues } = validateAtom({ ...core, durability: value }, 'Body.')
      assert.equal(atom!.durability, value)
      assert.equal(issues.filter((issue) => issue.severity === 'error').length, 0)
    }
  })

  it('refuses volatile with E_DURABILITY_VOLATILE', () => {
    const { atom, issues } = validateAtom({ ...core, durability: 'volatile' }, 'Body.')
    assert.equal(atom, undefined)
    assert.ok(issues.some((issue) => issue.severity === 'error' && issue.code === 'E_DURABILITY_VOLATILE'))
  })

  it('names where the content belongs instead — the refusal has to teach', () => {
    // A bare "rejected" teaches nothing. This message is the feature.
    const { issues } = validateAtom({ ...core, durability: 'volatile' }, 'Body.')
    const message = issues.find((issue) => issue.code === 'E_DURABILITY_VOLATILE')!.message
    assert.match(message, /working memory/)
    assert.match(message, /Nothing was written/)
  })

  it('warns on an unknown value and treats it as stable — R4.1, not a refusal', () => {
    const { atom, issues } = validateAtom({ ...core, durability: 'seasonal' }, 'Body.')
    assert.equal(atom!.durability, 'stable', 'forward compatibility: unknown values must not break a load')
    assert.ok(issues.some((issue) => issue.code === 'W_DURABILITY_UNKNOWN'))
    assert.equal(issues.filter((issue) => issue.severity === 'error').length, 0)
  })

  it('type-checks the field', () => {
    const { issues } = validateAtom({ ...core, durability: 7 }, 'Body.')
    assert.ok(issues.some((issue) => issue.severity === 'error' && issue.code === 'E_TYPE'))
  })

  it('fails the whole load, not just the file', () => {
    const files = [...BASE_FILES, atomFile('product.meeting', 'durability: volatile\n')]
    assert.throws(() => loadMemory(files, config), MemoryContractError)
  })

  it('no atom in a loaded base carries volatile — consumers may rely on R11.4', () => {
    for (const atom of base().atoms) {
      assert.ok(atom.durability === 'fixed' || atom.durability === 'stable')
    }
  })

  it('exposes the enum in the machine-readable contract', () => {
    const descriptor = describeContract()
    assert.deepEqual([...descriptor.durability.values], [...DURABILITY])
    assert.deepEqual([...descriptor.durability.refused], ['volatile'])
    assert.equal(descriptor.durability.default, 'stable')
  })
})

describe('the gate has no back door', () => {
  it('planApply rejects a volatile proposal', () => {
    const plan = planApply(base(), [{
      id: 'product.meeting', title: 'Meeting', category: 'product', lang: 'en',
      body: 'Wednesday with X.', durability: 'volatile',
    }])
    assert.equal(plan.ok, false)
    assert.equal(plan.plans[0].verdict, 'rejected')
    assert.equal(plan.plans[0].content, undefined)
  })

  it('materialize refuses to write a rejected plan', () => {
    const plan = planApply(base(), [{
      id: 'product.meeting', title: 'M', category: 'product', lang: 'en',
      body: 'x', durability: 'volatile',
    }])
    assert.throws(() => materialize(BASE_FILES, plan, config), /refusing to materialize/)
  })

  it('the memory tool refuses create', () => {
    const outcome = runMemoryToolCommand(
      {
        command: 'create',
        path: '/memories/product/meeting.md',
        file_text: atomFile('product.meeting', 'durability: volatile\n').content,
      },
      { files: BASE_FILES, base: base() },
    )
    assert.equal(outcome.isError, true)
    assert.equal(outcome.code, 'E_DURABILITY_VOLATILE')
    assert.deepEqual(outcome.writes, [])
  })

  it('the memory tool refuses an edit that turns an atom volatile', () => {
    // The sneaky path: the atom is already stored, and str_replace flips it.
    const files = [atomFile('product.limits', 'durability: stable\n')]
    const outcome = runMemoryToolCommand(
      {
        command: 'str_replace',
        path: '/memories/product/limits.md',
        old_str: 'durability: stable',
        new_str: 'durability: volatile',
      },
      { files, base: loadMemory(files, config).base },
    )
    assert.equal(outcome.isError, true)
    assert.equal(outcome.code, 'E_DURABILITY_VOLATILE')
    assert.deepEqual(outcome.writes, [])
  })

  it('the memory tool refuses an insert that turns an atom volatile', () => {
    const outcome = runMemoryToolCommand(
      {
        command: 'insert',
        path: '/memories/product/limits.md',
        insert_line: 1,
        insert_text: 'durability: volatile',
      },
      { files: BASE_FILES, base: base() },
    )
    assert.equal(outcome.isError, true)
    assert.equal(outcome.code, 'E_DURABILITY_VOLATILE')
    assert.deepEqual(outcome.writes, [])
  })
})

/* ================================================================== *
 * Provenance
 * ================================================================== */

describe('provenance fields', () => {
  it('accepts a well-formed ISO date without warning', () => {
    const { issues } = validateAtom(
      { ...core, source: 'https://example.com', retrievedAt: '2026-08-30', validUntil: '2026-12-31' },
      'Body.',
      { quotedScalars: new Set(['retrievedAt', 'validUntil']) },
    )
    assert.equal(issues.filter((issue) => issue.code === 'W_DATE_FORM').length, 0)
    assert.equal(issues.filter((issue) => issue.code === 'W_DATE_UNQUOTED').length, 0)
  })

  it('warns when a date is not YYYY-MM-DD', () => {
    const { issues } = validateAtom({ ...core, validUntil: 'next tuesday' }, 'Body.')
    assert.ok(issues.some((issue) => issue.code === 'W_DATE_FORM'))
  })

  it('warns when a date is unquoted — a stricter parser would read it as a Date', () => {
    const files = [atomFile('product.x', 'validUntil: 2026-12-31\n')]
    const { warnings } = loadMemory(files, config)
    assert.ok(warnings.some((warning) => warning.code === 'W_DATE_UNQUOTED'))
  })

  it('does not warn when the date is quoted', () => {
    const files = [atomFile('product.x', 'validUntil: "2026-12-31"\n')]
    const { warnings } = loadMemory(files, config)
    assert.equal(warnings.filter((warning) => warning.code === 'W_DATE_UNQUOTED').length, 0)
  })

  it('never validates source as a URL — offline provenance is legitimate', () => {
    const { issues } = validateAtom({ ...core, source: 'Slack thread with Anna, 2026-08-12' }, 'Body.')
    assert.equal(issues.filter((issue) => issue.severity === 'error').length, 0)
  })

  it('reports atoms that cite a source but can never go stale', () => {
    const files = [
      atomFile('research.a', 'source: https://example.com\n'),
      atomFile('research.b', 'source: https://example.com\nvalidUntil: "2026-12-31"\n'),
    ]
    const unbounded = findUnboundedProvenance(loadMemory(files, config).base)
    assert.deepEqual(unbounded.map((atom) => atom.id), ['research.a'])
  })
})

/* ================================================================== *
 * Expiry
 * ================================================================== */

describe('expiry', () => {
  const files = [
    atomFile('research.old', 'source: https://example.com/a\nvalidUntil: "2026-01-01"\n'),
    atomFile('research.soon', 'validUntil: "2026-09-15"\n'),
    atomFile('research.later', 'validUntil: "2027-06-01"\n'),
    atomFile('product.limits'),
  ]
  const memory = () => loadMemory(files, config).base
  const NOW = new Date('2026-08-30T12:00:00Z')

  it('finds only expired atoms by default', () => {
    const findings = findExpiring(memory(), NOW)
    assert.deepEqual(findings.map((finding) => finding.atomId), ['research.old'])
    assert.equal(findings[0].expired, true)
  })

  it('counts whole days, and the count is exact', () => {
    const [finding] = findExpiring(memory(), NOW)
    assert.equal(finding.daysRemaining, -241)
  })

  it('looks ahead with withinDays, most urgent first', () => {
    const findings = findExpiring(memory(), NOW, { withinDays: 30 })
    assert.deepEqual(findings.map((finding) => finding.atomId), ['research.old', 'research.soon'])
    assert.equal(findings[1].expired, false)
    assert.equal(findings[1].daysRemaining, 16)
  })

  it('surfaces the boundary day in the report but does not call it expired', () => {
    const onTheDay = findExpiring(memory(), new Date('2026-09-15T23:00:00Z'))
    const soon = onTheDay.find((finding) => finding.atomId === 'research.soon')!
    assert.equal(soon.daysRemaining, 0)
    assert.equal(soon.expired, false, 'the last valid day is still valid')
  })

  it('produces no gap on the boundary day — an atom still valid is missing nothing', () => {
    // A gap saying "expired 0d ago" would simply be false.
    const gaps = expiryToGaps(memory(), new Date('2026-09-15T23:00:00Z'))
    assert.deepEqual(gaps.map((gap) => gap.atomId), ['research.old'])
  })

  it('produces the gap the following day', () => {
    const gaps = expiryToGaps(memory(), new Date('2026-09-16T00:30:00Z'))
    assert.deepEqual(gaps.map((gap) => gap.atomId).sort(), ['research.old', 'research.soon'])
  })

  it('ignores atoms with no validUntil', () => {
    assert.ok(!findExpiring(memory(), NOW, { withinDays: 9999 }).some((f) => f.atomId === 'product.limits'))
  })

  it('skips a malformed date instead of warning twice about it', () => {
    // W_DATE_FORM already fired at load. Repeating it here trains people to skim.
    const broken = [atomFile('product.x', 'validUntil: "not a date"\n')]
    assert.deepEqual(findExpiring(loadMemory(broken, config).base, NOW), [])
  })

  it('keeps serving an expired atom — expiry is a gap, never a deletion', () => {
    const loaded = memory()
    assert.ok(loaded.byId.has('research.old'), 'the atom must still be in the base')
    assert.equal(loaded.byId.get('research.old')!.body, 'Body.')
  })

  it('carries the source into the gap so it can be acted on without a lookup', () => {
    const [gap] = expiryToGaps(memory(), NOW)
    assert.equal(gap.kind, 'expiry')
    assert.equal(gap.atomId, 'research.old')
    assert.match(gap.detail!, /re-check https:\/\/example\.com\/a/)
  })

  it('says so when there is no source to re-check', () => {
    const [gap] = expiryToGaps(loadMemory([atomFile('research.soon', 'validUntil: "2026-01-01"\n')], config).base, NOW)
    assert.match(gap.detail!, /no source recorded/)
  })

  it('deduplicates and counts recurrence like every other gap kind', () => {
    const ledger = createGapLedger([])
    for (const observation of expiryToGaps(memory(), NOW)) ledger.observe(observation)
    for (const observation of expiryToGaps(memory(), NOW)) ledger.observe(observation)
    const open = ledger.open()
    assert.equal(open.length, 1)
    assert.equal(open[0].count, 2)
  })

  it('deduplicates across days — the topic must not move with the clock', () => {
    // The ledger keys on (kind, normalized topic). A topic containing "expired
    // 30d ago" mints a fresh record every single day, so one stale atom becomes
    // an unbounded pile of gaps that can never be closed. Found in the example
    // memory, not by this test — hence the test.
    const ledger = createGapLedger([])
    for (const day of ['2026-09-20', '2026-09-21', '2026-10-05']) {
      for (const observation of expiryToGaps(memory(), new Date(`${day}T00:00:00Z`))) {
        ledger.observe(observation)
      }
    }
    const expiry = ledger.open().filter((record) => record.kind === 'expiry')
    assert.equal(expiry.length, 2, 'one record per expired atom, not one per observation')
    assert.ok(expiry.every((record) => record.count >= 1))
    assert.ok(
      expiry.every((record) => !/\d+d ago/.test(record.topic)),
      'elapsed time belongs in the detail, never in the dedup key',
    )
  })

  it('still reports elapsed time, in the detail where it may change', () => {
    const [gap] = expiryToGaps(memory(), new Date('2026-10-05T00:00:00Z'))
    assert.match(gap.detail!, /expired \d+d ago/)
    assert.match(gap.topic, /research\.old is past validUntil 2026-01-01/)
  })

  it('is deterministic — the same clock gives the same answer', () => {
    assert.deepEqual(findExpiring(memory(), NOW), findExpiring(memory(), NOW))
  })
})

/* ================================================================== *
 * Round trip — the field that gets silently dropped
 * ================================================================== */

describe('round trip', () => {
  it('preserves all four fields through compile and reload', () => {
    const files = [atomFile(
      'research.x',
      'durability: fixed\nsource: https://example.com/x\nretrievedAt: "2026-08-30"\nvalidUntil: "2027-01-01"\n',
    )]
    const atom = loadMemory(files, config).base.atoms[0]

    const serialized = serializeAtom({
      id: atom.id, title: atom.title, category: atom.category, lang: atom.lang,
      summary: atom.summary, alwaysInclude: atom.alwaysInclude, intents: atom.intents,
      keywords: atom.keywords, synonyms: atom.synonyms, related: atom.related ?? [],
      durability: atom.durability, source: atom.source, retrievedAt: atom.retrievedAt,
      validUntil: atom.validUntil, body: atom.body,
    })
    const reloaded = loadMemory([{ path: 'research/x.md', content: serialized }], config).base.atoms[0]

    assert.equal(reloaded.durability, 'fixed')
    assert.equal(reloaded.source, 'https://example.com/x')
    assert.equal(reloaded.retrievedAt, '2026-08-30')
    assert.equal(reloaded.validUntil, '2027-01-01')
  })

  it('emits dates quoted, so the round trip does not depend on whose parser runs', () => {
    const serialized = serializeAtom({
      id: 'research.x', title: 'T', category: 'research', lang: 'en', summary: '',
      alwaysInclude: false, intents: [], keywords: [], synonyms: [], related: [],
      validUntil: '2027-01-01', body: 'Body.',
    })
    assert.match(serialized, /validUntil: "2027-01-01"/)
  })

  it('omits durability when it is the default — a file of "stable" is noise', () => {
    const serialized = serializeAtom({
      id: 'product.x', title: 'T', category: 'product', lang: 'en', summary: '',
      alwaysInclude: false, intents: [], keywords: [], synonyms: [], related: [],
      durability: 'stable', body: 'Body.',
    })
    assert.doesNotMatch(serialized, /durability:/)
  })

  it('planApply reports a durability change instead of calling it unchanged', () => {
    const files = [atomFile('product.limits', 'durability: stable\n')]
    const plan = planApply(loadMemory(files, config).base, [{
      id: 'product.limits', title: 'T', category: 'product', lang: 'en',
      keywords: ['alpha', 'beta'], summary: 'S.', body: 'Body.', durability: 'fixed',
    }])
    assert.equal(plan.plans[0].verdict, 'update')
    assert.ok(plan.plans[0].changedFields.includes('durability'))
  })

  it('planApply reports a provenance change', () => {
    const plan = planApply(base(), [{
      id: 'product.limits', title: 'T', category: 'product', lang: 'en',
      keywords: ['alpha', 'beta'], summary: 'S.', body: 'Body.',
      source: 'https://example.com', validUntil: '2027-01-01',
    }])
    assert.deepEqual(plan.plans[0].changedFields.sort(), ['source', 'validUntil'])
  })
})

/* ================================================================== *
 * End to end
 * ================================================================== */

describe('through the memory-tool handler', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'amk-dur-'))
    for (const file of BASE_FILES) {
      const target = join(root, file.path)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, file.content)
    }
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('leaves the disk untouched when a volatile write is refused', () => {
    const memory = createMemoryToolHandler({ root, config })
    const result = memory.handle({
      command: 'create',
      path: '/memories/product/meeting.md',
      file_text: atomFile('product.meeting', 'durability: volatile\n').content,
    })
    assert.equal(result.is_error, true)
    assert.ok(!existsSync(join(root, 'product/meeting.md')))
  })

  it('writes a durable atom with provenance and reloads it intact', () => {
    const memory = createMemoryToolHandler({ root, config })
    const result = memory.handle({
      command: 'create',
      path: '/memories/research/sla.md',
      file_text: atomFile(
        'research.sla',
        'durability: fixed\nsource: https://example.com/sla\nvalidUntil: "2027-03-01"\n',
      ).content,
    })
    assert.equal(result.is_error, false)
    const atom = loadMemory(
      [...BASE_FILES, { path: 'research/sla.md', content: atomFile('research.sla', 'durability: fixed\nsource: https://example.com/sla\nvalidUntil: "2027-03-01"\n').content }],
      config,
    ).base.byId.get('research.sla')!
    assert.equal(atom.durability, 'fixed')
    assert.equal(atom.validUntil, '2027-03-01')
  })
})
