# Roadmap and priority decisions

Planning revision: 2026-10-05, third pass. Scope, use cases and market position are set by [`PRODUCT.md`](../../PRODUCT.md); this file only orders the work. The second pass (a Claude Code companion with a correction-and-replay loop) is withdrawn: it would have competed with existing memory tools, which [`PRODUCT.md`](../../PRODUCT.md) §5 rules out. Its review findings on code and facts still stand ([plan review](reviews/PLAN-REVIEW-2026-10-05.md)). Ticket state lives only in batch documents.

## Goals

| # | Goal | Done when |
|---|---|---|
| G1 | **Safe to deploy next to a web server** | HTTP binds to loopback by default; writes over HTTP need a token; path escapes refused; each with a test |
| G2 | **Correct for chatbots** | Streaming gap markers survive any chunk split; context budget is hard or reports overflow; eval metrics are honest |
| G3 | **Fast first value** | A developer goes from a fresh clone to a chatbot retrieval with a recorded gap in under 15 minutes ([`PRODUCT.md`](../../PRODUCT.md) §6) |
| G4 | **Useful to existing memory systems** | The Mem0 adapter records missed retrievals and runs eval cases against a real Mem0 instance |
| G5 | **Credible open source** | Red-team findings closed or documented; every guide runnable as written |

Non-goals: Claude Code companion or audit plugin, correction-and-replay product, own memory store for conversational memory, embeddings, hosted service, npm package, enterprise features without a paying customer, the parked 0.4.0 to 1.0.0 releases.

## Phases

Effort is an estimate for one owner working with coding agents, including the docs required by `CLAUDE.md`. It is not a commitment. Each phase can shrink or stop the roadmap if its gate fails.

| Phase | Content | Estimate | Gate | Batch |
|---|---|---|---|---|
| 0. Housekeeping | Commits pushed, strategy merged, plan reviewed, [`PRODUCT.md`](../../PRODUCT.md) written | done 2026-10-05 | One product definition on `master` | – |
| 1. Chatbot-ready core | Security, then the defects that hit chatbots, then starter hygiene (list below) | 5-7 days | Every listed finding has a real-module test and a fix, or a documented limit | [B0](batches/B0-foundation.md) |
| 2. Chatbot integration path | One runnable chatbot example (library call before the model, streamed answer, gap recorded); README rebuilt around it | 3-4 days | G3 timed by someone who did not write it | not ticketed |
| 3. Backend adapter interface and Mem0 | One interface; Mem0 adapter for missed-retrieval recording and eval; write validation opt-in | 4-6 days | G4 on a pinned Mem0 open-source version | not ticketed |
| 4. Public release | Claims checked against [`LINKMAP.md`](../../LINKMAP.md), guides executed, changelog, tag | 2-3 days | G5 | B5 |
| Later | Honcho or Claude Code memory adapter; retrieval improvements; enterprise | demand-led | A named user or customer who needs it | – |

Phases 1 to 4 are roughly three to four weeks of work.

### Phase 1: scope, in order

1. **HTTP exposure (R16).** Loopback by default, log the address actually bound, explicit host option, no mutating tools over HTTP without a token.
2. **Path confinement (R13, R14, S06)** in `adapters/fs.ts` and `src/memory-tool.ts`.
3. **Streaming gap decoder (R01-R03).** Stateful, lossless, every marker detected at any split.
4. **Context budget (R07)** hard, or an explicit overflow signal.
5. **History zero (R09)** and shared mutable config defaults (R19).
6. **Evaluator honesty (R10, R11).**
7. **Corrupt ledger lines (R15)** reported, not skipped.
8. **Starter hygiene (S07):** `eval` stops modifying tracked files, `drift` exits non-zero on an error finding, root `npm run check` works from a fresh clone.
9. **Node floor 22.18.0** in `package.json`, README and LIMITATIONS, with a startup check.

Out: npm packaging, tarball tests, typechecking, multi-file write atomicity (documented as a limit), stale-proposal checks, S01-S05 where they do not touch an enabled path.

### Phase 3: what the Mem0 adapter does

The host passes its Mem0 search; AMK does not import a Mem0 SDK. On each search the adapter records a scope gap when no result clears the threshold, so recurring unanswered questions become visible. The eval runner executes must-retrieve and must-not-retrieve cases against Mem0 search by memory id. Write validation is opt-in: a candidate fact passes the AMK contract (durability, provenance) before the host calls Mem0's add. Entry check before building: confirm on the pinned version that Mem0 does not already offer missed-retrieval tracking.

## Later, unscheduled

- **Honcho adapter.** Only on demand: AGPL-3.0, and Honcho already ships its own Claude Code plugin.
- **Claude Code memory adapter.** Only on demand; read-only audits already exist elsewhere.
- **Retrieval improvements (B3).** Only when a real chatbot's eval shows misses that keywords and synonyms cannot fix.
- **Time and provenance (B2).** Start from contract 1.1.0 fields if a chatbot needs dated facts.
- **Parked releases** in [`docs/plans/`](../plans/README.md): revisit when a deployment asks for scopes or escalation.

## Dependencies

Phase 1 item 1 precedes everything else. Phase 2 needs Phase 1 items 3, 4, 8 and 9. Phase 3 needs Phase 1 items 6 and 7. Phase 4 combines only tested capabilities. Preserve the starter in `example/` at every checkpoint.
