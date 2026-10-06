/**
 * The Anthropic memory tool, backed by the contract.
 *
 * Two classes of test here, and the second is the point of the module:
 *
 *   1. **Compatibility** — the documented return strings and error messages,
 *      so the model's trained expectations still hold.
 *   2. **Properties a filesystem handler cannot have** — a refused write, a
 *      refused delete, an edge-rewriting rename, and a miss that becomes a gap.
 *
 * If group 2 ever passes trivially, the module has stopped earning its place.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, posix, win32 } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'

import { createMemoryToolHandler } from '../adapters/memory-tool.ts'
import { defineMemoryConfig } from '../src/config.ts'
import { loadMemory } from '../src/loader.ts'
import { runMemoryToolCommand, toRelativePath } from '../src/memory-tool.ts'
import { readMemoryDir } from '../adapters/fs.ts'
import type { MemoryFileRaw } from '../src/types.ts'

const config = defineMemoryConfig({ categories: ['pricing', 'product'], intents: [] })

const FILES: MemoryFileRaw[] = [
  {
    path: 'pricing/plans.md',
    content: '---\nid: pricing.plans\ntitle: "Plans"\ncategory: pricing\nlang: en\nkeywords: [price, cost]\nrelated: [product.limits]\nsummary: "Plan prices."\n---\n\nStarter costs 49 EUR.\n',
  },
  {
    path: 'product/limits.md',
    content: '---\nid: product.limits\ntitle: "Limits"\ncategory: product\nlang: en\nkeywords: [limits, seats]\nsummary: "Plan limits."\n---\n\nStarter includes 5 seats.\n',
  },
]

const ctx = () => ({ files: FILES, base: loadMemory(FILES, config).base })

const ATOM = (id: string, category: string, extra = '') =>
  `---\nid: ${id}\ntitle: "T"\ncategory: ${category}\nlang: en\nkeywords: [alpha, beta]\nsummary: "S."\n${extra}---\n\nBody.\n`

/* ================================================================== *
 * Path safety
 * ================================================================== */

describe('path traversal protection', () => {
  const rejected = [
    '/etc/passwd',
    '/memories/../secrets.env',
    '/memories/../../etc/passwd',
    '/memories/a/../../b.md',
    '/memories/%2e%2e%2fsecrets.env',
    '/memories/%252e%252e%252fsecrets.env',
    '/memories\\..\\secrets.env',
    'memories/x.md',
    '',
  ]

  for (const path of rejected) {
    it(`rejects ${JSON.stringify(path)}`, () => {
      assert.equal(toRelativePath(path), null)
    })
  }

  // S06: these passed the `..` check but came back absolute, so any caller
  // that resolves instead of joins lands outside the root.
  const absoluteAfterPrefix = [
    '/memories//etc/passwd',
    '/memories/%2Fetc%2Fpasswd',
    '/memories/C:/Windows/win.ini',
    '/memories/C:\\Windows\\win.ini',
    '/memories/c%3A%5CWindows%5Cwin.ini',
    '/memories/\\\\server\\share\\x.md',
    '/memories/pricing/plans.md:hidden',
  ]
  for (const path of absoluteAfterPrefix) {
    it(`never yields an absolute, drive or stream path for ${JSON.stringify(path)}`, () => {
      const relative = toRelativePath(path)
      if (relative !== null) {
        assert.equal(posix.isAbsolute(relative) || win32.isAbsolute(relative) || relative.includes(':'), false, relative)
      }
      assert.equal(relative, null)
    })
  }

  it('accepts the root and ordinary nested paths', () => {
    assert.equal(toRelativePath('/memories'), '')
    assert.equal(toRelativePath('/memories/'), '')
    assert.equal(toRelativePath('/memories/pricing/plans.md'), 'pricing/plans.md')
  })

  it('refuses a traversal path at the command level, not just the parser', () => {
    const outcome = runMemoryToolCommand({ command: 'view', path: '/memories/../../etc/passwd' }, ctx())
    assert.equal(outcome.isError, true)
    assert.match(outcome.content, /outside \/memories/)
    assert.deepEqual(outcome.writes, [])
  })
})

