# Memory Contract

**Contract:** `io.atomicmemory/contract` · **Version:** `1.0.0` · **Conformance of this build:** L4

The frontmatter contract is the load-bearing element of this kit. Retrieval can
be replaced, the compiler can be rewritten, the CLI can be thrown away — but
every one of those reads atoms through this contract, and so does every foreign
system you will ever hand a memory to. It is the schema, the glue and the
negotiation surface at once.

Which means it has two obligations that pull against each other, and this
document exists to state how they are reconciled:

1. **It must be strict enough to be trusted.** After the loader returns, the
   contract holds and every edge resolves. No consumer downstream re-checks.
2. **It must be loose enough to be extended** by you, by a future version of
   your taxonomy, and by other systems — without a coordinated upgrade.

Machine-readable mirror: [`src/contract.ts`](src/contract.ts), served over MCP as
`memory_contract`. Enforced by [`src/schema.ts`](src/schema.ts). The three are
held together by [`tests/contract.test.ts`](tests/contract.test.ts), which fails
if this file, the data and the validator disagree.

---

## 0. Dependencies

### 0.1 What the contract depends on

Nothing. `src/contract.ts` imports no runtime value from any module, and this is
enforced by inspection in review. The moment the contract imports the loader or
the scorer, "the contract" stops being a specification and becomes a description
of one implementation's behaviour.

The only things it *relies on* are external and frozen:

| Dependency | Version | Why it cannot drift |
|---|---|---|
| YAML frontmatter subset | frozen, see §5 | The subset is defined here, not by a YAML library |
| Markdown body | CommonMark-ish | Never parsed by the kit; passed through as text |
| Unicode | any | Only NFC-stable comparison is assumed |
| RFC 5646 language tags | shape only | Matched by pattern, not resolved against a registry |

Because of this, a conforming implementation in Python, Go or Rust needs no
shared library — only the patterns in §5 and the rules in §1.

### 0.2 What depends on the contract

This is the direction that matters when you change a field. Every field declares
its consumers in `src/contract.ts`; `blastRadius(field)` returns them.

| Consumer | Reads | Breaks if you change |
|---|---|---|
| `loader` | `id`, `related`, all types | id uniqueness, edge integrity |
| `retrieval` | `title`, `summary`, `keywords`, `synonyms`, `category`, `priority`, `alwaysInclude` | which atoms are found at all |
| `graph` | `id`, `related` | 1-hop expansion, `viaEdge` provenance |
| `compile` | everything | the round-trip invariant |
| `index` | `id`, `title`, `summary`, `category`, `alwaysInclude` | the generated scope map |
| `gaps` | `id`, `related` | orphan and cycle detection |
| `citation` | `id`, `link` | every `[[source:id]]` ever emitted |
| `host` | `lang`, `link`, `linkLabel`, `intents` | your application, not this kit |

**The asymmetry to internalise:** changing `keywords` changes what gets found
today. Changing an `id` breaks references that may already live in another
team's system, in a chat transcript, or in a gap ledger written six months ago.
Only one of those is recoverable.

### 0.3 Layer rule

```
  contract.ts          no imports                    ← specification
     ↑
  schema.ts            derives its field lists       ← enforcement
     ↑
  loader.ts            trust boundary                ← integrity
     ↑
  everything else                                    ← consumers
```

A module may depend on a layer below it and never above. `schema.ts` derives
`CORE_FIELDS`, `STRING_ARRAY_FIELDS` and the reserved-name set *from* `FIELDS`
rather than restating them, so a field cannot exist in one and not the other.

---

## 1. Core rules

Normative. **MUST** / **MUST NOT** / **SHOULD** carry their RFC 2119 meanings.
An implementation that breaks a MUST is not conforming, and memories it writes
are not safe to exchange.

### R1 — Identity

