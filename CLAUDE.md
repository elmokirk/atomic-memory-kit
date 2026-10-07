# Working on this repo

Atomic Memory Kit. Zero dependencies, no build step, Node ≥ 22.18 native type
stripping. `npm test` must stay green.

Read [`PRODUCT.md`](PRODUCT.md) for what this is for and what is out of scope.
Read [`CONCEPT.md`](CONCEPT.md) before substantial work. It is the portable
artifact this project exists to produce; the code is the perishable part.

## The five rules that are not negotiable

1. **`src/contract.ts` imports nothing.** The moment it imports the loader or
   the scorer it stops being a specification and becomes a description of one
   implementation. Guard this in review.
2. **`src/` performs no I/O.** No `node:fs`, no `fetch`, no `Date.now()`, no
   randomness. All of it lives in `adapters/`. This is what keeps the core
   portable and every test deterministic.
3. **The round-trip is an invariant, not an aspiration.** `compile → decompile →
   load` equals identity. Any new frontmatter field must survive it, and the
   test proves it before the field is called done.
4. **Severity is contract, not preference.** Errors stay errors, warnings stay
   warnings. `CONTRACT.md` §1 R4.4. If a warning is annoying, that is not a
   reason to promote or demote it.
5. **Docs ship in the same commit as the code.** A stale `LIMITATIONS.md` or
   `LINKMAP.md` is worse than none, because this project's entire argument is
   that unverifiable knowledge is the problem.

## Skills

Invoke these — they carry the checklists.

| Skill | When |
|---|---|
| `amk-contract-change` | Touching `contract.ts`, `schema.ts`, `CONTRACT.md`, or any frontmatter field |
| `amk-release-plan` | Working a release from `docs/plans/` |
| `amk-doc-integrity` | Any doc change, or any claim about an external system |
| `amk-testing` | Writing or reviewing tests |

## Layout

```
src/         pure engine        contract.ts is layer 0, everything imports it
adapters/    the only I/O
cli/         thin shell over src/
agent/       MCP server + skills for CONSUMERS of a memory (not for this repo)
docs/plans/  one file per release
tests/       node:test, zero deps
example/     a working memory with problems planted on purpose
```

Full module graph and layering rules: [`SOURCEMAP.md`](SOURCEMAP.md) §2.

## Commands

```bash
npm test                  # 308 tests
npm run demo              # the chatbot demo
npm run check             # validate + eval on example/, then the tests
npm run contract          # print the contract
cd example && node ../cli/amk.mjs doctor
```

## Style

- TypeScript must stay **type-strippable**: no enums, no parameter properties,
  no namespaces, no decorators.
- `.ts` extensions in import specifiers — required by Node's resolver.
- Comments explain *why*, never *what*. The existing files are the reference for
  density; match them rather than a general habit.
- No emoji. No decorative output. CLI output is read by tired people.
