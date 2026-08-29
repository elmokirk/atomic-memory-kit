# Gap Spotlighting

How the memory reports its own holes, and how those reports become knowledge.

Conceptual background: [`../CONCEPT.md`](../CONCEPT.md) §4.

---

## The six detectors

| Kind | Question it answers | Cooperation needed | Where |
|---|---|---|---|
| `scope` | "Do we have anything on this at all?" | none | `search.ts` scope gate |
| `runtime` | "We have the topic — do we have *this*?" | consumer emits a marker | `gaps.ts` detector |
| `eval` | "Can we still find what we have?" | curated question set | `eval.ts` |
| `drift` | "Do we agree with the source of truth?" | claims map | `drift.ts` |
| `todo` | "Did the author know it was incomplete?" | author marker | `gaps.ts` |
| `cycle` / `orphan` | "Is the graph degrading?" | none | `loader.ts` |

---

## 1. Scope gate — deterministic, free

Retrieval scores every atom. If the best score is below `minScore`, the result is
`no_match` before any model is involved.

```ts
const result = searchMemory(base, question)
if (result.scopeStatus === 'no_match') {
  ledger.observe({ kind: 'scope', topic: question, source: route })
  // Tell the consumer explicitly. Do not let it improvise.
}
```

Reproducible, costs nothing, needs no cooperation. It catches *"not my
territory"* — and only that.

**Tuning.** Too high a `minScore` produces false gaps (real knowledge reported as
missing). Too low produces hallucination room. The eval suite is how you find the
right value: `scopeAccuracy` measures exactly this, which is why negative cases
(`expectScope: "no_match"`) are as important as positive ones.

---

## 2. Runtime marker — the one that needs an agent

The scope gate cannot detect the more common failure: retrieval matched the
*topic*, but the retrieved atoms do not answer the *question*. Only the reasoning
layer can see that.

So instruct it. `GAP_PROTOCOL_INSTRUCTION` is ready to paste:

```
When the provided memory does not cover the question — even partially — say so
plainly instead of guessing.

End such an answer with the marker [GAP: <short topic>]. The system removes the
marker before the user sees it and uses it to find holes in the memory.

Use the marker for missing knowledge inside your subject area. Do not use it for
questions that are simply off-topic.
```

### Detecting it in a stream

A marker will be split across deltas. This is the normal case, not an edge case —
an implementation that only tests complete strings misses most gaps in
production.

```ts
const detector = createGapDetector()

for await (const delta of modelStream) {
  for (const topic of detector.push(delta)) {
    ledger.observe({ kind: 'runtime', topic, source: route })
  }
  send(stripGapMarkers(delta))
}
detector.reset()
```

`createGapDetector` keeps a rolling tail (128 chars by default), matches against
it, and reports each marker exactly once. Covered by tests down to
character-sized deltas.

**Always strip before display.** The marker is instrumentation. The user should
see a graceful admission of ignorance, not internal syntax.

### Three failure modes, honestly

1. **The model ignores the instruction.** Then you get no runtime gaps, and
   silence is indistinguishable from having none. Smaller models comply less.
   The scope detector is your floor.
2. **The model over-emits**, marking gaps for things the memory does cover. Shows
   up as many low-count runtime gaps that a human dismisses. Usually means the
   retrieval budget is too tight, not that the instruction is wrong.
3. **Free-text topics fragment.** *"SSO pricing"* and *"cost of single sign-on"*
   are two records. Counts are a lower bound on real demand.

---

## 3. Eval — regression detection

An atom that exists but is never retrieved is functionally absent. Content
quality and retrieval quality are different problems, and only the second can be
measured cheaply.

```json
[
  {
    "q": "what does it cost",
    "expectScope": "match",
    "expectIds": ["pricing.plans"],
    "expectCategories": ["pricing"],
    "mustNotRetrieve": ["process.support"]
  },
  {
    "q": "give me a recipe for jam",
    "expectScope": "no_match",
    "mustNotRetrieve": ["pricing.plans"]
  }
]
```

