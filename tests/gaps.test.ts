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
  GAP_MARKER_PATTERN,
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

/*
 * The oracle for every streaming test below is the batch regex over the whole
 * text: however a stream is cut, the decoder must find exactly the markers
 * `GAP_MARKER_PATTERN` finds and show exactly the text it leaves behind.
 */
function batch(text: string): { text: string, topics: string[] } {
  return { text: text.replace(GAP_MARKER_PATTERN, ''), topics: extractGapTopics(text) }
}

function stream(deltas: string[]): { text: string, topics: string[] } {
  const detector = createGapDetector()
  let text = ''
  const topics: string[] = []
  for (const delta of deltas) {
    const out = detector.write(delta)
    text += out.text
    topics.push(...out.topics)
  }
  const last = detector.end()
  return { text: text + last.text, topics: [...topics, ...last.topics] }
}

// Hostile on purpose: brackets that are not markers, a near-miss head, an empty
// topic, a marker with no space, a marker opened inside a bracket, runs of
// whitespace and newlines around markers.
const SAMPLE = 'See [1] and [GA] or [GAME].  Ask us. [GAP: sso pricing]\n\n[GAP: ]x [[GAP:refunds]  end '

describe('streaming decoder', () => {
  it('is lossless at every single split point', () => {
    for (let cut = 0; cut <= SAMPLE.length; cut++) {
      assert.deepEqual(stream([SAMPLE.slice(0, cut), SAMPLE.slice(cut)]), batch(SAMPLE), `cut at ${cut}`)
    }
  })

  it('is lossless at every pair of split points', () => {
    for (let a = 0; a <= SAMPLE.length; a++) {
      for (let b = a; b <= SAMPLE.length; b++) {
        const deltas = [SAMPLE.slice(0, a), SAMPLE.slice(a, b), SAMPLE.slice(b)]
        assert.deepEqual(stream(deltas), batch(SAMPLE), `cuts at ${a}, ${b}`)
      }
    }
  })

  it('finds every marker when markers are farther apart than any tail', () => {
    const filler = 'Plain answer text that goes on for a while. '.repeat(10)
    const text = `${filler}[GAP: first]${filler}[GAP: second]${filler}[GAP: third]${filler}`
    for (const size of [1, 3, 7, 64, 127, 128, 129, text.length]) {
      const deltas = text.match(new RegExp(`[\\s\\S]{1,${size}}`, 'g'))!
      assert.deepEqual(stream(deltas), batch(text), `chunk size ${size}`)
    }
    assert.deepEqual(batch(text).topics, ['first', 'second', 'third'])
  })

  it('reassembles a marker split across one-character deltas', () => {
    const text = 'answer  [GAP: tiny chunks]  end'
    assert.deepEqual(stream([...text]), { text: 'answer    end', topics: ['tiny chunks'] })
  })

  it('releases text that cannot be a marker without waiting for the end', () => {
    const detector = createGapDetector()
    assert.deepEqual(detector.write('See [1] and [GAME] now'), { text: 'See [1] and [GAME] now', topics: [] })
    assert.deepEqual(detector.write('[GAP: x'.padEnd(100, 'y')), { text: '[GAP: x'.padEnd(100, 'y'), topics: [] })
  })

  it('holds back only a possible marker, then releases it verbatim at end of stream', () => {
    const detector = createGapDetector()
    assert.deepEqual(detector.write('Truncated answer [GAP: pric'), { text: 'Truncated answer ', topics: [] })
    assert.deepEqual(detector.end(), { text: '[GAP: pric', topics: [] })
    // end() leaves a clean detector for the next turn.
    assert.deepEqual(detector.write('[GAP: next]'), { text: '', topics: ['next'] })
  })

  it('reset drops held text so it cannot leak into the next turn', () => {
    const detector = createGapDetector()
    detector.write('half a marker [GA')
    detector.reset()
    assert.deepEqual(detector.write('P: no]'), { text: 'P: no]', topics: [] })
  })

  it('push still reports topics from markers far apart (R01)', () => {
    const detector = createGapDetector()
    const filler = 'x'.repeat(300)
    const found = [`${filler}[GAP: one]`, filler, '[GAP: two]', filler].flatMap((delta) => detector.push(delta))
    assert.deepEqual(found, ['one', 'two'])
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
