# Porting

How to get this into another project, and what breaks where.

---

## The three layers

| Layer | Files | Portability |
|---|---|---|
| **Core** | `src/*.ts` | 1:1 copyable. No I/O, no framework, no network |
| **Adapter** | `adapters/fs.ts` | Replace per host — this is the only I/O |
| **Tooling** | `cli/`, `agent/`, `tests/` | Optional, Node-specific |

Porting means: copy `src/`, write one adapter, done.

---

## Option A — vendor the source

Best for embedding the engine in an app.

```bash
cp -r atomic-memory-kit/src your-project/lib/memory
cp atomic-memory-kit/adapters/fs.ts your-project/lib/memory/fs.ts
```

Then in `tsconfig.json`:

```json
{ "compilerOptions": { "allowImportingTsExtensions": true, "noEmit": true } }
```

`src/` imports use explicit `.ts` extensions (required by Node's resolver). Vite,
esbuild, Rollup, Next.js and Nuxt handle this natively. Plain `tsc` needs the
flag above, or `rewriteRelativeImportExtensions` if you emit JavaScript.

**Delete `src/index.ts` if your host auto-imports** (see Nitro below).

## Option B — keep it as a sibling repo

Best when several projects share one memory, or the memory belongs to a customer.

```bash
npm link ../atomic-memory-kit
# or
"dependencies": { "atomic-memory-kit": "file:../atomic-memory-kit" }
```

Keeps `amk` available for maintenance while your app imports the library.

## Option C — CLI only

Best when the memory is a documentation asset, not a runtime dependency: an
Obsidian vault, a `docs/` tree, a second brain.

```bash
npm i -g atomic-memory-kit
cd my-vault && amk init --root knowledge
```

Nothing is embedded. `bundle.md` and `compiled.json` are the deliverables.

---

## Host adapters

The core needs `{ path, content }[]` and nothing else.

### Node / filesystem

`adapters/fs.ts` as shipped.

### Nuxt / Nitro

```ts
// server/utils/memory/store.ts
export async function readMemoryFiles() {
  const storage = useStorage('assets:memory')
  const keys = await storage.getKeys()
  return Promise.all(keys.map(async (key) => ({
    path: key.replace(/:/g, '/'),          // driver keys use ':' as separator
    content: await storage.getItem(key),
  })))
}
```

Three Nitro-specific traps:

1. **`serverAssets.dir` is server-relative** in Nuxt ≥ 4.4 — use `'../memory'`.
2. **Storage keys use `:`**, not `/`. Normalize before any path logic, or the
   `_`-prefix rules silently stop working.
3. **No barrel file.** Nitro auto-imports `server/utils/**`; a barrel produces
   duplicate-import warnings. Import modules individually and delete
   `src/index.ts`.

### Next.js App Router

```ts
// app/api/memory/route.ts
export const runtime = 'nodejs'   // fs is unavailable on edge
```

`readMemoryDir` works as-is at module scope. Load once, cache in a module-level
variable.

### CMS or HTTP

```ts
const files = entries.map((entry) => ({
  path: `${entry.category}/${entry.slug}.md`,
  content: `---\n${toFrontmatter(entry)}\n---\n\n${entry.body}`,
}))
```

Any source works as long as it can produce frontmatter + body. The kit never
learns where the bytes came from.

### Edge / browser

`src/` runs unchanged. Fetch `compiled.json`, feed it through `decompile()`, and
load. No `node:` imports anywhere in the core.

---

## Configuration

```json
{
  "name": "Customer memory",
  "root": "memory",
  "out": ".memory-out",
  "indexAtomId": "index.scope",
  "evalCases": "memory/_kit/eval-cases.json",
  "claims": "memory/_kit/claims.json",
  "gapLedger": ".memory-out/gaps.jsonl",
  "baseline": ".memory-out/eval-baseline.json",
  "retrieval": {
    "categories": ["product", "pricing", "process", "scope"],
    "intents": ["capability", "pricing", "process"],
    "minScore": 3,
    "maxChunks": 4,
    "charBudget": 2500,
    "contextBoost": 2,
    "contextCategories": { "/pricing": ["pricing", "product"] }
  }
}
```

`retrieval` is the only section that affects behaviour; the rest is paths. In
library use, `defineMemoryConfig()` takes the same shape.

---

## Adoption checklist

- [ ] `src/` copied or linked; `.ts` extension resolution works in your build
- [ ] Host adapter returns `{ path, content }[]` with `/` separators
- [ ] `categories` and `intents` registered in config
- [ ] Base loaded **once** at startup, not per request
- [ ] Contract errors crash the boot rather than degrading service
- [ ] `no_match` produces an explicit refusal path
- [ ] Gap ledger has a writable location (or an external sink on serverless)
- [ ] At least two eval cases per atom
- [ ] `amk validate` and `amk eval` wired into CI

---

## CI

```yaml
- run: node cli/amk.mjs validate --strict
- run: node cli/amk.mjs eval          # exits 1 on threshold or regression
- run: node cli/amk.mjs drift
- run: npm test
```

`amk compile` on release turns the memory into a shippable artifact.

`amk gaps --report` on a schedule (weekly) keeps the backlog visible without
anyone having to remember to look.

---

## Migrating an existing knowledge base

1. **One fact per file.** Split anything answering more than one question. Aim
   for 500–1500 characters of body.
2. **Ids before content.** Ids are permanent citation targets; renaming later
   breaks every reference. Decide the taxonomy first.
3. **Keywords last, by hand.** Write them as the questions people actually ask.
   This is the step that decides retrieval quality, and it cannot be automated.
4. **Edges after atoms exist.** A dangling `related` target fails the entire
   load, so never write edges speculatively.
5. **Eval cases as you go.** Two per atom. Retrofitting them onto 200 atoms is
   miserable; writing them alongside is trivial.
6. **`amk index` at the end**, then commit.

Expect roughly 10–20 minutes per atom for the first twenty, then much faster once
the taxonomy settles.

---

## Name mapping

If you are reading an older codebase this was extracted from, the concepts are
identical under different names:

| Original | Here |
|---|---|
| `KnowledgeAtom`, `KnowledgeBase`, `KnowledgeConfig` | `MemoryAtom`, `MemoryBase`, `MemoryConfig` |
| `loadKnowledgeBase()` | `loadMemory()` |
| `searchKnowledge()` | `searchMemory()` |
| `route` / `routeBoost` / `routeCategories` | `context` / `contextBoost` / `contextCategories` |
| `knowledge:export` / `:import` / `:index` | `amk compile` / `amk import` / `amk index` |
| compiled MD (review-only) | `digest.md` |
| — (did not exist) | `bundle.md`, the editable round-trippable surface |
| `[CHAT_GAP]` log lines | the gap ledger |
