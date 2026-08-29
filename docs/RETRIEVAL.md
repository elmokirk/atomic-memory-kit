# Retrieval

Deterministic scoring: no embeddings, no vector store, no model call, no network.

Why this trade: [`../CONCEPT.md`](../CONCEPT.md) §6. Its boundaries:
[`../LIMITATIONS.md`](../LIMITATIONS.md).

---

## Pipeline

```
message + last N user turns
        │
        ▼  normalize: lowercase, fold umlauts
        ▼  tokenize: split, drop stopwords, drop bare years, add stems
        ▼
   score every atom (alwaysInclude excluded)
        │
        ▼  + contextBoost for matching categories
        ▼  sort by score, then id (stable)
        │
        ▼  best < minScore ?  ──yes──►  scopeStatus: no_match  (a gap)
        │ no
        ▼  fill seeds: maxChunks, charBudget, reserve for one edge
        ▼  expand 1 hop: edgeMaxChunks, score × edgeBoost, marked viaEdge
        │
        ▼  { chunks, scopeStatus, bestScore }
```

---

## Scoring

| Source | Default weight | Matching |
|---|---|---|
| `keywords[]` | 3 | per entry; multi-word = phrase on the normalized query |
| `synonyms[]` | 2 | same |
| `title` | 2 | **once**, if any token matches |
| `summary` | 1 | **once** |
| `body` | 0.5 | **once** |
| `priority` | ±1 | `priority / 100`, clamped |

Two properties are deliberate:

**Keywords accumulate, fields do not.** Each matching keyword adds its full
weight; title/summary/body contribute at most once regardless of how many tokens
hit. A long body cannot outshout an explicit keyword — but it also means a body
that discusses a topic ten times scores no higher than one mentioning it once.

**`alwaysInclude` atoms never score.** They are injected unconditionally, so
letting them compete would waste the retrieval budget on atoms already present.

---

## Normalization

**Folding.** `ä→ae`, `ö→oe`, `ü→ue`, `ß→ss` by default. Configurable per
language profile.

**Stemming.** Suffix stripping (`ern, er, es, em, en, e, n, s`) with a
minimum-length guard, so `kosten → kost` but `cost → cost`. Both the raw and the
stemmed form are indexed, because morphology is asymmetric — `webseiten` and
`webseite` stem differently.

**Stopwords.** A small German + English list. Kept tiny on purpose: aggressive
stopword removal destroys short queries.

**Bare years are dropped.** `2026` in a body is a weak signal that produces false
positives ("buy in 2026"). Explicit `keywords: ["2026"]` still matches through
the keyword path.

**Prefix fuzzy matching.** Tokens of 5+ characters match by shared prefix in
either direction. This handles German compounds without an NLP dependency. It
will occasionally over-match (`kosten` / `kostenlos`) — it reduces synonym
maintenance, it does not replace it.

### Other languages

```json
{
  "retrieval": {
    "language": {
      "fold": { "é": "e", "è": "e", "ç": "c" },
      "stopwords": ["le", "la", "les", "de", "et"],
      "stemSuffixes": ["ements", "ement", "s"],
      "minPrefixLength": 5,
      "dropYearTokens": true
    }
  }
}
```

**CJK and other non-Latin scripts do not work.** `tokenize()` splits on
`[^a-z0-9]+`, so CJK text collapses to nothing. That needs a different tokenizer,
not a config change.

---

## The scope gate

```ts
scopeStatus = bestScore >= minScore ? 'match' : 'no_match'
```

The single most consequential number in the config.

- **Too high** → false gaps: real knowledge reported as missing.
- **Too low** → hallucination room: weak matches presented as answers.

Tune it with eval cases, not intuition. `scopeAccuracy` measures exactly this,
which is why negative cases matter as much as positive ones. With default
weights, `minScore: 3` means roughly "one keyword hit, or title plus summary".

---

## Budget

```
charBudget: 2500     total characters of chunk bodies
maxChunks: 4         maximum atoms returned
edgeReserveChars: 700  held back for one edge chunk before seeds fill up
```

The **first chunk is always admitted**, even if it alone exceeds the budget — a
truncated-but-relevant answer beats no answer.

The edge reserve is subtracted from the seed budget *before* seeds fill it, so a
curated edge cannot lose to seed volume. If no edge candidate exists, nothing is
reserved.

Budget in characters rather than tokens is deliberate: characters are exact and
model-independent, tokens require a tokenizer that changes with the model. Rough
conversion: ~4 characters per token for Latin text.

---

## Edge expansion

`related[]` edges bring in one neighbour of the best seeds:

```
candidate score = seed score × edgeBoost   (default 0.4)
cap             = edgeMaxChunks            (default 1)
```

This produces multi-atom answers without the user naming both topics — asking
about pricing surfaces the plan limits too. Edge chunks are marked `viaEdge` so
consumers can show provenance.

Hard-capped and budget-bound so edges **dilute, never replace** primary hits.
Multi-hop traversal is not supported; that is the reasoning layer's job, and it
can call `searchMemory` again.

---

## Context boost

```json
{
  "contextBoost": 2,
  "contextCategories": {
    "/pricing": ["pricing", "product"],
    "/support": ["process"]
  }
}
```

`searchMemory(base, q, { context: '/pricing' })` adds `contextBoost` to atoms in
the listed categories. Applied **after** scoring but **before** the threshold, so
it can both reorder results and lift an atom across `minScore`.

Leading locale segments are stripped (`/en/pricing` → `/pricing`). Unknown
contexts are ignored rather than failing.

The context is not necessarily a route — it can be a workspace, a task type, a
current file, any situational key you define.

---

## Query construction

```ts
query = [...lastNUserMessages, currentMessage].join('\n')
```

`historyContextMessages` (default 2) trailing **user** turns are prepended.
Assistant turns are excluded on purpose: including them lets the model's own
vocabulary steer retrieval, which compounds errors turn over turn.

This is what makes "and what does that cost?" resolve — the previous turn carries
the subject.

---

## Performance

One tokenize pass per atom at load (`buildTokenCache`), cached for the lifetime
of the base. Query time is linear over atoms, comparing pre-tokenized sets.

At a few hundred atoms this is sub-millisecond. Load the base **once** at process
start, not per request.

**Scaling triggers:** atom count > 300, or eval precision < 0.6. Then BM25 with
an inverted index (500–2000 atoms), hybrid embeddings above that. Both go behind
the same `searchMemory()` signature — the contract, the gap system and the
bidirectional compile do not change.
