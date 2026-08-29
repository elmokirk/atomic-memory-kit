# Bidirectional Compile

Store atomically, work in bulk, and make the projection reversible.

Conceptual background: [`../CONCEPT.md`](../CONCEPT.md) §2.

---

## Three surfaces, one source

All three are generated from the same loaded base, so drift between them is
structurally impossible.

| Surface | Format | Lossless | Importable | For |
|---|---|---|---|---|
| **Bundle** | `bundle.md` | yes | **yes** | humans and agents who edit |
| **Compiled** | `compiled.json` | yes | **yes** | machines, RAG, MCP, A2A |
| **Digest** | `digest.md` | no | no | skimming and review |

The atoms remain the source. Everything else is a projection that can be
regenerated. Never the reverse.

---

## The bundle format

```markdown
<!-- amk:bundle v1 atoms=5 generated=2026-08-29T20:54:19.854Z -->
# Memory Bundle — Example SaaS memory

5 atoms · 4 categories · 2 open gaps

## How to work with this file
...instructions travel with the artifact...

## Open gaps

- [ ] `drift-5de7caad` **drift**: website:support.sla → `process.support`
      states 12 business hours but the atom says 24
- [ ] `todo-54a94308` **todo**: sso setup is not documented → `product.onboarding`

## Atoms

### pricing

<!-- amk:atom pricing.plans -->
---
id: pricing.plans
title: "Plans and prices"
category: pricing
lang: en
keywords: [price, pricing, cost, kosten, preis]
related: [product.limits]
summary: "Starter and Growth plan pricing."
priority: 10
---

# Plans and prices

- Starter: 49 EUR per month.
<!-- amk:end pricing.plans -->
```

### The rules

1. Everything between `<!-- amk:atom id -->` and `<!-- amk:end id -->` is a real
   atom and gets written to disk on import.
2. Everything outside fences is prose, discarded on import. Edit freely.
3. Content inside ``` code blocks is ignored — that is how the bundle can
   document its own format without the parser eating the example.
4. The fence id and the frontmatter `id` must agree. A mismatch is **reported,
   never guessed** — guessing here silently corrupts memory.
5. `- [x] \`gap-id\`` closes that gap on import.

### Why fences instead of a JSON blob

Because the artifact has to survive a non-technical reader. A bundle can be sent
by email, pasted into a document, reviewed in a browser, and edited by someone
who has never seen a terminal. Adding an atom means pasting a block that looks
like the ones around it.

---

## The workflow

```bash
amk compile
# → .memory-out/bundle.md
```

Send `bundle.md` to whoever holds the knowledge. They:

1. Read the **Open gaps** list at the top.
2. Either extend an existing atom's body, or paste a new block:

   ```markdown
   <!-- amk:atom product.sso -->
   ---
   id: product.sso
   title: "SSO setup"
   category: product
   lang: en
   keywords: [sso, single sign on, saml]
   related: [product.onboarding]
   summary: "How SAML SSO is configured during onboarding."
   ---

   # SSO setup

   - SAML 2.0 is available on the Growth plan.
   <!-- amk:end product.sso -->
   ```

3. Tick the gaps they closed.
4. Send it back.

```bash
amk import bundle.md --dry-run   # see what would change
amk import bundle.md             # write atoms, close ticked gaps
amk validate                     # contract + graph
amk eval                         # retrieval must not regress
```

Never skip `validate`. An import that does not validate is a broken memory.

---

## Round-trip guarantees

**Guaranteed** and covered by tests against fixtures containing quotes, umlauts,
colons, `"1500"`, apostrophes, mixed quote styles and multiline block scalars:

- all core and standard fields, including `priority`
- bodies verbatim, including fenced code blocks
- string, number, boolean and string-array extension fields
- `compile → decompile → load` is identity
- serializing twice yields byte-identical output

**Not preserved:**

| Lost | Why |
|---|---|
| Field order, formatting | Output is normalized |
| Frontmatter comments | Parsed and discarded |
| Nested/complex extension values | Survive in JSON, dropped by the markdown emitter |
| Prose outside fences | By design |

**Import is destructive.** It overwrites atom files whose content differs, skips
byte-identical ones, and has no undo beyond version control. Commit first.
**Deletion does not propagate** — removing a block from a bundle does not delete
the file.

---

## The quoting problem

The frontmatter parser strips quotes but does not unescape, so the emitter picks
quoting by content:

| Value contains | Emitted as |
|---|---|
| nothing special | `"double quoted"` |
| a `"` | `'single quoted'` |
| a `'` | `"double quoted"` |
| both, or a newline | block scalar `key: \|` |
| array entry starting with a digit or containing `,` | quoted |

This is why numbers must be quoted in arrays: `[1500]` parses as a number and
fails schema validation, `["1500"]` stays a string. The emitter does this
automatically; hand-written atoms trip on it once.

> **Why not a YAML library:** the restricted grammar is what makes lossless
> round-tripping provable. Full YAML has many representations for the same value,
> so `parse → emit → parse` stops being identity — and the guarantee that makes
> this workflow safe evaporates.

---

## The compiled JSON

```json
{
  "generatedAt": "2026-08-29T20:54:19.854Z",
  "contractVersion": 1,
  "atomCount": 5,
  "categories": ["pricing", "process", "product", "scope"],
  "atoms": [ { "id": "pricing.plans", "...": "..." } ],
  "gaps": [ { "id": "drift-5de7caad", "kind": "drift", "count": 1 } ]
}
```

For machine consumers: another agent, a RAG pipeline, an MCP tool, a customer
handover artifact. `decompile()` restores atoms from it.

**Open gaps travel with the memory.** A consuming agent knows not only what this
memory contains but what it is missing — which is exactly what it needs to decide
whether to ask elsewhere.

---

## The scope index

```bash
amk index
```

Regenerates `_index.md`: a generated atom carrying `alwaysInclude: true`, listing
every category and every atom's title and summary.

It is injected on every single query. That is what lets a consumer recognise
"this is outside what I know" instead of improvising — the map is in context
before the question is even scored.

Regenerate it after any structural change. Above `indexRequiredAtAtoms` (default
41) `amk validate` warns if it is missing.
