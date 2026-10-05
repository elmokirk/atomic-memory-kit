# Product positioning

Status: product hypothesis and release guidance, not validated marketing claims.

## Initial user and job

Revision 2026-10-05, after the [plan review](reviews/PLAN-REVIEW-2026-10-05.md). Start with a solo or small-team Claude Code power user, or a consultant, working on a changing project. They repeatedly correct the same project facts, decisions, or workflow rules, and the agent's auto memory accumulates without review. The job is to turn an important correction into knowledge that can be inspected, and to check on a later question that it worked. Enterprise buyers are not the first user.

Working positioning:

> AMK turns the corrections you keep repeating to your coding agent into reviewed, sourced facts, and checks with a replayed question whether the agent now gets them right.

A read-only audit of auto memory is the entry point, not the claim. Auditing memory is already covered by others (`cc-memory-view`, `memory-hygiene`, CLAUDE.md linters, Anthropic's `/doctor prompt-audit` for instruction files). The review found no packaged equivalent of the correction, review and replay loop; that is what has to prove its value.

The broader category hypothesis is memory assurance and coverage accounting. Native episodic memory remains in place. AMK is not a replacement conversation store, personality engine, compliance certification, or truth oracle.

## Standalone first, adapters second

AMK must be useful with no other memory system installed: its own atoms, CLI and MCP server. Adapters then apply the same checks to stores other tools own. The value is in the checks; an adapter only gets them to where the knowledge already is.

| Store | Route | Status |
|---|---|---|
| AMK atoms | Native | Built |
| Claude Code auto memory | Read the documented directory and `MEMORY.md` index | Next, [Roadmap](ROADMAP.md) Phase 2 |
| GBrain | Comparator in Phase 3; ships its own integrity checks, so no audit adapter | Comparison only |
| OpenViking, Mem0, Hermes, Pi | Read-only export where offered | Unscheduled |

Rules for every adapter: read-only first; no client library for someone else's API when a file export exists; writes into a foreign store only after a reviewed workflow and an explicit owner decision. A universal adapter for every memory system is not a goal: each host changes its surface on its own schedule, and every adapter is a maintenance cost that needs a user.

## Open source and enterprise

The core, CLI, MCP server and adapters are open source under the existing MIT licence. That is where adoption and trust come from, and it is what makes the contract checkable by others.

The first commercial offer is a service, not a product tier: a bounded audit and hardening of a team's agent memory, delivered with the open-source tool. Enterprise features (access control, audit store, retention, multi-tenant operation) are built only when a paying pilot asks for them, and may then live in a separate repository under a separate licence. Before any offer touches OpenViking, review its AGPLv3 core with counsel. The core proposition (correction, review, replay) must work in the open-source tool; a service sells the work of applying it, not a locked feature.

## Repository decision

One repository. Repositioning happens in the README, the plugin name and these documents. A split is reconsidered only when an enterprise component with its own licence exists.

## What must be shown

The demonstration is a complete sequence: an agent fails on a scoped fact; AMK records the diagnostic; a person reviews a correction; the write is validated; a later session answers a held-out equivalent question using the corrected source.

The question to answer commercially is whether this reduces repeated mistakes enough to justify authoring, review, context, and integration overhead. A native-memory baseline receives equivalent facts and comparable maintenance effort. If that baseline works equally well, simplify the product or target a different workflow.

## Comparison framing

| Alternative | What to compare | AMK hypothesis, not an absence claim |
|---|---|---|
| Claude Code auto-memory | Native files and project instructions | Scoped, replay-tested correction workflow |
| Mem0 | Persistent memory and host scoping | Reviewed promotion of selected canonical facts |
| Honcho | Reasoning about persistent entities | Explicit reviewed facts without mandatory inference |
| Hindsight | Retain/recall/reflect and multi-strategy retrieval | Small deterministic core and portable repair evidence |
| A-MEM | Structured linked notes | Novelty must be demonstrated in the workflow, not the word atomic |
| GBrain | Canonical Markdown repository indexed by a database; doctor, orphan, lint, contradiction and gap-analysis features | Deterministic, zero-dependency loop with replay evidence; must beat GBrain's own workflow in the Phase 3 comparison |
| cc-memory-view, memory-hygiene | Read-only audit and clean-up of Claude Code auto memory | AMK's audit is equivalent and is not a differentiator |
| OpenViking | Context database with tiered loading and automatic extraction | Reviewed facts beside extracted memory; not a storage competitor |

Consult the dated [source register](SOURCES.md) before making feature-by-feature comparisons. No claim that competitors lack gap tracking is established here.

## Candidate services

| Workflow | First deliverable | Evidence of value |
|---|---|---|
| Coding-agent knowledge reliability | Claude companion for project rules and known gotchas | Fewer repeated corrections across sessions |
| Product/support chatbot | Pi or custom-agent adapter for curated product facts | Successful replay of recurring unanswered questions |
| Design-system assistant | Versioned component guidance and source references | Fewer violations of reviewed implementation rules |
| Personal-agent knowledge | Explicit preferences and decisions beside Hermes memory | Correct scope, review, history, and deletion behavior |
| Customer-success/sales assistant | Approved policy/product knowledge beside account memory | Correct current facts without leaking account data |

The first offer can be a bounded reliability audit and pilot, not a hosted platform. Define scope, data handling, acceptance, support, and exclusions before quoting. Earlier chat price ranges were hypotheses, not market evidence; no pricing, ROI, or exit multiple is asserted by this plan.

## Release and marketing checklist

- [ ] Publish a working installation guide, a small demo, limitations, and removal instructions.
- [ ] Identify tested host/package/model versions and fixture sizes for each result.
- [ ] Separate measured results from intended capabilities in a claims ledger.
- [ ] Obtain permission before publishing customer or personal examples.
- [ ] Explain which steps are deterministic and which rely on model/user behavior.
- [ ] Avoid guarantees of factual truth, full native-memory interception, compliance, unique category ownership, or acquisition interest.

Prepare marketing material only for released capabilities. The original starter remains the simple route; advanced integrations are opt-in.

## Long-term standard and enterprise thesis

A credible standard needs small stable semantics, portable conformance tests, independent implementations, and outside adoption. Good documentation alone does not establish one.

Enterprise scope follows observed needs for permissions, audit, recovery, and operational accountability. The business must create value independently of a possible buyer. No evidence of acquisition interest is part of this handoff.
