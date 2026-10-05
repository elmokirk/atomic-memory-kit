# B0: reliable foundation

Outcome: preserve the starter while making installation, representation, measurements, and controlled local writes dependable enough for a real companion.

Entry gate: the owner assigns implementation of B0; inspect the current checkout and [red-team register](../reviews/RED-TEAM.md). Documentation approval is not that assignment. Full-suite and live-host results from the earlier review are unavailable.

Scope note, 2026-10-05: the [roadmap](../ROADMAP.md) Phase 1 list overrides the ticket bodies below where they differ. Order: R16 first, then confinement (including `src/memory-tool.ts`), stream decoder, context budget, history zero and config aliasing, evaluator, ledger corruption, starter hygiene, Node floor. Deferred: npm packaging, tarball tests and typechecking (T07 shrinks to the Node floor and a startup version check); multi-file atomicity is documented as a limit; stale-proposal checks are out of scope until a write workflow needs them. Installed-artifact checks in T08 and the exit checklist mean a plugin install from the repository marketplace. T01 records the current `master` head as baseline, which includes contract 1.1.0.

Non-goals: new ranking algorithms, temporal features, Hermes plugin, hosted service, full benchmark framework, and mass refactoring.

## Tickets and state

The integrator owns this table. Each worker's evidence identifies its branch and commit.

| Ticket | Status | Owner | Depends on | Evidence |
|---|---|---|---|---|
| B0-T01 | planned | unassigned | B0 assignment | none |
| B0-T02 | planned | unassigned | T01 | none |
| B0-T03 | planned | unassigned | T01 | none |
| B0-T04 | planned | unassigned | T01 | none |
| B0-T05 | planned | unassigned | T01, T02 | none |
| B0-T06 | planned | unassigned | T01, T05 for mutating calls | none |
| B0-T07 | planned | unassigned | T01 | none |
| B0-T08 | planned | unassigned | T02-T07 | none |

## B0-T01: capture baseline and executable checks

Scope: `package.json`, existing tests, example documentation, and a sanitized B0 verification record. Avoid product behavior changes in this ticket.

Reproduce the current install/run/check paths in a disposable checkout. Capture Node/npm/OS, all exits, the starter's intentional drift/TODOs, and which prior findings reproduce against actual modules. Inspect config resolution before declaring `npm run check` a working gate. Establish file ownership and supported runtime decisions for the following tickets.

Acceptance: baseline failures are individually classified; real failing tests or precise reproduction instructions exist for assigned defects; the starter remains unchanged; test environment requirements are recorded. End with a reproducible command list, not an assertion of 110 passing tests copied from README.

## B0-T02: representation and proposal correctness

Scope: `src/parse-frontmatter.ts`, `src/compile.ts`, `src/schema.ts`, `src/restructure.ts`, related tests; coordinate changes to contract/types.

Fix supported string-array round-trips, reject malformed quoting, detect extension-only updates, and prevent extensions from overriding reserved fields. Clarify normalized content versus byte identity. Reject unsupported values rather than silently discarding data under a lossless claim. Preserve documented legacy fields and valid starter inputs.

Acceptance: quotes, boolean-looking strings, numeric strings, Unicode, multiline text, and metadata-only changes have exact oracles; malformed input fails before mutation; existing round-trip cases remain meaningful; any grammar change has a contract/migration note. No broad YAML dependency change without an ADR.

## B0-T03: honest retrieval and evaluation

Scope: `src/search.ts`, `src/score.ts`, `src/config.ts`, `src/eval.ts`, related tests. No new retrieval algorithm.

Correct history count zero and shared-mutable-default risks. Define how contextual boosts affect eligibility. Make budget behavior explicit and test total supplied context, including always-included material at the host boundary. Fix hit-rate denominators and make forbidden-ID failures block independently of aggregate metrics. Specify empty-case semantics and exact-ID evaluation.

Acceptance: all metrics are within their stated ranges; forbidden hits fail the gate; context-only matches are distinguished from evidence-bearing matches; deterministic fixtures cover overflow and history zero. Record intentional compatibility changes. Do not tune a baseline to conceal a defect.

## B0-T04: lossless streaming output