/* ================================================================== *
 * Compatibility with the documented behaviour
 * ================================================================== */

describe('view', () => {
  it('returns the documented directory header and size/path lines', () => {
    const outcome = runMemoryToolCommand({ command: 'view', path: '/memories' }, ctx())
    assert.equal(outcome.isError, false)
    assert.match(outcome.content, /^Here're the files and directories up to 2 levels deep in \/memories/)
    assert.match(outcome.content, /\t\/memories\/pricing\/plans\.md/)
  })

  it('annotates the listing with titles and summaries', () => {
    // The affordance a filesystem cannot give: decide what to open without
    // opening anything.
    const outcome = runMemoryToolCommand({ command: 'view', path: '/memories' }, ctx())
    assert.match(outcome.content, /pricing\.plans — Plans: Plan prices\./)
  })

  it('returns file contents with 6-wide 1-indexed line numbers', () => {
    const outcome = runMemoryToolCommand({ command: 'view', path: '/memories/pricing/plans.md' }, ctx())
    assert.match(outcome.content, /^Here's the content of \/memories\/pricing\/plans\.md with line numbers:\n/)
    assert.match(outcome.content, /\n {5}1\t---\n/)
  })

  it('honours view_range, including [start, -1]', () => {
    const all = runMemoryToolCommand({ command: 'view', path: '/memories/pricing/plans.md' }, ctx())
    const ranged = runMemoryToolCommand(
      { command: 'view', path: '/memories/pricing/plans.md', view_range: [2, 3] },
      ctx(),
    )
    assert.equal(ranged.content.split('\n').length, 3)
    assert.match(ranged.content, /\n {5}2\t/)
    assert.ok(all.content.length > ranged.content.length)

    const toEnd = runMemoryToolCommand(
      { command: 'view', path: '/memories/pricing/plans.md', view_range: [8, -1] },
      ctx(),
    )
    assert.match(toEnd.content, /\n {5}8\t/)
  })

  it('lists a subdirectory', () => {
    const outcome = runMemoryToolCommand({ command: 'view', path: '/memories/pricing' }, ctx())
    assert.equal(outcome.isError, false)
    assert.match(outcome.content, /plans\.md/)
    assert.doesNotMatch(outcome.content, /limits\.md/)
  })
})

describe('str_replace, insert, delete, rename — documented messages', () => {
  it('reports a missing old_str verbatim', () => {
    const outcome = runMemoryToolCommand(
      { command: 'str_replace', path: '/memories/pricing/plans.md', old_str: 'nope', new_str: 'x' },
      ctx(),
    )
    assert.equal(outcome.isError, true)
    assert.match(outcome.content, /No replacement was performed, old_str `nope` did not appear verbatim/)
  })

  it('refuses an ambiguous old_str and names the lines', () => {
    const files: MemoryFileRaw[] = [{
      path: 'product/dup.md',
      content: `${ATOM('product.dup', 'product')}\nrepeat\nrepeat\n`,
    }]
    const outcome = runMemoryToolCommand(
      { command: 'str_replace', path: '/memories/product/dup.md', old_str: 'repeat', new_str: 'x' },
      { files, base: loadMemory(files, config).base },
    )
    assert.equal(outcome.isError, true)
    assert.match(outcome.content, /Multiple occurrences of old_str `repeat` in lines: \d+, \d+/)
    assert.deepEqual(outcome.writes, [])
  })

  it('rejects an out-of-range insert_line with the documented bounds', () => {
    const outcome = runMemoryToolCommand(
      { command: 'insert', path: '/memories/pricing/plans.md', insert_line: 999, insert_text: 'x' },
      ctx(),
    )
    assert.equal(outcome.isError, true)
    assert.match(outcome.content, /Invalid `insert_line` parameter: 999.*range of lines of the file: \[0, \d+\]/s)
  })

  it('refuses to delete or rename the memory root', () => {
    assert.match(
      runMemoryToolCommand({ command: 'delete', path: '/memories' }, ctx()).content,
      /cannot be deleted/,
    )
    assert.match(
      runMemoryToolCommand({ command: 'rename', old_path: '/memories', new_path: '/memories/x' }, ctx()).content,
      /cannot be renamed/,
    )
  })

  it('refuses to rename onto an existing destination', () => {
    const outcome = runMemoryToolCommand(
      { command: 'rename', old_path: '/memories/pricing/plans.md', new_path: '/memories/product/limits.md' },
      ctx(),
    )
    assert.equal(outcome.isError, true)
    assert.match(outcome.content, /destination .* already exists/)
  })

  it('names the supported commands when given an unknown one', () => {
    const outcome = runMemoryToolCommand({ command: 'append' }, ctx())
    assert.equal(outcome.isError, true)
    assert.match(outcome.content, /unknown command append/)
    assert.match(outcome.content, /view, create, str_replace, insert, delete, rename/)
  })
})

/* ================================================================== *
 * What a filesystem handler cannot do
 * ================================================================== */

describe('the contract gate', () => {
  it('refuses a write with no frontmatter and explains the format', () => {
    const outcome = runMemoryToolCommand(
      { command: 'create', path: '/memories/product/note.md', file_text: 'just some prose\n' },
      ctx(),
    )
    assert.equal(outcome.isError, true)
    assert.equal(outcome.code, 'E_PARSE')
    assert.match(outcome.content, /id, title, category, lang/)
    assert.deepEqual(outcome.writes, [], 'nothing may be written when the gate refuses')
  })

  it('refuses a missing core field and returns its diagnostic code', () => {
    const outcome = runMemoryToolCommand(
      {
        command: 'create',
        path: '/memories/product/note.md',
        file_text: '---\nid: product.note\ntitle: "T"\n---\n\nBody.\n',
      },
      ctx(),
    )
    assert.equal(outcome.code, 'E_CORE_MISSING')
    assert.match(outcome.content, /\[E_CORE_MISSING\]/)
    assert.match(outcome.content, /Nothing was written/)
  })

  it('refuses a dangling edge and says which target is missing', () => {
    const outcome = runMemoryToolCommand(
      {
        command: 'create',
        path: '/memories/product/note.md',
        file_text: ATOM('product.note', 'product', 'related: [product.ghost]\n'),
      },
      ctx(),
    )
    assert.equal(outcome.code, 'E_EDGE_DANGLING')
    assert.match(outcome.content, /"product\.ghost"/)
    assert.match(outcome.content, /fails the whole memory load/)
  })

  it('accepts an edge to an atom created in the same write', () => {
    const outcome = runMemoryToolCommand(
      {
        command: 'create',
        path: '/memories/product/note.md',
        file_text: ATOM('product.note', 'product', 'related: [pricing.plans]\n'),
      },
      ctx(),
    )
    assert.equal(outcome.isError, false)
    assert.equal(outcome.writes.length, 1)
  })

  it('refuses a write whose id does not match its path', () => {
    const outcome = runMemoryToolCommand(
      { command: 'create', path: '/memories/product/note.md', file_text: ATOM('pricing.elsewhere', 'pricing') },
      ctx(),
    )
    assert.equal(outcome.isError, true)
    assert.match(outcome.content, /maps to \/memories\/pricing\/elsewhere\.md/)
  })

  it('accepts a valid write and passes warnings through as advice', () => {
    const outcome = runMemoryToolCommand(
      {
        command: 'create',
        path: '/memories/product/note.md',
        file_text: '---\nid: product.note\ntitle: "T"\ncategory: product\nlang: en\n---\n\nBody.\n',
      },
      ctx(),
    )
    assert.equal(outcome.isError, false)
    assert.match(outcome.content, /created successfully/)
    assert.match(outcome.content, /Accepted with warnings/)
    assert.match(outcome.content, /W_KEYWORDS_NONE/)
  })

  it('gates an edit, not just a create — a str_replace cannot break an atom', () => {
    const outcome = runMemoryToolCommand(
      {
        command: 'str_replace',
        path: '/memories/pricing/plans.md',
        old_str: 'category: pricing',
        new_str: 'category:',
      },
      ctx(),
    )
    assert.equal(outcome.isError, true)
    assert.equal(outcome.code, 'E_CORE_MISSING')
    assert.deepEqual(outcome.writes, [])
  })

  it('gates an insert too', () => {
    const outcome = runMemoryToolCommand(
      { command: 'insert', path: '/memories/pricing/plans.md', insert_line: 1, insert_text: 'nested:\n  a: 1' },
      ctx(),
    )
    assert.equal(outcome.isError, true)
    assert.deepEqual(outcome.writes, [])
  })
})

describe('edge-aware delete', () => {
  it('refuses to delete an atom that others link to, and lists the referrers', () => {
    const outcome = runMemoryToolCommand({ command: 'delete', path: '/memories/product/limits.md' }, ctx())
    assert.equal(outcome.isError, true)
    assert.equal(outcome.code, 'E_EDGE_DANGLING')
    assert.match(outcome.content, /pricing\.plans -> product\.limits/)
    assert.deepEqual(outcome.deletes, [])
  })

  it('allows deleting an atom nothing points at', () => {
    const outcome = runMemoryToolCommand({ command: 'delete', path: '/memories/pricing/plans.md' }, ctx())
    assert.equal(outcome.isError, false)
    assert.deepEqual(outcome.deletes, ['pricing/plans.md'])
  })

  it('allows deleting a whole subtree whose edges are internal to it', () => {
    const files: MemoryFileRaw[] = [
      { path: 'tmp/a.md', content: ATOM('tmp.a', 'product', 'related: [tmp.b]\n') },
      { path: 'tmp/b.md', content: ATOM('tmp.b', 'product') },
    ]
    const outcome = runMemoryToolCommand(
      { command: 'delete', path: '/memories/tmp' },
      { files, base: loadMemory(files, config).base },
    )
    assert.equal(outcome.isError, false)
    assert.deepEqual(outcome.deletes.sort(), ['tmp/a.md', 'tmp/b.md'])
  })
})

describe('edge-rewriting rename', () => {
  it('rewrites every inbound reference so the graph survives', () => {
    const outcome = runMemoryToolCommand(
      { command: 'rename', old_path: '/memories/product/limits.md', new_path: '/memories/product/quotas.md' },
      ctx(),
    )
    assert.equal(outcome.isError, false)
    assert.match(outcome.content, /id changed from "product\.limits" to "product\.quotas"/)
    assert.match(outcome.content, /1 inbound related\[\] reference was rewritten/)

    // The moved atom plus the referrer, and the old file removed.
    assert.deepEqual(outcome.writes.map((write) => write.path).sort(), ['pricing/plans.md', 'product/quotas.md'])
    assert.deepEqual(outcome.deletes, ['product/limits.md'])

    const referrer = outcome.writes.find((write) => write.path === 'pricing/plans.md')!
    assert.match(referrer.content, /related: \[product\.quotas\]/)
  })

  it('produces a file set that actually loads', () => {
    // The property that matters: not "the strings look right" but "the result
    // is a valid memory".
    const outcome = runMemoryToolCommand(
      { command: 'rename', old_path: '/memories/product/limits.md', new_path: '/memories/product/quotas.md' },
      ctx(),
    )
    const merged = new Map(FILES.map((file) => [file.path, file]))
    for (const write of outcome.writes) merged.set(write.path, write)
    for (const path of outcome.deletes) merged.delete(path)

    const { base } = loadMemory([...merged.values()], config)
    assert.ok(base.byId.has('product.quotas'))
    assert.ok(!base.byId.has('product.limits'))
    assert.deepEqual(base.byId.get('pricing.plans')!.related, ['product.quotas'])
  })

  it('warns that ids are permanent citation targets', () => {
    const outcome = runMemoryToolCommand(
      { command: 'rename', old_path: '/memories/pricing/plans.md', new_path: '/memories/pricing/tariffs.md' },
      ctx(),
    )
    assert.match(outcome.content, /permanent citation targets/)
  })

  it('allows but flags a destination that implies a deviant id', () => {
    // R1.4: id-convention deviation warns, never fails — an imported memory
    // with legacy ids has to stay fixable. The rename proceeds and says so.
    const outcome = runMemoryToolCommand(
      { command: 'rename', old_path: '/memories/pricing/plans.md', new_path: '/memories/Pricing/PLANS.md' },
      ctx(),
    )
    assert.equal(outcome.isError, false)
    assert.match(outcome.content, /Accepted with warnings/)
    assert.match(outcome.content, /W_ID_FORM/)
  })

  it('refuses a destination that does not round-trip through the id mapping', () => {
    // `b.markdown` would imply the id `product.b.markdown`, which maps back to
    // product/b/markdown.md — so pathForId would be lying about where it lives.
    const outcome = runMemoryToolCommand(
      { command: 'rename', old_path: '/memories/pricing/plans.md', new_path: '/memories/pricing/plans.markdown' },
      ctx(),
    )
    assert.equal(outcome.isError, true)
    assert.match(outcome.content, /does not round-trip through the id mapping/)
    assert.deepEqual(outcome.writes, [])
  })

  it('refuses a destination whose implied id is already taken', () => {
    const files: MemoryFileRaw[] = [
      { path: 'product/a.md', content: ATOM('product.a', 'product') },
      { path: 'product/b.md', content: ATOM('product.b', 'product') },
      // A stray file whose id collides with what renaming a.md there would imply.
      { path: 'archive/note.md', content: ATOM('archive.note', 'product') },
    ]
    const base = loadMemory(files, config).base
    // product/a.md -> archive/note2.md is fine; the collision case is renaming
    // onto a path whose id exists but whose file does not.
    const outcome = runMemoryToolCommand(
      { command: 'rename', old_path: '/memories/product/a.md', new_path: '/memories/product/b.md' },
      { files, base },
    )
    assert.equal(outcome.isError, true)
    assert.match(outcome.content, /already exists/)
  })
})

describe('a miss becomes a gap', () => {
  it('records a gap when the model views a path that does not exist', () => {
    const outcome = runMemoryToolCommand({ command: 'view', path: '/memories/product/refunds.md' }, ctx())
    assert.equal(outcome.isError, true)
    assert.match(outcome.content, /does not exist\. Please provide a valid path\./)
    assert.equal(outcome.gaps.length, 1)
    assert.equal(outcome.gaps[0].kind, 'scope')
    assert.equal(outcome.gaps[0].topic, 'product refunds')
    assert.match(outcome.gaps[0].detail!, /memory-tool view/)
  })

  it('does not record a gap for a successful view', () => {
    assert.deepEqual(runMemoryToolCommand({ command: 'view', path: '/memories' }, ctx()).gaps, [])
    assert.deepEqual(
      runMemoryToolCommand({ command: 'view', path: '/memories/pricing/plans.md' }, ctx()).gaps,
      [],
    )
  })

  it('does not record a gap for an empty store — that is not a miss', () => {
    const outcome = runMemoryToolCommand(
      { command: 'view', path: '/memories' },
      { files: [], base: loadMemory([], config).base },
    )
    assert.equal(outcome.isError, false)
    assert.deepEqual(outcome.gaps, [])
  })
})

describe('degraded mode', () => {
  it('still serves view when the memory does not load, and says why', () => {
    const outcome = runMemoryToolCommand(
      { command: 'view', path: '/memories' },
      { files: FILES, base: null, loadError: 'pricing/plans.md: duplicate id' },
    )
    assert.equal(outcome.isError, false)
    assert.match(outcome.content, /does not currently load: pricing\/plans\.md: duplicate id/)
  })

  it('still gates writes without a base, minus the graph checks', () => {
    const outcome = runMemoryToolCommand(
      { command: 'create', path: '/memories/product/note.md', file_text: 'no frontmatter' },
      { files: FILES, base: null, loadError: 'broken' },
    )
    assert.equal(outcome.isError, true)
    assert.equal(outcome.code, 'E_PARSE')
  })
})

/* ================================================================== *
 * The filesystem handler
 * ================================================================== */

describe('createMemoryToolHandler', () => {
  let root: string
  let ledger: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'amk-memtool-'))
    ledger = join(root, '.gaps.jsonl')
    for (const file of FILES) {
      const target = join(root, file.path)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, file.content)
    }
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  const handler = () => createMemoryToolHandler({ root, gapLedger: ledger, config })

  it('shapes its return like a tool_result payload', () => {
    const result = handler().handle({ command: 'view', path: '/memories' })
    assert.equal(result.is_error, false)
    assert.equal(typeof result.content, 'string')
  })

  it('persists an accepted write to disk', () => {
    const memory = handler()
    const result = memory.handle({
      command: 'create',
      path: '/memories/product/sso.md',
      file_text: ATOM('product.sso', 'product'),
    })
    assert.equal(result.is_error, false)
    assert.ok(existsSync(join(root, 'product/sso.md')))
    assert.match(readFileSync(join(root, 'product/sso.md'), 'utf8'), /id: product\.sso/)
  })

  it('leaves the disk untouched when the gate refuses', () => {
    const before = readMemoryDir(root).length
    const result = handler().handle({
      command: 'create',
      path: '/memories/product/bad.md',
      file_text: 'not an atom',
    })
    assert.equal(result.is_error, true)
    assert.equal(readMemoryDir(root).length, before)
    assert.ok(!existsSync(join(root, 'product/bad.md')))
  })

  it('persists gaps to the ledger and counts recurrence', () => {
    const memory = handler()
    memory.handle({ command: 'view', path: '/memories/product/refunds.md' })
    memory.handle({ command: 'view', path: '/memories/product/refunds.md' })

    const open = memory.gaps()
    assert.equal(open.length, 1, 'the same miss twice is one gap, not two')
    assert.equal(open[0].count, 2)
    assert.equal(open[0].topic, 'product refunds')
  })

  it('invalidates its cache after a write, so the next view sees it', () => {
    const memory = handler()
    memory.handle({ command: 'view', path: '/memories' })
    memory.handle({ command: 'create', path: '/memories/product/sso.md', file_text: ATOM('product.sso', 'product') })
    assert.match(memory.handle({ command: 'view', path: '/memories' }).content, /product\.sso/)
  })

  it('applies a rename across files and leaves a loadable memory on disk', () => {
    const memory = handler()
    const result = memory.handle({
      command: 'rename',
      old_path: '/memories/product/limits.md',
      new_path: '/memories/product/quotas.md',
    })
    assert.equal(result.is_error, false)
    assert.ok(!existsSync(join(root, 'product/limits.md')))
    assert.ok(existsSync(join(root, 'product/quotas.md')))

    const { base } = loadMemory(readMemoryDir(root), config)
    assert.deepEqual(base.byId.get('pricing.plans')!.related, ['product.quotas'])
  })

  it('recovers from a memory that does not load', () => {
    writeFileSync(join(root, 'product/broken.md'), '---\nid: product.limits\ntitle: "Dup"\ncategory: product\nlang: en\n---\n\nx\n')
    const memory = handler()
    const view = memory.handle({ command: 'view', path: '/memories' })
    assert.equal(view.is_error, false, 'a broken atom must not brick the agent')
    assert.match(view.content, /does not currently load/)

    const fixed = memory.handle({ command: 'delete', path: '/memories/product/broken.md' })
    assert.equal(fixed.is_error, false)
    assert.doesNotMatch(memory.handle({ command: 'view', path: '/memories' }).content, /does not currently load/)
  })
})
