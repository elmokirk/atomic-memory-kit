/**
 * Round-trip is the load-bearing invariant of this kit.
 *
 * If compile -> decompile -> load is not identity, then "hand the memory to a
 * human, get it back" silently corrupts knowledge — which is worse than not
 * offering the feature at all. These tests are the reason the frontmatter
 * emitter is fussy about quoting.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { defineMemoryConfig } from '../src/config.ts'
import {
  compileMemory,
  decompile,
  parseBundle,
  pathForId,
  renderBundle,
  serializeAtom,
} from '../src/compile.ts'
import { loadMemory } from '../src/loader.ts'
import type { MemoryFileRaw } from '../src/types.ts'

const config = defineMemoryConfig({
  categories: ['alpha', 'beta', 'scope'],
  intents: ['one', 'two'],
})

/** Deliberately nasty: quotes, umlauts, colons, numbers, multiline summary. */
const FILES: MemoryFileRaw[] = [
  {
    path: 'alpha/first.md',
    content: `---
id: alpha.first
title: "The \\"quoted\\" title"
category: alpha
lang: de
intents: [one]
keywords: [preis, "1500", größe, multi word phrase]
synonyms: [kosten]
related: [beta.second]
summary: "Ein Satz: mit Doppelpunkt, Komma und Ümlauten."
priority: 25
link: /pricing#tier
linkLabel: "Preise"
region: emea
---

# Überschrift

- Fakt eins kostet 1.500 EUR.
- Fakt zwei: enthält ein [Link](/somewhere) und \`code\`.
`,
  },
  {
    path: 'beta/second.md',
    content: `---
id: beta.second
title: Plain unquoted title
category: beta
lang: en
keywords: [second, zwei]
summary: |
  A summary that spans
  two lines on purpose.
alwaysInclude: true
---

Body with a fenced block:

\`\`\`js
const x = 1
\`\`\`
`,
  },
  {
    path: 'alpha/third.md',
    content: `---
id: alpha.third
title: "Apostrophe's title"
category: alpha
lang: en
keywords: [third, drei]
summary: "Nothing special."
---

Third body.
`,
  },
]

const original = loadMemory(FILES, config)