Scope: `src/gaps.ts`, streaming tests, consuming streaming example in documentation.

Use a stateful decoder or equivalent minimal design for visible text and gap events. Keep multiple distant markers detectable, preserve ordinary whitespace, and define end-of-stream handling for incomplete markers. Avoid duplicate events across chunk boundaries.

Acceptance: arbitrary split points, multiple markers farther apart than the old rolling window, long deltas, reset, and ordinary text all have exact output/event assertions. Record how existing consumers migrate. Only synthetic output is used.

## B0-T05: shared safe-write boundary

Scope: `adapters/fs.ts`, `cli/lib.mjs`, `cli/amk.mjs`, common application module if needed, and write/CLI tests. Coordinate MCP call-site changes with T06.

Unify config-relative resolution and merged-state validation before writes. Confine reads/writes to allowed roots, including symlink parent components. Add a single-writer boundary and stale-base check; make file and ledger outcomes explicit. Report corrupted ledger data. Implement or document-and-test the smallest recovery mechanism adequate for the released path.

Acceptance: rejected batch changes no files; stale proposal is rejected; traversal/symlink fixtures cannot touch sentinels outside the sandbox root; injected write failure never reports success or closes gaps; restart exposes or recovers incomplete work. Distinguish per-file replacement from batch atomicity. If safe recovery cannot fit B0, keep affected operations read-only and block B1 mutation acceptance rather than overclaim.

## B0-T06: bounded and compatible transport

Scope: `agent/mcp-server.mjs`, transport tests, `agent/README.md`, `docs/MCP.md`. Reuse T05 write policy.

Validate tool arguments and protocol envelopes at the boundary; ensure documented tools exist. Prefer local stdio for the first companion. If HTTP remains exposed, bind explicitly and test its origin/access policy and body limits; otherwise disable it with a migration note. Test negotiated versions rather than accepting old-version labels with untested new-only response behavior. Keep a non-elicitation path.

Acceptance: invalid envelopes/arguments fail predictably; read-only mode rejects mutation server-side; no accidental wildcard listener; a real MCP client can list/read tools on a pinned protocol; malformed requests do not corrupt memory or crash the process. Feature claims match tested paths.

## B0-T07: package and typecheck

Scope: `package.json`, build/typecheck configuration and scripts, package tests, optional CI. Keep runtime dependencies out of the core.

Verify the declared Node floor, establish typechecking, and emit installable JavaScript/types if required. Include CLI/MCP assets needed after installation. Check imports, exports, and paths from a consumer directory containing spaces. Use an actual packed artifact; `npm link` alone is insufficient.

Acceptance: supported Node versions can import the public library and run installed CLI/read-only MCP; source workflow still works on its documented runtime; tarball content and size are reported; no credentials or runtime outputs enter the package. Publishing to a registry is not authorized by this ticket.

## B0-T08: combined gate and starter acceptance

Scope: combined branch, starter instructions, B0 evidence record, current technical docs affected by fixes.

Run every applicable [QA](../QA.md) regression family on the combined branch, then install the packed artifact in a clean consumer. Confirm the original starter does not require new fields or an integration. Record actual user-run acceptance and known limits. Reassess B1's entry gate against unresolved findings.

Acceptance: no unresolved critical issue in enabled install/read/write paths; command list is reproducible; actual test counts and environment are recorded; no undocumented data loss; owner has accepted the starter workflow or batch remains `awaiting_user`.

## Parallelization

After T01, T02, T03, T04, and T07 can proceed with agreed ownership. T05 depends on representation semantics; T06 may probe protocol in parallel but must integrate T05 before accepting writes. One owner coordinates shared types, scripts, and final docs. T08 runs only on the merged batch branch.

## Success and exit checklist

- [ ] T01-T08 acceptance evidence is linked in the state table.
- [ ] All required deterministic safety/compatibility cases pass.
- [ ] Full regression run uses actual project modules, not copied snippets.
- [ ] Plugin install from the repository marketplace starts the read-only MCP server on the declared Node floor and a current release.
- [ ] The original starter remains minimal and usable.
- [ ] User acceptance and the shared definition of done are satisfied.
- [ ] B1 is proposed for assignment; no automatic feature continuation or merge occurs.
