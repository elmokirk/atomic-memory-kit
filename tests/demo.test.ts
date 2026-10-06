/**
 * The chatbot demo, run as a real process: it is the README's first promise,
 * so it is tested the way a newcomer runs it.
 *
 * The ledger file is read back with the real adapter and matched by gap id, so
 * the test does not trust the demo's own printout of what it recorded.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, describe, it } from 'node:test'
import { readGapLedger } from '../adapters/fs.ts'
import { gapId } from '../src/gaps.ts'

const REPO = fileURLToPath(new URL('..', import.meta.url))
const DEMO = join(REPO, 'example', 'chatbot', 'demo.mjs')

// Includes untracked files, so a stray write anywhere in the tree shows up.
const gitStatus = () => {
  const result = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: REPO, encoding: 'utf8' })
  return result.status === 0 ? result.stdout : null
}

describe('example/chatbot/demo.mjs', () => {
  let out: string
  let run: ReturnType<typeof spawnSync>
  let statusBefore: string | null

  before(() => {
    out = mkdtempSync(join(tmpdir(), 'amk-demo-test-'))
    statusBefore = gitStatus()
    run = spawnSync(process.execPath, [DEMO, '--out', out], { cwd: REPO, encoding: 'utf8' })
  })

  after(() => rmSync(out, { recursive: true, force: true }))

  it('exits 0 with no API key and no network', () => {
    assert.equal(run.status, 0, `${run.stdout}${run.stderr}`)
  })

  it('the answer shown to the user contains no gap marker, not even a fragment', () => {
    const answer = String(run.stdout).split('answer shown to the user:\n')[1]!.split('\n== ')[0]!
    assert.match(answer, /Starter includes 5 seats/)
    assert.doesNotMatch(answer, /\[GA|GAP:|plan\]/)
  })

  it('records the streamed marker as a runtime gap and the off-topic question as a scope gap', () => {
    const ledger = readGapLedger(join(out, 'gaps.jsonl'))
    const ids = ledger.map((record) => record.id).sort()
    assert.deepEqual(ids, [
      gapId('runtime', 'SSO on the Starter plan'),
      gapId('scope', 'Give me a recipe for strawberry jam'),
    ].sort())
  })

  it('reports no_match before any model call: one question answered, one model call', () => {
    assert.match(String(run.stdout), /scope: no_match/)
    assert.match(String(run.stdout), /model calls: 1\n/)
  })

  it('leaves the working tree exactly as it found it', (t) => {
    if (statusBefore === null) return t.skip('not a git checkout')
    assert.equal(gitStatus(), statusBefore)
  })
})
