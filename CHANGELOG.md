# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Kit vs Contract versioning:** Kit version (`package.json`) tracks the engine/tooling.
> Contract version (`src/contract.ts`, `CONTRACT.md`) tracks the frontmatter grammar.
> A breaking change to a core field or parser grammar is a **contract major** bump
> with a migration note here. Contract `1.0.0` was `v1` — same atoms, formalised.

## How to update this file (for contributors / agents)

1. Add your entry under `## [Unreleased]` in the right subsection (`Added` / `Changed` / `Fixed` / `Removed`).
2. Keep one bullet per user-visible change. Link the PR/issue if you have one.
3. On release: rename `## [Unreleased]` to `## [x.y.z] - YYYY-MM-DD`, create a new empty
   `## [Unreleased]` at the top, update the link refs at the bottom, bump `package.json`.

Subsections to use: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`.

---

## [Unreleased]

### Security

- `--http` binds `127.0.0.1` by default; `--host` binds elsewhere. The startup
  log prints the address actually bound (it used to print `127.0.0.1` while
  listening on every interface).
- Writing tools over HTTP (`memory_apply`, `memory_gap_add`, `memory_gap_close`,
  `memory_close_gaps` with `autoApply`) are refused unless `AMK_AUTH_TOKEN` is set.
- Reads and writes are confined to the memory root: `../`, absolute, drive, UNC
  and stream paths are refused, and symlinks or junctions cannot lead outside.
  Applies to `adapters/fs.ts`, `adapters/memory-tool.ts` and `src/memory-tool.ts`.

### Fixed

- Streaming gap detection lost a second marker more than 128 characters after
  the first, and per-delta stripping leaked split markers and dropped whitespace.
- `historyContextMessages: 0` used the whole history.
- Config defaults were shared between calls; mutating one leaked into the next.
- Eval hit rate could exceed 1; a forbidden retrieval passed when aggregate
  scores passed.
- A corrupt ledger line was skipped silently; it is now reported with its line
  number (warning `AMK_CORRUPT_LEDGER_LINE` or a callback).
- `amk drift` (and `doctor`) exited 0 when reporting an error finding.
- `npm run check`, `npm run mcp` and `npm run mcp:http` failed from the
  repository root; they now run against `example/`.

### Added

- Claude Code plugin `amk` in marketplace `atomic-memory-kit`
  (`.claude-plugin/`): starts `agent/mcp-server.mjs` over stdio, read-only by
  default, memory config resolved from the project root. Options `config` and
  `allow_writes`. See `docs/INTEGRATIONS.md` §1.
- MCP server `--allow-writes <value>`: refuses every writing tool unless the
  value is exactly `true`. Without the flag, behaviour is unchanged.
- A missing memory config now answers `no memory config at <path>` with the fix,
  instead of a raw `ENOENT`.
- `example/chatbot/demo.mjs` (`npm run demo`): a runnable chatbot path over the
  example memory with a scripted model. Shows retrieval with scores, `no_match`
  before any model call, a streamed `[GAP: …]` marker hidden from the user and
  recorded, and the resulting ledger. No API key, no network; writes only to a
  temp directory.
- `GapDetector.write(delta)` and `end()`, returning visible text and completed
  topics. Replace `push(delta)` plus `stripGapMarkers(delta)` with them; `push`
  still works for topics only.
- `MemorySearchResult.overBudget`: true when the best atom alone exceeds the
  character budget. The atom is still returned whole.
- `resolveInside(root, path)` in `adapters/fs.ts`.
- Eval summary field `matchCases`.

### Changed

- Node floor raised to 22.18.0, the first 22.x with type stripping on by
  default. The CLI and the MCP server check it first and exit with a clear
  message.
- An eval suite with no cases, or only negative cases, now fails.
- `writeMemoryFiles` creates a missing root folder.

### Contract 1.1.0 — durability and provenance

Additive. **There is nothing to migrate.** All four fields are optional, every
atom valid under 1.0.0 is valid under 1.1.0, and an existing memory loads with
zero new warnings. Run `amk validate` to confirm rather than taking this on
trust.

| Field | Type | Class | Default |
|---|---|---|---|
| `durability` | `fixed` \| `stable` | standard | `stable` |
| `source` | string | standard | — |
| `retrievedAt` | string, quoted ISO date | standard | — |
| `validUntil` | string, quoted ISO date | standard | — |

- **`durability: volatile` is refused on write** (`E_DURABILITY_VOLATILE`) at
  every entry point: `amk validate`, `planApply`, `memory_apply`, and the
  memory-tool `create` / `str_replace` / `insert` paths. The refusal names where
  the content belongs instead — an agent learns the Tier-1 / Tier-2 boundary
  from a tool result rather than from documentation it never reads. An
  unrecognised value warns (`W_DURABILITY_UNKNOWN`) and behaves as `stable`, per
  R4.1.
- **`expiry` — the seventh gap detector.** `src/expiry.ts` compares `validUntil`
  against an injected clock (`src/` still contains no `Date.now()`, which is what
  keeps every test deterministic). An expired atom is **not** deleted, hidden or
  down-ranked: it keeps serving and produces a gap carrying its `source`, so a
  research agent can close it without a second lookup.
- `amk expiring [--within N]` — what is already stale, plus what goes stale in
  the next N days, with relative time rather than naked dates. Wired into
  `amk gaps` and `amk doctor`.
- Library: `findExpiring`, `expiryToGaps`, `findUnboundedProvenance` (atoms with
  a `source` but no expiry — knowledge implicitly claiming it can never age).
- `W_DATE_FORM` / `W_DATE_UNQUOTED` — dates must be `YYYY-MM-DD` and quoted. Ours
  reads a bare date as a string; a foreign L1 implementation might read it as
  arithmetic. The emitter always quotes.

### Added

- **Anthropic memory-tool bridge.** `src/memory-tool.ts` (pure) and
  `adapters/memory-tool.ts` (I/O) implement the six `memory_20250818` commands
  with the contract underneath. The documented return strings are preserved, so
  the model's trained expectations still hold; four behaviours are added that a
  filesystem handler cannot offer:
  - a `view` of a path that does not exist is **recorded as a gap** — the model
    guessed a filename, and a wrong guess is a statement about demand;
  - a `create` / `str_replace` / `insert` whose result violates the contract is
    **refused with its diagnostic code**, so the model corrects itself in the
    same turn instead of memorising rules;
  - a `delete` that would leave an inbound edge dangling is **refused with the
    referrer list**;
  - a `rename` **rewrites every inbound `related[]` reference atomically**, and
    warns that citations outside the memory cannot be repaired.
- Directory listings are annotated with each atom's title and summary, so the
  model can choose what to open without opening anything.
- Degraded mode: a memory that fails to load no longer bricks the agent. `view`
  and `delete` keep working so the damage can be repaired, and the load error is
  surfaced in the listing.
- `AMK_AUTH_TOKEN` — constant-time bearer auth on the HTTP transport. Required in
  practice for hosted clients, since custom connectors dial the server from
  Anthropic's cloud. The server warns when it is unset.
- `amk contract [--json]` — print the field table with consumers and
  blast-radius markers, or the full machine-readable descriptor.
- `VERDICT.md` — the two-minute form of the analysis: comparison table, what this
  does better, and the two-tier recommendation.
- `docs/MEMORY-TOOL.md`, `docs/INTEGRATIONS.md`, `SOURCEMAP.md`.
- `LINKMAP.md` — external provenance split out of `SOURCEMAP.md`. Every claim
  about MCP, Anthropic's memory stack, custom connectors and `/dream` with a
  retrieval date and a reliability grade (spec / docs / vendor / press /
  community / observation). The two files rot on different clocks, which is
  why keeping them together meant one was always the reason to skip the update.
- `docs/plans/` — a release train, 0.3.0 through 1.0.0, one file per release:
  durability and provenance, scopes, escalation, the audit pass, and the
  contract freeze with a language-neutral conformance suite. Each plan carries
  UX / DX / agent-experience notes, the oracle its tests check against, the
  documents it must update, and kill criteria written before the work starts.
- `IDEAS.md` — captured directions (scopes, durability, escalation,
  self-observation) each scored against one question: what oracle tells us it
  worked? Three are marked "do not build", with reasons.

### Changed

- `package.json` exports `./adapters/memory-tool`.
- `CLAUDE.md` and `.claude/skills/` — the project's own operating rules and four
  skills (contract change, release planning, doc integrity, testing), so agent
  work on this repo is governed by the same discipline as the code.
- Tests: 110 → 203.

### Fixed

- `SOURCEMAP.md` claimed `npm run contract` was runnable; the escaping in the
  `package.json` one-liner was broken. Replaced with the real `amk contract`
  command rather than deleting the claim.
- Expiry gap topics embedded the elapsed days ("expired 30d ago"). The ledger
  deduplicates by `(kind, normalized topic)`, so one stale atom minted a fresh,
  uncloseable gap record every single day. The topic now carries the atom id and
  its declared `validUntil`; elapsed time moved to the detail. Found by running
  `amk doctor` on the example twice on different days — not by the test suite,
  which had used the same injected clock for both observations. A regression test
  now steps the clock.
- The memory-tool `rename` accepted destinations that do not round-trip through
  the id mapping (`plans.markdown` implied the id `pricing.plans.markdown`,
  which maps back to `pricing/plans/markdown.md`). Now refused, with contract
  rule R1.5 named. Found by its own test.

## [0.2.0] - 2026-08-29

Contract **1.0.0** (now semver, was `v1`). No atom valid under `v1` becomes
invalid: this is a formalisation, not a break.

### Contract

- `src/contract.ts` — the contract as machine-readable data. Field table with
  types, both severities, consumer lists, retrieval/reference flags; grammar
  patterns as source strings; stable diagnostic codes; conformance levels L1–L4.
  Imports nothing, so it sits at the bottom of the dependency graph.
- `CONTRACT.md` rewritten as a normative spec: §0 dependencies in both
  directions, §1 ten numbered rules with RFC 2119 keywords, §4 the three
  extension mechanisms, §6 the code table, §7 conformance levels.
- `schema.ts` now **derives** its field lists from the contract table instead of
  restating them, and stamps a stable code on every issue.
- `LoadIssue` and `MemoryContractError` carry `code`. Tooling branches on codes,
  never on message text.
- `x-*` and `_*` field names reserved for users in perpetuity.

### MCP — protocol revision 2026-07-28

- Rewritten stateless and headless. `server/discover`, per-request `_meta`
  negotiation, `resultType` on every result, cacheable list results,
  deterministic tool order, `-32020` / `-32021` / `-32022`.
- Streamable HTTP transport (`--http`) alongside stdio. POST-only; no session
  header, no GET endpoint, no resumability — all removed in this revision.
- `Mcp-Method` / `Mcp-Name` header validation with `HeaderMismatchError`.
- **`memory_close_gaps`** — the gap loop as a Multi Round-Trip Request. Returns
  one elicitation per open gap; the retry carries `inputResponses` plus a
  HMAC-signed, TTL-bounded, tool-bound `requestState`. Degrades to a question
  list when the client cannot elicit.
- New tools: `memory_contract`, `memory_compile`, `memory_restructure`,
  `memory_apply`.
- `initialize` still answered for 2025-era clients.

### Inbound direction

- `src/restructure.ts` — `planApply` (validate + diff, writes nothing),
  `materialize` (merge, then prove the result still loads), `draftFromMarkdown`
  (structural split only; never invents keywords, reports `needs`).
- Edges resolve against the union of existing and proposed ids, so A and B can
  be added in one batch. All-or-nothing: no partial writes.

### Analysis

- `ANALYSIS-ANTHROPIC-MEMORY.md` — placement against Anthropic's four memory
  layers, red-teamed, with a verdict and a two-tier recommendation.

### Fixed

- `linkLabel` and `link` were never type-checked; a number passed validation.
  Found by the contract-derivation test.
- `amk gaps` detected cycles by matching message prose. Now matches `W_CYCLE`.

### Tests

51 new (110 total): contract self-consistency and derivation totality, blast
radius, version negotiation, restructure planning and materialization, and MCP
conformance including a full MRTR round trip across two cold processes.

## [0.1.0] - 2026-08-29

Initial extraction. Contract **v1**, bundle format **v1**.

### Core

- Atom contract with three field classes: core (error), standard (typed),
  extension (inert pass-through).
- YAML-subset frontmatter parser: scalars, inline arrays with quote tracking,
  block scalars, comments. Everything else is a hard error with line context.
- Loader as trust boundary: parse, validate, index, verify graph integrity.
  Dangling and self-referencing edges fail the load; cycles of 3+ warn.
- Deterministic retrieval: weighted keyword/synonym/field scoring, umlaut
  folding, light suffix stemmer, length-guarded prefix matching. Configurable
  language profile.
- Scope gate producing `match` / `no_match` below `minScore`.
- 1-hop `related[]` edge expansion with reserved budget and `viaEdge` marking.
- Context boosting by category.

### Bidirectional compile

- `bundle.md` — lossless, editable, round-trippable single-file projection with
  fenced atom blocks and gaps as checkboxes.
- `compiled.json` — lossless machine transport; carries open gaps with the memory.
- `digest.md` — lossy read-only overview.
- Generated scope index atom (`_index.md`, `alwaysInclude`).
- Round-trip verified against fixtures with quotes, umlauts, colons, quoted
  numbers, mixed quote styles and multiline block scalars.

### Gap spotlighting

- Six detectors: `runtime`, `scope`, `eval`, `drift`, `todo`, `cycle`/`orphan`.
- `[GAP: topic]` marker protocol with a streaming detector that survives markers
  split across deltas.
- Deduplicated ledger keyed by `(kind, normalized topic)` with recurrence
  counting; re-observing a closed gap reopens it.
- Gap report renders checkboxes that parse back — the report is an input as well
  as an output.
- Retrieval eval with thresholds and baseline regression detection.
- Drift detection: numeric verification of external claims against atoms.

### Tooling

- `amk` CLI: init, validate, stats, search, compile, import, index, eval, drift,
  gaps, doctor.
- Node filesystem adapter with byte-identical skip on write.
- Zero-dependency MCP stdio server exposing 8 tools.
- Two agent skills and an `AGENTS.md` snippet.
- 59 tests on `node:test`, zero dependencies.

### Deliberate non-goals

No embeddings, no LLM code, no multi-tenancy, no access control, no automatic
knowledge extraction, no keyword generation. See `LIMITATIONS.md`.

---

[Unreleased]: https://github.com/elmokirk/atomic-memory-kit/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/elmokirk/atomic-memory-kit/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/elmokirk/atomic-memory-kit/releases/tag/v0.1.0
