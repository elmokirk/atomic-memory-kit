# PRODUCT

What Atomic Memory Kit is for, who uses it, where it stands in the market, and the requirements that follow from that. This file decides scope. [`CONCEPT.md`](CONCEPT.md) holds the portable idea, [`CONTRACT.md`](CONTRACT.md) the normative rules, [`docs/strategy/ROADMAP.md`](docs/strategy/ROADMAP.md) the order of work. If a plan or feature contradicts this file, this file wins or gets changed first.

Revision 2026-10-05. Replaces the earlier direction of a Claude Code companion product; the reasons are in [the plan review](docs/strategy/reviews/PLAN-REVIEW-2026-10-05.md) and in §4.

---

## 1. In one sentence

> AMK is a retrieval engine for chatbots that answer from a small, curated knowledge base: no embeddings, no vector database, and a record of every question the knowledge base could not answer.

Second role, built on the same core: an add-on that gives existing memory systems (Mem0, Honcho, Claude Code memory) the things they do not ship: missed-retrieval tracking, retrieval regression tests, and write validation. **AMK does not compete with those systems as a memory store.**

## 2. The problems it solves

| Problem in a typical RAG chatbot | What AMK does |
|---|---|
| The bot answers confidently when nothing relevant was retrieved | Deterministic scope gate: `no_match` before any model is called |
| Nobody sees which customer questions go unanswered | Gap ledger: deduplicated, counted, ranked by recurrence, reopens when a fix did not work |
| A price changes on the website, the bot keeps quoting the old one | Drift check: numbers in an external source against the atom that backs them |
| Retrieval cannot be explained or regression-tested | Score breakdown per atom; eval cases with must-retrieve and must-not-retrieve |
| Embedding pipeline, vector store, per-query cost, index rebuilds | None. Markdown files, zero runtime dependencies, sub-millisecond at a few hundred atoms |
| The knowledge base is a pile nobody can review | One fact per file, a validated contract, a lossless single-document bundle a non-engineer can edit and hand back |

## 3. Core features

Status is honest: *built* means it exists with tests; *fix* means it exists but a confirmed defect affects it ([red-team register](docs/strategy/reviews/RED-TEAM.md)); *planned* means it does not exist yet.

| Feature | Status |
|---|---|
| Atom contract with validator (core, standard, extension fields; errors vs warnings) | built |
| Deterministic retrieval with scope gate, synonyms, German/English folding | built |
| Context budget for the prompt | fix (first result can exceed it, R07) |
| Gap ledger with six detectors (runtime, scope, eval, drift, todo, cycle/orphan) | built |
| Streaming gap marker for chatbot output (`[GAP: topic]`) | fix (markers lost or split across chunks, R01-R03) |
| Eval with baseline regression | fix (hit rate can exceed 1, forbidden hits do not fail, R10-R11) |
| Drift check against an external claims map | built (exit code wrong, S07) |
| Bidirectional bundle: compile, edit, import, validate | built |
| CLI and MCP server (stdio) | built |
| MCP over HTTP | fix (binds all interfaces, writes without token, R16) |
| Durability and provenance fields, expiry (contract 1.1.0) | built |
| Memory-tool backend for the Claude API | built (path handling unreviewed, S06) |
| Backend adapter interface plus a Mem0 adapter | planned |
| Honcho and Claude Code memory adapters | planned, demand-led |

## 4. Where it is used

**Primary: chatbots on curated knowledge.** A company website, a product or support assistant, a configurator, an internal FAQ: a few dozen to a few hundred facts, which change on business events, and where a wrong answer costs a customer. The user is a developer or agency building that chatbot, including the owner's own client projects. AMK is a component inside their stack, called before the model.

**Secondary: an add-on for existing memory systems.** A team already runs Mem0, Honcho, or Claude Code auto memory. AMK wraps that system's search to record misses, runs regression tests against it, and can validate writes before they reach it. The memory system stays authoritative for its own records.

**Not for:**

- Episodic or conversational memory ("the user said X on Tuesday"). Mem0, Honcho and native agent memory do this; AMK refuses volatile writes by contract.
- Large document corpora or unreviewed content. Past roughly 500 atoms, deterministic retrieval needs an index, and past a few thousand, embeddings.
- Fuzzy questions in vocabulary that appears nowhere in the atoms, and CJK text.
- A hosted chatbot product. AMK has no UI, no hosting, no model calls.

## 5. Market positioning

Sources and dates for every external statement here are in [`LINKMAP.md`](LINKMAP.md) §7.

