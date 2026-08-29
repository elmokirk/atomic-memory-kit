# This kit vs. Anthropic's memory stack

*Assessment written 2026-08-29 against MCP `2026-07-28`, the `memory_20250818`
tool, and Claude Code as shipped. Anthropic moves fast; the dated claims below
will rot. The structural argument in §5–§7 should outlive them.*

---

## 1. What Anthropic actually built

Four layers, and they solve three different problems. Conflating them is the
most common mistake in this comparison, including in my own first draft.

### Layer 1 — The context window

The ground truth. Everything the model can attend to right now. Ephemeral,
expensive, and the only place reasoning happens.

### Layer 2 — Context editing

`clear_tool_uses_20250919`. As the window fills, stale tool calls and their
results are cleared in place, preserving conversational flow. Anthropic's
published figure is 84 % token savings and a 39 % performance improvement on a
100-turn web-search task when combined with the memory tool.

Crucially, the model gets a **warning before the clear**, and can write anything
worth keeping to memory first. That handoff is the whole design.

### Layer 3 — Compaction

Summarize the conversation and continue. Server-side is the recommended path.
Lossy by construction, one-way by construction. This session is running on it.

### Layer 4 — The memory tool

`{"type": "memory_20250818", "name": "memory"}` — that entry is the entire
configuration. No input schema; the tool is defined server-side. The model
issues file operations (`view`, `create`, `str_replace`, `insert`, `delete`,
`rename`) scoped to `/memories`, and **you** execute them. Storage is yours, and
your handler must reject path traversal. Beta header
`context-management-2025-06-27`, Claude 4+, API / Bedrock / Vertex.

The design bet worth naming: **retrieval is the model reading a filesystem.**
Not embeddings, not a vector index. The model runs `view` on a directory,
decides from filenames what to open, and opens it. Anthropic bet that a capable
model navigating named files beats similarity search over chunks.

### Layer 4b — Claude Code's variant

Same idea, more convention:

- `CLAUDE.md` hierarchy — enterprise → user (`~/.claude/CLAUDE.md`) → project →
  subdirectory, with `@import` and `/memory`.
- An auto-memory directory per project with a hand-maintained `MEMORY.md` index —
  one line per memory, loaded every session, pointing at files loaded on demand.
- Skills: `SKILL.md` frontmatter with a `description` the model reads to decide
  whether to load the body. Progressive disclosure, same principle.

### What is conspicuously absent from all four

There is no schema, no validation, no link integrity, no measurement, and — the
one that matters most — **no record of what was asked and not found.**

---

## 2. The overlap, honestly

| | Anthropic | This kit |
|---|---|---|
| Storage | Markdown files, free-form | Markdown files, contracted |
| Retrieval | Model reads filenames, then files | Deterministic scoring, then a gate |
| Index | `MEMORY.md`, hand-maintained by prompt | `_index.md`, generated |
| Scope awareness | Model's judgement | `match` / `no_match` against a threshold |
| Write path | Model writes a file | Proposal → contract check → all-or-nothing apply |
| Forgetting | Context editing + compaction | Not addressed |
| Missing knowledge | **Nothing** | Gap ledger, six detectors, recurrence |
| Round-trip | Not defined | Tested invariant |
| Measurement | **Nothing** | Eval harness with regression baselines |

We agree on the fundamental bet — files, markdown, model-navigable, no vector
DB — which is the reason integration is even possible. We disagree on whether
that store should be able to *account for itself*.

---

## 3. Where this concept genuinely improves the stack

### 3.1 Not-knowing is data — and nothing in the stack records it

This is the one real contribution, and everything else here is secondary.

Follow a miss through Anthropic's layers. The model runs `view /memories`, sees
nothing relevant, answers from general knowledge or says it doesn't know, and
the turn ends. The window fills. Context editing clears the tool result. Nothing
persists. The same question next week produces the same miss, and no artifact
anywhere counted to two.

