---
name: amk-contract-change
description: Use when adding, changing, or removing an atom frontmatter field, editing src/contract.ts or src/schema.ts, changing a diagnostic code or severity, or bumping the contract version. Covers the derivation rule, blast radius, round-trip obligation and version semantics.
---

# Changing the contract

The contract is the load-bearing element of this project. Retrieval can be
replaced, the compiler rewritten, the CLI thrown away — everything reads atoms
through this contract, and so does every foreign system anyone hands a memory to.

Changing it is the highest-risk operation in the repo. Work through this in
order; do not skip the first question.

## 0. Should this be a contract change at all?

Three mechanisms, cheapest first (`CONTRACT.md` §4):

| Want | Mechanism | Cost |
|---|---|---|
| Carry extra data | **Extension field** — just add it | free, no coordination |
| Silence a warning for a known value | **Register in config** | config only |
| Enforce or score it for everyone | **Standard field** | contract minor bump |

**The bar for a standard field:** *name the consumer that breaks without it.*
If you cannot, it is an extension field. `blastRadius('yourField')` returning
`[]` is not a defect — that empty list is the safety property that lets two
teams extend the same memory without conflict.

Do not add a field speculatively. Do not add enum values speculatively either;
R4.1 means an unknown value warns rather than breaks, so waiting costs nothing.

## 1. The derivation rule

`src/schema.ts` **derives** its field lists from `src/contract.ts` — it never
restates them. `tests/contract.test.ts` proves the derivation is total in both
directions and will fail if you declare a field without enforcing it, or enforce
one without declaring it.

So the order is always:

1. Declare in `FIELDS` in `contract.ts`
2. Enforce in `schema.ts`, deriving from the table
3. Document in `CONTRACT.md` §3 — **the test greps for the field name**, so an
   undocumented field fails the build

## 2. Every FieldSpec entry is a decision

```ts
{
  name: 'yourField',
  class: 'standard',            // core = required, standard = typed, extension = inert
  type: 'string',
  required: false,              // MUST equal (class === 'core') — the test checks
  onTypeViolation: 'error',     // wrong type is essentially always an error
  onValueViolation: 'warning',  // unknown VALUE — see below
  consumers: ['retrieval'],     // this is the permanent blast radius
  affectsRetrieval: true,       // does changing it change what is found?
  isReferenceTarget: false,     // do other artifacts point at this value?
  summary: 'One line.',
}
```

`onValueViolation: 'error'` is allowed for exactly `related` and `link`, and
`tests/contract.test.ts` asserts that list. A well-typed but unregistered value
must not stop a memory loading — that is R4.1, and it is why anyone can be the
first to extend the taxonomy.

`consumers` is not documentation. It is what `blastRadius()` returns, and it is
the answer to "what breaks if I change this". Getting it wrong makes a future
change look safe when it is not.

## 3. Diagnostic codes

New severity → new code in `DIAGNOSTICS`. Codes are API; **messages are prose**
and may be reworded in a patch release. Never branch on message text — there is
already one bug in `SOURCEMAP.md` §1.3 from doing exactly that.

Naming: `E_` error, `W_` warning, `I_` info. Add the row to `CONTRACT.md` §6 in
the same commit.

## 4. The round-trip obligation

Any new frontmatter field must survive `compile → decompile → load`, which means
touching **four** places, and forgetting one is the classic bug here (`priority`
was lost exactly this way):

- [ ] `MemoryAtom` in `src/types.ts`
- [ ] the atom construction at the end of `validateAtom`
- [ ] `CompiledAtom` + `toCompiledAtom` in `src/compile.ts`
- [ ] `serializeAtom` in `src/compile.ts` — emit it

Then also, because they build atoms by hand:

- [ ] `frontmatterOf` and `toCompiled` in `src/restructure.ts`
- [ ] the `before`/`after` diff in `planApply` — otherwise the field changes
      silently and the diff says "unchanged"
- [ ] `frontmatterOf` / `toCompiled` in `src/memory-tool.ts`

A round-trip test with a *nasty* value (quotes, umlauts, a numeric-looking
string) is required, not optional.

## 5. Version semantics

| Change | Bump |
|---|---|
| Additive optional field, new consumer for an existing field | **minor** |
| Wording, diagnostics, non-normative guidance | patch |
| A previously valid atom becomes invalid, or a field changes meaning | **major** |

Contract version is independent of the kit version. A major bump needs a
migration note in `CHANGELOG.md` — and if there is nothing to migrate, **say so
explicitly** rather than leaving readers to wonder.

Through 1.x, contract changes are additive. If your change cannot be additive,
it does not ship in 1.x.

## 6. Checklist

- [ ] The §4.3 bar is met — you can name the consumer that breaks without it
- [ ] Declared in `FIELDS` with every flag deliberately chosen
- [ ] `schema.ts` derives, does not restate
- [ ] Documented in `CONTRACT.md` §3, code in §6, version in §7
- [ ] All seven round-trip sites updated
- [ ] Round-trip test with a hostile value
- [ ] `npm test` green — `tests/contract.test.ts` will catch a partial job
- [ ] `CHANGELOG.md` under `[Unreleased]`, with migration note if major
- [ ] `LIMITATIONS.md` updated if the field creates a new way to be wrong

## Red flags

| Thought | Reality |
|---|---|
| "I'll add the field and document it after" | The derivation test fails. Document first. |
| "This warning should be an error, it keeps firing" | R4.4. Severity is contract. Fix the atoms. |
| "Extension fields are a workaround" | They are the intended mechanism for almost everything. |
| "The round-trip test is overkill for one field" | `priority` was silently dropped for a whole release. |
| "I'll match on the message text just here" | Already a fixed bug. Use the code. |