Three metrics:

- **scopeAccuracy** — how often the gate was right. Below 0.95 means the
  threshold is wrong.
- **hitRate** — of the match cases, how often every expected id was available.
- **precision** — of everything retrieved, how much was relevant. The number that
  degrades as a memory grows.

Absolute thresholds catch a bad memory. The **baseline** catches *getting worse*,
which is the failure that actually happens:

```bash
amk eval                      # fails on threshold violation or regression
amk eval --update-baseline    # accept the current numbers as the new floor
```

Every failure and confusion pair becomes an `eval` gap.

> **The rule that makes this work:** every new atom ships with at least two eval
> cases — one positive, one negative. Without it, precision rots invisibly.

---

## 4. Drift — the dangerous class

Retrieval metrics cannot see drift. The memory is confidently *wrong* rather than
empty: a price changed on the website, and the agent keeps quoting the old one
with a citation, which makes the wrong answer look verified.

```json
[
  { "key": "website:pricing.starter", "value": "49 EUR / month",
    "atomId": "pricing.plans", "claimType": "price" },
  { "key": "website:support.sla", "value": "within 12 business hours",
    "atomId": "process.support", "claimType": "duration" }
]
```

`amk drift` checks that each claim's **numbers** appear in the mapped atom.

```
error unbacked-number: "website:support.sla" states 12 ("We answer within 12
business hours") but atom process.support does not contain it
```

Deliberately dumb, therefore trustworthy. Numbers are the part of a claim that is
unambiguously checkable without a model. Prose contradiction is **not** detected
and will not be — adding a model would make the check non-deterministic and
therefore useless as a gate.

Generating the claims map from your actual source (i18n JSON, CMS, spec files) is
a ten-line script per source and worth writing once.

`amk drift` also reports **uncovered atoms** — atoms no eval case exercises.
Latent gaps rather than observed ones.

---

## 5. Structural detectors

`amk gaps` re-scans and records:

- **`todo`** — `TODO(owner): ...` or `TODO: ...` in an atom body. The author
  already told you what is missing; this collects it. *To close one you must
  remove the marker* — a ticked TODO whose comment is still in the file reopens
  on the next run, correctly.
- **`cycle`** — a `related[]` cycle of three or more atoms. Reciprocal pairs
  (A↔B) are fine and not reported.
- **`orphan`** — an atom with no edges in or out. Usually means either the graph
  is incomplete or the atom does not belong.

---

## The ledger

Deduplicated by `(kind, normalized topic)`, with `firstSeen`, `lastSeen`,
`count`, `status`. Stored as JSONL — appendable, greppable, diffable.

```bash
amk gaps                      # refresh detectors, print the report
amk gaps --report GAPS.md     # write it
amk gaps add "sso pricing" --kind runtime
amk gaps close runtime-1a2b3c --by product.sso
amk gaps sync GAPS.md         # read ticked boxes back
```

### Count is the backlog

Records sort by recurrence. A gap seen forty times is a missing product page; a
gap seen once is noise. You stop guessing what to write next.

### Reopening is a feature

Re-observing a **closed** gap reopens it and bumps the count. If the same question
fails after you closed it, the fix did not work — usually an atom was written but
its keywords do not match how people actually ask. Staying closed would hide
exactly the failure you most need to see.

---

## The return channel

The gap report is an **input** as well as an output. Checkboxes parse back:

```markdown
- [x] `todo-54a94308` sso setup during onboarding is not documented yet
- [ ] `drift-5de7caad` unbacked-number: website:support.sla
```

```bash
amk gaps sync GAPS.md    # closes the ticked one
```

The same parser reads an edited bundle, so gaps can be closed in the same
document where the knowledge was added. That is the point: whoever has the answer
writes it and ticks the box, in one file, without repo access.

Anything less and the human is doing data entry.