| Category | Examples | What they have | Where AMK stands |
|---|---|---|---|
| Hosted chatbot platforms | Intercom Fin, Chatbase | Unresolved-question reports (Chatbase only on its top plan); closed SaaS | AMK is not a platform. It gives developers the same gap signal inside their own stack, open source, deterministic |
| RAG frameworks | general retrieval libraries | Embedding retrieval, many integrations | Different trade: small curated knowledge, explainable scores, loud misses. We have not checked whether any of them ships a gap ledger; no absence claim is made |
| Agent memory systems | Mem0, Honcho, GBrain, Claude Code memory | Storage, extraction, retrieval of conversational and personal memory | **Not a competitor.** AMK adds missed-retrieval tracking, regression tests and write validation to them |
| Memory audit tools | cc-memory-view, memory-hygiene | Read-only checks of Claude Code memory | Not pursued; already covered |

**Positioning statement:**

> For developers who build chatbots on a small, curated knowledge base, AMK is an open-source retrieval engine that never answers from nothing and tells you which questions your knowledge base is missing. Unlike RAG pipelines it needs no embeddings or vector database; unlike hosted chatbot platforms it runs inside your own stack.

**Business model.** MIT open source. Value is captured through chatbot projects and services built with it, not through a paid tier or SaaS. No enterprise features are built without a paying customer who needs them.

**What is not claimed.** That AMK answers better than RAG in general, that competitors lack any specific feature beyond what [`LINKMAP.md`](LINKMAP.md) §7 records, or that it scales beyond the ceiling in [`LIMITATIONS.md`](LIMITATIONS.md).

## 6. Requirements derived from this

### Code quality

| Requirement | Why it follows | Check |
|---|---|---|
| Zero runtime dependencies; backend SDKs are never dependencies | A chatbot component must not drag a stack into the host | `package.json` has empty `dependencies` |
| `src/` pure, no I/O; adapters hold all I/O | Deterministic tests; portable core (CLAUDE.md rule 2) | Import review |
| Safe by default: loopback-only HTTP, token required for writes over HTTP, every path confined to its root including symlinks | A chatbot backend sits next to a public web server | One test per rule |
| Streaming output is lossless and every gap marker is detected at any chunk split | Chatbots stream; a lost marker is a lost customer question | Split-point tests |
| Context budget is a hard limit or reports overflow | The host pays per token and has a context window | Budget tests |
| Metrics stay in range; forbidden retrievals fail on their own | Eval is the regression gate for knowledge changes | Eval tests |
| Every confirmed defect gets a failing test before its fix | The project's claim is verifiability | Red-team register links |
| Round-trip and contract rules unchanged (CLAUDE.md rules 1-4) | The bundle workflow depends on them | Existing suite |
| An adapter is one small module behind one interface, with a fake-backend test and one recorded real-backend run | Adapters break when the host changes; small is maintainable | Per-adapter review |

### Usability

| Requirement | Check |
|---|---|
| From a fresh clone to a first retrieval with a gap recorded in under 15 minutes, with no more than three documents read | Timed walk-through by someone who did not write it |
| The quickstart leaves the repository unchanged | `git status` clean after the quickstart |
| `npm run check` works from a fresh clone | CI or manual run |
| Node version checked at startup with a clear message (floor 22.18.0) | Run on an older Node |
| Exit codes are meaningful: any error finding exits non-zero | CLI tests |
| Error messages name the file, line and fix | Validator output review |
| One integration guide per surface (library in a chatbot, MCP, each adapter), each runnable as written | Execute every guide before release |
| README leads with what it is for, a runnable chatbot example, and the limits | Review against §1 and §4 |

### Implementation

- **Adapter interface.** The host supplies a search function that returns candidates with an id, text and score; optionally a write function. AMK wraps it with gap recording, eval and write validation. No adapter writes into a foreign store without passing the contract and an explicit opt-in.
- **Backends over HTTP or caller-injected functions**, never bundled SDKs. Pin the tested backend version in the adapter's guide.
- **First adapter: Mem0.** Apache-2.0, widely used, and its documentation shows no missed-retrieval tracking. Honcho (AGPL-3.0, already ships its own Claude Code plugin) and Claude Code memory follow only on demand.
- **No new retrieval algorithm** until a real chatbot's eval shows misses the current scorer cannot fix with keywords and synonyms.
- **No npm package** until a build step that emits JavaScript is justified; Node does not strip types under `node_modules`.

## 7. Open decisions

| Decision | Default until the owner decides |
|---|---|
| Which real chatbot is the reference deployment for measuring value | None; Phase 2 uses the `example/` memory and a synthetic chat script |
| Mem0 edition (open source or platform) for the first adapter | Open source, self-hosted |
| Whether the Honcho or Claude Code memory adapter is built at all | Not built |
