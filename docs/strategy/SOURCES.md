# Sources and verification register

Reviewed for this planning change on 2026-09-26. `docs-read` means the primary page was read, not that an AMK integration was executed. `reference-only` and `retrieval-failed` are not verified capability claims. Recheck host APIs and pin installed versions before implementation.

## Project evidence

- **P01: core baseline.** [Commit af24e19](https://github.com/elmokirk/atomic-memory-kit/commit/af24e19664816966591281f91d6c8c23a98992e4). Used for file-level review. See the pinned file links in [RED-TEAM.md](reviews/RED-TEAM.md).
- **P02: prior documentation.** [Commit 188dce6](https://github.com/elmokirk/atomic-memory-kit/commit/188dce607d799b93e8643a9aa1586b261fc78a37). Contains the earlier strategy index. This plan replaces its dangling pointers without replacing the core.
- **P03: prior review results.** Nineteen synthetic probes were reported against copied upstream function excerpts and packaging patterns on Node v22.16.0/Linux. The supplied results were inspected during planning, but were not rerun. They are not a full checkout test or live-host certification. B0 reproduces each relevant case using real modules. Results are summarized in the review register; no opaque chat-attachment links are required to execute B0.

## Implementation references

| ID | Primary source | Status | Use and limit |
|---|---|---|---|
| S01 | [Claude Code plugins](https://code.claude.com/docs/en/plugins) | docs-read | Plugin packaging can include skills, hooks, and MCP; does not prove AMK compatibility |
| S02 | [Claude Code memory](https://code.claude.com/docs/en/memory) | docs-read | Native memory boundary and worktree considerations; do not assume a replaceable backend |
| S03 | [Claude API memory tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool) | docs-read | Client-side handler is a distinct integration from Claude Code |
| S04 | [Claude Code hooks](https://code.claude.com/docs/en/hooks) | docs-read | Evaluate documented hook events; exact payloads and timeout behavior need pinned-host tests |
| S05 | [MCP specification](https://modelcontextprotocol.io/specification/2026-07-28) | docs-read via latest redirect | Specification existence is not proof a target host implements every feature; test negotiation and fallback |
| S06 | [Hermes MCP](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp/) | docs-read | Companion transport and configuration |
| S07 | [Hermes memory providers](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory-providers/) | docs-read | Provider coexistence constraints; verify installed version before choosing a plugin surface |
| S08 | [Node TypeScript support](https://nodejs.org/api/typescript.html) | docs-read; page identified v26.8.2 when read | Stripping is not typechecking; package distribution and minimum-runtime claims require testing. This rolling URL is not a pinned runtime dependency |
| S09 | [Mem0 open-source overview](https://docs.mem0.ai/open-source/overview) | docs-read | Select edition/SDK before an example; no equivalence asserted with hosted feature sets |
| S10 | [Pi repository](https://github.com/badlogic/pi-mono) and [previous SDK path](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sdk.md) | retrieval-failed for SDK file | Confirm current SDK path and the user's actual package/version in B1; exact hook/API mapping remains open |
| S11 | [Claude plugin evals](https://code.claude.com/docs/en/plugin-evals) | retrieval-failed; linked from S01 | Optional later tool; not a dependency or claimed working command in this plan |
| S12 | [Writing for agents](https://github.com/mattpocock/skills/blob/main/skills/productivity/writing-for-agents/SKILL.md) | source-read | Authoring reference: short entry points, triggered references, explicit completion criteria, one status owner; read blob a37608daf6e835e767deecfb498facecaaba82ba |

## Comparators and future evaluation

| ID | Primary source | Status | Relevance |
|---|---|---|---|
| C01 | [Honcho overview](https://honcho.dev/docs/v3/documentation/introduction/overview) | docs-read | Persistent entities and reasoning-based representations; no competitor absence claim |
| C02 | [Hindsight overview](https://hindsight.vectorize.io/) | docs-read | Retain, recall, reflect and memory architecture; published scores not adopted here |
| C03 | [A-MEM paper](https://arxiv.org/abs/2502.12110) | abstract-read | Linked atomic notes are prior art, not AMK's sole differentiator |
| C04 | [LongMemEval](https://github.com/xiaowu0162/LongMemEval) | primary README surfaced in search | Later questions about updates, time, and abstention; pin dataset and evaluation protocol before use |
| C05 | [LongMemEval-V2](https://github.com/xiaowu0162/LongMemEval-V2) | reference-only | Prior conversation's agent-oriented benchmark candidate; verify before any benchmark claim |
| C06 | [Mem0 benchmark repository](https://github.com/mem0ai/memory-benchmarks) | reference-only | Candidate benchmark tooling, including prior BEAM discussion; do not inherit scores or comparisons |
| C07 | [Graphiti](https://github.com/getzep/graphiti) | reference-only | Temporal graph comparison for B2; no dependency decision |
| C08 | [Letta](https://docs.letta.com/) | reference-only | Agent-managed memory comparison |
| C09 | [LangMem](https://github.com/langchain-ai/langmem) | reference-only | Memory-management comparison |

## Claim discipline

External capability descriptions belong to their cited version. Keep untested integration assumptions labeled. The preceding chat's numerical speed, accuracy, pricing, adoption, and acquisition claims are not transferred into this plan as facts.

When a source fails to load, retain its status and assign verification to the dependent ticket. Do not fabricate a replacement API. Promote an integration to tested only with a reproducible host trace and version record.
