# Ideas: scopes, escalation, and self-observation

Captured 2026-08-30 from Kirk's thinking, then scored. This is **not a plan** and
nothing here is built. Half of it should never be.

The rule for this file: an idea is written down as stated, then evaluated against
one question — *what fixed point tells us it worked?* Ideas with an oracle are
load-bearing. Ideas without one are confabulation with extra steps, no matter how
good they sound.

Related: [`CONCEPT.md`](CONCEPT.md) (what exists), [`VERDICT.md`](VERDICT.md)
(where it sits), [`LIMITATIONS.md`](LIMITATIONS.md) (what it refuses to do).

---

## 1. The ideas, as stated

**I1 — Two-stage retrieval.** Cheap deterministic search first; agentic/deep
search second, as correction. Possibly in parallel.

**I2 — Scopes.** Three long-lived areas with different natures:
`personal` (user data, preferences, interests), `business` (the user's products,
goals, commercial side), `research` (durable external knowledge, so an agent does
not start with an expensive web search).

**I3 — Durability is the entry criterion.** The user's name is fixed. Preferences
persist. *"Meeting Wednesday with X about Y"* is volatile. AMK is for the
long-lived part only.

**I4 — Scopes are also gap columns**, and each can render as its own reviewable
page — more useful for `personal` than for `research`.

**I5 — Research as a shared cache.** Central, long-lived, so N agents do not each
pay for the same web search.

**I6 — Agents use it on themselves.** Find their own gaps, improve autonomously.

**I7 — Single source of truth.** Because the memory composes from one place, that
is where the correct values live — for agents as much as for users.

**I8 — Meditation.** A deliberate pass where the agent observes its own
memory/reasoning, orders scopes, finds errors (in reasoning, or lessons from
implementing code), and rebuilds *only the affected areas*. Like meditation:
observing, not thinking harder.

**I9 — An intermediate layer.** A map across session knowledge, reasoning, and
long-term memory. Assembly must not pollute the context window.

**I10 — A tree that partially rebuilds itself** as the agent needs it.

**I11 — Hallucinations get observed, recognised, and land in memory** so agents
stop repeating them.

---

## 2. The insight that was buried

None of the eleven says this outright, but it is implied by I1 + I11 and it is
the strongest thing in the whole dump:

> **When the cheap stage misses and the deep stage succeeds, that pair is a
> labelled retrieval failure with the correct answer attached.**

That is the one signal a memory system can produce that is both *free* and
*supervised*. Every escalation writes back:

- the query terms that failed → new `keywords` on the atom that should have won,
- an eval case, so the miss becomes a regression test,
- a gap record, closed by the atom the deep stage found or created.

The cheap layer is then **tuned by the expensive layer**, automatically, with an
external fixed point (did retrieval improve? the eval says so). The system gets
cheaper the more it is used, and the improvement is measurable rather than
asserted.

This is what I8 is reaching for, and it is a better mechanism than introspection
because it has an oracle.

---

## 3. Prior art check: Anthropic already ships part of I8

`/dream` exists — memory consolidation between sessions, presented at Code with
Claude 2026, research preview. Three phases: **orientation** (read memory, see
what changed), **consolidation** (merge duplicates, prune stale entries, elevate
recurring patterns), **output** (a reviewable diff, optionally auto-committed
with an audit log). Plain text files. Does not touch weights.

Reported effect is domain-dependent: high-repetition work gains most, genuinely
novel tasks gain little.

**So do not rebuild dreaming.** What dreaming lacks is exactly what this kit has:

| Dreaming has | Dreaming lacks | This kit has |
|---|---|---|
| Consolidation, pruning | A contract to consolidate *against* | `validateAtom`, all-or-nothing apply |
| A reviewable diff | Proof the consolidation did not break retrieval | `runEval` + baseline regression |
| "Prune stale entries" | Any record of what pruning *lost* | gap ledger |
| Model judgement on contradictions | A deterministic contradiction check | `checkDrift` |

The honest positioning is not "AMK does dreaming too". It is **AMK is the thing
dreaming should run against** — a store where a consolidation pass can be
verified rather than trusted.

