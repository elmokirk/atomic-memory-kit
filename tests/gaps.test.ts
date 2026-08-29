/**
 * Gap subsystem: marker protocol, streaming detection, ledger semantics.
 *
 * The streaming test matters most. A marker split across two deltas is the
 * normal case with token streaming, not an edge case — an implementation that
 * only tests complete strings will silently miss most gaps in production.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  createGapDetector,
  createGapLedger,
  extractGapTopics,
  findTodoMarkers,
  gapId,
  parseGapReport,
  renderGapReport,
  stripGapMarkers,
} from '../src/gaps.ts'

describe('gap markers', () => {
  it('extracts topics from a complete text', () => {
    const text = 'I cannot answer that reliably. [GAP: sso pricing]'
    assert.deepEqual(extractGapTopics(text), ['sso pricing'])
  })

  it('extracts several markers', () => {
    assert.deepEqual(
      extractGapTopics('a [GAP: one] b [GAP: two] c'),
      ['one', 'two'],
    )
  })

  it('ignores an empty topic', () => {
    assert.deepEqual(extractGapTopics('[GAP: ]'), [])
  })

  it('strips markers from user-visible text', () => {
    const stripped = stripGapMarkers('Ask the team directly. [GAP: sso pricing]')
    assert.equal(stripped, 'Ask the team directly.')
    assert.ok(!stripped.includes('GAP'))
  })
})

describe('streaming detector', () => {
  it('detects a marker split across deltas', () => {
    const detector = createGapDetector()
    const deltas = ['I do not ', 'know that. [G', 'AP: ss', 'o pricing', ']']
    const found = deltas.flatMap((delta) => detector.push(delta))
    assert.deepEqual(found, ['sso pricing'])
  })

  it('reports each marker exactly once', () => {
    const detector = createGapDetector()
    let count = 0
    for (const delta of ['[GAP: a]', ' text ', '[GAP: b]', ' more']) {
      count += detector.push(delta).length
    }
    assert.equal(count, 2)
  })

  it('detects one marker per character-sized delta', () => {
    const detector = createGapDetector()
    const found = [...'answer [GAP: tiny chunks] end'].flatMap((char) => detector.push(char))
    assert.deepEqual(found, ['tiny chunks'])
  })

  it('resets between turns', () => {
    const detector = createGapDetector()
    detector.push('[GAP: first]')
    detector.reset()
    assert.deepEqual(detector.push('[GAP: second]'), ['second'])
  })
})

describe('gap ledger', () => {
  const at = '2026-01-01T00:00:00.000Z'

  it('gives the same gap a stable id regardless of casing and spacing', () => {
    assert.equal(gapId('runtime', 'SSO  Pricing '), gapId('runtime', 'sso pricing'))
  })

  it('separates ids by kind', () => {
    assert.notEqual(gapId('runtime', 'x'), gapId('drift', 'x'))
  })

  it('deduplicates and counts recurrences', () => {
    const ledger = createGapLedger()
    ledger.observe({ kind: 'runtime', topic: 'sso pricing', at })
    ledger.observe({ kind: 'runtime', topic: 'SSO pricing', at })
    ledger.observe({ kind: 'runtime', topic: 'sso pricing', at })
    assert.equal(ledger.all().length, 1)
    assert.equal(ledger.all()[0]!.count, 3)
  })

  it('sorts by recurrence — demand ranks the backlog', () => {
    const ledger = createGapLedger()
    ledger.observe({ kind: 'runtime', topic: 'rare', at })
    for (let index = 0; index < 5; index++) ledger.observe({ kind: 'runtime', topic: 'common', at })
    assert.equal(ledger.all()[0]!.topic, 'common')
  })

  it('reopens a closed gap when it is observed again', () => {
    const ledger = createGapLedger()
    const record = ledger.observe({ kind: 'runtime', topic: 'sso', at })
    ledger.close(record.id, 'product.sso')
    assert.equal(ledger.get(record.id)!.status, 'closed')

    ledger.observe({ kind: 'runtime', topic: 'sso', at })
    assert.equal(ledger.get(record.id)!.status, 'open', 'a recurring gap means the fix did not work')
    assert.equal(ledger.get(record.id)!.resolvedBy, undefined)
  })

  it('prunes only old closed records', () => {
    const ledger = createGapLedger()
    const old = ledger.observe({ kind: 'todo', topic: 'ancient', at: '2020-01-01T00:00:00.000Z' })
    const fresh = ledger.observe({ kind: 'todo', topic: 'recent', at: '2026-01-01T00:00:00.000Z' })
    ledger.close(old.id)
    const removed = ledger.prune(30, new Date('2026-02-01T00:00:00.000Z'))
    assert.equal(removed, 1)
    assert.ok(ledger.get(fresh.id), 'open records survive pruning')
  })

  it('restores from persisted records', () => {
    const first = createGapLedger()
    first.observe({ kind: 'runtime', topic: 'persisted', at })
    const second = createGapLedger(JSON.parse(JSON.stringify(first.all())))
    second.observe({ kind: 'runtime', topic: 'persisted', at })
    assert.equal(second.all()[0]!.count, 2)
  })
})

describe('gap report round trip', () => {
  it('renders checkboxes that parse back into closed ids', () => {
    const ledger = createGapLedger()
    const a = ledger.observe({ kind: 'runtime', topic: 'alpha' })
    const b = ledger.observe({ kind: 'drift', topic: 'beta' })

    const report = renderGapReport(ledger.all())
    assert.ok(report.includes(`- [ ] \`${a.id}\``))
    assert.ok(report.includes(`- [ ] \`${b.id}\``))

    const edited = report.replace(`- [ ] \`${a.id}\``, `- [x] \`${a.id}\``)
    const parsed = parseGapReport(edited)
    assert.deepEqual(parsed.closed, [a.id])
    assert.deepEqual(parsed.stillOpen, [b.id])
  })

  it('groups by kind', () => {
    const ledger = createGapLedger()
    ledger.observe({ kind: 'runtime', topic: 'x' })
    ledger.observe({ kind: 'todo', topic: 'y' })
    const report = renderGapReport(ledger.all())
    assert.ok(report.includes('## Asked for, not known (runtime)'))
    assert.ok(report.includes('## Author TODOs inside atoms'))
  })
})

describe('todo detection', () => {
  it('finds TODO(owner) markers and cleans comment terminators', () => {
    const found = findTodoMarkers([
      { id: 'a.b', body: '<!-- TODO(kirk): document the SSO flow -->', sourcePath: 'a/b.md' },
    ])
    assert.equal(found.length, 1)
    assert.equal(found[0]!.topic, 'document the SSO flow')
    assert.equal(found[0]!.atomId, 'a.b')
  })

  it('finds bare TODO: markers', () => {
    const found = findTodoMarkers([{ id: 'a.b', body: 'TODO: add numbers' }])
    assert.equal(found[0]!.topic, 'add numbers')
  })

  it('still records a marker with no text', () => {
    const found = findTodoMarkers([{ id: 'a.b', body: '<!-- TODO(kirk): -->' }])
    assert.equal(found.length, 1)
    assert.match(found[0]!.topic, /unspecified TODO in a\.b/)
  })
})
