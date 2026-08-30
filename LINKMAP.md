# Link map

Every external claim in this repo, traced to the source that backs it, with the
date it was retrieved and an honest note on how much weight it can carry.

Companion to [`SOURCEMAP.md`](SOURCEMAP.md). The split:

- **Sourcemap** — *internal* provenance. Where our code came from, the module
  graph, what changed in transit.
- **Link map** — *external* provenance. Where our facts about other people's
  systems came from.

**The rule for this file:** if a document in this repo states something about
MCP, Anthropic, or any other system, there is a row here. If there is no row,
the statement is either our own reasoning or it should not be there. Rows carry
retrieval dates because everything below moves fast — treat anything older than
a quarter as stale and re-verify before quoting.

Reliability is graded so nobody has to guess:

| Grade | Means |
|---|---|
| **spec** | Normative documentation from the party that defines the thing |
| **docs** | Official product documentation, non-normative |
| **vendor** | First-party blog or announcement — accurate on facts, promotional on framing |
| **press** | Third-party reporting; sourced but not primary |
| **community** | Independent implementation or write-up; useful as evidence something is reproducible, not as authority |
| **observation** | Seen in a running system, not published anywhere |

---

## 1. Model Context Protocol — revision `2026-07-28`

*Retrieved 2026-08-29.*