describe('round trip', () => {
  it('loads the fixture without contract errors', () => {
    assert.equal(original.base.atoms.length, 3)
    assert.equal(original.base.alwaysInclude.length, 1)
  })

  it('compile -> decompile -> load preserves every field', () => {
    const compiled = compileMemory(original.base)
    const rebuiltFiles = decompile(compiled)
    const rebuilt = loadMemory(rebuiltFiles, config)

    assert.equal(rebuilt.base.atoms.length, original.base.atoms.length)

    for (const atom of original.base.atoms) {
      const twin = rebuilt.base.byId.get(atom.id)
      assert.ok(twin, `missing ${atom.id}`)
      assert.equal(twin.title, atom.title, `title ${atom.id}`)
      assert.equal(twin.summary, atom.summary, `summary ${atom.id}`)
      assert.equal(twin.body, atom.body, `body ${atom.id}`)
      assert.equal(twin.category, atom.category)
      assert.equal(twin.lang, atom.lang)
      assert.equal(twin.alwaysInclude, atom.alwaysInclude)
      assert.equal(twin.link, atom.link)
      assert.equal(twin.linkLabel, atom.linkLabel)
      assert.equal(twin.priority, atom.priority, `priority ${atom.id}`)
      assert.equal(twin.priorityBonus, atom.priorityBonus)
      assert.deepEqual(twin.keywords, atom.keywords, `keywords ${atom.id}`)
      assert.deepEqual(twin.synonyms, atom.synonyms)
      assert.deepEqual(twin.intents, atom.intents)
      assert.deepEqual(twin.related ?? [], atom.related ?? [])
      assert.deepEqual(twin.extensions, atom.extensions, `extensions ${atom.id}`)
    }
  })

  it('is idempotent: serializing twice yields identical bytes', () => {
    const once = decompile(compileMemory(original.base))
    const twice = decompile(compileMemory(loadMemory(once, config).base))
    assert.deepEqual(twice, once)
  })

  it('bundle -> parse -> load preserves every atom', () => {
    const bundle = renderBundle(original.base, { name: 'test' })
    const parsed = parseBundle(bundle)

    assert.deepEqual(parsed.problems, [])
    assert.equal(parsed.files.length, original.base.atoms.length)

    const rebuilt = loadMemory(parsed.files, config)
    for (const atom of original.base.atoms) {
      const twin = rebuilt.base.byId.get(atom.id)
      assert.ok(twin, `missing ${atom.id}`)
      assert.equal(twin.body, atom.body)
      assert.equal(twin.title, atom.title)
      assert.deepEqual(twin.keywords, atom.keywords)
    }
  })

  it('the bundle instruction block is not parsed as an atom', () => {
    // The bundle documents itself with a sample fence inside a code block.
    const bundle = renderBundle(original.base, { name: 'test' })
    assert.ok(bundle.includes('<!-- amk:atom category.topic -->'), 'sample fence should be present')
    const parsed = parseBundle(bundle)
    assert.ok(!parsed.files.some((file) => file.path.includes('category/topic')), 'sample must be ignored')
  })

  it('reads ticked gap checkboxes back out of an edited bundle', () => {
    const bundle = renderBundle(original.base, {
      name: 'test',
      gaps: [{
        id: 'todo-abc123',
        kind: 'todo',
        topic: 'something missing',
        firstSeen: '2026-01-01T00:00:00.000Z',
        lastSeen: '2026-01-01T00:00:00.000Z',
        count: 1,
        status: 'open',
      }],
    })
    assert.ok(bundle.includes('- [ ] `todo-abc123`'))
    const edited = bundle.replace('- [ ] `todo-abc123`', '- [x] `todo-abc123`')
    assert.deepEqual(parseBundle(edited).closedGapIds, ['todo-abc123'])
  })

  it('rejects a fence whose id disagrees with its frontmatter', () => {
    const broken = [
      '<!-- amk:atom alpha.mismatch -->',
      '---',
      'id: alpha.something-else',
      'title: "X"',
      'category: alpha',
      'lang: en',
      '---',
      '',
      'Body.',
      '<!-- amk:end alpha.mismatch -->',
    ].join('\n')
    const parsed = parseBundle(broken)
    assert.equal(parsed.files.length, 0)
    assert.equal(parsed.problems.length, 1)
    assert.match(parsed.problems[0]!, /fence and id must agree/)
  })

  it('reports an unterminated fence instead of guessing', () => {
    const parsed = parseBundle('<!-- amk:atom alpha.open -->\n---\nid: alpha.open\n---\n')
    assert.match(parsed.problems[0]!, /unterminated fence/)
  })
})

describe('path derivation', () => {
  it('maps dotted ids to nested paths', () => {
    assert.equal(pathForId('services.pricing.audit'), 'services/pricing/audit.md')
    assert.equal(pathForId('alpha.first'), 'alpha/first.md')
    assert.equal(pathForId('standalone'), 'standalone.md')
  })

  it('maps the reserved index id to the root index file', () => {
    assert.equal(pathForId('index.scope', 'index.scope'), '_index.md')
  })
})

describe('serialization edge cases', () => {
  const base = {
    id: 'x.y',
    title: 'T',
    category: 'alpha',
    lang: 'en',
    summary: '',
    alwaysInclude: false,
    intents: [],
    keywords: [],
    synonyms: [],
    related: [],
    body: 'B',
  }

  it('quotes numeric array entries so they stay strings', () => {
    const output = serializeAtom({ ...base, keywords: ['1500', 'plain'] })
    assert.match(output, /keywords: \["1500", plain]/)
    const parsed = loadMemory([{ path: 'alpha/y.md', content: output }], config)
    assert.deepEqual(parsed.base.atoms[0]!.keywords, ['1500', 'plain'])
  })

  it('switches quote style when the value contains a double quote', () => {
    const output = serializeAtom({ ...base, title: 'He said "hi"' })
    const parsed = loadMemory([{ path: 'alpha/y.md', content: output }], config)
    assert.equal(parsed.base.atoms[0]!.title, 'He said "hi"')
  })

  it('falls back to a block scalar when both quote kinds appear', () => {
    const title = `mixed "double" and 'single'`
    const output = serializeAtom({ ...base, title })
    const parsed = loadMemory([{ path: 'alpha/y.md', content: output }], config)
    assert.equal(parsed.base.atoms[0]!.title, title)
  })

  it('omits empty optional fields rather than emitting empty arrays', () => {
    const output = serializeAtom(base)
    assert.ok(!output.includes('related:'))
    assert.ok(!output.includes('intents:'))
  })
})
