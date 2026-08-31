# Anthropic memory tool, backed by the contract

The memory tool (`memory_20250818`) is client-side: the model only *requests*
file operations, and your application executes them. Almost every implementation
makes that handler a thin wrapper over a filesystem — so whatever the model
writes is what the store contains.

This backs the same six commands with the contract instead.

```js
import { createMemoryToolHandler } from 'atomic-memory-kit/adapters/memory-tool'
import { defineMemoryConfig } from 'atomic-memory-kit'

const memory = createMemoryToolHandler({
  root: './memory',
  gapLedger: './.memory-out/gaps.jsonl',
  config: defineMemoryConfig({ categories: ['pricing', 'product'] }),
})

// in the tool-use loop, for each tool_use block named "memory":
const { content, is_error } = memory.handle(block.input)
```

That is the whole integration. The return value is shaped like a `tool_result`
payload on purpose.

---

## What changes

| Command | Filesystem handler | This |
|---|---|---|
| `view` dir | sizes and paths | + every atom's title and summary |
| `view` missing | "does not exist" | "does not exist" **+ a recorded gap** |
| `create` | writes anything | contract-gated; refusal explains what to fix |
| `str_replace` | writes anything | the *result* is re-validated as an atom |
| `insert` | writes anything | same |
| `delete` | removes the file | **refused** if an inbound edge would dangle |
| `rename` | moves the file | **rewrites every inbound `related[]`** |

Documented return strings are preserved so the model's trained expectations
hold. Extra guidance is appended, never substituted.

---

## The four properties worth the integration

### A miss becomes a gap

```json
{ "command": "view", "path": "/memories/product/refunds.md" }
```

```text
The path /memories/product/refunds.md does not exist. Please provide a valid path.

Recorded as a gap. Use view on /memories to see what this memory actually covers,
and if nothing does, say so rather than answering from general knowledge.
```

The model expected something there. That guess is a statement about demand,
already attributable, and it is the one signal a filesystem handler throws away.
It lands in the ledger as `kind: "scope"`, deduplicated by topic, counted on
recurrence — so a gap seen nine times sorts to the top of the backlog for free.

An empty store is *not* a miss and is not recorded. Neither is a successful view.

### The write path teaches the contract

```json
{ "command": "create", "path": "/memories/product/sso.md",
  "file_text": "---\nid: product.sso\ntitle: \"SSO\"\ncategory: product\nlang: en\nrelated: [product.scim]\n---\n\nSAML 2.0.\n" }
```

```text
related[] points at "product.scim", which does not exist. A dangling edge fails
the whole memory load, so the write was refused. Create the target first, or drop
the edge. Nothing was written.
```

`is_error: true`, nothing on disk, and the model has what it needs to fix it in
the same turn. **The model never has to have memorised the contract** — it learns
it from tool results, which is the only place it reliably reads.

Valid writes with warnings go through and say so:

```text
File created successfully at: /memories/product/sso.md

Accepted with warnings — worth fixing:
  [W_KEYWORDS_NONE] no keywords — this atom is only reachable via title/summary/body tokens
```

That distinction is the contract's severity model doing its job: R4 says unknown
values warn and never block, so a thin atom lands and stays fixable.

#### Session knowledge is refused at the door

The same path carries the durability gate (contract R11). This is the one
refusal that is about *what belongs here* rather than *whether it parses*:

```json
{ "command": "create", "path": "/memories/notes/wednesday.md",
  "file_text": "---\nid: notes.wednesday\ntitle: \"Meeting\"\ncategory: notes\nlang: en\ndurability: volatile\n---\n\nMeeting Wednesday with Anna about the migration.\n" }
```

```text
durability "volatile" is refused: this store is for knowledge that stays true.
Session knowledge ("meeting Wednesday", "the file I am editing") belongs in your
agent's working memory, where being wrong costs one session instead of one
citation. Nothing was written.
```

The message names the alternative on purpose. "Rejected" teaches an agent to
retry; "this belongs in your working memory" teaches it the boundary, once, in
the turn where it tried to cross it — which is the only moment anyone is paying
attention. This is the Tier-1 / Tier-2 split from `VERDICT.md` becoming
enforceable instead of advisory.

It applies to `create`, `str_replace` and `insert` alike, because all three are
validated on their *result*: an edit that turns a stable atom volatile is
refused exactly like a create.

Two honest boundaries. The gate fires only when the agent *declares*
`durability: volatile` — the same content with no `durability` field defaults to
`stable` and is written without complaint. And an unrecognised value
(`durability: seasonal`) warns rather than fails, per R4.1, so a foreign
implementation's vocabulary never bricks a load.

### Delete cannot orphan an edge

```text
Refused: deleting this would leave 1 dangling edge, which fails the whole memory load:
  pricing.plans -> product.limits

Remove those related[] entries first, or rename instead of deleting. Nothing was deleted.
```

A filesystem handler cannot know this. The failure would surface on the next
cold start, far from the action that caused it.

### Rename keeps the graph intact

Because the path determines the id (contract R1.5), a move *is* an id change,
and an id change breaks every inbound edge. So the rename rewrites them:

```text
Successfully renamed /memories/product/limits.md to /memories/product/quotas.md

The id changed from "product.limits" to "product.quotas". 1 inbound related[]
reference was rewritten so the graph stays intact: pricing.plans.

Anything outside this memory that cited the old id — a transcript, another
system, a gap ledger entry — still points at it. Ids are permanent citation
targets; prefer creating a new atom over renaming one that has been quoted.
```

The warning is the honest part. Inbound edges *inside* the memory are repaired;
citations *outside* it cannot be, and the model should know that before it
decides to rename rather than create.

---

## Design notes

**Pure core, thin adapter.** `src/memory-tool.ts` decides what should happen and
returns writes, deletes and gap observations. `adapters/memory-tool.ts` performs
them. The core has no I/O, no clock, no randomness, so it runs in a Worker or a
test unchanged.

**Writes before deletes, always.** A rename is write-destination plus
delete-source. That ordering means a crash between the two leaves a duplicate —
recoverable — rather than a hole.

**No partial writes.** A command either produces its full effect or none of it.

**Path traversal.** Every path is checked against `/memories` in both its raw and
percent-decoded form, up to three decode passes, with `..` segments and NUL bytes
rejected. A rejected path returns `null`, never a partially sanitized one —
"sanitize and continue" is how traversal bugs survive review.

**Degraded mode.** If the memory currently fails to load, the handler does not
throw. `base` becomes `null`, graph-dependent checks are skipped, writes are
still gated on everything that does not need the graph, and the load error is
surfaced in the next listing. A broken atom must not brick the agent — it still
needs `view` and `delete` to repair the damage.

**Caching.** The base is loaded once and invalidated on write. Set
`alwaysReload: true` only if something outside this handler writes to the root;
it costs a full parse per command.

---

## Limits

- **Reads the whole memory into RAM.** Fine at a few hundred atoms; there is no
  lazy loading. See [`LIMITATIONS.md`](../LIMITATIONS.md).
- **No concurrency control.** Single-writer assumptions throughout. Two agents
  against one root will interleave badly.
- **The contract cannot check truth.** A write can be contract-clean,
  graph-consistent, well-keyworded, and factually wrong.
- **Gap topics are derived from paths.** `/memories/product/refunds.md` becomes
  `product refunds`. Good enough to deduplicate and count; not a question.
- **Every file must be an atom.** There is no room for a free-form scratch note
  under the same root. That is the Tier-1/Tier-2 split in
  [`VERDICT.md`](../VERDICT.md), and pointing this handler at episodic memory is
  the documented way to make it unpleasant.
