# Plan review, 2026-10-05

Independent second review of the first 2026-10-05 roadmap, by a reviewer that did not write it, followed by spot checks of the main findings by the author. External sources are graded in [LINKMAP.md](../../../LINKMAP.md) §7. This record keeps the findings and what the plan did with them; the plan itself is [ROADMAP.md](../ROADMAP.md).

## Method

The reviewer read the strategy, batches, red-team register, LINKMAP, README, LIMITATIONS and VERDICT; fetched primary sources; reproduced red-team findings against the real modules with throwaway scripts on Node 24.11.1 outside the repository; walked the README quickstart in a temporary copy; and searched for competing tools. No repository file was changed during the review.

Author spot checks: auto-memory frontmatter shapes on the owner's machine (18 files with a nested `metadata:` block, 5 with a flat `type:`); `cc-memory-view` and `memory-hygiene` repositories via the GitHub API; the HTTP listener in `agent/mcp-server.mjs`; the GBrain README; the Claude Code memory page for `autoMemoryDirectory` and the over-limit error.

## Findings and disposition

| # | Finding | Evidence | Disposition |
|---|---|---|---|
| 1 | `--http` listens on all interfaces while the log prints `127.0.0.1`; token is off by default; `memory_apply` writes files | Reproduced with netstat; `server.listen(port)` with no host | Phase 1 item 1 |
| 2 | Auto-memory frontmatter appears both flat (`type:`) and nested (`metadata.type`), plus fields such as `modified`; the docs name only `type` | Owner's disk, Claude Code memory docs | Adapter accepts both; LINKMAP row corrected |
| 3 | The read-only audit is largely prior art: `cc-memory-view` covers five of seven proposed checks | GitHub, MIT, 0 stars, pushed 2026-10-04 | Audit reframed as a hook, cut to five deterministic checks |
| 4 | Claude Code tells Claude, not necessarily the user, when `MEMORY.md` exceeds its read limit | Claude Code memory docs | Wording corrected |
| 5 | GBrain's Markdown repository is canonical (the database is an index), and GBrain ships doctor, orphan, lint, contradiction and gap-analysis features | GBrain README, GBrain MCP catalogue on the owner's instance | GBrain audit adapter dropped; GBrain becomes a Phase 3 comparator |
| 6 | `VERDICT.md` says the gap ledger is "new in the world"; GBrain calls its gap analysis its differentiator | GBrain README | VERDICT scoped to the Anthropic stack it was derived from |
| 7 | R09, R01, R13, R14, R15 still reproduce on current `master` | Throwaway scripts | Phase 1 items 2-4 |
| 8 | `src/memory-tool.ts` path handling postdates the red-team baseline and was never reviewed | Git history | Added to the register and to Phase 1 item 2 |
| 9 | Quickstart: README says 5 atoms (example has 6); `eval` modifies a tracked file; `drift` exits 0 on an error finding; root `npm run check` fails | Temporary copy | Phase 1 item 6; atom count left to the Phase 4 README rewrite |
| 10 | Claude Code install today is a manual `claude mcp add` with absolute paths, in `docs/INTEGRATIONS.md` §1 | README, INTEGRATIONS | Phase 2 plugin; Phase 4 README |
| 11 | npm deferral contradicts B0-T07, T08, the B0 exit checklist and QA family 5 | Document text | Those texts updated |
| 12 | B1 entry gate (B0 accepted) contradicts starting Phase 2 after B0-T01 | Document text | Phase 2 now needs Phase 1 items 1, 2, 7; B1 gate updated |
| 13 | Estimates low: Phase 1 is 8-12 days as written; Phase 3 is 8-10; release 7-10 weeks | Scope count | Phase 1 cut and re-estimated at 6-8; Phase 3 at 8-10; release 7-10 weeks |
| 14 | Three cases cannot support an improvement claim; run-to-run noise in agent-memory evaluations is large | Taskade write-up (unverified secondary source) | Repeated runs with spread; no published percentage |
| 15 | `~/.claude.json` holds a plain-text bearer token for the local GBrain MCP server | Reviewer observation | Owner's machine, outside this repository; reported to the owner |

## Market verdict

A read-only memory audit is a commodity: `cc-memory-view`, `memory-hygiene`, several CLAUDE.md linters, and Anthropic's own `/doctor prompt-audit` for instruction files. The correction-to-reviewed-fact-to-replay loop has no packaged equivalent that the review found; the nearest items are an issue thread and a paper. Demand evidence is weak: the comparable tools have almost no stars. The realistic first user is a solo or small-team Claude Code power user, or a consultant who keeps repeating the same correction to an agent, not an enterprise buyer.

Positioning adopted from the review: *AMK turns the corrections you keep repeating to your coding agent into reviewed, sourced facts, and checks with a replayed question whether the agent now gets them right.*

## Not adopted

- A contradiction check between auto memory and atoms or CLAUDE.md. It needs judgement about meaning, which this project does deterministically or not at all. Revisit if Phase 3 shows contradictions are a common cause of repeated corrections.
- Moving top-level documents under `docs/`. It breaks inbound links for little gain; the Phase 4 README gets a short start path instead.
