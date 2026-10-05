# Roadmap and priority decisions

Planning revision: 2026-10-05, second pass after an independent review ([PLAN-REVIEW-2026-10-05](reviews/PLAN-REVIEW-2026-10-05.md)). This revision replaces the 2026-09-26 batch order with a phase order, and parks the local release train in [`docs/plans/`](../plans/README.md) (0.4.0 to 1.0.0). Priorities are product decisions, not measured scores. Ticket state lives only in batch documents.

## Target picture

> AMK turns the corrections you keep repeating to your coding agent into reviewed, sourced facts, and checks with a replayed question whether the agent now gets them right.

AMK runs **standalone first**: its own atoms, CLI and MCP server, no other memory system required. A read-only audit of Claude Code auto memory is the entry point that shows where corrections are needed; it is a hook, not the product. Similar audits already exist (see [Positioning](POSITIONING.md)). What nobody packages yet is the loop from correction to reviewed fact to replay.

## Goals

| # | Goal | Done when |
|---|---|---|
| G1 | **Safe to run.** No AMK surface exposes writes beyond the local user | HTTP binds to loopback by default; writes over HTTP need a token; path escapes are refused, each with a test |
| G2 | **Correction loop.** A correction becomes a validated, sourced atom and is replayed | At least three correction cases, each replayed repeatedly on the original and a held-out question, with pass counts and run-to-run variance reported |
| G3 | **Install in under five minutes**, removable without residue | Two outside developers install the plugin and remove it without help |
| G4 | **Credible open source.** Limits documented, no unbacked claims | Red-team findings closed or documented; claims ledger published |
| G5 | **Enterprise only on demand** | A paid pilot exists before the first enterprise feature |

Non-goals until a phase gate says otherwise: own vector store, embeddings, hosted service, two-way sync, writing into another system's store, replacing or intercepting native memory, an npm package, Mem0/Hermes/Pi/OpenViking integrations, a GBrain audit adapter, and the parked 0.4.0 to 1.0.0 features (scopes, escalation, audit pass, freeze).

## Phases

Effort is an estimate for one owner working with coding agents, including the docs required by `CLAUDE.md`. It is not a commitment. Each phase can shrink or stop the roadmap if its gate fails.

| Phase | Content | Estimate | Gate | Batch |
|---|---|---|---|---|
| 0. Housekeeping | Local commits pushed, strategy merged, obsolete branches removed, plan written and reviewed | done 2026-10-05 | One reviewed plan on `master` | – |
| 1. Foundation | Security first, then the confirmed red-team findings and starter hygiene (list below) | 6-8 days | Every listed finding has a real-module test and a fix, or a documented limit | [B0](batches/B0-foundation.md) |
| 2. Plugin and audit hook | Claude Code plugin from this repository's marketplace, read-only by default; `amk audit` over auto memory | 3-4 days | Owner installs from GitHub, runs the audit on their own memory, removes the plugin | [B1](batches/B1-agent-companion.md) T00, T02 |
| 3. Correction loop | Reviewed promotion into a sourced atom, stale-proposal rejection, replay in fresh sessions; comparison against native memory and GBrain | 8-10 days | G2 and the owner's user test | [B1](batches/B1-agent-companion.md) T03, T05, T06 |
| 4. Public release | README rebuilt around a 60-second demo and the plugin install; claims ledger; two outside installs | 3-4 days | G3 and G4 | B5 |
| 5. Enterprise | Sell a pilot first (memory review and hardening as a service), then build exactly what it requires | demand-led | Signed pilot | B6 |

A credible open-source release is roughly seven to ten weeks away. Enterprise work starts no earlier than two to three months after that, and only with a customer.

### Why this order

A memory server that accepts writes from the network is a worse problem than any missing feature, so security leads Phase 1. The audit comes before the loop because it is cheap, it is the visible first minute of the product, and it shows the owner which corrections to promote. The loop is the headline because it is the only part without a packaged equivalent; it gets the larger budget.

