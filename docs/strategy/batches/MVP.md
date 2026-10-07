# MVP: integrations and release

Outcome: the PoC core reaches users through a Mem0 adapter and a Claude Code plugin, and is released. Starts after the [PoC](POC.md) exit. Order and file ownership: [roadmap](../ROADMAP.md).

## State

| Increment | Status | Branch | Evidence |
|---|---|---|---|
| I6 Mem0 integration | done | `mvp/i6-mem0` | Entry check `c9142ad`: mem0ai 2.2.1 (commit `94c3fe9`) does not record empty searches; official server cannot use Ollama without code changes, so the library ran behind a stdlib wrapper. Code `3ab4243`, `41dd2c9`, `b6ee673`; guide `90626f8`; recorded real run with `qwen3.5:4b` + `nomic-embed-text:v1.5`: hit 0.773, miss recorded as gap, volatile write refused, eval passes at 0.6 and fails at 0.4. Guide re-run from a fresh directory matched |
| I7 Claude Code integration | awaiting_user | `mvp/i7-plugin` | `a2c44f0` manifests, `92a95e4` server + tests, `d1f987d` docs; validate passes (3 warnings); isolated install on Claude Code 2.1.289 connected, read-only enforced; GitHub-shorthand install and interactive `/plugin` screens open |
| I8 Release | awaiting_user | `master` | 0.3.0 prepared: CHANGELOG, package.json, serverInfo, plugin version; fresh clone 2026-10-07: demo exit 0, no marker leak, validate/search/check green, tree clean, 8 s; tag, GitHub release and outside installs are the owner's |

The Definition of Done for every increment in [POC.md](POC.md) applies here too.

## I6 Mem0 integration

Entry check, recorded before building: on the pinned Mem0 open-source version, confirm the search and add endpoints, and confirm Mem0 does not already record searches that returned nothing. If it does, stop and report.

- [x] `src/backend.ts` defines one small, pure interface: a host-supplied search returning candidates with id, text and score, and an optional write. No I/O, no Mem0 types.
- [x] Wrapping a backend search records a scope gap when no candidate clears the threshold, reusing the existing ledger.
- [x] The eval runner executes must-retrieve and must-not-retrieve cases against a backend by candidate id.
- [x] Write validation is opt-in: a candidate fact passes the AMK contract (including durability) before the host's write is called; a rejection returns the diagnostic and calls nothing.
- [x] `adapters/mem0.ts` talks to Mem0 over HTTP with `fetch`; no Mem0 SDK dependency.
- [x] Tests run against a fake backend in-process; one recorded run against a real, pinned Mem0 instance (version, command, result) is in the evidence column.
- [x] `docs/MEM0.md` is runnable as written: start Mem0, point the adapter at it, see a gap and an eval result.
- [x] `LINKMAP.md` rows for every Mem0 fact the guide relies on.

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

## Owner acceptance (one pass)

Run in order; tick here or note what failed. Expected results are what the integrator observed on 2026-10-07.

1. **Fresh clone and demo.** `git clone https://github.com/elmokirk/atomic-memory-kit.git && cd atomic-memory-kit && npm run demo`. Expect exit 0, an answer without `[GAP:`, `no_match` for the jam question, two gaps in the ledger. Time from clone to output.
2. **Check.** `npm run check`. Expect validate and eval pass on `example/`, then 308 tests, 1 skipped on Windows without symlink rights.
3. **Plugin from GitHub** (needs Node 22.18+ on PATH). In Claude Code: `/plugin marketplace add elmokirk/atomic-memory-kit`, `/plugin install amk@atomic-memory-kit`, restart. In a project with a `memory.config.json` (copy `example/`), ask a question the memory covers and one it does not, without naming the tool. Expect a cited answer, and a gap recorded in the ledger even though writes are off.
4. **Writes stay off.** Ask Claude to add an atom. Expect a refusal naming `allow_writes`.
5. **Remove.** `/plugin uninstall amk@atomic-memory-kit` and remove the marketplace. Expect your settings, auto memory and other plugins unchanged.
6. **Mem0 (optional, about 15 minutes).** Follow `docs/MEM0.md` as written. Expect a hit, a recorded gap for the out-of-scope question, a refused volatile write, an eval pass.
7. **Outside install.** Two people who did not write it run step 1 (and ideally 3) without help; note friction.
8. **Release.** If 1 to 5 pass: `git tag v0.3.0 && git push origin v0.3.0`, then a GitHub release from the `[0.3.0]` CHANGELOG section. LinkedIn material stays out of the repository.