| Claim | Grade | Source | Used in |
|---|---|---|---|
| Current revision is `2026-07-28`; versions are `YYYY-MM-DD` and only bump on breaking change | spec | [Versioning](https://modelcontextprotocol.io/specification/versioning) | `agent/mcp-server.mjs`, `docs/MCP.md` |
| `initialize` handshake and `Mcp-Session-Id` removed; `_meta` carries version + capabilities; `server/discover` mandatory; `ping` / `logging/setLevel` removed | spec | [Key changes](https://modelcontextprotocol.io/specification/2026-07-28/changelog) | server dispatch, `docs/MCP.md` |
| Error allocation: `-32020` HeaderMismatch, `-32021` MissingRequiredClientCapability, `-32022` UnsupportedProtocolVersion | spec | [Key changes](https://modelcontextprotocol.io/specification/2026-07-28/changelog) §12 | `ERROR` map, `tests/mcp.test.ts` |
| `ttlMs` + `cacheScope` required on list results; deterministic `tools/list` order recommended | spec | [Key changes](https://modelcontextprotocol.io/specification/2026-07-28/changelog) minor §3, §5 | `cacheable()`, tool ordering |
| `Mcp-Method` / `Mcp-Name` headers required on POST; server rejects header/body disagreement | spec | [Key changes](https://modelcontextprotocol.io/specification/2026-07-28/changelog) minor §4 (SEP-2243) | HTTP transport |
| MRTR: `resultType: "input_required"`, `inputRequests`, `inputResponses`, opaque `requestState`; new JSON-RPC id on retry; server MUST integrity-protect state, SHOULD bind principal, TTL and originating request | spec | [MRTR](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr) | `memory_close_gaps`, `signState` / `verifyState` |
| Server MUST NOT send an `inputRequests` type the client did not declare | spec | [MRTR](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr) server req. 7 | the `no-elicitation` degradation path |
| `server/discover` shape: `supportedVersions`, `capabilities`, `instructions`, `serverInfo` in `_meta` | spec | [Discovery](https://modelcontextprotocol.io/specification/2026-07-28/server/discover) | `dispatch('server/discover')` |
| Sampling, Roots and Logging deprecated; SSE resumability removed | spec | [Key changes](https://modelcontextprotocol.io/specification/2026-07-28/changelog) | "deliberately not implemented", `docs/MCP.md` |
| Stateless servers need no stateful infrastructure | vendor | [Cloudflare](https://blog.cloudflare.com/mcp-v2/) · [MCP blog](https://blog.modelcontextprotocol.io/posts/2026-07-28/) | `ANALYSIS-…` §7 |

## 2. Anthropic memory stack

*Retrieved 2026-08-29.*

| Claim | Grade | Source | Used in |
|---|---|---|---|
| `{"type": "memory_20250818", "name": "memory"}` is the whole config; no input schema; commands `view` / `create` / `str_replace` / `insert` / `delete` / `rename` scoped to `/memories` | docs | [Memory tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool) | `ANALYSIS-…` §1, `src/memory-tool.ts` |
| The handler is client-side; you execute the commands and must block path traversal | docs | same | `ANALYSIS-…` §1 §6, `docs/MEMORY-TOOL.md` |
| Exact return strings and error messages per command; `view` line format is 6-wide, 1-indexed, tab-separated; `str_replace` must reject a non-unique `old_str` with the matching line numbers; `insert_text` goes *after* `insert_line`, `0` prepends | docs | same, § *Tool commands* | every return string in `src/memory-tool.ts`, asserted in `tests/memory-tool.test.ts` |
| `create` "creates or overwrites"; returning an error on an existing path is reference behaviour, overwriting is a valid choice | docs | same, § *create* | why our `create` updates instead of erroring |
| The memory root cannot be deleted or renamed by the model | docs | same, § *delete* / *rename* | the root guards |
| Claude 4+, beta header `context-management-2025-06-27`, API / Bedrock / Vertex | docs | same | `ANALYSIS-…` §1 |
| Context editing (`clear_tool_uses_20250919`) clears stale tool results in-window; the model is warned before a clear and can write to memory first | docs | [Context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing) | `ANALYSIS-…` §1 §3.1 |
| 84 % token reduction and 39 % improvement on a 100-turn web-search task, memory + context editing | vendor | Anthropic benchmark via [Managing context](https://claude.com/blog/context-management) | `ANALYSIS-…` §1 |
| Server-side compaction is the recommended path | docs | [Managing context](https://claude.com/blog/context-management) | `ANALYSIS-…` §1 |

## 3. Claude custom connectors

*Retrieved 2026-08-29.*

| Claim | Grade | Source | Used in |
|---|---|---|---|
| Two fields: display name and remote MCP server URL; OAuth client id/secret under Advanced | docs | [Get started with custom connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp) | `docs/INTEGRATIONS.md` §2.3 |
| **Connectors are dialled from Anthropic's cloud, not the local device — even in Cowork and Desktop.** `claude_desktop_config.json` stdio servers are a separate mechanism, unavailable in Cowork and on claude.ai | docs | [Use connectors](https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities) · [Remote MCP](https://claude.com/docs/connectors/custom/remote-mcp) | the constraint that shapes all of `docs/INTEGRATIONS.md`, and why `AMK_AUTH_TOKEN` exists |
| Only Owners can add connectors on Team/Enterprise; members enable individually | docs | [Get started with custom connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp) | `docs/INTEGRATIONS.md` §2.3 |
| No edit option — changing a URL means remove and re-add; Free plan allows one custom connector | docs | same | `docs/INTEGRATIONS.md` §2.6 |
| Both SSE and Streamable HTTP are supported; SSE is deprecated, use Streamable HTTP | docs | [Remote MCP](https://claude.com/docs/connectors/custom/remote-mcp) | `docs/INTEGRATIONS.md` §2.6 |

## 4. Memory consolidation — `/dream`

*Retrieved 2026-08-30. **The weakest-sourced section in this repo.*** Anthropic
has not published primary documentation; everything below is press or community
reimplementation. Several search results are vendor marketing with product
plugs. Treat specific numbers as unverified and re-check before repeating.

| Claim | Grade | Source | Used in |
|---|---|---|---|
| Anthropic introduced memory consolidation called "dreaming"; presented at Code with Claude 2026, research preview, developer access | press | [Let's Data Science](https://letsdatascience.com/news/anthropic-introduces-dreaming-for-claude-agent-memory-consol-32a279c9) (citing Business Insider) | `IDEAS.md` §3 |
| Three phases — orientation, consolidation (merge duplicates, prune stale, elevate recurring patterns), output as a reviewable diff; optional human approval or auto-commit with audit log | press | same | `IDEAS.md` §3 |
| Operates on plain text memory files between sessions; does not change model weights | press | same | `IDEAS.md` §3 |
| Gains are domain-dependent: high-repetition work benefits most, novel tasks little | press | same | `IDEAS.md` §3, the argument for why AMK is complementary |
| A community reimplementation exists with a 4-phase pass and a Stop-hook trigger | community | [dream-skill](https://github.com/grandamenium/dream-skill) | `IDEAS.md` §3 — evidence the pattern is reproducible, not that ours must match it |

> **Explicitly not repeated in our docs:** the "6x" figure and similar
> performance numbers appearing in marketing write-ups. No primary source was
> found, so they carry no weight here.

## 5. Observation, not published

Statements sourced from the runtime this repo was built in rather than from
documentation. Presented as observation wherever they appear. **Verify before
quoting.**

| Claim | Where it appears |
|---|---|
| Claude Code's `CLAUDE.md` hierarchy: enterprise → user → project → subdirectory, with `@import` and `/memory` | `ANALYSIS-…` §1 (Layer 4b) |
| Claude Code's per-project auto-memory directory with a hand-maintained `MEMORY.md` index, loaded every session | `ANALYSIS-…` §1, §3.2 — this is the basis of the "a hand-maintained index will drift" argument |
| Skills use `SKILL.md` frontmatter descriptions for progressive disclosure | `ANALYSIS-…` §1 |

## 6. Named but not evaluated

| Systems | Where | Status |
|---|---|---|
| LangMem, Zep, Mem0, mem-agent | `ANALYSIS-…` §3.1 | **Not tested.** The claim that they optimise recall and do not model absence is a positioning statement from public framing, not a benchmark. Must not be repeated as a measured result. |

---

## 7. Adding a row

When you state a fact about someone else's system:

1. Add the row *in the same commit* as the claim.
2. Grade it honestly. `press` and `community` are not `spec`.
3. Include the retrieval date in the section header.
4. If you cannot find a primary source, either drop the claim or say in the prose
   that it is unverified. `IDEAS.md` §3 is the worked example of the second.

A claim without a row is a claim nobody can check, and this project's entire
argument is that unverifiable knowledge is the problem.