**R1.1** Every atom **MUST** carry a non-empty `id`.
**R1.2** An `id` **MUST** be unique within a memory. Duplicates fail the load
(`E_ID_DUPLICATE`).
**R1.3** An `id` **MUST NOT** be reused for different content. If the meaning
changes, create a new atom and delete the old one.
**R1.4** An `id` **SHOULD** match `^[a-z0-9]+(?:[.-][a-z0-9]+)*$`. Deviation
warns (`W_ID_FORM`), never fails — an imported memory with legacy ids must still
load so you can fix it.
**R1.5** Dots in an `id` **MUST** map to directories: `a.b.c` ⇄ `a/b/c.md`. The
mapping is total and reversible in both directions.

### R2 — Core fields

**R2.1** `id`, `title`, `category`, `lang` **MUST** each be present and be a
non-empty string. Violation is an error (`E_CORE_MISSING`) and the file is
rejected.
**R2.2** A rejected file **MUST** abort the whole load. Partial loading is
forbidden.

> **Why R2.2 is absolute.** A memory that half-loads is worse than one that
> refuses to load. The agent keeps answering, confidently, from a subset nobody
> noticed had shrunk — and the gap system cannot see it, because a missing atom
> produces no question. Loud failure is the cheapest possible bug.

### R3 — Types

**R3.1** A standard field that is present **MUST** have its declared type. Wrong
type is an error (`E_TYPE`).
**R3.2** Numbers intended as strings **MUST** be quoted in arrays:
`keywords: ["1500"]`, never `[1500]`.
**R3.3** An implementation **MUST NOT** coerce types to be helpful. `priority:
"10"` is an error, not a ten.

### R4 — Forward compatibility

**R4.1** An unregistered but well-typed *value* — an unknown `category`, an
unknown `intent` — **MUST** warn and **MUST NOT** fail.
**R4.2** A field name the contract does not declare **MUST** be preserved
verbatim in `extensions` and **MUST NOT** be rejected.
**R4.3** Extension fields **MUST NOT** affect retrieval until explicitly
registered in config.
**R4.4** An implementation **MUST NOT** promote a warning to an error, and
**MUST NOT** demote an error to a warning. Severity is contract, not policy.

> **Why R4 exists.** Forward compatibility is the difference between a format
> people adopt and one they fight. A memory written against next quarter's
> taxonomy has to load today, or nobody will ever be the first to extend it.
> Reporting extensions as *info* is also how typos surface: `keywrods:` shows up
> in the log without breaking anything.

### R5 — Graph integrity

**R5.1** Every `related[]` target **MUST** exist. A dangling edge fails the load
(`E_EDGE_DANGLING`).
**R5.2** An atom **MUST NOT** reference itself (`E_EDGE_SELF`).
**R5.3** A reciprocal pair (A↔B) **MUST** be accepted. Two atoms pointing at each
other is good graph hygiene, and expansion is capped at one hop so it cannot loop.
**R5.4** A cycle of three or more atoms **SHOULD** warn (`W_CYCLE`) and be
recorded as a gap. It is a topology smell, not a corruption.
**R5.5** Edges are curated, never inferred. An implementation **MUST NOT**
generate `related[]` automatically.

### R6 — Round-trip

**R6.1** Serializing a loaded atom and re-parsing it **MUST** yield an equal
atom, including `extensions`, `priority` and quoting decisions.
**R6.2** Serialization **MUST** be idempotent: serializing twice yields identical
bytes.
**R6.3** A lossy projection (`digest`) **MUST** declare itself non-importable in
its own output.

> R6.1 is why the frontmatter grammar is a deliberate subset rather than full
> YAML. Full YAML has several ways to write the same value and no defined way to
> choose one when writing back. A subset makes the round-trip *provable*, and a
> provable round-trip is what lets you hand the whole memory to a human, get it
> back edited, and trust the result.

### R7 — Gaps

