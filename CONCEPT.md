# CONCEPT — Atomic Memory

> This is the portable idea. The code in this repository is one implementation
> of it; the idea outlives the code. If you take one file from this project into
> another system, take this one.

---

## 1. The problem

Agent memory today fails in one of two shapes.

**Shape A — the pile.** One giant `NOTES.md`, `CLAUDE.md`, or wiki. Everything is
in there. The agent reads all of it every time, or a chunk of it at random. It
costs tokens, it dilutes attention, and nobody can tell you what is actually in
it without reading the whole thing. It rots silently because there is no unit
small enough to review.

**Shape B — the vector store.** Documents get chopped and embedded. Retrieval is
fuzzy and unexplainable, results are unstable across model and library versions,
you cannot diff it, you cannot review it, and you cannot hand it to a human. Worst
of all: when it retrieves nothing useful, *nothing happens*. The failure is
invisible.

Both shapes share the same fatal property: **they cannot tell you what they do
not know.** A memory system that cannot report its own holes will confidently
answer from the holes, and the confident wrong answer is the one that costs you.

---

## 2. The three claims

This concept rests on three claims. Everything else follows from them.

### Claim 1 — Knowledge should be stored atomically and used in bulk

The storage unit and the working unit are different problems, and conflating
them is the root mistake.

- **Storage wants small.** One atom = one self-contained fact or topic, in one
  file, with typed frontmatter. Small enough that a human can review it in
  twenty seconds. Small enough that a diff is meaningful. Small enough that
  "which atom is wrong" is an answerable question.
- **Working wants big.** A human reviewing the memory, an agent handed the full
  context, a customer receiving a knowledge export — all of them want one
  document, not four hundred files.

So: **store atomically, compile on demand.** Neither representation is primary in
the usual sense — but the atoms are the *source*, and everything else is a
projection that can be regenerated. Never the reverse.

### Claim 2 — The projection must be reversible

This is the claim that makes it a system rather than a build step.

A one-way export is a report. A **reversible** projection is an interface. Once
`atoms → bundle` and `bundle → atoms` are both lossless, you get a workflow that
one-way systems structurally cannot have:

```
atoms ──compile──► one bundle ──► human or agent edits it ──► import ──► atoms
  ▲                                                                        │
  └──────────────────── validate, and the loop closes ─────────────────────┘
```

The human never touches four hundred files. They skim one document, answer
questions inline, paste in a new block, tick some boxes, and hand it back. The
system fans it back out into atoms and verifies the result.

Reversibility is not a convenience feature. It is what turns memory maintenance
from an engineering task into a reading task — which is the only form in which a
non-engineer, or a busy owner, will ever actually do it.

### Claim 3 — Not knowing is data, and must be recorded

When a memory is asked for something it does not have, that moment is the single
most valuable signal the system will ever produce. It is unsolicited demand data:
*someone wanted this and we did not have it.*

Every conventional knowledge base throws this away. The agent apologises, the
moment passes, and the same hole gets hit again next week by someone else.

So: **record it.** Every "I do not know" becomes a durable, deduplicated,
counted record. Recurrence ranks the backlog automatically — a gap seen forty
times is a missing product page; a gap seen once is noise. You stop guessing what
to write next, because the demand tells you.

---

## 3. What an atom is

```markdown
---
id: services.audit            # stable citation target, never reused
title: "AI potential audit"   # human label
category: services            # taxonomy slot
lang: en                      # content language
keywords: [audit, assessment, potenzialanalyse]   # how people ASK for this
synonyms: [review, check]
related: [pricing.audit]      # graph edges, integrity-enforced
summary: "One sentence that fully describes this atom."
alwaysInclude: false          # true = injected on every single query
priority: 10                  # -100..100 score nudge
link: /services/audit         # canonical surface this atom describes
---

# AI potential audit

- One checkable fact per line.
- Nothing that cannot be defended.
```

Three field classes, and the distinction is load-bearing:

| Class | Fields | On violation |
|---|---|---|
| **Core** | `id`, `title`, `category`, `lang` | **Error** — file rejected, load fails loudly |
| **Standard** | `keywords`, `synonyms`, `intents`, `summary`, `related`, `link`, `alwaysInclude`, `priority` | Type error = error; unknown *value* = warning |
| **Extension** | anything else (`region`, `validFrom`, `owner`, …) | Pass-through, inert until registered |

**Why extensions are inert rather than rejected:** a memory written against a
future version of your taxonomy must still load today. Forward compatibility is
the difference between a format people adopt and a format people fight. The
validator lists extension fields as info, which is also how typos (`keywrods:`)
become visible without breaking anything.

**Why core violations are hard errors:** silent degradation of memory is the
failure mode that costs the most trust. A memory that half-loads is worse than
one that refuses to load, because the agent will keep answering — from a subset
nobody noticed shrank.

