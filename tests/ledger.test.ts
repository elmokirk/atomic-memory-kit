/**
 * Gap ledger persistence (red-team R15): a corrupt line is evidence that
 * something went wrong, so it is reported with its line number while every
 * valid line around it still loads.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'

import { readGapLedger } from '../adapters/fs.ts'

let dir: string
let file: string

const record = (id: string) => JSON.stringify({ id, kind: 'runtime', topic: id, status: 'open', count: 1 })

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'amk-ledger-'))
  file = join(dir, 'gaps.jsonl')
  // Line 3 is a write torn mid-record; line 4 is blank and must not count.
  writeFileSync(file, `${record('a')}\r\n${record('b')}\n{"id":"c","kind":"runt\n\n${record('d')}\n`)
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('corrupt ledger lines (R15)', () => {
  it('keeps every valid line and names the corrupt one by line number', () => {
    const corrupt: [number, string][] = []
    const records = readGapLedger(file, (line, text) => corrupt.push([line, text]))
    assert.deepEqual(records.map((entry) => entry.id), ['a', 'b', 'd'])
    assert.deepEqual(corrupt, [[3, '{"id":"c","kind":"runt']])
  })

  it('warns on stderr by default instead of skipping silently', { timeout: 2000 }, async () => {
    const warned = new Promise<Error>((resolve) => process.once('warning', resolve))
    const records = readGapLedger(file)
    assert.equal(records.length, 3)
    const warning = await warned
    assert.match(warning.message, /gaps\.jsonl:3/)
    assert.match(warning.message, /corrupt/)
  })
})
