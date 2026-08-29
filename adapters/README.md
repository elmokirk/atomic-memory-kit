# Host Adapters

`src/` is pure: no I/O, no framework, no network. A host adapter is the one place
that knows where bytes come from.

The entire interface is:

```ts
interface MemoryFileRaw {
  path: string     // relative to the memory root, `/` separated
  content: string  // frontmatter + body
}
```

Produce those, hand them to `loadMemory(files, config)`, and every feature in the
kit works — retrieval, compile, gaps, eval, drift.

## Shipped

**`fs.ts`** — Node filesystem. Also carries gap-ledger persistence (JSONL) and
the atom writer used by `amk import`, which skips byte-identical files so an
import produces a readable diff.

## Writing your own

Two things matter:

1. **Normalize separators to `/`.** The `_`-prefix rules (`_kit/`, `_drafts/`,
   `_index.md`) split on `/`. Windows paths and Nitro storage keys (which use
   `:`) will silently bypass those rules otherwise.
2. **Load once.** Loading parses, validates, builds the graph and tokenizes every
   atom. Cold-start work, not per-request work.

Concrete recipes for Nitro, Next.js, CMS, HTTP and browser hosts are in
[`../docs/PORTING.md`](../docs/PORTING.md).

## Ledger storage on serverless

`fs.ts` rewrites the JSONL ledger wholesale on sync. Two processes writing
concurrently will lose records — fine for CLI and single-server use, not safe for
multi-instance deployments.

For those, keep the append path external (a log drain, a queue, a table) and fold
observations into the ledger in a single-writer job:

```ts
ledger.observe({ kind: 'runtime', topic, source: route })
// then, in a scheduled single-writer job:
writeGapLedger(path, ledger.all())
```

The ledger API is deliberately storage-agnostic: `createGapLedger(records)` takes
whatever you loaded and `ledger.all()` returns whatever you should persist.