### The two rules that actually matter for quality

1. **Keywords are user vocabulary, not your vocabulary.** They answer "what will
   someone type?", not "what is this called internally?". `website cost`, not
   `pricing model transparency`. This cannot be automated — it is the one place
   where an author's judgement is irreplaceable, and it is why keyword generation
   is deliberately *not* a feature of this kit.
2. **One atom, one thing.** If a single question could reasonably be answered by
   half of an atom, it should have been two atoms.

---

## 4. Gap spotlighting

A gap is a recorded moment where the memory was asked for something it did not
have. There are more sources of that signal than are obvious, and they catch
genuinely different failures.

| Detector | Catches | Needs |
|---|---|---|
| **runtime** | "we have the topic but not this detail" | consumer cooperation (a marker) |
| **scope** | "we have nothing on this at all" | nothing — deterministic |
| **eval** | "we have it but retrieval stopped finding it" | a curated question set |
| **drift** | "we know something *different* from the source of truth" | a claims map |
| **todo** | "the author knew it was incomplete" | an author marker |
| **cycle / orphan** | "the graph is degrading" | nothing — structural |

The first two are a pair, and the pairing is the trick:

- **The scope gate is deterministic code.** If no atom scores above the
  threshold, retrieval reports `no_match` before any model is involved. Cheap,
  reproducible, no cooperation required.
- **The runtime marker is the consumer's job.** Even on a `match`, the retrieved
  atoms may not answer the actual question. Only the reasoning layer can tell.
  So it is instructed: say so plainly, and end with `[GAP: <topic>]`. The system
  strips the marker before the user sees it, and logs it.

Scope catches *"not my territory"*. Runtime catches *"my territory, my
ignorance"*. You need both, and you get the second one nearly free — it is a
sentence in a system prompt and a regex.

**Drift deserves special attention** because it is the dangerous class. Retrieval
metrics cannot see it: the memory is confidently *wrong* rather than empty. A
price changed on the website, in a contract, in a spec — and the agent keeps
quoting the old number, with a citation, which makes the wrong answer look
verified. The check is deliberately dumb so it can be trusted: map each
externally-owned claim to the atom that backs it, then verify the claim's
*numbers* appear in that atom. Numbers are the part of a claim that is
unambiguously checkable without a model.

### The ledger

Observations are folded into a deduplicated ledger keyed by `(kind, normalized
topic)`. Each record carries `firstSeen`, `lastSeen`, `count`, `status`.

One semantic detail carries a lot of weight: **re-observing a closed gap reopens
it.** If a gap was marked closed and the same question fails again, the fix did
not work — usually because an atom was written but its keywords do not match how
people actually ask. Silently staying closed would hide exactly the failure you
most need to see.

---

## 5. The loop

Put claims 2 and 3 together and a workflow appears that neither produces alone.

```
   ┌──────────────────────────────────────────────────────────────┐
   │                                                              │
   │   atoms/ ──────► retrieval ──────► agent answers             │
   │     ▲                │                  │                    │
   │     │                │ no_match         │ [GAP: topic]       │
   │     │                ▼                  ▼                    │
   │     │            ┌────────────────────────┐                  │
   │     │            │      gap ledger        │◄── eval          │
   │     │            │  deduped, counted      │◄── drift         │
   │     │            └───────────┬────────────┘◄── todo          │
   │     │                        │                               │
   │     │                        ▼                               │
   │     │        compile ──► ONE BUNDLE (atoms + open gaps)      │
   │     │                        │                               │
   │     │                        ▼                               │
   │     │            human or agent reads, answers,              │
   │     │            adds atoms, ticks boxes                     │
   │     │                        │                               │
   │     └──────── import ────────┘                               │
   │                    │                                         │
   │                    ▼                                         │
   │              validate (contract + graph)                     │
   └──────────────────────────────────────────────────────────────┘
```

Read it as a sentence: *the memory tells you what it is missing, in the same
document that contains everything it knows, in a form you can answer in place
and hand straight back.*

That is the whole concept. Everything in this repository is machinery for that
sentence.

### Why this matters for agent handoff specifically

An agent working a long task accumulates exactly two things worth keeping: what
it learned, and what it could not resolve. Conventional handoffs keep the first
and lose the second — the open questions live in a transcript nobody re-reads.

Here both travel in one artifact, in the same structure. A subagent finishing its
work compiles a bundle: everything it knows plus everything it hit a wall on. The
orchestrator, or the human, gets a single readable document where the open
questions are checkboxes rather than buried paragraphs. Answer them in place,
import, validate. The next agent starts from a memory that is measurably better
than the one the last agent started from.

---

## 6. Why deterministic retrieval

Retrieval here is keyword/synonym/field scoring with light morphological
folding. No embeddings, no vector store, no model call.

