# Roadmap

Planning revision: 2026-10-05, fourth pass. Scope, use cases and market position are set by [`PRODUCT.md`](../../PRODUCT.md); this file orders the work into a proof of concept and an MVP, each cut into increments that coding agents can execute in parallel. Ticket state and per-increment Definition of Done live in the batch files: [PoC](batches/POC.md) and [MVP](batches/MVP.md). Earlier passes are superseded; their findings remain in the [plan review](reviews/PLAN-REVIEW-2026-10-05.md) and the [red-team register](reviews/RED-TEAM.md).

## Stages

| Stage | Outcome | Increments | Estimate (agents in parallel, plus owner review) |
|---|---|---|---|
| **PoC** | A safe, correct core and a runnable chatbot demo that shows `no_match` and a recorded gap | I1-I5 | 2-3 days |
| **MVP** | The same core reaches users through a Mem0 adapter and a Claude Code plugin, and is released | I6-I8 | 3-5 more days |
| Later | Honcho or other adapters, retrieval improvements, enterprise | – | only on named demand |

Agents write the code fast; the limiting factor is the owner's review and the real-system checks (a running Mem0, a clean Claude Code profile). Estimates assume one review pass per increment.

## Increments

| ID | Stage | Area | Content | Depends on | Owns (files) |
|---|---|---|---|---|---|
| I1 | PoC | Security | HTTP loopback and write token (R16); path confinement in both adapters and the memory tool (R13, R14, S06); corrupt ledger lines reported (R15) | – | `agent/mcp-server.mjs`, `adapters/fs.ts`, `adapters/memory-tool.ts`, `src/memory-tool.ts` |
| I2 | PoC | Chatbot correctness | Lossless streaming gap decoder (R01-R03); hard context budget or overflow signal (R07); history zero (R09); no shared mutable config defaults (R19) | – | `src/gaps.ts`, `src/search.ts`, `src/config.ts`, `src/types.ts` |
| I3 | PoC | Evaluation | Metrics in range (R10); forbidden retrievals fail on their own (R11); defined zero-case semantics | – | `src/eval.ts` |
| I4 | PoC | Starter and CLI | `drift` exit code (S07); quickstart leaves the repo clean (verify S07, reclassify if it does not reproduce); root `npm run check` from a fresh clone; Node floor 22.18.0 with startup check | – | `cli/`, `package.json`, `example/memory.config.json` |
| I5 | PoC | Chatbot demo | Runnable chatbot example: retrieval before the model, streamed answer, gap stripped and recorded, works without an API key; README rebuilt around it | I2, I4 | `example/chatbot/`, `README.md` |
| I6 | MVP | Mem0 integration | Backend adapter interface; Mem0 adapter recording missed retrievals and running eval cases; write validation opt-in | PoC | `src/backend.ts`, `adapters/mem0.ts`, `docs/MEM0.md` |
| I7 | MVP | Claude Code integration | Plugin and marketplace around the existing MCP server, read-only by default | I1 | `.claude-plugin/`, `plugin/` |
| I8 | MVP | Release | Changelog, version, claims checked, guides executed, tag; LinkedIn material stays outside this repository | I6, I7 | `CHANGELOG.md`, release notes |

Each increment owns its files. A change outside them goes through the integrator, who also owns the shared docs (`LIMITATIONS.md`, `SOURCEMAP.md`, `LINKMAP.md`) and merges in dependency order.

## Integration areas

| Area | Surface | Built by | Done when (summary; full DoD in the batch files) |
|---|---|---|---|
| Library in a chatbot | `searchMemory`, gap detector, ledger | I2, I5 | The demo runs from a fresh clone in under 15 minutes and records a gap |
| MCP | stdio and HTTP server | I1 | Loopback by default, writes need a token over HTTP, tool list matches `docs/MCP.md` |
| Claude Code | Plugin from this repository's marketplace | I7 | Installs in two commands, tools callable, read-only by default, removable without residue |
| Mem0 | Backend adapter | I6 | Missed retrievals and eval run against a pinned, running Mem0 open-source instance |

## Execution model

- One agent per increment, each in its own git worktree and branch (`poc/i1-security`, ...). I1 to I4 run in parallel; I5 starts after I2 and I4 merge; I6 and I7 run in parallel after the PoC.
- Every agent follows [`AGENTS.md`](../../AGENTS.md), [`CLAUDE.md`](../../CLAUDE.md) and the increment's DoD. A defect fix starts with a failing test against the real module.
- The integrator (the owner's main session) reviews, merges, runs the full suite on the combined branch, updates shared docs and the batch tables. Agents do not merge, push tags or publish.

## Out of scope

Claude Code companion or audit product, correction-and-replay product, own conversational memory store, embeddings, hosted service, npm package, enterprise features without a paying customer, the parked releases in [`docs/plans/`](../plans/README.md), Honcho, OpenViking and GBrain adapters.
