# QA gates and evidence

These are acceptance requirements for future implementation. This documentation change does not certify the product or mark any gate passed.

## Gate levels

| Gate | Requirement |
|---|---|
| Documentation | Relative links resolve; source status and proposed/current distinctions are explicit; no unresolved index links; no duplicate progress tracker |
| Ticket | Focused acceptance tests pass on real modules; failure case and compatibility impact recorded |
| Batch | Combined branch passes regression and integration checks; all critical failures resolved or feature safely withheld |
| User | Named human has followed the scripted scenario; missing access is `awaiting_user` |
| Release | Packaged install, external onboarding, migration, removal, and claims checked on supported hosts |

## Baseline commands

Use a disposable checkout and record the exact Node/npm versions. Read `package.json` first because commands may change. The current root has no default `memory.config.json`; do not treat a failing bare `npm run check` as a product result without examining its config assumptions.

Starting probes, not a claimed passing sequence:

```bash
node --version
npm --version
npm test
node cli/amk.mjs --help
```

Run starter probes in a disposable copy of the repository, because evaluation can write a gap ledger:

```bash
cd example
node ../cli/amk.mjs validate
node ../cli/amk.mjs eval
node ../cli/amk.mjs compile
node ../cli/amk.mjs search "what does it cost"
```

An expected planted drift or TODO must be distinguished from a regression. On a Node version that requires a type-stripping flag, record that fact; do not silently change the environment and claim the original requirement passed.

B0 must establish a reproducible check command and a plugin install smoke test; typecheck and package tests are deferred with npm (roadmap, 2026-10-05). Those scripts do not exist merely because this document requests them. Verify the declared minimum runtime and a current supported runtime, without unbounded latest-version dependencies.

## Mandatory regression families

1. **Representation:** strings resembling booleans/numbers; quotes and Unicode; malformed input rejection; extension-only updates; metadata round-trip; duplicate IDs; reserved-field collisions.
2. **Retrieval:** hard negatives, empty queries, history count zero, context-only boosts, deterministic order, entire-context budget, always-include content and edges.
3. **Evaluation:** metrics stay in range, exact expected IDs, forbidden IDs fail independently, zero-case semantics, regression comparison without auto-updating baselines.
4. **Writes:** validation precedes mutation; stale plan rejected; confinement including symlinks; partial failure and restart behavior; ledger corruption visible; distinct observations survive permitted concurrency.
5. **Transport/distribution:** installed plugin (tarball only once npm is in scope), runtime matrix, JSON-RPC invalid input, negotiated version, tool-list consistency, stdio-only operation or explicitly secured HTTP.
6. **Streaming:** split markers at every relevant boundary, multiple distant markers, long deltas, end-of-stream incomplete marker, no whitespace loss in ordinary output.

## B1 user script

Use a sandbox with synthetic project knowledge and no customer data.

1. Install the companion through the documented route; capture host and package versions.
2. Ask a relevant question without mentioning AMK. Record whether the host actually retrieves.
3. Ask a missing in-scope question. Record a diagnostic and distinguish a retrieval miss from proven absence.
4. Review a correction and its source. Reject once and verify no content write; then approve the intended proposal.
5. Replay the original and a held-out equivalent question in a new session. Inspect source/atom references.
6. Ask an unrelated and a confusable question. Check that the agent does not create fake certainty or noisy repair tasks.
7. Restart, remove the integration, and inspect native memory/configuration. Unrelated settings and memory must remain intact.

User acceptance includes usability notes and any manual intervention. A tool called only by an explicit test instruction is an installation check, not natural-use evidence.

## Measurements

| Metric | Definition |
|---|---|
| Invocation | Eligible natural prompts with AMK use / all eligible natural prompts |
| Verified repair | Fixed cases passing original and held-out replay / all attempted fixes; report numerator and denominator |
| Repeat miss | Later opportunities for the same reviewed fact that still fail / all later opportunities |
| False confident answer | Incorrect definitive answers / reviewed answers, with the review rubric retained |
| Maintenance | Human minutes and edits per accepted, replay-passing correction |
| Overhead | Core cold/warm p50/p95, context size, tool calls, and extra model turns reported separately |

For the initial fixture, all deterministic safety and oracle cases must pass. B1 has at least three distinct correction cases, each with an original and held-out question, plus rejection, restart, and removal. This is an engineering acceptance sample, not statistical proof of a population-wide improvement.

Record observational model failures rather than tuning them away. A failure in a designated critical user scenario blocks that scenario's acceptance until fixed or explicitly removed from scope. Choose paid-evaluation budgets and performance targets before the run with the owner; no silent acceptance of extra costs.

## Comparison and future benchmark kit

Compare equivalent facts, task sets, and maintenance effort. Separate tune-time hints from held-out queries. Preserve failures, model versions, run counts, and uncertain judgments. Do not treat a same-category atom as the correct answer.

Start with plain versioned fixtures and JSON results using existing test tools. Later publish a small runner around that format; public memory datasets and host eval tools are optional adapters, not B0 dependencies. Check [Sources](SOURCES.md) for candidates and access limitations.

## Evidence record

For each run record: commit, ticket, command, OS/architecture, Node/npm, host/model versions if used, input fixture version, exit code, pass/fail counts, raw-log location, reviewer, and limitations. Raw personal content stays out of Git. A documentation review, copied-function probe, unit test, and real-host test are different evidence classes.

## Shared definition of done

- [ ] Every required ticket acceptance case has evidence.
- [ ] Existing starter behavior is preserved except documented correctness/security changes.
- [ ] Combined-branch regressions, package checks, and applicable integration checks pass.
- [ ] No unresolved critical data-loss, scope-leak, or misleading-success defect remains in the released path.
- [ ] Failure and recovery behavior is documented and tested.
- [ ] User acceptance is recorded, or the batch remains `awaiting_user`.
- [ ] Docs, contract changes, migration, and release claims match actual behavior.
- [ ] Ticket states and evidence links are updated by the integrator; no automatic merge or release.
