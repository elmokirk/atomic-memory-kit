# Execution handoff

Audience: a coding agent with an assigned batch and repository access. This document governs execution, not feature semantics.

## Execution sequence

1. **Confirm scope.** Read the assigned batch, inspect the current branch and diff, and record the baseline commit. Continue only when the assignment authorizes implementation. Documentation approval alone does not authorize product code or personal-memory writes.
2. **Verify readiness.** Check ticket dependencies and the batch entry gate. Recheck external host versions through [Sources](SOURCES.md). Completion: every prerequisite has evidence or a named blocker.
3. **Claim work.** Set the ticket's owner, branch, and status in the batch table. Use one integrator to update that shared table when workers run concurrently. Completion: file ownership is agreed before edits.
4. **Reproduce first.** Import the actual project modules in a focused test. For a reported bug, record failing behavior before changing code. A copied function excerpt or vendor README is not an end-to-end test.
5. **Implement the smallest change.** Stay within the ticket's file boundary; use existing entry points. A necessary new shared API requires agreement before dependent workers continue.
6. **Validate.** Run the ticket acceptance cases and applicable [QA gates](QA.md). Record exact commands, environment, commit, denominators, and failures. Do not weaken an oracle or silently refresh an eval baseline to get green.
7. **Hand back.** Update the ticket and evidence link. The integrator reruns cross-ticket checks on the combined branch. User acceptance requires the user's recorded result.
8. **Stop at the batch boundary.** Propose the next batch or an ADR if evidence changes the roadmap. Do not auto-publish, auto-merge, or expand scope.

## Status protocol

Use `planned`, `ready`, `in_progress`, `blocked`, `awaiting_review`, `awaiting_user`, or `done`. The batch document owns state. `done` requires its acceptance criteria and the shared definition of done; an unavailable host or paid API is a blocker, not a pass.

A blocker record contains: ticket ID, failed prerequisite, evidence, minimal remedy, and owner. A rejected hypothesis is a valid result when the evidence and resulting plan change are recorded.

## Parallel work

Use a dedicated branch and worktree per independent ticket. Example, after checking that the names are unused:

```bash
git worktree add -b fix/b0-parser ../amk-b0-parser master
```

Create an isolated temporary memory directory for each worker. Worktrees isolate code, not necessarily host auto-memory or configuration. Never point tests at a shared personal memory root.

Freeze shared contracts before parallel implementation. `src/contract.ts`, `src/types.ts`, `src/schema.ts`, and serializers have one coordinating owner. Workers can propose patches, but do not independently change meanings of IDs, fields, or write outcomes. Test fixtures can be authored separately after the interface is agreed; final expected results require review.

B0 package work and parser work can run in parallel after baseline capture. B1 host probing can occur while B0 is underway, but no real mutating integration is accepted until B0's safety gate passes. Later Hermes packaging and the Mem0 guide can run in parallel against a pinned core.

## Decision and evidence records

Create `docs/strategy/decisions/ADR-NNN-topic.md` only when a real decision is needed. Include problem, options, choice, compatibility impact, test, and revisit trigger. Do not scaffold empty decision files.

Store sanitized verification records under `docs/strategy/reviews/Bx-verification.md` when a batch runs. Record raw logs outside Git unless they are safe, small, and necessary. Never commit personal conversations, customer data, tokens, or workstation paths containing sensitive information.

## Change authority

Safety and correctness fixes belong in the core. Optional capabilities must not become required to run the starter. An intentional compatibility break needs a migration note and owner review. Keep [CONTRACT.md](../../CONTRACT.md) synchronized with approved semantics; strategy sketches remain proposals until implemented.

When changing a host adapter, use the installed version and its documented surface. Claude API memory is not Claude Code auto-memory. A companion must not claim to intercept native writes it cannot observe.
