# Sourcemap

Where every file came from, what it depends on, and which external source backs
each factual claim in this repo.

Written 2026-08-29 for `0.2.0`, updated 2026-08-31 for `0.3.0`. If you change the module graph or add a dated
claim, change this file in the same commit — a sourcemap that lags the code is
worse than none, because it is believed.

- **Code total:** ~11 700 lines tracked, of which ~3 300 are `src/`
- **Dependencies:** zero, runtime and dev
- **Tests:** 285 (1 skipped on Windows without symlink rights), `node:test`

---

## 1. Provenance

This kit was extracted from the knowledge-management core of the
**Kirk-enterprises.space** chatbot (private repo, branch `feat/pi-sdk-chatbot-mvp`,
HEAD `c8103f1` at extraction time). That repo was read-only throughout; nothing
was committed to or deleted from it.

Two vocabulary changes were made during extraction, to remove chatbot framing:
`knowledge-*` → `memory-*`, and `route*` → `context*`. The full name mapping is in
[`docs/PORTING.md`](docs/PORTING.md).

### 1.1 Extracted — existed in the source, adapted here

| File | Source | What changed |
|---|---|---|
| `src/types.ts` | `server/utils/chat/knowledge/types.ts` | Renamed domain; `priority` and `code` added |
| `src/config.ts` | `.../knowledge/config.ts` | Language profile made configurable, was hardcoded DE+EN |
| `src/parse-frontmatter.ts` | `.../knowledge/parse-frontmatter.ts` | Unchanged in substance |
| `src/schema.ts` | `.../knowledge/schema.ts` | Now **derives** field lists from `contract.ts`; diagnostic codes added |
| `src/loader.ts` | `.../knowledge/loader.ts` | Cycle rule fixed (see §1.3); codes on issues |
| `src/score.ts` | `.../knowledge/score.ts` | Folding/stopwords/stemming read from config |
| `src/search.ts` | `.../knowledge/search.ts` | `routeBoost` generalized to `contextBoost` |
| `src/compile.ts` | `tests/knowledge/export.test.ts` | Promoted from test code to a module; bundle format added (§1.2) |
| `src/eval.ts` | `tests/knowledge/retrieval-eval.test.ts` | Promoted to a module; baseline regression added |
| `src/drift.ts` | `scripts/content-sync-check.mjs`, `knowledge/_kit/content-map.mjs` | Generalized from "website claims" to typed external claims |
| `src/gaps.ts` | `server/api/chat.post.ts`, `.../chat/observe.ts`, `.../chat/prompt.ts` | Marker protocol + streaming detector kept; ledger is new (§1.2) |
| `CONTRACT.md` | `knowledge/_kit/CONTRACT.md` | Rewritten as a normative spec; rules numbered, dependencies added |
| `docs/PORTING.md` | `knowledge/_kit/SPECIFICATION.md` §12–13 | Extraction guide and Nitro pitfalls carried over |

### 1.2 New — no antecedent in the source

| File / feature | Why it did not exist before |
|---|---|
| `src/contract.ts` | The contract was prose only. Foreign systems could not read it. |
| `src/restructure.ts` | The source only compiled *outward*. Closing a gap needs the inbound direction. |
| Bundle format in `src/compile.ts` | The source round-tripped JSON only. A human cannot edit JSON usefully. |
| Gap **ledger** in `src/gaps.ts` | The source logged gap events. It never deduplicated, counted, or reopened. |
| `agent/mcp-server.mjs` | No MCP surface existed. |
| `src/expiry.ts` | The source had no notion of knowledge ageing. Everything in it was assumed permanently true. |
| `src/memory-tool.ts`, `adapters/memory-tool.ts` | Anthropic's memory tool did not exist when the source kit was written, and its handler is client-side — so the contract can sit underneath it. |
| `CONCEPT.md` | The idea lived in Kirk's head and in the shape of the code, nowhere in writing. |
| `LIMITATIONS.md` | — |
| `ANALYSIS-ANTHROPIC-MEMORY.md` | — |
| `tests/` | The source had two lifecycle-gated test files; these 285 are new or rewritten. |

### 1.3 Defects found *during* extraction

Extraction is a review. These were real bugs in the source, fixed here and
recorded so the source can be fixed too if it is ever revisited.

| Defect | Where | Fix |
|---|---|---|
| Reciprocal edges (A↔B) reported as graph cycles — permanent warning noise | `loader.ts` | Only cycles of 3+ atoms warn, deduped by sorted signature |
| `priority` silently dropped on round-trip | `compile.ts` | Raw value preserved on the atom and re-emitted |
| TODO parser swallowed the comment terminator into the topic | `gaps.ts` | `cleanTodoText()` strips `-->`, `*/`, `]]>` |
| The bundle's own instruction block parsed as a real atom | `compile.ts` | `parseBundle` tracks code fences when outside an atom |
| `amk doctor` claimed to run gap detectors and did not | `cli/amk.mjs` | Shared `refreshStructuralGaps()` with `amk gaps` |
| `link` / `linkLabel` never type-checked — a number passed validation | `schema.ts` | Found by `tests/contract.test.ts`; string check added |
| `amk gaps` detected cycles by matching message prose | `cli/amk.mjs` | Matches the `W_CYCLE` code |
| Expiry gap topics contained elapsed days, so the ledger minted one uncloseable record per day per stale atom | `expiry.ts` | Topic is atom id + declared `validUntil`; elapsed time moved to the detail. Introduced and fixed within 0.3.0 |

---

## 2. Module graph

Edges are real `import` statements, extracted from source. Layers are strict: a
module may depend downward, never upward.