Context editing and compaction are both *information-destroying operations that
never ask whether what they are destroying was a hole.*

The gap ledger says: a question that found nothing is the highest-value signal
the system produces, because it is *demand*, already expressed, already
attributable. Deduplicated by `(kind, topic)`, counted, and reopened when a
supposed fix fails to match. A gap seen nine times is nine people who did not
get an answer, sorted to the top of a list, for free.

Nothing in Anthropic's stack does this. Nothing in LangMem, Zep, Mem0 or
mem-agent does it either — they all optimise recall of what is stored.

### 3.2 A hand-maintained index will drift; a generated one cannot

Claude Code's `MEMORY.md` is maintained by an instruction in a system prompt:
*"add a one-line pointer."* That works until it doesn't — a write that skips the
index makes a memory that exists on disk and is invisible to every future
session. There is no check that would catch it.

`_index.md` is generated from the atoms. It cannot disagree with them.

### 3.3 The write path can fail loudly instead of silently

`create` in the memory tool writes whatever the model produced. A malformed
file, a reference to a note that was renamed, a fact that contradicts the one
next to it — all accepted, all discovered later, if ever.

Here every write goes through the contract and then through the real loader over
the merged file set. Dangling reference, duplicate id, unquoted number: the batch
is refused whole, with a diagnostic code. **An agent cannot write an invalid
memory through this path, no matter what it proposes.** That property is worth
more than any retrieval improvement.

### 3.4 Retrieval you can measure, and therefore regress

`runEval` with positive cases and `mustNotRetrieve` cases, thresholds, and a
baseline comparison. When an atom's keywords change and a different atom stops
being found, that is a test failure with a name.

Model-mediated retrieval is not measurable this way — not because it is worse,
but because there is no fixed function to hold still. Anthropic ships no eval
harness for memory, and structurally cannot ship a simple one.

### 3.5 A projection a human can actually work in

Compaction summarizes and discards. The bundle is lossless, editable, and
imports back with the round-trip as a tested invariant — with open gaps rendered
as checkboxes *inside the same document*, which parse back out. The human reads
one file, answers the open questions in place, and hands it back.

That workflow has no equivalent in the stack. `/memory` opens one file at a time.

---

## 4. Red team — where this is weaker, wrong, or beside the point

Written adversarially on purpose. Every point below is one I believe.

### 4.1 Schemaless is a feature, and the contract taxes it

The memory tool works partly *because* the model can just write a file. Zero
friction, zero failure modes, zero teaching. This kit introduces a contract the
agent must read, rules it can violate, and a write that can be refused.

Every one of those is real cost paid on every write, against a benefit that
only materialises later and only if someone reviews. For a personal second brain
with one user and no correctness requirement, that trade may simply be bad.

Mitigations exist — L1 conformance is cheap, extension fields are free, warnings
never block — but they reduce the tax, they do not remove it.

### 4.2 Wrong shape for episodic memory

Anthropic's memory is mostly *episodic and personal*: "Kirk prefers TypeScript",
"the build hangs on PowerShell 5.1", "we decided X on Tuesday". Unbounded,
low-stakes, high-write-rate, valuable in aggregate.

Atoms are *semantic and curated*: one defensible fact, keywords maintained by
hand, edges curated by hand. Forcing episodic memory into that shape produces
thousands of thin atoms nobody maintains, and the contract's discipline becomes
overhead on content that never needed it.

**This is the strongest argument that the concept cannot replace the stack**,
and I do not think it has a rebuttal. It has an architecture (§6).

### 4.3 Keyword retrieval is the weakest component and the most replaceable

`LIMITATIONS.md` already concedes CJK is a hard failure and that quality degrades
past a few hundred atoms. Beyond that: a competent model reading twenty
filenames beats weighted keyword scoring on any query the keyword author did not
anticipate — which is most interesting queries.