This is a considered trade, not a limitation of ambition:

| Property | Deterministic scoring | Embeddings |
|---|---|---|
| Explainability | exact score breakdown per atom | opaque similarity |
| Reproducibility | byte-identical across runs and years | shifts with model/library version |
| Cost | zero | per-query, plus index maintenance |
| Cold start | milliseconds | index build |
| Reviewability | a human can predict what will match | cannot |
| Failure mode | `no_match` — **loud, and logged** | plausible-but-wrong neighbours — **silent** |
| Ceiling | a few hundred well-written atoms | millions of unreviewed documents |

The last two rows are the argument.

Curated memory is small — hundreds of atoms, not millions of documents. In that
regime, deterministic scoring wins on every axis that matters for a system whose
purpose is *knowing what it does not know*. Embeddings are optimised for always
returning something plausible; that is precisely the behaviour that makes gap
detection impossible.

And the ceiling is a real ceiling, honestly stated: past roughly 500 atoms, or
when precision drops below ~0.6, you want BM25 with an inverted index, and past
a few thousand you want hybrid embeddings. Both go **behind the same
`searchMemory()` interface** — the contract, the gap system, and the bidirectional
compile do not change. The scaling path is a swap of one module, planned for,
not a rewrite.

---

## 7. What this is not

Stating this precisely is part of the concept, because a concept that claims
everything is useless.

- **Not a filing system.** It does not tell you where sessions, decisions,
  handoffs, or ADRs live. It is the retrieval-and-gap *engine* that sits inside
  such a system. If you already have a memory layer (Owledge, a `.memory/`
  convention, an Obsidian vault), this plugs into it and does not replace it.
- **Not a chatbot.** There is no LLM code here at all. It produces a scored,
  budgeted context and a scope verdict; what you do with those is your business.
  See `docs/INTEGRATION-LLM.md` for wiring it to a model properly.
- **Not a semantic search engine.** See §6.
- **Not a fact checker.** Drift detection compares numbers, nothing more. Prose
  that quietly contradicts a source of truth will not be caught by any mechanism
  in this repository.
- **Not automated knowledge extraction.** Nothing here reads your documents and
  writes atoms for you. Keywords especially are an author decision, on purpose
  (§3). An agent can draft atoms; a human still owns whether they are true.

---

## 8. Porting this concept

If you are re-implementing this elsewhere, these are the load-bearing decisions.
Everything else is taste.

1. **Atoms are files with typed frontmatter.** Not database rows. Files diff,
   review, merge, and survive your tooling.
2. **Three field classes with different severities.** Core = error, standard =
   typed, extension = inert pass-through. Forward compatibility is a feature.
3. **The loader is the trust boundary.** After it returns, everything downstream
   may assume the contract holds and every edge resolves. Broken edges fail
   loudly; a memory that half-loads is worse than one that refuses to.
4. **Round-trip is an invariant with a test, not an aspiration.** `compile →
   decompile → load` must equal identity, verified against deliberately nasty
   fixtures — quotes, umlauts, colons, numbers-as-strings, multiline values. The
   day it silently breaks is the day the system starts eating knowledge.
5. **Two scope layers: deterministic gate plus consumer marker.** Neither alone
   is sufficient.
6. **Gaps are deduplicated, counted, and reopen on recurrence.** Count is the
   priority signal. Recurrence after closure is the "your fix did not work" alarm.
7. **The gap report is an input as well as an output.** Checkboxes parse back.
   Anything less and the human is doing data entry.
8. **A generated scope index, always injected.** The map of what is known is
   itself an atom. It is what lets a consumer recognise "not my territory"
   instead of improvising.
9. **Every new atom ships with eval cases.** Without them, precision rots
   invisibly as the memory grows, and you will not notice until answers get bad.
10. **Keep the core pure.** No I/O, no framework, no network in the engine. One
    thin host adapter is what makes it portable to the next runtime — and this
    concept will outlive several of them.

---

## 9. Vocabulary

| Term | Meaning |
|---|---|
| **Atom** | One self-contained fact or topic, one file, typed frontmatter |
| **Base** | The loaded, validated, indexed set of atoms |
| **Contract** | The frontmatter rules and their severities |
| **Scope gate** | Deterministic threshold producing `match` / `no_match` |
| **alwaysInclude** | Atoms injected on every query regardless of the question |
| **Edge** | A curated `related[]` link; expansion is 1 hop, hard-capped |
| **Bundle** | Lossless, editable, round-trippable single-file projection |
| **Compiled** | Lossless JSON projection for machine transport |
| **Digest** | Lossy read-only overview, explicitly not importable |
| **Gap** | A recorded moment where the memory lacked something |
| **Ledger** | Deduplicated, counted gap store |
| **Drift** | Memory disagrees with an external source of truth |
