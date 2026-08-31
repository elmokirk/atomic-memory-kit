---
name: amk-release-plan
description: Use when implementing a release from docs/plans/, starting new feature work on this repo, or deciding whether something is ready to ship. Covers the plan-first rule, the oracle test, exit and kill criteria, and the order of work within a release.
---

# Working a release plan

Releases in this repo are planned before they are built, in `docs/plans/`, one
file per release. The plan is a contract with the future: what ships, what it
costs, what would make us stop.

## The plan comes first

If there is no plan file for what you are about to build, **write one before
writing code**. The template is the section list in
[`docs/plans/README.md`](../../../docs/plans/README.md), and it is not
ceremony — three of its sections routinely change what gets built:

- **Contract impact** — forces you to notice you are making a breaking change
  before you have written it
- **Kill criteria** — written while being honest is still cheap
- **Docs** — the list of files that must change, so "done" is checkable

A plan that gets written *after* the code is a summary, and summaries do not
catch mistakes.

## Every feature needs an oracle

The question from [`IDEAS.md`](../../../IDEAS.md), applied per feature:

> **What fixed point tells us it worked?**

Every check in this system compares against something it did not produce: a
claim against an atom, a query against an expected result, an edge against the
graph, a date against a clock. A feature whose success can only be *asserted*
does not get built here — that is the rule that put three of Kirk's eleven ideas
in the "refuse" column, and it applies to your feature too.

If you cannot name the oracle, you are not ready to write the plan.

## Order of work within a release

1. **Contract first**, if the release touches it — invoke `amk-contract-change`.
   Everything downstream depends on the field existing.
2. **Pure core** in `src/`. No I/O, no clock, no randomness. Takes `now` as a
   parameter if it needs time.
3. **Adapter** in `adapters/`. This is where the world gets touched.
4. **Surfaces** — CLI, MCP, memory tool. Each plan lists which ones it changes.
5. **Tests**, alongside each layer, not at the end.
6. **Docs**, in the same commit. The plan lists the files.

Skipping to step 4 because it is the visible part is how the layering rules get
broken, and they are the reason `src/` runs unchanged in a Worker.

## Ticking boxes

The checkboxes in a plan are a navigation aid. **The test output is the
evidence.** Tick nothing you have not run.

If a plan turns out wrong mid-flight — and this happens — change the plan in the
same commit as the code. A plan that lags its implementation is worse than none,
for the same reason a stale sourcemap is: someone will believe it.

## Done means done

A release is not done while any of these is false:

- [ ] every box under **Done when** is ticked and verified
- [ ] `npm test` green
- [ ] every document under **Docs** updated in the same commit
- [ ] `LIMITATIONS.md` describes the new ways to be wrong that this release adds
- [ ] `CHANGELOG.md` under `[Unreleased]`
- [ ] the example memory still passes `amk doctor`
- [ ] the plan file itself reflects what actually shipped

`LIMITATIONS.md` is the one people skip. It is load-bearing for trust: this
project's whole argument is that a memory should be able to report its own
holes, and a project that hides its own is not credible.

## Kill criteria are real

They were written before the work started, specifically so they could be honest.
If one triggers, **say so and stop**. Shipping something the plan already said
should be killed is worse than not building it, because now it has to be
maintained and the plan has been taught to lie.

Killing a feature is a normal outcome. Record it in the plan file and in the
changelog.

## Checklist

- [ ] A plan file exists and you have read it end to end
- [ ] The oracle is named and testable
- [ ] Contract changes done first, via `amk-contract-change`
- [ ] Layering respected: pure core → adapter → surfaces
- [ ] Tests written alongside, not after
- [ ] Every doc in the plan's list updated in the same commit
- [ ] Kill criteria re-read before declaring done
