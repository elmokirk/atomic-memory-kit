# Architecture and compatibility

Status: proposed extension architecture. Existing format semantics remain governed by [CONTRACT.md](../../CONTRACT.md). The source baseline and review limitations are in [the strategy index](README.md) and [review register](reviews/RED-TEAM.md).

## Keep one product

Retain the repository and `example/`. Reference the original commit rather than maintaining a second frozen core. Fix defects in place; make new capabilities optional. Avoid a monorepo, dependency-injection framework, or generic plugin registry until multiple real consumers need one.

| Existing location | Responsibility | Planned change boundary |
|---|---|---|
| `src/` | Pure atom model, validation, resolution, retrieval | Small functions/modules; no host SDK or filesystem |
| `adapters/` | Persistent bytes and host-owned I/O | Safe roots, controlled writes, explicit failure semantics |
| `cli/` | CLI entry point | Call common application operations rather than duplicate write policy |
| `agent/` | MCP and consumer instructions | Keep public entry compatibility; split transport from business operations as needed |
| `example/` | Minimal starter | Preserve existing valid inputs; put advanced examples elsewhere |
| `integrations/` (future) | Claude Code, Pi, Hermes packages/guides | Thin wrappers over the same application operations |

Introduce a small shared application module only to remove actual CLI/MCP duplication. Proposed operation concepts are retrieve, observe, propose, and commit; they are not promised function names. Inject storage and clock through simple explicit arguments. Dependency arrows point toward the core. An integration never becomes a dependency of `src/`.

## Core versus optional capability

Core guarantees cover representation, validation, deterministic results under fixed inputs, and explicit errors. Optional temporal resolution, richer lexical retrieval, and host packaging build on those guarantees. Development-only TypeScript/build/test tools do not violate a zero-runtime-dependency core.

Keep source-based development possible on a tested Node version. A distribution build may emit JavaScript and declarations so installed packages work without runtime type stripping. Test the actual tarball, not just `npm link`.

## Compatibility policy

Existing valid starter atoms must still load without added fields. Keep supported round-trip values stable, not arbitrary unsupported YAML. Security-sensitive changes may reject previously unsafe paths; document that change rather than preserve the vulnerability.

For every field addition, update validation, types, serialization, parsing, transport, diff comparison, fixtures, and documentation together. Extension-only changes must be visible to the write plan. Protect reserved names from extension collisions. Do not add nested YAML, null values, or duplicate IDs merely because an earlier chat example used them.

Kit, contract, and bundle versions are different contracts. Decide version and migration implications in an ADR before changing a wire shape. Do not require a generic `extensions` framework to add a few optional fields.

## Writes and recovery

One common write policy serves CLI and MCP. Resolve config paths consistently, validate the merged candidate before mutation, and reject stale proposals using the base revision/hash. Recheck after acquiring the writer boundary. A diff prepared for one state is not approval for a different state.

Initial operating model: one controlled writer per memory root; readers consume complete validated snapshots. Decide and test the smallest adequate filesystem implementation. Per-file atomic replacement is not multi-file transactional publication. If crash-safe batches are not available, document that limit, stop on an incomplete write, and provide deterministic recovery. Never close gaps or report success before the durable operation is confirmed.

Reject path escapes and unsafe symlink traversal, including parent components. Restrict read as well as write roots. Use synthetic local fixtures for fault tests. A namespace or a metadata flag is not authorization.

## Retrieval and context

The host selects allowed roots/scopes before retrieval. Apply time and scope eligibility before ranking and edge expansion; apply the same rules to always-included content. An optional index must not leak private titles or summaries across scopes.

`no_match` means no acceptable candidate was found under this configuration. It is not proof that the knowledge does not exist. Preserve the difference between retrieval miss, unavailable source, denied access, ambiguous revision, and an unconfirmed content gap. Map new diagnostics compatibly instead of silently changing existing enum meanings.

Budget the entire injected context, including always-included atoms and wrappers. Return an explicit overflow/incompleteness signal rather than quietly exceeding a hard budget. Pin definitions of characters, bytes, and tokens; measure host token usage separately.

## Temporal model proposal

Use a unique stored revision ID and a stable `factKey` within a namespace. Preserve source references, `recordedAt`, and optional `validFrom`/`validUntil`; use half-open validity intervals after an ADR confirms that choice. Missing bounds have explicit semantics and need no unsupported YAML nulls.

Compute current/historical selection from the query time, not a second editable `current` flag. Overlaps and conflicting facts are visible outcomes. `supersedes` refers to specific revisions and does not imply deletion. Legacy atoms are unversioned, not retroactively verified. Inject the clock for deterministic tests.

Source existence, human review, schema conformance, and factual truth are distinct. Record a reviewer and source only when actually known. Inferred preferences are not silently promoted to explicit user preferences. Raw conversation storage and personality inference remain outside AMK.

## Repair lifecycle proposal

Observe a failure with a stable observation ID and reason, propose a correction, obtain approval, commit, and replay linked cases before claiming verified closure. Preserve compatibility with the existing open/closed ledger; add repair evidence rather than inventing a second conflicting status system.

Retries must not inflate demand. Separate user observations from diagnostic scans. Reopening a gap is not evidence that a particular person returned. Raw queries are optional and sensitive. Minimize stored data and define deletion behavior before real personal use.

## Host contracts

| Host | Initial attachment | Explicit limit |
|---|---|---|
| Claude Code | Plugin containing MCP and small skills; tested command hooks only when useful | Complements auto-memory, does not replace undocumented internals |
| Claude API | Optional client-side handler example | Separate integration from Claude Code; file operations still need safety policy |
| Pi | Direct application API or thin tool adapter in a reference host | Confirm the actual SDK and chatbot boundary before exact calls |
| Hermes | MCP companion, optional general plugin after evidence | Keep native and selected external provider behavior intact |
| Mem0 | Guide for reviewed promotion into AMK | No automatic bidirectional sync or assertion of universal SDK compatibility |

Protocol support requires a recorded host version, negotiation trace, tools/list and call tests, and fallback when elicitation is unavailable. A protocol revision in a README is not a compatibility test. See [Sources](SOURCES.md).

Zero AMK model calls does not mean zero added agent turns. Measure invocation, latency, and token costs at the host boundary.
