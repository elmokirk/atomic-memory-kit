/**
 * Root confinement for every adapter that reads or writes atoms
 * (red-team R13, R14).
 *
 * The oracle is a sentinel file outside the memory root: after each refused
 * call it must still hold its original bytes, and the directory around it must
 * hold nothing new. A refusal message alone proves nothing about the disk.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'

import { readMemoryDir, writeMemoryFiles } from '../adapters/fs.ts'
import { createMemoryToolHandler } from '../adapters/memory-tool.ts'
import { defineMemoryConfig } from '../src/config.ts'

const SENTINEL_TEXT = 'sentinel: must never change\n'

let sandbox: string
let root: string
let outside: string
let sentinel: string

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'amk-confine-'))
  root = join(sandbox, 'memory')
  outside = join(sandbox, 'outside')
  mkdirSync(join(root, 'pricing'), { recursive: true })
  mkdirSync(outside)
  sentinel = join(outside, 'sentinel.md')
  writeFileSync(sentinel, SENTINEL_TEXT)
})

afterEach(() => rmSync(sandbox, { recursive: true, force: true }))

function assertOutsideUntouched(): void {
  assert.equal(readFileSync(sentinel, 'utf8'), SENTINEL_TEXT)
  assert.deepEqual(readdirSync(outside), ['sentinel.md'])
  assert.deepEqual(readdirSync(sandbox).sort(), ['memory', 'outside'])
}

/** A directory link from inside the root to `outside`; a junction on Windows. */
function linkOutside(name: string): void {
  symlinkSync(outside, join(root, name), 'junction')
}

const atom = (body: string) => `---\nid: x\n---\n\n${body}\n`

describe('writeMemoryFiles stays inside the root (R14)', () => {
  const escapes = [
    '../sentinel.md',
    '../outside/sentinel.md',
    'pricing/../../outside/sentinel.md',
    '..\\outside\\sentinel.md',
    'pricing\\..\\..\\outside\\sentinel.md',
    '/etc/amk-escape.md',
    'C:\\Windows\\amk-escape.md',
    'C:/Windows/amk-escape.md',
    '\\\\server\\share\\amk-escape.md',
  ]

  for (const path of escapes) {
    it(`refuses ${JSON.stringify(path)} and writes nothing`, () => {
      assert.throws(() => writeMemoryFiles(root, [{ path, content: 'overwritten' }]), /outside the memory root/)
      assertOutsideUntouched()
    })
  }

  it('refuses an absolute path naming the sentinel itself', () => {
    assert.throws(() => writeMemoryFiles(root, [{ path: sentinel, content: 'overwritten' }]), /outside the memory root/)
    assertOutsideUntouched()
    assert.deepEqual(readdirSync(root), ['pricing'])
  })

  it('refuses the whole batch when one path escapes, so no partial write lands', () => {
    assert.throws(() => writeMemoryFiles(root, [
      { path: 'pricing/ok.md', content: atom('fine') },
      { path: '../outside/new.md', content: 'escape' },
    ]))
    assert.equal(existsSync(join(root, 'pricing', 'ok.md')), false)
    assertOutsideUntouched()
  })

  it('still writes ordinary nested paths, creating the root if needed', () => {
    rmSync(root, { recursive: true })
    const result = writeMemoryFiles(root, [{ path: 'pricing/plans.md', content: atom('ok') }])
    assert.deepEqual(result.written, ['pricing/plans.md'])
    assert.equal(readFileSync(join(root, 'pricing', 'plans.md'), 'utf8'), atom('ok'))
  })
})

describe('symlink and junction escapes (R13)', () => {
  it('refuses a write through a directory junction that leaves the root', () => {
    linkOutside('link')
    assert.throws(() => writeMemoryFiles(root, [{ path: 'link/sentinel.md', content: 'overwritten' }]), /outside the memory root/)
    assert.throws(() => writeMemoryFiles(root, [{ path: 'link/new/deeper.md', content: 'escape' }]), /outside the memory root/)
    assertOutsideUntouched()
  })

  it('accepts a link that stays inside the root', () => {
    symlinkSync(join(root, 'pricing'), join(root, 'alias'), 'junction')
    const result = writeMemoryFiles(root, [{ path: 'alias/plans.md', content: atom('ok') }])
    assert.deepEqual(result.written, ['alias/plans.md'])
    assert.equal(existsSync(join(root, 'pricing', 'plans.md')), true)
  })

  it('refuses to read an atom file that is a symlink out of the root', (t) => {
    try {
      symlinkSync(sentinel, join(root, 'leak.md'), 'file')
    } catch (error) {
      // Windows without Developer Mode or admin cannot create file symlinks.
      return t.skip(`file symlink not creatable here: ${(error as NodeJS.ErrnoException).code}`)
    }
    assert.throws(() => readMemoryDir(root), /outside the memory root/)
  })

  it('does not read through a directory junction that leaves the root', () => {
    linkOutside('link')
    const paths = readMemoryDir(root).map((file) => file.path)
    assert.deepEqual(paths, [])
  })

  it('memory tool: create through a junction is refused and nothing lands outside', () => {
    linkOutside('link')
    const handler = createMemoryToolHandler({ root, config: defineMemoryConfig({ categories: ['link'] }) })
    // Contract-valid atoms, so the only reason left to refuse is the path.
    for (const name of ['sentinel', 'fresh']) {
      const file_text = `---\nid: link.${name}\ntitle: "T"\ncategory: link\nlang: en\n---\n\nBody.\n`
      const result = handler.handle({ command: 'create', path: `/memories/link/${name}.md`, file_text })
      assert.equal(result.is_error, true)
      assert.match(result.content, /outside the memory root/)
      assert.match(result.content, /Nothing was written/)
    }
    assertOutsideUntouched()
  })

  it('memory tool: a delete is confined by the same rule', () => {
    // A file inside the root whose name matches; the delete must resolve inside.
    writeFileSync(join(root, 'pricing', 'plans.md'), atom('ok'))
    const handler = createMemoryToolHandler({ root, config: defineMemoryConfig({ categories: ['pricing'] }) })
    const result = handler.handle({ command: 'delete', path: '/memories/pricing/plans.md' })
    assert.equal(result.is_error, false)
    assert.equal(existsSync(join(root, 'pricing', 'plans.md')), false)
    assertOutsideUntouched()
  })
})