The scope gate is valuable because it is *deterministic*, not because it is
*accurate*. If you sell this on retrieval quality, you lose. The gate is
infrastructure for the gap system; it is not the product.

### 4.4 The gap ledger can become a second inbox

Recurrence counting is a priority signal only if someone reads the list. In a
personal system, that someone is the same overloaded person who did not write
the atom in the first place. A ledger with 200 open gaps is not intelligence, it
is a guilt generator — and it is *worse than nothing*, because it looks like
process.

The MRTR loop is the honest answer: the agent brings three questions at a
moment the human is already present, instead of a backlog they must visit. But
that only works if the agent is disciplined about `limit`, and nothing enforces
that.

### 4.5 Curated edges do not scale by hand

`related[]` is the best part of the graph and the first thing to rot. At 50 atoms
it is a pleasure. At 300 it is unmaintained, and integrity enforcement then
means a rename fails a load for an edge nobody remembers wanting.

Auto-inference is explicitly forbidden by R5.5, and I still think that is right —
inferred edges are unfalsifiable — but the rule has a maintenance cost that
grows superlinearly and has no answer.

### 4.6 It does not touch the problem the stack is actually solving

Context editing and compaction solve an **in-window** problem: too many tokens,
right now, in this conversation. This kit has nothing to say about that. Zero.

Anyone pitching this as an alternative to compaction is making a category error.
It is a *store*; compaction is a *window management strategy*. They compose;
they do not compete.

### 4.7 Anthropic can close most of this, and probably will

Validation on memory writes, a generated index, a gap counter — none of these are
hard, and all of them are obvious once someone frames memory as an accountable
store rather than a scratchpad. Betting a product on Anthropic not shipping
schema validation is a bad bet on an 18-month horizon.

What does not commoditise: the *concept* — that not-knowing is a first-class
record — and a **portable, vendor-neutral contract** that a Python or Go
implementation can reproduce in a weekend. The code is the perishable part.
`CONCEPT.md` and `CONTRACT.md` are the durable ones.

### 4.8 Two unproven claims I am making

- **That anyone will answer the questions.** The entire loop rests on a human
  who responds. Untested outside one person's own project.
- **That the round-trip stays lossless as the format grows.** It holds today
  because the YAML subset is deliberately small. Every future field is pressure
  on that, and R6 is the first rule that will be tempting to bend.

---

## 5. Verdict

**Not a replacement. Not irrelevant. It is the accounting layer the stack does
not have.**

Scored against what it could be:

| Claim | Verdict |
|---|---|
| Replaces the memory tool | **No.** Wrong shape for episodic memory (§4.2) |
| Replaces context editing / compaction | **No.** Different problem entirely (§4.6) |
| Better retrieval than a model reading files | **No.** Worse on anything unanticipated (§4.3) |
| The right store *behind* the memory tool | **Yes**, for knowledge that must be right |
| Contributes something genuinely absent | **Yes** — gap spotlighting, and only that |
| Portable as a concept across vendors | **Yes**, and this is the durable asset |

If exactly one idea survives from this project, it should be:

> A memory system must be able to report what it does not know, and that report
> must be an input as well as an output.

Everything else — the scorer, the bundle format, the CLI — is a plausible
implementation of a much smaller idea.

---

## 6. Recommendation: two tiers, one promotion path

Stop framing it as this-or-that. Run both, with an explicit boundary.

```
  ┌────────────────────────────────────────────────────────┐
  │ TIER 1 — episodic, hot, model-written                  │
  │ Anthropic memory tool / CLAUDE.md / auto-memory dir    │
  │ Free-form. High write rate. No schema. Leave it alone. │
  └───────────────────────┬────────────────────────────────┘
                          │  promotion = a human reviewed it
                          │  (this is the gap-closing loop)
                          ▼
  ┌────────────────────────────────────────────────────────┐
  │ TIER 2 — semantic, cold, curated                       │
  │ Atomic Memory Kit                                      │
  │ Contracted. Cited. Evaluated. Gap-accounted. Shared.   │
  └────────────────────────────────────────────────────────┘
```