*Sources, retrieved 2026-08-30:*
[Let's Data Science](https://letsdatascience.com/news/anthropic-introduces-dreaming-for-claude-agent-memory-consol-32a279c9) ·
[dream-skill (community reimplementation)](https://github.com/grandamenium/dream-skill) ·
[Sean Kim](https://blog.imseankim.com/claude-dreaming-anthropic-managed-agents-memory-consolidation-harvey-6x-may-2026/).
Several other write-ups are vendor marketing; treat specific numbers with
suspicion until Anthropic publishes primary docs.

---

## 4. Evaluation

| # | Idea | Verdict | Why |
|---|---|---|---|
| I3 | Durability as entry criterion | **Load-bearing** | The missing field. Decides what enters at all. |
| I2 | Scopes | **Load-bearing** | Different review policies, not just folders. |
| — | Escalation record (§2) | **Load-bearing** | Supervised signal, free, with an oracle. |
| I1 | Two-stage retrieval | **Load-bearing, sequential only** | Parallel wastes the deep budget. |
| I5 | Research as shared cache | **Load-bearing with a TTL** | Needs freshness or it becomes confident rot. |
| I7 | Single source of truth | **Already true** | Existing property; state it, do not build it. |
| I4 | Scopes as gap columns + pages | **Cheap and worth it** | Bundle scoped to an area. Mostly done. |
| I11 | Hallucinations into memory | **Holds only in narrow form** | Nothing detects hallucination. A *verified correction* is an atom. |
| I9 | Intermediate layer | **Holds as a budget rule, not a layer** | The rule already exists; the layer does not need to. |
| I8 | Meditation as error detection | **Mostly does not hold** | No oracle. See §5. |
| I6 | Autonomous self-improvement | **Actively dangerous** | See §5. |
| I10 | Self-building tree | **Does not hold** | A picture, not a mechanism. |

### I3 — Durability is the real entry gate

This is the best idea in the dump and the cheapest to build. Today the
Tier-1/Tier-2 boundary from `VERDICT.md` is *prose*. Make it a field:

```yaml
durability: fixed     # the user's name. Changes ~never.
durability: stable    # preferences, product facts, research findings.
durability: volatile  # "meeting Wednesday" — REFUSED at the gate.
```

`volatile` is not a category the kit stores — it is a category the kit **rejects
on write**, with a message saying where it belongs instead. That single rule
prevents the failure mode most likely to kill adoption: a personal memory that
fills with thousands of thin episodic atoms nobody maintains.

It also gives the review cadence something to key on. `fixed` needs no review.
`stable` needs review when contradicted. That is a real policy, derivable.

### I2 — Scopes are policies, not folders

The tempting cheap version is `category: personal|business|research`. That is
wrong, because the three differ in things `category` cannot express:

| | `personal` | `business` | `research` |
|---|---|---|---|
| Authority | the user | the user | the source |
| Correction | user edits directly | user edits directly | re-fetch, do not "fix" |
| Review trigger | contradiction | contradiction | expiry |
| Sharing | never leaves | team | shareable across users |
| Gap means | "ask the user" | "ask the user" | "go research it" |

That last row is the one that matters. **A gap's `kind` should determine who
answers it.** A personal gap goes to an elicitation; a research gap goes to a
search agent; a business gap goes to the user. Same ledger, three routes.

So a scope is: its own root, its own config, its own gap routing, its own review
policy, its own eval set — sharing one contract and one ledger. That is a
`memory.config.json` array, not a frontmatter field.

**Watch out:** the correctness cost of `research` is highest and the user's
ability to check it is lowest. Kirk already noted this. It means `research`
needs provenance (`source`, `retrievedAt`, `validUntil`) and expiry-driven gaps,
or it becomes the most confident and least trustworthy part of the system.

### I1 — Sequential, not parallel

Parallel means always paying for the expensive path. The point of the cheap path
is to make the expensive one unnecessary.

```
query → cheap retrieval → match?  → answer, done          (cost: ~0)
                       → no_match → deep/agentic search   (cost: real)
                                  → write back keywords + eval case + close gap
```

`scopeStatus: 'no_match'` is already the escalation trigger; it exists and is
tested. Parallel is only right when latency dominates cost — an interactive UI
where 300 ms matters. Make it a flag, default off.

### I11 — What actually holds

"Detect hallucinations" does not hold. Nothing in a memory store can tell a
confident falsehood from a confident truth; that needs a human or a checkable
source.

What holds: **once someone has corrected a claim, the correction becomes an atom
and an eval case, and the wrong answer becomes a `mustNotRetrieve` case.** The
agent then cannot repeat it silently — not because it "learned", but because the
right answer now outranks nothing at all, and a regression would fail the eval.

Narrow, unglamorous, and actually true.

---

## 5. What I would refuse to build

### I6 — Autonomous self-improvement

An agent that promotes its own output into curated core knowledge, then cites it
authoritatively in a later session, has built a laundering machine for its own
errors. The second citation looks like corroboration. Nothing distinguishes
"verified by a human" from "written by me last Tuesday" once it is an atom.

The human gate in the gap loop is not friction to be optimised away. It is the
property that makes Tier 2 worth trusting at all. If it goes, Tier 2 is just
Tier 1 with better formatting and more confidence.

**Acceptable version:** an agent may *propose* freely and *record gaps* freely.
It may not *promote*. `memory_close_gaps` already defaults `autoApply: false`
for exactly this reason.

### I8 — Meditation, in its introspective form

The analogy is meditation as *observing*, and it is a good analogy — which is
precisely why it does not do what is hoped. Observation needs something outside
the observer. An agent reviewing its memory with the same model that wrote it has
no independent signal; it will find the errors it is already disposed to find and
confirm the rest.

Restated with an oracle, it becomes real and is mostly already built:

| "Meditation" step | Oracle | Status |
|---|---|---|
| Find contradictions | numeric claims vs. atoms | `checkDrift` ✔ |
| Find knowledge that stopped being findable | eval + baseline | `runEval` ✔ |
| Find structural rot | graph | orphan/cycle detectors ✔ |
| Find stale knowledge | `validUntil` vs. clock | **not built** — worth building |
| Find duplicates / near-duplicates | similarity threshold | **not built** — worth building |
| "Reflect on whether my reasoning was wrong" | *none* | **refuse** |

Five of six have fixed points. Build those, name the pass `amk audit`, and do not
call it reflection.

### I10 — The self-building tree

The picture is a directed graph that grows where the agent needs it. The
mechanism it implies is edge inference — and `related[]` edges are curated on
purpose (contract R5.5). An inferred edge is unfalsifiable: nobody can say it is
wrong, so nobody removes it, and the graph fills with plausible connections that
degrade every expansion.

The part worth keeping: **growth is driven by gaps, and gaps are already
recorded.** The tree does grow where it is needed — a human just signs each
branch. That is slower and it is the whole point.

---

## 6. What I would build, in order

1. **`durability` as a contract field with a rejecting gate** (I3). One field,
   one rule, largest effect on whether this survives contact with a real second
   brain.
2. **Scopes as configured roots with gap routing** (I2, I4). `personal`,
   `business`, `research` share a contract and a ledger; the gap's scope decides
   who answers it.
3. **The escalation record** (§2). `no_match` → deep search → write back keywords
   + eval case + close the gap. This is the one that makes the system improve
   measurably rather than accumulate.
4. **`amk audit`** (I8 minus introspection): drift + eval + structure + expiry +
   near-duplicates, emitting a reviewable diff. Composes with `/dream` rather
   than competing: dreaming proposes, `audit` verifies.
5. **Provenance for `research`**: `source`, `retrievedAt`, `validUntil`, and
   expiry-driven gaps. Without this, I5 ages into confident rot.

Everything above has an oracle. Nothing above requires the agent to be right
about itself.

---

## 7. Open questions

- **Do scopes share one gap ledger or one per scope?** One ledger with a `scope`
  field keeps "what does the whole system not know" answerable in a single place,
  which was the original point. Leaning one ledger.
- **Who is allowed to close a `research` gap?** If an agent may close it by
  fetching a source, that is autonomous promotion through the back door — unless
  the source itself is the oracle and gets recorded. Probably acceptable, but it
  is the thinnest part of the human gate and deserves a decision rather than a
  drift.
- **Does `durability: volatile` get rejected, or stored in a quarantine the
  audit pass empties?** Rejection is cleaner and teaches the boundary. Quarantine
  is friendlier and will silently become Tier 1 in disguise.
- **How is a near-duplicate resolved without a model?** A similarity threshold
  can *flag* two atoms; deciding which survives is a judgement. Probably: flag as
  a gap, let a human or a proposing agent merge, never auto-merge.