**R7.1** A gap **MUST** be keyed by `(kind, normalized topic)` so the same
missing knowledge observed twice is one record with a count, not two records.
**R7.2** Observing a topic whose gap is `closed` **MUST** reopen it.
**R7.3** A gap report **MUST** be parseable back into close instructions. A
report that is only an output makes the human a data-entry clerk.

> **Why R7.2 is a MUST.** A reopened gap is the only automatic signal that a fix
> did not work — the atom exists, but its keywords do not match how people
> actually ask. Nothing else in the system can detect that.

### R8 — Reserved names

**R8.1** A path segment beginning with `_` is meta content and **MUST NOT** be
ingested.
**R8.2** The single exception is a root `_index.md`, the generated scope index,
which **MUST** be ingested.
**R8.3** Implementations **MUST NOT** define further reserved prefixes. `_` is
the whole namespace reservation.

### R9 — Versioning and negotiation

**R9.1** The contract version is semver and **MUST** be independent of the kit
version.
**R9.2** Major bump: a previously valid atom becomes invalid, or a field changes
meaning. Minor: an additive optional field, or a new consumer. Patch: wording.
**R9.3** A consumer reading a memory whose contract major differs from its own
**MUST** refuse rather than guess. A newer *minor* **MUST** be accepted —
unknown additions land in `extensions` by R4.2.
**R9.4** Every breaking change **MUST** ship a migration note in `CHANGELOG.md`.

### R10 — Diagnostics

**R10.1** Every finding **MUST** carry a stable code from the table in §6.
**R10.2** Tooling **MUST** branch on codes, never on message text. Messages are
prose and may be reworded in a patch release.

---

## 2. Field classes

| Class | Fields | Validation |
|---|---|---|
| **Core** (required) | `id`, `title`, `category`, `lang` | Missing or non-string → **error**, file rejected, load fails |
| **Standard** (optional) | `summary`, `keywords`, `synonyms`, `intents`, `related`, `alwaysInclude`, `priority`, `link`, `linkLabel` | Wrong type → **error**. Unregistered value → warning (except `related`/`link`) |
| **Extension** (open) | anything else — `region`, `validFrom`, `owner`, … | Preserved into `atom.extensions`. Listed as **info**. Inert until registered |

---

## 3. Field reference

### `id` — required, unique, stable

```yaml
id: services.audit
```

The permanent citation target. It appears in `related[]`, in `[[source:id]]`
citations, in the gap ledger, in every compiled export, and possibly in another
team's system. Renaming one breaks every reference to it. See R1.

### `title` — required

Human label. Scored at `weights.title`.

### `category` — required

Taxonomy slot. Unregistered categories warn (R4.1). Drives `contextCategories`
boosting and the grouping in bundles, digests and the scope index.

### `lang` — required

ISO tag (`de`, `en`, `pt-BR`). Retrieval is **language-agnostic** — `lang`
describes the content so consumers can mirror the user's language. A German
question can legitimately retrieve an English atom.

### `summary` — optional, strongly recommended

One sentence that fully describes the atom. Carries the scope index, the digest
and bundle listings. Scored at `weights.summary`.

If the summary needs a second sentence, the atom is probably two atoms.

### `keywords[]` — optional, the most important optional field

```yaml
keywords: [website cost, was kostet eine website, homepage preis]
```

These decide which questions find this atom.

1. **User vocabulary, not internal vocabulary.** What people type, not what you
   call it in a planning doc.
2. **Both languages** if you serve both. At least one term per language.
3. **Write compounds out.** `webseite`, `webseiten`, `homepage`. The prefix
   heuristic helps; it does not replace variant maintenance.
4. **Two to about eight.** Fewer than two warns. More than eight usually means
   the atom should be split.
5. **Quote numbers** (R3.2).

Multi-word entries match as phrases against the normalized query. Single words
match by token, stem, or length-guarded prefix.

### `synonyms[]` — optional

Same matching as keywords, lower weight. Alternative phrasings that are not the
primary way people ask.

### `intents[]` — optional

