# Changelog

Kit version is independent of the contract version. A breaking change to a core
frontmatter field or to parser grammar is a **contract** major bump with a
migration note here.

## 0.2.0 — 2026-08-29

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

## 0.1.0 — 2026-08-29

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
