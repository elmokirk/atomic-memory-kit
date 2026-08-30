# Verdict

The short answer. [`ANALYSIS-ANTHROPIC-MEMORY.md`](ANALYSIS-ANTHROPIC-MEMORY.md)
is the long one — layer-by-layer, red-teamed, with sources. This page exists so
the conclusion can be read in two minutes and quoted without quoting 380 lines.

Everything below is *derived from* that document. If the two ever disagree, the
analysis is right and this page is stale.

---

## Side by side

| | Anthropic memory stack | Atomic Memory Kit |
|---|---|---|
| **Storage** | Markdown files, free-form | Markdown files, contracted |
| **Retrieval** | Model reads filenames, then files | Deterministic scoring + `match`/`no_match` gate |
| **Index** | `MEMORY.md`, hand-maintained by prompt | `_index.md`, generated |
| **Write path** | Model writes a file; all accepted | Proposal → contract → all-or-nothing apply |
| **Schema / validation** | none | 10 rules, 19 codes, L1–L4 conformance |
| **Link integrity** | none | Dangling edge fails the load |
| **Measurability** | none | Eval with `mustNotRetrieve` + baseline regression |
| **Forgetting** | Context editing + compaction | **not addressed** |
| **Round-trip** | undefined; compaction is lossy and one-way | tested invariant |
| **Missing knowledge** | **nothing** | Ledger, 6 detectors, recurrence, reopen |
| **Episodic memory** | built for it | **wrong shape** |
| **Fuzzy / unanticipated queries** | strong | weak (CJK not at all) |
| **Multi-tenancy, ACL, history** | partly | absent, deliberately |

---

## What this project does better

Four things. Only the first is new in the world.

**1. Not-knowing becomes a record.** Follow a miss through the stack: the model
finds nothing, answers from general knowledge, the turn ends, context editing
clears the tool result. Nothing persists. The same question next week produces
the same miss, and no artifact anywhere counted to two. Context editing and
compaction are *information-destroying operations that never ask whether what
they are destroying was a hole.* The gap ledger is the only part of this project
without an equivalent somewhere else.

**2. The write path can fail loudly.** An agent cannot write an invalid memory
through `planApply` or the memory-tool bridge, no matter what it proposes. With
`create` in the raw memory tool, whatever the model produced is what the store
contains.

**3. The generated index cannot drift.** `MEMORY.md` is maintained by an
instruction in a system prompt. A write that skips the index produces a memory
that exists on disk and is invisible to every future session, and nothing checks
for it. `_index.md` is derived from the atoms.

**4. A projection a human can work in.** Compaction summarizes and discards. The
bundle is lossless, editable and re-importable, with open gaps as checkboxes
*inside the same document* that parse back out.

---

## Is it a sensible extension for Claude / Cowork / second brains?

### Claude Code and Cowork — yes, and it is already built

The MCP server is stateless, speaks revision `2026-07-28`, and is one connector
line away. See [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md).

The deeper integration is also built: [`docs/MEMORY-TOOL.md`](docs/MEMORY-TOOL.md).
Anthropic's memory tool is client-side by design, so its handler can be backed by
this kit instead of a filesystem — `view` returns the annotated scope, `create`
goes through the contract and returns its diagnostic on refusal, `delete` refuses
to orphan an inbound edge, `rename` rewrites references atomically, and **a `view`
of a path that does not exist is recorded as a gap.**

That last line is the thing that did not exist before: a memory backend that
reports its own holes to the agent using it, and teaches the contract through
tool results rather than through a prompt the model must have memorised.

### Second brains — only the top half, and that is the honest answer

A second brain is mostly episodic: *prefers TypeScript*, *the build hangs on
PowerShell 5.1*, *decided X on Tuesday*. Pressing that into atoms produces
thousands of thin atoms nobody maintains, and the contract's discipline becomes
overhead on content that never needed it. Curated `related[]` edges are a
pleasure at 50 atoms and unmaintained at 300. And the gap ledger can become a
second inbox: 200 open gaps are not intelligence, they are a guilt generator —
worse than nothing, because they look like process.

So: **two tiers, not either-or.**

```
  TIER 1  episodic, hot, model-written
          Anthropic memory tool / CLAUDE.md / auto-memory
          free-form · high write rate · leave it alone
                        │
                        │  promotion = a human reviewed it
                        │  (this is the gap-closing loop)
                        ▼
  TIER 2  semantic, cold, curated
          Atomic Memory Kit
          contracted · cited · evaluated · gap-accounted
```

Tier 2 is for knowledge that must be *right*: cited to a user, shared across
agents, audited, or expensive to get wrong. Promotion happens only when a human
reviewed it, and thanks to MRTR the agent brings three questions while the human
is already present, instead of a backlog they must go and visit.

This is the same shape as Owledge's `sessions/` → `canonical/`. Either
convergent evolution, or a hint that the structure is right.

---

## The caveat worth knowing before you prioritise

Validation, a generated index and a gap counter are not hard for Anthropic to
build. On an 18-month horizon it is a bad bet to assume they will not.

What does not commoditise is the concept and a vendor-neutral contract that a
Python or Go port reaches in a weekend (L1). **The code is the perishable part.
[`CONCEPT.md`](CONCEPT.md) and [`CONTRACT.md`](CONTRACT.md) are the durable
ones.**

If exactly one idea survives:

> A memory system must be able to report what it does not know, and that report
> must be an input as well as an output.

---

*Long form: [`ANALYSIS-ANTHROPIC-MEMORY.md`](ANALYSIS-ANTHROPIC-MEMORY.md) ·
provenance and sources: [`SOURCEMAP.md`](SOURCEMAP.md) ·
what is not built yet and whether it should be: [`IDEAS.md`](IDEAS.md)*
