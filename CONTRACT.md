# Memory Contract v1

The single source of truth for atom frontmatter. Code mirror:
[`src/schema.ts`](src/schema.ts).

Versioned independently of the kit. A breaking change to a **core** field or to
parser behaviour is a major bump with a migration note in `CHANGELOG.md`.

---

## 1. Field classes

| Class | Fields | Validation |
|---|---|---|
| **Core** (required) | `id`, `title`, `category`, `lang` | Missing or non-string → **error**, file rejected, load fails |
| **Standard** (optional) | `keywords[]`, `synonyms[]`, `intents[]`, `related[]`, `summary`, `alwaysInclude`, `priority`, `link`, `linkLabel` | Wrong type → **error**. Unknown *value* (unregistered category/intent) → warning |
| **Extension** (open) | anything else — `region`, `validFrom`, `owner`, … | Pass-through into `atom.extensions`. Listed as **info**. Inert until registered in config |

### The severity rules, and why

**Core violations are errors.** A memory that half-loads is worse than one that
refuses to load: the consumer keeps answering, from a subset nobody noticed
shrank. Fail loudly.

**Unknown values only warn.** A memory written against a future taxonomy must
still load today. Forward compatibility is the difference between a format
people adopt and one they fight.

**Extensions are inert, not rejected.** They never affect retrieval until you
register them in config. Listing them as info is also how typos (`keywrods:`)
surface without breaking anything.

---

## 2. Field reference

### `id` — required, unique, stable

```yaml
id: services.audit
```

Lowercase, dot- or dash-separated: `^[a-z0-9]+(?:[.-][a-z0-9]+)*$`. Deviations
warn rather than fail.

The id is a **permanent citation target**. It appears in `related[]` edges, in
`[[source:id]]` citations, in the gap ledger, in compiled exports, and possibly
in another team's system. Renaming one breaks every reference to it.

Dots map to directories: `services.pricing.audit` → `services/pricing/audit.md`.

> Never reuse an id for different content. If the meaning changes, make a new
> atom and delete the old one.

### `title` — required

Human label. Contributes to scoring at `weights.title`.

### `category` — required

Taxonomy slot. Unregistered categories warn. Categories drive `contextCategories`
boosting and the grouping in bundles, digests and the scope index.

### `lang` — required

ISO tag (`de`, `en`, `pt-BR`). Retrieval itself is **language-agnostic** — `lang`
describes the content so consumers can mirror the user's language. A German
question can legitimately retrieve an English atom.

### `keywords[]` — optional, the most important optional field

```yaml
keywords: [website cost, was kostet eine website, homepage preis]
```

These decide which questions find this atom. Rules:

1. **User vocabulary, not internal vocabulary.** What people type, not what you
   call it internally.
2. **Both languages** if you serve both. At least one term per language.
3. **Write compounds out.** `webseite`, `webseiten`, `homepage`. The prefix
   heuristic helps; it does not replace variant maintenance.
4. **Two to about eight.** Fewer than two warns. More than eight usually means
   the atom should be split.
5. **Quote numbers.** `["1500"]`, never `[1500]` — bare numbers parse as numbers
   and fail validation.

Multi-word entries match as phrases against the normalized query. Single words
match by token, stem, or length-guarded prefix.

### `synonyms[]` — optional

Same matching as keywords, lower weight. Use for alternative phrasings that are
not the primary way people ask.

### `intents[]` — optional

Free labels (`pricing`, `objection`, `process`). Unregistered values warn.
Currently metadata for your own routing — **not used in scoring**.

### `summary` — optional, strongly recommended

One sentence that fully describes the atom. Appears in the scope index, the
digest, and bundle listings. Contributes at `weights.summary`.

If the summary needs a second sentence, the atom is probably two atoms.

### `alwaysInclude` — optional, default `false`

`true` injects this atom into every context regardless of the query, and excludes
it from retrieval scoring and budget.

Use sparingly — every always-include atom is a permanent tax on the context
budget. Typical set: the generated scope index, and one or two orientation atoms.

### `priority` — optional, `-100`…`100`

Score nudge: `priority / 100`, clamped to ±1. Preserved verbatim through
round-trips. Use for gentle tie-breaking, not to force retrieval — an atom that
needs a large priority to be found has a keyword problem.

### `link` / `linkLabel` — optional

Canonical surface this atom describes. Must be an absolute path (`/pricing`) or
absolute URL. `linkLabel` without `link` warns.

### `related[]` — optional, integrity-enforced

```yaml
related: [pricing.plans, process.support]
```

Curated graph edges. Retrieval expands 1 hop from seed hits, capped at
`edgeMaxChunks` with a reserved character budget, scored at `seed × edgeBoost`.
Edge-derived chunks are marked `viaEdge` so consumers can trace them.

| Condition | Severity |
|---|---|
| Target does not exist | **Error** — load fails |
| Self-reference | **Error** — load fails |
| Reciprocal pair (A↔B) | Fine — good graph hygiene |
| Cycle of 3+ atoms | Warning, recorded as a gap |
| No edges in or out | Info — reported as an `orphan` gap |

Author rules: link only genuine topical relationships. Never invent target ids
speculatively — a dangling edge fails the whole load. Set an edge when a question
about A plausibly leads to B.

---

## 3. Reserved names

| Name | Meaning |
|---|---|
| `_`-prefixed **directories** | Meta content (`_kit/`, `_drafts/`) — never ingested |
| `_`-prefixed **files** | Skipped |
| `_index.md` | **Exception**: the generated scope index, always ingested |

---

## 4. Decision matrix

| Trigger | Rule | Action |
|---|---|---|
| New topic in an existing category | One atom = one thing; a single question should be able to hit it | New atom from the template |
| New subject area | 3+ expected atoms, or a genuinely separate search context | New directory + register the category in config |
| A gap recurs in the ledger | Recurrence is demand | Write the atom, add eval cases, close the gap |
| A fact changes | Change only the affected atom | Edit, re-run `eval` |
| New audience, region, or variant | Content differentiation, not code | Extension field, optionally registered later |
| New language | `lang` is open; keep parallel atoms with distinct ids | New atoms, keywords per language |
| Atom exceeds ~2000 characters | Too big to review, too big for the budget | Split, link with `related[]` |
| Retrieval finds the wrong neighbour | Confusable atoms | Add a `mustNotRetrieve` eval case, then fix keywords |

---

## 5. Author checklist

Before committing a new atom:

- [ ] `id` is unique, stable, and matches the file path
- [ ] `category` is registered in config
- [ ] At least 2 keywords, in user vocabulary, both languages if applicable
- [ ] Numbers in arrays are quoted
- [ ] `summary` is exactly one sentence
- [ ] Every `related` target exists
- [ ] Body contains only defensible facts; uncertainty marked `TODO(owner):`
- [ ] At least 2 eval cases added — one positive, one `mustNotRetrieve`
- [ ] `amk validate` clean, `amk eval` green

---

## 6. Template

```markdown
---
id: category.topic
title: "Human readable title"
category: category
lang: en
intents: [capability]
keywords: [primary term, synonym, andere sprache]
synonyms: [variant]
summary: "One sentence that fully describes this atom."
related: [other.atom]
alwaysInclude: false
priority: 0
---

# Topic

- One checkable fact per line.
- Nothing that cannot be defended.

<!-- TODO(owner): mark open questions here — they become gaps automatically -->
```

---

## 7. Versioning

**Contract v1.** Bump major on: a change to core field semantics, a change to
parser grammar, or a change to a severity that makes previously-valid atoms
invalid. Minor for additive optional fields. `CHANGELOG.md` carries migration
notes.
