---
name: amk-doc-integrity
description: Use when editing any Markdown in this repo, stating a fact about an external system such as MCP or Anthropic, adding a link, or updating LIMITATIONS, SOURCEMAP, LINKMAP, CONCEPT or CONTRACT. Covers which file owns what, the citation rule, and the honesty obligations.
---

# Documentation integrity

This project argues that unverifiable knowledge is the problem. Documentation
that cannot be checked, or that quietly lags the code, makes the argument
self-refuting. Treat the docs as part of the product.

## Which file owns what

Putting content in the wrong file is the most common failure, because every file
looks plausible for everything.

| File | Owns | Does **not** own |
|---|---|---|
| `PRODUCT.md` | Purpose, use cases, market positioning, derived requirements. Decides scope | Normative atom rules, release ordering |
| `CONCEPT.md` | Implementation-independent ideas. Ports to a Python rewrite. | Anything about our code, our CLI, our API |
| `CONTRACT.md` | Normative rules for atoms. RFC 2119 keywords. | Rationale beyond one line, tutorials |
| `LIMITATIONS.md` | Every way this is wrong, weak, or refuses to help | Apologies, roadmap, "coming soon" |
| `SOURCEMAP.md` | **Internal** provenance: where our code came from, module graph | External facts |
| `LINKMAP.md` | **External** provenance: every claim about someone else's system | Our own reasoning |
| `IDEAS.md` | Captured thinking, scored. Not a commitment. | Anything built |
| `docs/plans/` | One file per release. A commitment. | Ideas that failed the oracle test |
| `VERDICT.md` | The two-minute form of `ANALYSIS-…` | New arguments |
| `docs/*.md` | How to use a specific surface | Concepts |

Two derived rules:

- **`CONCEPT.md` must not mention a filename from `src/`.** If it does, it has
  stopped being portable.
- **`VERDICT.md` is derived.** If it disagrees with `ANALYSIS-ANTHROPIC-MEMORY.md`,
  the analysis is right and `VERDICT.md` is stale. It says so in its own header.

## The citation rule

> **Every claim about an external system needs a row in `LINKMAP.md`, added in
> the same commit as the claim.**

No row → the statement is either our own reasoning, or it should not be there.

Grade honestly. The scale is in `LINKMAP.md`: `spec`, `docs`, `vendor`, `press`,
`community`, `observation`. Press is not spec. A vendor blog is accurate on facts
and promotional on framing. If a number only appears in marketing write-ups,
**do not repeat it** — say it is unverified, as the `/dream` section does.

Include the retrieval date. Everything in this space moves fast; a claim without
a date cannot be triaged later.

If something comes from the runtime rather than from documentation, it goes in
`LINKMAP.md` §5 "Observation, not published" and is presented as observation in
the prose too. One of this project's arguments rests on such an observation, and
it is marked.

## Honesty obligations

**`LIMITATIONS.md` grows with every feature.** Each release adds new ways to be
wrong. A release that adds none has almost certainly not looked. Write them
plainly — "Jaccard misses paraphrases", not "similarity detection is heuristic".

**Never claim something is verified that is not.** `SOURCEMAP.md` §5 is a
verification trail: claim on the left, the command that checks it on the right.
If you add a claim there, run the command first. There is already one incident
where a documented command did not work (`npm run contract`); the fix was to
make the command real, not to delete the claim.

**Prefer deleting a claim to softening it.** "May be slow at scale" is worse than
either a measurement or silence.

## When code changes

| Changed | Also update |
|---|---|
| A module's imports | `SOURCEMAP.md` §2 module graph |
| Test count | `SOURCEMAP.md` header + §5, `README.md` layout |
| A contract field | `CONTRACT.md`, and `amk-contract-change` covers the rest |
| Behaviour with a documented limit | `LIMITATIONS.md` |
| A CLI command | `README.md` commands table, relevant `docs/` page |
| An MCP tool | `docs/MCP.md`, `docs/INTEGRATIONS.md` |
| Anything a plan listed | the plan's Docs section, all of it |

## Before committing docs

- [ ] Content is in the file that owns it
- [ ] Every external claim has a `LINKMAP.md` row, graded and dated
- [ ] No claim in `SOURCEMAP.md` §5 that you have not just run
- [ ] `LIMITATIONS.md` covers what this change makes newly possible to get wrong
- [ ] Internal links resolve — check them, do not assume
- [ ] No emoji, no marketing voice, no "simply" or "just"
- [ ] Numbers are current: test counts, line counts, version strings

## Red flags

| Thought | Reality |
|---|---|
| "I'll add the LINKMAP row later" | Later never has the URL you had open. |
| "This limitation is obvious" | It is obvious to you, today. |
| "The blog post says 6x, that's a data point" | Marketing numbers with no primary source are not data. |
| "CONCEPT.md should mention the new module" | Then it has stopped being portable. |
| "VERDICT and ANALYSIS disagree, I'll fix ANALYSIS" | Wrong direction. Verdict is derived. |
