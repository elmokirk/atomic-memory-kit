---
name: amk-testing
description: Use when writing, reviewing or debugging tests in this repo. Covers the oracle rule, node:test conventions, what a test name must say, the hostile-fixture principle, and the specific properties that must always be tested.
---

# Testing

`node:test`, zero dependencies, `npm test`. Every test file is `tests/*.test.ts`
and runs with native type stripping — no build, no transpiler, no mocking
library.

## The oracle rule

Before writing a test, answer: **what fixed point is this comparing against?**

Every real check in this system compares against something it did not produce —
a claim against an atom, a query against an expected result, an edge against the
graph, a date against an injected clock. A test that asserts a function returned
what the function computes is not a test; it is a restatement.

The strongest tests here take this shape:

```ts
// not "the plan looks right" but "the result is a valid memory"
const { files } = materialize(FILES, plan, config)
const reloaded = loadMemory(files, config).base   // ← the real loader is the oracle
assert.ok(reloaded.byId.has('product.sso'))
```

Prefer round-tripping through the actual loader over asserting on intermediate
shapes. It is the difference between "the strings look right" and "this works".

## Test names state the property

The name is documentation that cannot go stale. Write the claim, not the action.

```ts
// no
it('tests str_replace', ...)
it('works with umlauts', ...)

// yes
it('refuses an ambiguous old_str and names the lines', ...)
it('quotes numeric array entries so they stay strings', ...)
it('a broken atom must not brick the agent', ...)
```

If you cannot phrase the name as a property, you probably do not know what you
are testing.

## Fixtures are hostile on purpose

Every awkward fixture in this repo commemorates a real bug. Keep that habit —
the fixture list is the accumulated bug history and it is scheduled to become
the portable conformance suite in 1.0.0.

Currently load-bearing:

- reciprocal edges A↔B — must load clean, must **not** be reported as a cycle
- `priority: 10` — must survive the round trip
- `keywords: ["1500"]` — must stay a string, never become a number
- a value containing both quote kinds — must become a block scalar
- a fenced code block inside a bundle — must not parse as an atom
- `linkLabel` with no `link` — warns, does not fail
- umlauts in titles, ids and keywords
- a path like `/memories/%252e%252e%252f...` — must be rejected

When you fix a bug, **add the fixture that would have caught it** in the same
commit, and name the test after the property that was violated.

## Properties that must always hold

Some tests are not about a feature, they are about the system. Do not delete
these when refactoring:

| Property | Where |
|---|---|
| Contract, prose and validator agree | `contract.test.ts` derivation tests |
| `compile → decompile → load` is identity | `round-trip.test.ts` |
| Serialization is idempotent | `round-trip.test.ts` |
| A gap reopens when re-observed after closing | `gaps.test.ts` |
| An invalid write never reaches disk | `restructure`, `memory-tool` |
| Path traversal is rejected in raw and encoded form | `memory-tool.test.ts` |
| Two commands sharing a check never disagree | `doctor` vs `gaps` |

That last one exists because they once did, and nobody noticed for a release.

## Determinism

`src/` has no clock and no randomness, and tests must keep it that way. Anything
time-dependent takes `now` as a parameter:

```ts
checkExpiry(base, new Date('2026-12-01'))   // yes
checkExpiry(base)                            // no — reaches for Date.now()
```

Same for ordering: if a function returns a list, sort it deterministically or
assert with `.sort()`. A test that passes on one machine and fails on another is
worse than no test.

## Testing the CLI and the server

Spawn a real process. Do not import the CLI and call it.

`tests/mcp.test.ts` spawns one server process per call deliberately, to prove
nothing is held between invocations — that is the statelessness claim, tested
rather than asserted. Keep that property when adding cases.

For the filesystem, use `mkdtempSync(join(tmpdir(), 'amk-...'))` and clean up in
`afterEach`. Never write into the repo, never into `/tmp` by hand (Windows).

## Testing agent-facing text

Some payloads exist to be *read by a model*, and their wording is the feature.
Assert on it:

```ts
assert.match(result.content, /Nothing was written/)
assert.match(result.content, /permanent citation targets/)
```

That is not brittle over-testing — if the refusal stops saying what to do
instead, the self-correction loop silently stops working and no structural
assertion would notice.

## Checklist

- [ ] The oracle is something the code under test did not produce
- [ ] The test name states a property
- [ ] A hostile fixture is included if the change touches parsing or writing
- [ ] No `Date.now()`, no randomness, no ordering assumptions
- [ ] Temp dirs for I/O, cleaned up
- [ ] Bug fix → the fixture that would have caught it, same commit
- [ ] `npm test` green, and the count in `SOURCEMAP.md` updated if it changed