Free routing labels (`pricing`, `objection`, `process`). Unregistered values
warn. Validated and deliberately **not scored** — they are for your routing, not
this kit's.

### `related[]` — optional, integrity-enforced

```yaml
related: [pricing.plans, process.support]
```

Curated edges. Retrieval expands 1 hop from seed hits, capped at `edgeMaxChunks`
with a reserved character budget, scored at `seed × edgeBoost`. Edge-derived
chunks are marked `viaEdge` so consumers can trace them.

| Condition | Severity | Code |
|---|---|---|
| Target does not exist | **Error** — load fails | `E_EDGE_DANGLING` |
| Self-reference | **Error** — load fails | `E_EDGE_SELF` |
| Malformed target id | **Error** — load fails | `E_EDGE_MALFORMED` |
| Reciprocal pair (A↔B) | Fine — good hygiene | — |
| Cycle of 3+ atoms | Warning, recorded as a gap | `W_CYCLE` |
| No edges in or out | Info — reported as an `orphan` gap | `I_ORPHAN` |

Set an edge when a question about A plausibly leads to B. Never invent target ids
speculatively — a dangling edge fails the whole load, by design.

### `alwaysInclude` — optional, default `false`

`true` injects this atom into every context regardless of the query, and excludes
it from retrieval scoring and budget.

Use sparingly — every always-include atom is a permanent tax on the context
budget. Typical set: the generated scope index, and one or two orientation atoms.

### `priority` — optional, `-100`…`100`

Score nudge: `priority / 100`, clamped to ±1. Preserved verbatim through
round-trips. Gentle tie-breaking, not a way to force retrieval — an atom that
needs a large priority to be found has a keyword problem.

### `link` / `linkLabel` — optional

Canonical surface this atom describes. `link` **MUST** be an absolute path
(`/pricing`) or absolute URL. `linkLabel` without `link` warns.

---

## 4. Extending the contract

Three mechanisms, in increasing order of cost. Use the cheapest one that works.

### 4.1 Extension fields — free, no coordination

Add any field. It is preserved, reported as info, and ignored by every consumer.

```yaml
---
id: pricing.plans
title: "Plans"
category: pricing
lang: en
region: eu                      # extension
validFrom: "2026-01-01"         # extension
owner: kirk                     # extension
---
```

`blastRadius('region')` returns `[]` — that empty list *is* the safety property.
Two teams can add unrelated extension fields to the same memory and never
conflict. This is where nearly every extension should live, permanently.

### 4.2 Registration — config only, still no contract change

Register a category or intent in `memory.config.json` and the warning goes away.
Add a `contextCategories` entry and your extension can influence boosting.
No code change, no version bump, no coordination with anyone else's copy.

### 4.3 Promotion to a standard field — a contract change

Only when a field must be *enforced* or *scored* for everyone. Costs a minor
version bump and an entry in `FIELDS` with:

- a declared type and both severities,
- a `consumers` list (which is now its permanent blast radius),
- `affectsRetrieval` and `isReferenceTarget` flags,
- a `CONTRACT.md` section — `tests/contract.test.ts` fails without one.

**The bar:** if you cannot name the consumer that would break without it, it is
an extension field, not a standard field.

### 4.4 Reserved for you

The contract will never define a field name containing `x-` or a leading
underscore. Those are yours in perpetuity, and a future minor version cannot
collide with them.

---

## 5. Frontmatter grammar

A deliberate subset. Anything outside it is `E_PARSE` with line context, never a
silent misparse.

| Form | Example |
|---|---|
| Scalar | `id: services.audit` |
| Quoted scalar | `title: "Audit"` / `title: 'He said "no"'` |
| Inline array | `keywords: [a, b, "1500"]` |
| Block scalar | `summary: \|` + indented lines |
| Comment | `# anything` |
| Boolean | `alwaysInclude: true` |
| Number | `priority: 10` |

