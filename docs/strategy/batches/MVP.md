# MVP: integrations and release

Outcome: the PoC core reaches users through a Mem0 adapter and a Claude Code plugin, and is released. Starts after the [PoC](POC.md) exit. Order and file ownership: [roadmap](../ROADMAP.md).

## State

| Increment | Status | Branch | Evidence |
|---|---|---|---|
| I6 Mem0 integration | planned | `mvp/i6-mem0` | – |
| I7 Claude Code integration | planned | `mvp/i7-plugin` | – |
| I8 Release | planned | `mvp/i8-release` | – |

The Definition of Done for every increment in [POC.md](POC.md) applies here too.

## I6 Mem0 integration

Entry check, recorded before building: on the pinned Mem0 open-source version, confirm the search and add endpoints, and confirm Mem0 does not already record searches that returned nothing. If it does, stop and report.

- [ ] `src/backend.ts` defines one small, pure interface: a host-supplied search returning candidates with id, text and score, and an optional write. No I/O, no Mem0 types.
- [ ] Wrapping a backend search records a scope gap when no candidate clears the threshold, reusing the existing ledger.
- [ ] The eval runner executes must-retrieve and must-not-retrieve cases against a backend by candidate id.
- [ ] Write validation is opt-in: a candidate fact passes the AMK contract (including durability) before the host's write is called; a rejection returns the diagnostic and calls nothing.
- [ ] `adapters/mem0.ts` talks to Mem0 over HTTP with `fetch`; no Mem0 SDK dependency.
- [ ] Tests run against a fake backend in-process; one recorded run against a real, pinned Mem0 instance (version, command, result) is in the evidence column.
- [ ] `docs/MEM0.md` is runnable as written: start Mem0, point the adapter at it, see a gap and an eval result.
- [ ] `LINKMAP.md` rows for every Mem0 fact the guide relies on.

## I7 Claude Code integration

- [ ] `.claude-plugin/marketplace.json` and a plugin that starts the existing MCP server over stdio via `${CLAUDE_PLUGIN_ROOT}`; no duplicate server code.
- [ ] Read-only by default; enabling writes is an explicit, documented setting enforced by the server.
- [ ] The memory root is configurable; no hardcoded workstation paths.
- [ ] `claude plugin validate` passes without errors.
- [ ] In a clean Claude Code profile: `/plugin marketplace add elmokirk/atomic-memory-kit`, then install, lists and calls the tools; recorded with Claude Code version.
- [ ] Uninstall leaves auto memory, settings and unrelated plugins unchanged.
- [ ] `docs/INTEGRATIONS.md` §1 leads with the plugin route; the manual `claude mcp add` route stays as a fallback.
- [ ] The plugin presents AMK as a knowledge base with gap tracking, not as a replacement for Claude Code memory.

## I8 Release

- [ ] `CHANGELOG.md` `[Unreleased]` becomes the next minor version with date; `package.json` version matches.
- [ ] Every guide (`README.md`, `docs/MEM0.md`, plugin install) executed as written on a fresh clone; failures fixed or removed.
- [ ] Every external claim in `README.md` and `PRODUCT.md` has a `LINKMAP.md` row; nothing claims better accuracy than RAG or competitor absence beyond the recorded rows.
- [ ] `LIMITATIONS.md` covers the adapter and the plugin.
- [ ] Git tag and GitHub release created by the owner, not by an agent.
- [ ] LinkedIn posts, videos and drafts stay in the owner's knowledge base, never in this repository.

## MVP exit

- [ ] I6-I8 `done`; release published by the owner.
- [ ] Two people who did not write it installed either the plugin or the demo without help; notes recorded.
