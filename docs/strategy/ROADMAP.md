# Roadmap and priority decisions

Planning revision: 2026-10-05. This revision replaces the 2026-09-26 batch order with a phase order, and parks the local release train in [`docs/plans/`](../plans/README.md) (0.4.0 to 1.0.0). Priorities are product decisions, not measured scores. Ticket state lives only in batch documents.

## Target picture

> AMK checks and hardens what agents believe they know, whether that knowledge lives in AMK itself, in Claude Code auto memory, or in a Markdown brain such as GBrain. It reports what is missing or wrong, and proves that a correction works on a later question.

AMK runs **standalone first**: its own atoms, CLI and MCP server, no other memory system required. Adapters read other stores so the same checks apply to them. Adapters are a distribution channel; the checks are the product. See [Positioning](POSITIONING.md).

## Goals

| # | Goal | Done when |
|---|---|---|
| G1 | **Audit.** AMK reads a native memory store read-only and reports concrete defects | `amk audit` on a real Claude Code memory directory produces reproducible findings |
| G2 | **Reviewed promotion.** A correction becomes a validated, sourced atom | Three correction cases pass replay on the original and a held-out question |
| G3 | **Install in under five minutes**, removable without residue | Two outside developers manage it without help |
| G4 | **Credible open source.** Limits documented, no unbacked claims | Red-team findings closed or documented; claims ledger published |
| G5 | **Enterprise only on demand** | A paid pilot exists before the first enterprise feature |

Non-goals until a phase gate says otherwise: own vector store, embeddings, hosted service, two-way sync, writing into another system's store, replacing or intercepting native memory, Mem0/Hermes/Pi/OpenViking integrations, and the parked 0.4.0 to 1.0.0 features (scopes, escalation, audit pass, freeze).

## Phases

Effort is an estimate for one owner working with coding agents, including the docs required by `CLAUDE.md`. It is not a commitment. Each phase can shrink or stop the roadmap if its gate fails.

| Phase | Content | Estimate | Gate | Batch |
|---|---|---|---|---|
| 0. Housekeeping | Local commits pushed, strategy merged, obsolete branches removed, this plan written | done 2026-10-05 | One plan on `master` | – |
| 1. Foundation | Reduced B0: fix the red-team findings that sit on the released path | 4-6 days | Every finding reproduced by a real-module test and fixed, or documented as a limit | [B0](batches/B0-foundation.md) |
| 2. Claude Code memory audit | Read-only adapter for the auto-memory directory plus `amk audit`; Claude Code plugin around the existing MCP server | 4-5 days | Demo: audit of the owner's own auto memory | [B1](batches/B1-agent-companion.md) T00, T02 |
| 3. Correction loop | Promote a reviewed entry into a sourced atom, replay it in a new session; rejection writes nothing | 4-5 days | G2 and the owner's user test | [B1](batches/B1-agent-companion.md) T03, T05, T06 |
| 4. GBrain, read-only | Same audit over a GBrain Markdown export | 2-4 days | Entry only if a Markdown export of the owner's brain exists on disk; otherwise skipped | not ticketed |
| 5. Public release | README repositioning, quickstart, claims ledger, two outside installs | 3 days | G3 and G4 | B5 |
| 6. Enterprise | Sell a pilot first (memory audit and hardening as a service), then build exactly what it requires | demand-led | Signed pilot | B6 |

A credible open-source release is roughly five to seven weeks away. Enterprise work starts no earlier than two to three months after that, and only with a customer.

### Why this order

Phase 2 delivers visible value in week two with nothing external, because the Claude Code auto-memory format is documented and is already close to an atom: one Markdown file per memory, frontmatter, and an index. Phase 4 comes later because GBrain's live store is a database; a Markdown export is the only route that keeps AMK free of a client for someone else's API. OpenViking is deferred: it is not in use, its API is still moving, and its core licence (AGPLv3) needs a review before any enterprise offer touches it.

### Phase 1: what is in and out of B0

In: B0-T01 to T06 and T08 as written, limited to the findings in the [red-team register](reviews/RED-TEAM.md).

Changed: B0-T07. `npm` distribution is deferred. Node does not strip types from files under `node_modules`, so a registry package needs a build step this project avoids. Phase 2 ships as a Claude Code plugin, which installs outside `node_modules`. The `engines` floor moves from 22.6.0 to 22.18.0, the first 22.x release that strips types without a flag; T01 confirms it on a real install. Typechecking stays optional until a defect shows it is needed.

### Phase 2: what the audit checks

The adapter reads the directory; it never writes to it. It does not go through the atom loader, because auto-memory frontmatter nests `metadata.type`, which the atom grammar rejects on purpose.

| Check | Why it matters |
|---|---|
| `MEMORY.md` exceeds 200 lines or 25KB | Content past the limit is not loaded at session start, and nothing tells the user |
| Topic file not listed in `MEMORY.md` | The memory exists and no session will find it |
| Index line points at a missing file | The agent is told about knowledge that is gone |
| `[[link]]` with no matching memory | A dangling edge; AMK's loader refuses these for atoms |
| Missing or unknown `type`, missing `description` | The index line cannot be judged for relevance |
| Near-duplicate names or descriptions | Two memories that will drift apart |
| `project` memory with an absolute date in the past | Candidate for review, reported as information, not as an error |

Output reuses the gap ledger format where it fits, so audit findings and retrieval gaps live in one backlog.

## Later, unscheduled

These stay in the plan as direction, not as work. Each needs evidence from Phases 1 to 3 before it gets tickets.

- **B2, time and provenance.** Revision IDs, a stable fact key, validity intervals, `asOf` queries. Contract 1.1.0 already carries `source`, `retrievedAt` and `validUntil`; start from those rather than a parallel model.
- **B3, retrieval driven by misses.** Retrieval hints and tokenizer fixes first; one field-aware index only if measured misses justify it.
- **B4, interoperability.** Hermes, Mem0, OpenViking, Pi. Read-only Markdown export first wherever the host offers one.
- **Parked releases.** 0.4.0 scopes, 0.5.0 escalation, 0.6.0 audit, 1.0.0 freeze. Their plans remain valid as designs. Revisit after Phase 3, with the audit findings as input.

## Dependencies

Phase 1 precedes any write path that a user is asked to trust. Phase 2 is read-only and may start once B0-T01 has captured the baseline. Phase 3 needs B0-T05 (safe writes). Phase 5 combines only tested capabilities. Detail the active and the next batch only. Preserve the starter in `example/` at every checkpoint.
