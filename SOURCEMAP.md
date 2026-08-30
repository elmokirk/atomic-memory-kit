# Sourcemap

Where every file came from, what it depends on, and which external source backs
each factual claim in this repo.

Written 2026-08-29 for `0.2.0`. If you change the module graph or add a dated
claim, change this file in the same commit — a sourcemap that lags the code is
worse than none, because it is believed.

- **Code total:** 10 030 lines tracked, of which ~2 900 are `src/`
- **Dependencies:** zero, runtime and dev
- **Tests:** 110, `node:test`

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
| `CONCEPT.md` | The idea lived in Kirk's head and in the shape of the code, nowhere in writing. |
| `LIMITATIONS.md` | — |
| `ANALYSIS-ANTHROPIC-MEMORY.md` | — |
| `tests/` | The source had two lifecycle-gated test files; these 110 are new or rewritten. |

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

  LAYER 4 — I/O and shells                    (the only files that touch the world)
    adapters/fs.ts .... node:fs, node:path, gaps, types
    cli/amk.mjs ....... adapters/fs + src/*
    agent/mcp-server.mjs  adapters/fs + src/*
```

**The load-bearing property:** `src/contract.ts` is at layer 0 and imports
nothing. The moment it imports the loader or the scorer, it stops being a
specification and becomes a description of one implementation's behaviour. Guard
this in review.

**Second property:** exactly one file in `src/` and `adapters/` performs I/O.
That is why `src/` runs unchanged in Node, Deno, Bun, a browser, a worker, or an
edge runtime.

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
| How does it compare to Anthropic's memory? | `ANALYSIS-ANTHROPIC-MEMORY.md` |
| Which idea is the durable one? | `CONCEPT.md` §2, `ANALYSIS-…` §5 |

---

## 4. External sources

Every dated or factual claim about someone else's system traces to a row here.
**Retrieved 2026-08-29.** Anthropic and the MCP working group both move fast;
treat anything below as stale after roughly a quarter and re-verify before
quoting it.

### 4.1 Model Context Protocol

| Claim | Source | Used in |
|---|---|---|
| Current revision is `2026-07-28`; versions are `YYYY-MM-DD` and only bump on breaking change | [Versioning](https://modelcontextprotocol.io/specification/versioning) | `agent/mcp-server.mjs`, `docs/MCP.md` |
| `initialize` handshake and `Mcp-Session-Id` removed; `_meta` carries version + capabilities; `server/discover` mandatory; `ping` / `logging/setLevel` removed | [Key Changes](https://modelcontextprotocol.io/specification/2026-07-28/changelog) | server dispatch, `docs/MCP.md` |
| Error allocation: `-32020` HeaderMismatch, `-32021` MissingRequiredClientCapability, `-32022` UnsupportedProtocolVersion | [Key Changes](https://modelcontextprotocol.io/specification/2026-07-28/changelog) §12 | `ERROR` in the server, `tests/mcp.test.ts` |
| `ttlMs` + `cacheScope` required on list results; deterministic `tools/list` order recommended | [Key Changes](https://modelcontextprotocol.io/specification/2026-07-28/changelog) minor §3, §5 | `cacheable()`, tool ordering |
| `Mcp-Method` / `Mcp-Name` headers required on POST; server rejects header/body disagreement | [Key Changes](https://modelcontextprotocol.io/specification/2026-07-28/changelog) minor §4 (SEP-2243) | HTTP transport |
| MRTR: `resultType: "input_required"`, `inputRequests`, `inputResponses`, opaque `requestState`; new JSON-RPC id on retry; server MUST integrity-protect state, SHOULD bind principal, TTL, and originating request | [MRTR](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr) | `memory_close_gaps`, `signState` / `verifyState` |
| Server MUST NOT send an `inputRequests` type the client did not declare | [MRTR](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr) server req. 7 | the `no-elicitation` degradation path |
| `server/discover` response shape: `supportedVersions`, `capabilities`, `instructions`, `serverInfo` in `_meta` | [Discovery](https://modelcontextprotocol.io/specification/2026-07-28/server/discover) | `dispatch('server/discover')` |
| Sampling, Roots and Logging deprecated; SSE resumability removed | [Key Changes](https://modelcontextprotocol.io/specification/2026-07-28/changelog) deprecations, major §9 | "deliberately not implemented" in `docs/MCP.md` |
| Stateless servers can run with no stateful infrastructure | [Cloudflare: the next generation of MCP](https://blog.cloudflare.com/mcp-v2/) · [MCP blog](https://blog.modelcontextprotocol.io/posts/2026-07-28/) | `ANALYSIS-…` §7 |

### 4.2 Anthropic memory stack

| Claim | Source | Used in |
|---|---|---|
| `{"type": "memory_20250818", "name": "memory"}` is the whole config; no input schema; commands `view` / `create` / `str_replace` / `insert` / `delete` / `rename` scoped to `/memories` | [Memory tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool) | `ANALYSIS-…` §1 |
| The handler is client-side; you execute the commands and must block path traversal | same | `ANALYSIS-…` §1, §6 |
| Claude 4+, beta header `context-management-2025-06-27`, API / Bedrock / Vertex | same | `ANALYSIS-…` §1 |
| Context editing (`clear_tool_uses_20250919`) clears stale tool results in-window; the model is warned before a clear and can write to memory first | [Context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing) | `ANALYSIS-…` §1, §3.1 |
| 84 % token reduction, 39 % improvement on a 100-turn web-search task, memory + context editing | Anthropic benchmark, via [Managing context](https://claude.com/blog/context-management) | `ANALYSIS-…` §1 |
| Server-side compaction is the recommended path | [Managing context](https://claude.com/blog/context-management) | `ANALYSIS-…` §1 |

> **Claims deliberately not sourced.** The description of Claude Code's
> `CLAUDE.md` hierarchy and its auto-memory `MEMORY.md` index comes from the
> runtime this repo was built in, not from published documentation. It is
> observation, and `ANALYSIS-…` §1 presents it as such. Verify before quoting.

### 4.3 Not evaluated

Named in `ANALYSIS-…` §3.1 as prior art that also does not model absence:
LangMem, Zep, Mem0, mem-agent. **These were not tested.** The claim is a
positioning statement based on their public framing, not a benchmark, and should
not be repeated as a measured result.

---

## 5. Verification trail

Reproduce any of these from a clean checkout.

| Claim made in the docs | How to check it |
|---|---|
| 110 tests, zero dependencies | `npm test` |
| Contract, prose and validator agree | `node --test tests/contract.test.ts` |
| Round-trip is lossless | `node --test tests/round-trip.test.ts` |
| MRTR works across cold processes | `node --test tests/mcp.test.ts` |
| The example memory has findable gaps | `cd example && node ../cli/amk.mjs doctor` |
| The HTTP transport speaks the revision | `npm run mcp:http`, then POST `server/discover` |
| The contract is machine-readable | `npm run contract` |

Last full run, 2026-08-29 on Node 22 / Windows: **110 pass, 0 fail.** Example
`doctor`: contract clean, graph intact, scope accuracy 1.0, hit rate 1.0,
precision 0.875, 1 drift finding, 2 open gaps — all planted on purpose.
