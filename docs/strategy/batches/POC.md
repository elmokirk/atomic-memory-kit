# PoC: safe core and a chatbot demo

Outcome: the existing core is safe to run next to a web server, correct for streamed chatbot answers, and demonstrated by a runnable chatbot example. Order and file ownership: [roadmap](../ROADMAP.md). Product requirements: [`PRODUCT.md`](../../../PRODUCT.md) §6.

## State

The integrator owns this table. Status values: `planned`, `in_progress`, `awaiting_review`, `blocked`, `done`.

| Increment | Status | Branch | Evidence |
|---|---|---|---|
| I1 Security | done | `poc/i1-security` | `13b6eba` R16, `335e522` R13/R14, `ff85d15` S06, `4e819de` R15 |
| I2 Chatbot correctness | done | `poc/i2-chatbot` | `2124737` R09, `8011a34` R19, `7792fee` R07, `8251de1` R01-R03 |
| I3 Evaluation | done | `poc/i3-eval` | `ca6bec5` R10, `aa75cf6` R11, `d915782` zero cases |
| I4 Starter and CLI | done | `poc/i4-cli` | `a737b1b` drift, `4455123` check, `bee26fe` Node floor, `5c29ab9` smoke; S07 eval part not reproduced |
| I5 Chatbot demo | planned | `poc/i5-demo` | – |

## Definition of Done for every increment

- [ ] Each finding addressed has a test that failed before the fix, against the real module, not a copied excerpt.
- [ ] `npm test` passes on the increment branch; test count reported.
- [ ] No runtime dependency added; TypeScript stays type-strippable; `src/` stays free of I/O; `src/contract.ts` imports nothing.
- [ ] Round-trip and contract tests unchanged unless the increment says otherwise.
- [ ] Behaviour changes are listed for the integrator: which doc lines in `LIMITATIONS.md`, `README.md`, `docs/*.md` must change, and the `CHANGELOG.md` `[Unreleased]` entry.
- [ ] The [red-team register](../reviews/RED-TEAM.md) row for each finding names the fix commit, or the finding is reclassified with evidence if it does not reproduce.
- [ ] Only the increment's own files are changed; anything else is proposed to the integrator.
- [ ] Commits on the increment branch only. No merge, push of tags, or publishing.

## I1 Security

Findings: R16, R13, R14, S06, R15.

- [ ] `--http` binds to `127.0.0.1` unless an explicit host option is given; the startup log prints the address actually bound.
- [ ] Mutating tools over HTTP are refused without a configured token; read tools keep working; stdio behaviour unchanged.
- [ ] A write to `../x`, an absolute path, or through a symlink or junction leaving the root is refused in `adapters/fs.ts`, `adapters/memory-tool.ts` and `src/memory-tool.ts`, with a sentinel file outside the root proving nothing was touched.
- [ ] Reads are confined the same way.
- [ ] A corrupt ledger line is reported with its line number instead of being skipped silently; valid lines still load.
- [ ] Tests cover each rule on Windows path forms as well as POSIX.

## I2 Chatbot correctness

Findings: R01, R02, R03, R07, R09, R19.

- [ ] The streaming gap decoder detects every `[GAP: topic]` marker regardless of chunk split points, including several markers far apart and a marker split across many chunks.
- [ ] Visible text is identical to the input minus markers: no lost whitespace, no duplicated or leaked marker fragments, defined handling of an incomplete marker at end of stream.
- [ ] The context budget is never exceeded silently: either results are cut to fit, or the result carries an explicit overflow flag. The choice is documented and tested, including always-included atoms.
- [ ] `historyContextMessages: 0` uses no history.
- [ ] Config defaults are fresh per call; mutating a returned config does not affect the next one.
- [ ] Existing consumers of the old detector API have a migration note.

## I3 Evaluation

Findings: R10, R11.

- [ ] Every metric stays within its stated range for all fixtures, including duplicate expected ids.
- [ ] A forbidden retrieval fails the run on its own, whatever the aggregate scores are.
- [ ] Zero cases and empty expectations have defined, tested semantics.
- [ ] `amk eval` on `example/` still distinguishes planted problems from regressions; the baseline is not refreshed to make the run pass.

## I4 Starter and CLI

Findings: S07; Node floor.

- [ ] `drift` exits non-zero when it reports an error finding.
- [ ] Running the README quickstart in a fresh clone leaves `git status` clean. If the review's claim that `eval` modifies a tracked file does not reproduce (`.memory-out/` is ignored), S07 is reclassified with that evidence.
- [ ] `npm run check` works from the repository root of a fresh clone.
- [ ] `package.json` `engines` is `>=22.18.0`; CLI and MCP server print a clear message and exit on older Node.
- [ ] Every CLI command still runs in `example/`.

## I5 Chatbot demo

Depends on I2 and I4 merged.

- [ ] `example/chatbot/` contains a runnable demo: a question goes through `searchMemory`, an out-of-scope question yields `no_match` and a scope gap, a streamed answer has its `[GAP: …]` marker stripped and recorded in the ledger.
- [ ] Runs with no API key using a scripted model; an optional real-model mode is documented and off by default.
- [ ] No runtime dependency; Node built-ins only.
- [ ] README starts with what AMK is for (from `PRODUCT.md` §1), the demo command and its expected output, then install, then limits; the atom count in the README matches `example/`.
- [ ] Someone who did not write it reaches the demo output from a fresh clone in under 15 minutes reading at most three documents; time recorded in the evidence column.

## PoC exit

- [ ] I1-I5 `done`, merged in order I1-I4, then I5.
- [ ] Full suite green on `master`; test count updated in `SOURCEMAP.md`, `README.md`, `CLAUDE.md`.
- [ ] `LIMITATIONS.md`, `docs/MCP.md`, `docs/INTEGRATION-LLM.md` match the new behaviour.
- [ ] Owner has run the demo.
