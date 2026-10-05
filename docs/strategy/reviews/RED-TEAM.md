# Red-team register

Purpose: preserve review findings as actionable hypotheses and reproduction tasks, without converting earlier isolated probes into a whole-product certification.

Baseline: `af24e19664816966591281f91d6c8c23a98992e4`. Planning transcription: 2026-09-26. No new feature or defect fix is implemented by this documentation change.

## Evidence limits

The preceding review used source inspection and reported 19 synthetic probes against copied upstream function excerpts or packaging patterns on Node v22.16.0/Linux. The supplied result file was inspected for this plan. Those probes were not rerun here, and no complete upstream suite, installed AMK tarball, or live Claude/Hermes session was certified by that review.

`R` below refers to an earlier isolated probe. `S` refers to static review. B0 must reproduce findings against actual modules before accepting a fix. Conditional behavior is not a claim that every caller is exploitable or every default configuration fails.

## Findings and ownership

| Finding | Evidence | Risk/condition | Owning ticket |
|---|---|---|---|
| Later GAP marker lost after first leaves rolling tail | R01 | Missing diagnostics in long streams | B0-T04 |
| Split marker leaks; per-delta whitespace removed | R02-R03 | Output corruption in README consumption pattern | B0-T04 |
| String arrays change boolean-like strings and apostrophes; unmatched quote accepted | R04-R06 | Supported round-trip claim fails on edge cases | B0-T02 |
| First result exceeds character budget | R07 | Intentional behavior conflicts with hard-budget claims | B0-T03 |
| Context boost alone reaches match threshold | R08 | Configured boost risk, not a claim about defaults | B0-T03 |
| History count zero includes history | R09 | `slice(-0)` is not an empty slice | B0-T03 |
| Hit rate exceeds 1; forbidden result passes aggregate threshold | R10-R11 | Evaluator can mask retrieval defects | B0-T03 |
| Write failure leaves earlier file changed | R12 | Per-file writes are not a batch transaction | B0-T05 |
| Symlink escapes read/write root | R13 | Demonstrated with sandbox-owned symlink and sentinel | B0-T05 |
| Parent path accepted by exported writer | R14 | Direct adapter API only; not every CLI/MCP call proven reachable | B0-T05 |
| Corrupt ledger line silently skipped | R15 | Invisible evidence loss | B0-T05 |
| HTTP `listen(port)` binds wildcard | R16 | Reproduced 2026-10-05 on the full server: listens on `0.0.0.0` and `[::]`, log prints `127.0.0.1`, token off by default, `memory_apply` writes. Highest priority | B0-T06 |
| Raw `.ts` package import fails under node_modules | R17 | Isolated installed-path pattern, not actual AMK tarball | B0-T07 |
| Bare TS import fails within declared Node range | R18 | Observed on Node 22.16.0 without required flag | B0-T07 |
| Config defaults share mutable arrays/maps | R19 | Aliasing if callers mutate returned config | B0-T03 |
| CLI import writes before validating merged state | S01 | Different guarantees from MCP proposal path | B0-T05 |
| Extension-only changes absent from diff comparison | S02 | Future metadata updates may be skipped | B0-T02 |
| CLI and MCP resolve relative roots differently | S03 | Wrong root when launched from another directory | B0-T05 |
| Tool catalog and integration README diverge | S04 | Documentation can describe unavailable operations | B0-T06 |
| Scope miss described as proven absence; recurrence as people count | S05 | Product claims exceed evidence | B0-T06, B1-T03 |
| `src/memory-tool.ts` path resolution never reviewed | S06 | Added after baseline `af24e19`; same confinement questions as R13/R14 | B0-T05 |
| `drift` exits 0 on an error finding; `eval` modifies tracked `example/.memory-out/gaps.jsonl` | S07 | Found walking the quickstart, 2026-10-05 | B0-T08 |

## Source locations

Pinned source files supporting inspection:

- [Gap detection and ledger](https://github.com/elmokirk/atomic-memory-kit/blob/af24e19664816966591281f91d6c8c23a98992e4/src/gaps.ts)
- [Parser](https://github.com/elmokirk/atomic-memory-kit/blob/af24e19664816966591281f91d6c8c23a98992e4/src/parse-frontmatter.ts) and [serializer](https://github.com/elmokirk/atomic-memory-kit/blob/af24e19664816966591281f91d6c8c23a98992e4/src/compile.ts)
- [Search](https://github.com/elmokirk/atomic-memory-kit/blob/af24e19664816966591281f91d6c8c23a98992e4/src/search.ts), [configuration](https://github.com/elmokirk/atomic-memory-kit/blob/af24e19664816966591281f91d6c8c23a98992e4/src/config.ts), and [evaluation](https://github.com/elmokirk/atomic-memory-kit/blob/af24e19664816966591281f91d6c8c23a98992e4/src/eval.ts)
- [Filesystem adapter](https://github.com/elmokirk/atomic-memory-kit/blob/af24e19664816966591281f91d6c8c23a98992e4/adapters/fs.ts)
- [CLI imports](https://github.com/elmokirk/atomic-memory-kit/blob/af24e19664816966591281f91d6c8c23a98992e4/cli/amk.mjs), [CLI config](https://github.com/elmokirk/atomic-memory-kit/blob/af24e19664816966591281f91d6c8c23a98992e4/cli/lib.mjs), and [proposal diff](https://github.com/elmokirk/atomic-memory-kit/blob/af24e19664816966591281f91d6c8c23a98992e4/src/restructure.ts)
- [MCP server](https://github.com/elmokirk/atomic-memory-kit/blob/af24e19664816966591281f91d6c8c23a98992e4/agent/mcp-server.mjs), [agent instructions](https://github.com/elmokirk/atomic-memory-kit/blob/af24e19664816966591281f91d6c8c23a98992e4/agent/README.md), and [package manifest](https://github.com/elmokirk/atomic-memory-kit/blob/af24e19664816966591281f91d6c8c23a98992e4/package.json)

## Architectural corrections carried into this plan

Retain the compact core, but establish safe writes and installability before new algorithms. Move minimal source/review metadata ahead of claims of verified knowledge. Separate native Claude Code memory from client-side API memory. Test agent invocation, not only tool availability. Use logical scope first; defer physical sharding. Treat no-match as a diagnostic rather than certainty.

The original proposed duplicate IDs, nested YAML metadata, and editable current/historical flags are not accepted implementation instructions. B2 needs a revision model and compatibility decision. A conventional graph cycle or isolated atom is not inherently a content defect; report structural observations without inflating business demand.

## Closure rule

For each finding add actual-module reproduction, affected version, fix commit, focused test, combined regression result, and remaining limits to the B0 verification record. A non-reproducing finding is reclassified with evidence, not silently removed. Keep the batch ticket table as the sole progress owner.
