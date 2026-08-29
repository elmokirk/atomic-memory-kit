# Changelog

Kit version is independent of the contract version. A breaking change to a core
frontmatter field or to parser grammar is a **contract** major bump with a
migration note here.

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