Not supported, on purpose: anchors, aliases, multi-document streams, nested
maps, flow maps, tags, multi-line plain scalars. Each of them has more than one
way to write the same value, which would make R6.1 unprovable.

Patterns, exported as source strings from `src/contract.ts` so a port compiles
the same expressions rather than re-deriving them:

```
id    ^[a-z0-9]+(?:[.-][a-z0-9]+)*$
lang  ^[a-z]{2}(-[a-zA-Z0-9]+)?$
link  ^(\/|https?:\/\/)[^\s]*$
```

---

## 6. Diagnostic codes

Stable API. Branch on these, not on messages (R10.2).

| Code | Severity | Meaning |
|---|---|---|
| `E_PARSE` | error | Frontmatter outside the supported subset |
| `E_CORE_MISSING` | error | A core field is absent or not a non-empty string |
| `E_TYPE` | error | A standard field has the wrong type |
| `E_LINK_FORM` | error | `link` is neither an absolute path nor URL |
| `E_ID_DUPLICATE` | error | Two atoms declare the same id |
| `E_EDGE_SELF` | error | `related[]` points at the atom itself |
| `E_EDGE_DANGLING` | error | `related[]` points at a nonexistent id |
| `E_EDGE_MALFORMED` | error | A `related[]` target violates the id grammar |
| `W_ID_FORM` | warning | `id` deviates from the convention |
| `W_LANG_FORM` | warning | `lang` is not an ISO tag |
| `W_CATEGORY_UNKNOWN` | warning | Category not registered in config |
| `W_INTENT_UNKNOWN` | warning | Intent not registered in config |
| `W_KEYWORDS_FEW` | warning | Below the configured keyword minimum |
| `W_KEYWORDS_NONE` | warning | No keywords at all |
| `W_BODY_EMPTY` | warning | Empty body |
| `W_LABEL_ORPHAN` | warning | `linkLabel` without `link` |
| `W_CYCLE` | warning | Cycle of three or more atoms |
| `I_EXTENSION` | info | An extension field is present and inert |
| `I_ORPHAN` | info | The atom has no inbound or outbound edges |

---

## 7. Conformance levels

A foreign implementation declares the level it reaches. `server/discover` and
`memory_contract` report it. Levels are cumulative, and an L1 implementation can
already exchange atoms with an L4 one without loss.

| Level | Requires |
|---|---|
| **L1 — Read** | Parse the subset or fail with `E_PARSE`; enforce core fields; preserve unknown fields |
| **L2 — Integrity** | L1 + id uniqueness + `related[]` integrity; emit warning codes without upgrading them |
| **L3 — Round-trip** | L2 + serialize back to bytes that re-parse equal, preserving extensions, `priority` and quoting |
| **L4 — Gaps** | L3 + a ledger keyed by `(kind, topic)` that reopens closed gaps on recurrence |

L1 is a weekend of work in any language. That is intentional: a contract nobody
can reimplement is a lock-in, not a standard.

---

## 8. Decision matrix

| Trigger | Rule | Action |
|---|---|---|
| New topic in an existing category | One atom = one thing; a single question should hit it | New atom from the template |
| New subject area | 3+ expected atoms, or a genuinely separate search context | New directory + register the category |
| A gap recurs in the ledger | Recurrence is demand | Write the atom, add eval cases, close the gap |
| A fact changes | Change only the affected atom | Edit, re-run `eval` |
| New audience, region, or variant | Content differentiation, not code | Extension field (§4.1) |
| New language | `lang` is open; keep parallel atoms with distinct ids | New atoms, keywords per language |
| Atom exceeds ~2000 characters | Too big to review, too big for the budget | Split, link with `related[]` |
| Retrieval finds the wrong neighbour | Confusable atoms | Add a `mustNotRetrieve` eval case, then fix keywords |
| You want a field enforced for everyone | §4.3 bar: name the consumer | Promote, or keep it an extension |

---

## 9. Author checklist

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

## 10. Template

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
