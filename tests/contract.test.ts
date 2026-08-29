/**
 * The contract is only load-bearing if the prose, the data and the validator
 * cannot drift apart. These tests are the mechanism that keeps them together.
 *
 * The two that matter most:
 *   - every field declared in contract.ts is actually enforced by schema.ts
 *   - every diagnostic code the validator can emit is declared in contract.ts
 *
 * Without them, `describeContract()` becomes documentation, and documentation
 * about a validator is a rumour.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

import {
  CONFORMANCE,
  CONSUMERS,
  CONTRACT_VERSION,
  CORE_FIELD_NAMES,
  DIAGNOSTICS,
  FIELDS,
  GRAMMAR,
  RESERVED_FIELD_NAMES,
  blastRadius,
  describeContract,
  fieldSpec,
  isContractCompatible,
} from '../src/contract.ts'
import { defineMemoryConfig } from '../src/config.ts'
import { loadMemory } from '../src/loader.ts'
import { validateAtom } from '../src/schema.ts'
import type { MemoryFileRaw } from '../src/types.ts'

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

describe('contract self-consistency', () => {
  it('declares exactly the four core fields', () => {
    assert.deepEqual(CORE_FIELD_NAMES, ['id', 'title', 'category', 'lang'])
  })

  it('has no duplicate field names', () => {
    assert.equal(new Set(RESERVED_FIELD_NAMES).size, RESERVED_FIELD_NAMES.length)
  })

  it('routes every field to at least one declared consumer', () => {
    for (const field of FIELDS) {
      assert.ok(field.consumers.length > 0, `${field.name} has no consumer — why is it in the contract?`)
      for (const consumer of field.consumers) {
        assert.ok(consumer in CONSUMERS, `${field.name} names unknown consumer "${consumer}"`)
      }
    }
  })

  it('marks core fields as required and standard fields as optional', () => {
    for (const field of FIELDS) {
      assert.equal(field.required, field.class === 'core', `${field.name} required flag disagrees with its class`)
    }
  })

  it('never lets a well-typed unknown VALUE be an error, except on edges and links', () => {
    // The forward-compatibility rule, mechanised: an unregistered category must
    // not stop a memory from loading. Only related[] and link are allowed to be
    // strict, because a broken edge silently shrinks what the agent can reach.
    const strict = FIELDS.filter((field) => field.onValueViolation === 'error').map((field) => field.name)
    assert.deepEqual(strict.sort(), ['link', 'related'])
  })

  it('agrees with the prose contract on version and field names', () => {
    const prose = read('../CONTRACT.md')
    assert.ok(prose.includes(CONTRACT_VERSION), `CONTRACT.md does not mention version ${CONTRACT_VERSION}`)
    for (const field of FIELDS) {
      assert.ok(
        prose.includes(`\`${field.name}\``),
        `CONTRACT.md never documents the field "${field.name}"`,
      )
    }
  })

  it('documents every diagnostic code it declares', () => {
    for (const [code, text] of Object.entries(DIAGNOSTICS)) {
      assert.ok(text.length > 10, `${code} has no usable description`)
    }
  })

  it('describes itself as a serializable object', () => {
    const descriptor = describeContract()
    assert.equal(descriptor.version, CONTRACT_VERSION)
    assert.deepEqual(JSON.parse(JSON.stringify(descriptor)).fields.length, FIELDS.length)
    assert.ok(Object.keys(CONFORMANCE).includes(descriptor.conformance))
  })
})

describe('contract <-> validator derivation', () => {
  // schema.ts derives its field lists from FIELDS. This proves the derivation
  // is total: a field added to the contract and forgotten in the validator
  // would slip through as an extension, and this catches that.
  it('treats every declared field as reserved, never as an extension', () => {
    const data: Record<string, unknown> = {
      id: 'a.b',
      title: 'T',
      category: 'c',
      lang: 'en',
      summary: 's',
      keywords: ['one', 'two'],
      synonyms: ['x'],
      intents: ['y'],
      related: [],
      alwaysInclude: false,
      priority: 5,
      link: '/x',
      linkLabel: 'X',
    }
    // Every contract field must appear in the probe, or the probe is stale.
    assert.deepEqual(Object.keys(data).sort(), RESERVED_FIELD_NAMES.slice().sort())

    const { atom } = validateAtom(data, 'body')
    assert.ok(atom)
    assert.deepEqual(atom!.extensions, {}, 'a declared field leaked into extensions')
  })

  it('type-checks every field whose violation is declared an error', () => {
    const wrongTypes: Record<string, unknown> = {
      summary: 42,
      keywords: 'not an array',
      synonyms: 1,
      intents: {},
      related: 'a.b',
      alwaysInclude: 'yes',
      priority: 'high',
      link: 'relative/path',
      linkLabel: 7,
    }
    for (const [name, badValue] of Object.entries(wrongTypes)) {
      const spec = fieldSpec(name)!
      assert.equal(spec.onTypeViolation, 'error', `${name} is not declared strict`)
      const { issues } = validateAtom(
        { id: 'a.b', title: 'T', category: 'c', lang: 'en', [name]: badValue },
        'body',
      )
      assert.ok(
        issues.some((issue) => issue.severity === 'error' && issue.message.includes(name)),
        `${name} accepted a ${typeof badValue} — the contract says that is an error`,
      )
    }
  })

  it('stamps a stable code on every issue it emits', () => {
    const { issues } = validateAtom(
      { id: 'Not_An_Id', title: 'T', category: 'unregistered', lang: 'english', keywords: [], region: 'eu' },
      '',
      { knownCategories: ['pricing'] },
    )
    for (const issue of issues) {
      assert.ok(issue.code in DIAGNOSTICS, `emitted undeclared code "${issue.code}"`)
    }
    const codes = issues.map((issue) => issue.code)
    assert.ok(codes.includes('W_ID_FORM'))
    assert.ok(codes.includes('W_CATEGORY_UNKNOWN'))
    assert.ok(codes.includes('W_LANG_FORM'))
    assert.ok(codes.includes('W_KEYWORDS_FEW'))
    assert.ok(codes.includes('W_BODY_EMPTY'))
    assert.ok(codes.includes('I_EXTENSION'))
  })

  it('compiles its grammar strings to the patterns the validator uses', () => {
    assert.ok(new RegExp(GRAMMAR.id).test('services.pricing.audit'))
    assert.ok(!new RegExp(GRAMMAR.id).test('Services.Audit'))
    assert.ok(new RegExp(GRAMMAR.lang).test('pt-BR'))
    assert.ok(new RegExp(GRAMMAR.link).test('https://example.com/x'))
    assert.ok(!new RegExp(GRAMMAR.link).test('./relative'))
  })

  it('surfaces the loader diagnostics with codes too', () => {
    const files: MemoryFileRaw[] = [
      {
        path: 'a/one.md',
        content: '---\nid: a.one\ntitle: "One"\ncategory: nope\nlang: en\nkeywords: [x, y]\n---\n\nBody.\n',
      },
    ]
    const { warnings } = loadMemory(files, defineMemoryConfig({ categories: ['pricing'] }))
    assert.ok(warnings.every((warning) => warning.code in DIAGNOSTICS))
    assert.ok(warnings.some((warning) => warning.code === 'W_CATEGORY_UNKNOWN'))
  })
})

describe('blast radius', () => {
  it('reports an empty radius for extension fields — that is what makes them safe', () => {
    assert.deepEqual(blastRadius('region'), [])
    assert.deepEqual(blastRadius('validFrom'), [])
  })

  it('reports id as a reference target touching the graph and citations', () => {
    const spec = fieldSpec('id')!
    assert.equal(spec.isReferenceTarget, true)
    assert.ok(spec.consumers.includes('citation'))
    assert.ok(spec.consumers.includes('graph'))
  })

  it('separates fields that change retrieval from fields that only change display', () => {
    assert.equal(fieldSpec('keywords')!.affectsRetrieval, true)
    assert.equal(fieldSpec('lang')!.affectsRetrieval, false)
    assert.equal(fieldSpec('intents')!.affectsRetrieval, false)
  })
})

describe('version negotiation', () => {
  it('accepts an absent declaration', () => {
    assert.equal(isContractCompatible(undefined).ok, true)
  })

  it('accepts a newer minor, because minor changes are additive', () => {
    assert.equal(isContractCompatible('1.7.0').ok, true)
  })

  it('refuses a different major and says why', () => {
    const result = isContractCompatible('2.0.0')
    assert.equal(result.ok, false)
    assert.match(result.reason!, /migration/)
  })

  it('refuses garbage rather than guessing', () => {
    assert.equal(isContractCompatible('v-one').ok, false)
  })
})