```
  LAYER 0 — leaves, import nothing internal
    contract.ts ....... the specification, as data
    types.ts .......... shared shapes
    parse-frontmatter.ts  the YAML subset
    gaps.ts ........... ledger, markers, reports

  LAYER 1 — enforcement
    schema.ts ......... contract, types
    config.ts ......... types
    score.ts .......... types

  LAYER 2 — the trust boundary
    loader.ts ......... parse-frontmatter, config, score, schema, contract, types

  LAYER 3 — consumers
    search.ts ......... score, types
    compile.ts ........ parse-frontmatter, contract, gaps, types
    eval.ts ........... search, gaps, types
    drift.ts .......... gaps, types
    restructure.ts .... compile, contract, loader, schema, types
    memory-tool.ts .... compile, gaps, parse-frontmatter, schema, types
    expiry.ts ......... gaps, types

  LAYER 4 — I/O and shells                    (the only files that touch the world)
    adapters/fs.ts .... node:fs, node:path, gaps, types
    adapters/memory-tool.ts  node:fs, node:path, fs.ts, gaps, loader, memory-tool
    cli/amk.mjs ....... adapters/fs + src/*
    agent/mcp-server.mjs  adapters/fs + src/*
```

**The load-bearing property:** `src/contract.ts` is at layer 0 and imports
nothing. The moment it imports the loader or the scorer, it stops being a
specification and becomes a description of one implementation's behaviour. Guard
this in review.

**Second property:** nothing in `src/` performs I/O — all of it lives in
`adapters/`. That is why `src/` runs unchanged in Node, Deno, Bun, a browser, a
worker, or an edge runtime, and why every adapter is small enough to reimplement
against a database or object store in an afternoon.

---

## 3. Where to look for X

| Question | File |
|---|---|
| What is an atom allowed to contain? | `CONTRACT.md` §3, `src/contract.ts` `FIELDS` |
| What breaks if I change field F? | `blastRadius('F')` in `src/contract.ts` |
| Why is this warning not an error? | `CONTRACT.md` §1 R4 |
| How does a gap get recorded? | `docs/GAP-SPOTLIGHTING.md`, `src/gaps.ts` |
| How does the bundle round-trip? | `docs/BIDIRECTIONAL.md`, `src/compile.ts` |
| Why keyword scoring and not embeddings? | `CONCEPT.md` §6, `docs/RETRIEVAL.md` |
| What does this NOT do? | `LIMITATIONS.md` |
| How do I put it in my own project? | `docs/PORTING.md` |
| How do agents drive the loop? | `docs/MCP.md`, `agent/mcp-server.mjs` |
| How do I back `/memories` with this? | `docs/MEMORY-TOOL.md` |
| How do I connect Cowork, Claude Code, the API? | `docs/INTEGRATIONS.md` |
| What might come next, and what should not? | `IDEAS.md` |
| What is planned for the next releases? | `docs/plans/` |
| Who says so, and when did we check? | `LINKMAP.md` |
| How does it compare to Anthropic's memory? | `ANALYSIS-ANTHROPIC-MEMORY.md` |
| Which idea is the durable one? | `CONCEPT.md` §2, `ANALYSIS-…` §5 |

---

## 4. External sources

Moved to [`LINKMAP.md`](LINKMAP.md), which is the canonical place for every
claim this repo makes about someone else's system — MCP, Anthropic's memory
stack, custom connectors, `/dream` — each with a retrieval date and a
reliability grade.

The split is deliberate:

| | Covers | Question it answers |
|---|---|---|
| **This file** | internal provenance | *Where did our code come from, and what depends on what?* |
| **`LINKMAP.md`** | external provenance | *Who says so, when did we check, and how much does it weigh?* |

They rot on different clocks. The module graph changes when we refactor; the
external facts change when Anthropic ships. Keeping them in one file meant one
of the two was always the reason to skip the update.

---

## 5. Verification trail

Reproduce any of these from a clean checkout.

| Claim made in the docs | How to check it |
|---|---|
| 285 tests, zero dependencies | `npm test` |
| Contract, prose and validator agree | `node --test tests/contract.test.ts` |
| Round-trip is lossless | `node --test tests/round-trip.test.ts` |
| MRTR works across cold processes | `node --test tests/mcp.test.ts` |
| Path traversal is rejected, writes are gated | `node --test tests/memory-tool.test.ts` |
| Volatile is refused, expiry does not delete | `node --test tests/durability.test.ts` |
| The chatbot demo runs with no API key, hides the marker, records a runtime and a scope gap, and leaves the tree clean | `npm run demo`; `node --test tests/demo.test.ts` |
| The example memory has findable gaps | `cd example && node ../cli/amk.mjs doctor` |
| An expired atom is reported, not removed | `cd example && node ../cli/amk.mjs expiring` |
| The HTTP transport speaks the revision | `npm run mcp:http`, then POST `server/discover` |
| The contract is machine-readable | `npm run contract` |

Last full run, 2026-10-06 on Node 24 / Windows: **284 pass, 1 skipped, 0 fail.** Example
`doctor`: contract clean, graph intact, scope accuracy 1.0, hit rate 1.0,
precision 0.75, 1 drift finding, 3 open gaps — all planted on purpose.

Precision moved 0.875 → 0.75 when the expired `research.gdpr-retention` atom
joined the example. Cause, checked rather than assumed: the log-retention query
retrieves the right atom first and then `process.support` as its 1-hop
`related[]` neighbour, and the eval case does not list `process` among its
expected categories — so a deliberate edge expansion is scored as an
irrelevant retrieval.

Left as it stands. Adding `process` to the case's `expectCategories` would
restore 0.875 without changing a single retrieval, which is tuning the ruler
rather than the thing being measured. The honest reading is that precision, as
defined here, penalises edge expansion; that is a property of the metric, and
`LIMITATIONS.md` says so. A number that only ever moves up is a number nobody is
measuring.