**Tier 1** is where "Kirk prefers X" and "that build hangs on PowerShell 5.1"
live. Cheap, forgiving, forgettable. Anthropic's design is correct for it and
this kit should not touch it.

**Tier 2** is for knowledge that must be *right*: cited to a user, shared across
agents, audited, or expensive to get wrong. Contract, eval, gaps.

**Promotion is the interesting part.** Something moves up only when a human
reviewed it — and that review is precisely the gap loop: the agent brings what
recurred, the human confirms, `planApply` files it as an atom.

This is the same shape as Owledge's `sessions/` → `canonical/`. Which is either
convergent evolution or a hint that the structure is right.

### The concrete build: memory tool on top of this kit

The single highest-value thing to build next, and it is small.

The memory tool's handler is client-side by design — Anthropic executes nothing.
So implement that handler over this kit:

| Model issues | Handler does |
|---|---|
| `view` on the directory | `memory_scope` |
| `view` on a file | `memory_get` |
| `create` / `str_replace` | `planApply` → refuse with a diagnostic on violation |
| `view` that returns nothing useful | **record a gap** |

That last row is the novel artifact: **a memory backend that reports its own
holes to the agent using it.** The model gets a contract violation back as a
tool result and can correct itself in the same turn — the write path becomes
self-teaching, and the model never has to have memorised the contract.

Nobody has shipped that. It is maybe 200 lines on top of what exists here.

---

## 7. Where this belongs, longer term

**As infrastructure — the missing primitive.** Every agent memory system on the
market optimises recall. None of them model absence. "Coverage accounting for
agent memory" is an unoccupied category, and it is more defensible than retrieval
quality because it is a *bookkeeping* problem, where determinism is an advantage
rather than a handicap.

**As a spec, not a library.** The distribution vehicle is `CONTRACT.md` plus the
L1–L4 conformance levels, not the TypeScript. A contract nobody can reimplement
is lock-in; L1 in a weekend is the design goal. If three unrelated systems
exchange atoms, the concept has won regardless of whose code runs.

**As the MCP server, right now.** The 2026-07-28 revision turned out to be a gift:
MRTR *is* the gap loop, and statelessness means the whole thing deploys as a
Worker with no session store. Any MCP client — Claude Code, Codex, Cursor —
gets the loop for one config line. That is the cheapest distribution this will
ever have, and it is already built.

**As a product, narrowly.** Not "AI memory." The wedge is regulated or
correctness-critical knowledge — support, compliance, internal policy — where
*"prove what your bot did not know"* is a purchasable sentence and the gap ledger
is an audit artifact. That framing sells the strongest component instead of the
weakest one.

### What would falsify all of this

- Anthropic ships schema validation and a gap counter on the memory tool
  → Tier 2 collapses into Tier 1 and only the contract survives as a spec.
- Model-native retrieval gets cheap enough that scope gating stops mattering
  → the deterministic gate loses its rationale, but gap *accounting* survives,
  since a model can report a miss just as well as a scorer can.
- Nobody answers the questions → the whole loop is theatre and the honest move
  is to say so and keep only the contract and the round-trip.

The first two would still leave the concept standing. The third would not.

---

## Sources

- [MCP versioning](https://modelcontextprotocol.io/specification/versioning) ·
  [2026-07-28 key changes](https://modelcontextprotocol.io/specification/2026-07-28/changelog) ·
  [MRTR](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr) ·
  [server/discover](https://modelcontextprotocol.io/specification/2026-07-28/server/discover)
- [The 2026-07-28 specification](https://blog.modelcontextprotocol.io/posts/2026-07-28/) ·
  [Cloudflare: the next generation of MCP](https://blog.cloudflare.com/mcp-v2/)
- [Memory tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool) ·
  [Context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing) ·
  [Managing context](https://claude.com/blog/context-management)