GBrain is not an audit target. It ships its own checks (doctor, orphans, schema lint, contradictions, gap analysis in synthesis), and its Markdown repository is canonical. It is a comparator in Phase 3: if GBrain's own workflow already makes a correction stick, AMK's loop has to show what it adds or shrink. OpenViking is deferred: it is not in use, its API is still moving, and its core licence (AGPLv3) needs a review before any enterprise offer touches it.

### Phase 1: scope

In, in this order:

1. **HTTP exposure (R16).** Bind to `127.0.0.1` by default, log the address actually bound, add an explicit host option, refuse mutating tools over HTTP without a token.
2. **Path confinement (R13, R14)** in `adapters/fs.ts` and in `src/memory-tool.ts`, which postdates the red-team baseline.
3. **Corrupt ledger lines (R15)** reported, not skipped.
4. **History zero (R09)** and **gap stream decoder (R01-R03)**.
5. **Evaluator honesty (R10, R11).**
6. **Starter hygiene:** `eval` stops modifying tracked files in `example/`; `drift` exits non-zero on an error finding; a root `npm run check` that works from a fresh clone.
7. **Node floor** to 22.18.0 in `package.json`, README and LIMITATIONS, plus a startup check with a clear message.

Out, moved or documented: npm packaging and tarball tests (deferred with npm); typechecking (optional until a defect needs it); multi-file write atomicity (documented as a limit, per-file writes stay); stale-base checks (moved to Phase 3, where proposals first need them); remaining static findings S01-S05 where they do not touch an enabled path.

### Phase 2: the audit hook

The adapter reads the auto-memory directory and never writes to it. It parses frontmatter itself rather than through the atom loader, which rejects nested maps on purpose. It accepts both shapes seen in practice: a flat `type:` and a nested `metadata:` block holding `type`, plus extra fields such as `modified`. It resolves the directory from the project, honouring `autoMemoryDirectory` and `CLAUDE_CODE_PROJECT_DIR_NAME`, and accepts an explicit path.

| Check | Why it matters |
|---|---|
| `MEMORY.md` over 200 lines or 25KB | Content past the limit is not loaded at session start; Claude is told, the user often is not |
| Topic file not listed in `MEMORY.md` | The memory exists and no session is pointed at it |
| Index line points at a missing file | The agent is told about knowledge that is gone |
| `[[link]]` with no matching memory | A dangling edge; AMK's loader refuses these for atoms |
| Missing or unknown `type`, missing `description` | The index line cannot be judged for relevance |

Near-duplicate and stale-date checks are dropped from this phase: they are heuristics, and the five checks above are deterministic. Findings are printed and can be recorded as gaps; nothing else changes.

### Phase 3: how results are reported

Model answers vary between runs. Each replay question runs several times per condition (AMK, native memory with the same fact, GBrain with the same fact), and results are reported as pass counts with their spread. A handful of cases is an engineering check, not evidence of improvement; no percentage is published from it.

## Later, unscheduled

These stay in the plan as direction, not as work. Each needs evidence from Phases 1 to 3 before it gets tickets.

- **B2, time and provenance.** Revision IDs, a stable fact key, validity intervals, `asOf` queries. Contract 1.1.0 already carries `source`, `retrievedAt` and `validUntil`; start from those rather than a parallel model.
- **B3, retrieval driven by misses.** Retrieval hints and tokenizer fixes first; one field-aware index only if measured misses justify it.
- **B4, interoperability.** Hermes, Mem0, OpenViking, Pi, and GBrain as a source or target of reviewed facts. Read-only first wherever the host offers a file export.
- **npm package.** Needs a build step that emits JavaScript, because Node does not strip types under `node_modules`.
- **Parked releases.** 0.4.0 scopes, 0.5.0 escalation, 0.6.0 audit, 1.0.0 freeze. Their plans remain valid as designs. Revisit after Phase 3, with the audit findings as input.

## Dependencies

Phase 1 item 1 precedes everything else. Phase 2 needs Phase 1 items 1, 2 and 7, because the plugin starts the MCP server on the user's machine. Phase 3 needs all of Phase 1. Phase 4 combines only tested capabilities. Detail the active and the next batch only. Preserve the starter in `example/` at every checkpoint.
