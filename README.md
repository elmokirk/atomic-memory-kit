# Atomic Memory Kit

AMK is a retrieval engine for chatbots that answer from a small, curated
knowledge base: no embeddings, no vector database, and a record of every
question the knowledge base could not answer.

| Problem in a typical RAG chatbot | What AMK does |
|---|---|
| The bot answers confidently when nothing relevant was retrieved | `no_match` before any model is called |
| Nobody sees which questions go unanswered | A gap ledger: deduplicated, counted, reopened when a fix did not work |
| A price changes on the website, the bot keeps quoting the old one | A drift check of external numbers against the atoms that back them |
| Retrieval cannot be explained or regression-tested | A score per atom; eval cases with must-retrieve and must-not-retrieve |
| Embedding pipeline, vector store, per-query cost | None. Markdown files, zero runtime dependencies |

It is a component you call before your model, not a chatbot product and not a
memory store for conversations. What it is for and what it is not:
[`PRODUCT.md`](PRODUCT.md).

---

## Try it in one minute

Requires Node 22.18 or newer. No install, no API key, no network.

```bash
git clone https://github.com/elmokirk/atomic-memory-kit.git
cd atomic-memory-kit
node example/chatbot/demo.mjs      # or: npm run demo
```

It loads the example memory, answers one question with a scripted model and
refuses another before any model call. Real output from a run (the
temp path differs per run and OS):

```
== Question 1 (in scope)
> How many seats do I get on Starter, and is SSO included?

scope: match, best score 4.5
atoms in the prompt:
  always  index.scope
     4.5  product.limits
     1.8  pricing.plans (via edge)
prompt: 1578 chars

answer shown to the user:
Starter includes 5 seats [[source:product.limits]]. Whether SSO is part of Starter is not in my memory, so I will not guess. I have passed the question on.

== Question 2 (out of scope)
> Give me a recipe for strawberry jam

scope: no_match, best score 0.1
model not called; the bot declines and the question is recorded

== Gap ledger
/tmp/amk-demo-XXXXXX/gaps.jsonl
  runtime  sso on the starter plan  (seen 1x)
  scope    give me a recipe for strawberry jam  (seen 1x)

model calls: 1
```

The model wrote `[GAP: SSO on the Starter plan]`, split across three stream
chunks. The user never sees it; the ledger records it. The ledger goes to a temp
directory, so the repository stays unchanged.

To use your own model, replace `callModel` in
[`example/chatbot/demo.mjs`](example/chatbot/demo.mjs): it receives the system
prompt and the question and yields text deltas. The repository ships no API
client. Wiring a real model properly: [`docs/INTEGRATION-LLM.md`](docs/INTEGRATION-LLM.md).

---

## Install

Node **22.18 or newer**, for native TypeScript type stripping; that is why there
is no build step. Zero dependencies, so there is nothing to `npm install`.

```bash
npm link                 # optional: puts `amk` on your PATH
npm test                 # 275 tests
```

There is no npm package yet: use a clone, or copy `src/` and `adapters/` into
your project ([`docs/PORTING.md`](docs/PORTING.md)).

---

## Quickstart

```bash
cd example
node ../cli/amk.mjs validate    # 6 atoms, contract clean, graph intact
node ../cli/amk.mjs eval        # scope accuracy, hit rate, precision
node ../cli/amk.mjs drift       # finds the planted SLA contradiction, exits 1
node ../cli/amk.mjs compile     # writes bundle.md + compiled.json + digest.md
node ../cli/amk.mjs search "what does it cost"
```

Or all checks at once from the repository root: `npm run check`.

In your own project:

```bash
mkdir my-memory && cd my-memory
amk init                 # scaffolds memory/ + memory.config.json + eval cases
amk validate
```

---

## Limits

Read [`LIMITATIONS.md`](LIMITATIONS.md) before adopting. The short form:
retrieval is keyword-based, so a question phrased in vocabulary that appears in
no atom finds nothing;
past roughly 500 atoms it needs an index; runtime gaps appear only if your model
follows the marker instruction; the ledger is a file, not safe for concurrent
writers.

## Read next

1. [`PRODUCT.md`](PRODUCT.md): what it is for, who it is for, what is out of scope.
2. [`docs/INTEGRATION-LLM.md`](docs/INTEGRATION-LLM.md): putting it in front of a real model.
3. [`LIMITATIONS.md`](LIMITATIONS.md): every way it is wrong or weak.

Deeper: [`CONCEPT.md`](CONCEPT.md) (the portable idea),
[`CONTRACT.md`](CONTRACT.md) (atom rules, contract `1.1.0`),
[`docs/MCP.md`](docs/MCP.md) (MCP server), [`docs/MEMORY-TOOL.md`](docs/MEMORY-TOOL.md)
(Anthropic memory-tool backend), [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md),
[`SOURCEMAP.md`](SOURCEMAP.md) (provenance and verification),
[`LINKMAP.md`](LINKMAP.md) (sources for every external claim).

---

## The full loop, concretely

```bash
# 1. An agent hits a hole while working. Recorded:
amk gaps add "SSO pricing on the Growth plan" --kind runtime

# 2. Structural detectors add their own findings:
amk eval      # curated questions that stopped retrieving
amk drift     # claims in a source of truth with no backing atom
amk expiring  # atoms whose validUntil has passed — still served, now suspect
amk gaps      # TODO markers, graph orphans, cycles

# 3. Compile everything the memory knows + everything it is missing:
amk compile
#    → .memory-out/bundle.md      one editable file, gaps as checkboxes
#    → .memory-out/compiled.json  machine transport
#    → .memory-out/digest.md      skimmable overview

# 4. Send bundle.md to whoever holds the knowledge. They read it, paste in a
#    new atom block, tick the gaps they closed. No repo access needed.

# 5. Fan it back out:
amk import bundle.md      # writes atom files, closes ticked gaps
amk validate              # contract + graph must be clean
amk eval                  # retrieval must not have regressed
```

Step 4 is the point of the whole design. The person who knows the answer is
usually not the person who wants to touch four hundred files.

---

## Commands

| Command | What it does |
|---|---|
| `amk init` | Scaffold a memory root, config and starter eval cases |
| `amk validate [--strict]` | Load, verify the contract, verify graph integrity |
| `amk stats` | Atom counts, categories, edges, orphans, budget health |
| `amk search <query> [--context /path]` | Retrieve with visible scores |
| `amk compile [--gaps false]` | Write bundle + compiled JSON + digest |
| `amk import <file>` | Bundle or JSON back into atom files; close ticked gaps |
| `amk index` | Regenerate the always-injected scope index atom |
| `amk eval [--update-baseline]` | Run eval cases; record failures as gaps |
| `amk drift` | Check external claims against atoms |
| `amk expiring [--within N]` | Atoms past `validUntil`, plus what goes stale in N days |
| `amk contract [--json]` | Print the field table, or the machine-readable descriptor |
| `amk gaps [--report <file>]` | Refresh structural detectors; show or write the report |
| `amk gaps add <topic> --kind k` | Record a gap by hand |
| `amk gaps sync <file>` | Read ticked checkboxes back; close those gaps |
| `amk doctor` | validate + eval + drift + gap summary in one run |

Global flags: `--config <file>` `--root <dir>` `--out <dir>` `--json` `--force`
`--dry-run`

---

## Library use

```ts
import { loadMemory, searchMemory, defineMemoryConfig } from 'atomic-memory-kit'
import { readMemoryDir } from 'atomic-memory-kit/adapters/fs'

const config = defineMemoryConfig({
  categories: ['product', 'pricing', 'process'],
  minScore: 3,
  maxChunks: 4,
  charBudget: 2500,
})

const { base, warnings } = loadMemory(readMemoryDir('./memory'), config)
const result = searchMemory(base, userQuestion, { context: '/pricing' })

if (result.scopeStatus === 'no_match') {
  // Deterministic: nothing scored above the threshold. Record it and refuse.
}
```

Gap detection during streaming:

```ts
import { createGapDetector } from 'atomic-memory-kit'

const detector = createGapDetector()
const record = ({ text, topics }) => {
  for (const topic of topics) ledger.observe({ kind: 'runtime', topic, source: route })
  send(text)                     // the user never sees the marker
}
for await (const delta of modelStream) record(detector.write(delta))
record(detector.end())           // releases text held back at the stream's end
```

The marker survives being split across deltas — that is the normal case with
token streaming, and it is covered by tests.

---

## The loop, in one call

The 2026-07-28 MCP revision introduced Multi Round-Trip Requests, which happen to
be exactly this system's core workflow:

```
gap found ──► agent asks the human ──► human answers ──► restructured into atoms
```

`memory_close_gaps` returns `resultType: "input_required"` with one elicitation
per open gap. The client collects answers and retries the same call with
`inputResponses`; the server turns them into contract-checked atom proposals and
returns a diff. No session, no sticky routing — the retry may land on a different
process.

```bash
node agent/mcp-server.mjs --config ./memory.config.json            # stdio
node agent/mcp-server.mjs --config ./memory.config.json --http 8787 # streamable HTTP, 127.0.0.1 only
```

---

## Layout

```
src/                pure engine — no I/O, no framework, no network
  types.ts            contract types
  config.ts           defaults + language profile
  parse-frontmatter.ts YAML subset parser
  contract.ts         the contract as data — imports nothing, everything imports it
  schema.ts           contract enforcement (derived from contract.ts)
  loader.ts           parse + validate + index + graph integrity  ← trust boundary
  score.ts            normalize · stem · tokenize · scoreAtom
  search.ts           scope gate, budget, 1-hop edge expansion
  compile.ts          compile · decompile · bundle · digest · scope index
  gaps.ts             marker protocol, streaming detector, ledger, reports
  eval.ts             retrieval evaluation + baseline regression
  drift.ts            external claim verification
  restructure.ts      material -> validated atom proposals (the inbound direction)
  memory-tool.ts      Anthropic memory-tool commands, contract-gated
  expiry.ts           validUntil vs. an injected clock -> expiry gaps
adapters/           fs.ts + memory-tool.ts — the only files that touch I/O
cli/                thin shell over src/
agent/              skills, MCP server (2026-07-28), AGENTS.md snippet
docs/               deep dives + porting guide + MCP reference
example/            working memory with planted gaps
  chatbot/demo.mjs    the one-minute demo: retrieval, scope gate, streamed gap
tests/              275 tests, node:test, zero deps
```

---

## Design commitments

- **`src/` is pure.** No I/O, no framework, no network. It runs in Node, Deno,
  Bun, a browser, a worker, an edge runtime. Hosts differ only in how bytes
  arrive.
- **The loader is the trust boundary.** After it returns, every atom satisfies
  the contract and every `related[]` edge resolves. Downstream code may assume it.
- **Round-trip is tested, not assumed.** `compile → decompile → load` is verified
  against fixtures containing quotes, umlauts, colons, `"1500"`, and multiline
  values.
- **Failures are loud.** Broken core fields and dangling edges refuse to load. A
  memory that half-loads is worse than one that will not load, because the agent
  keeps answering from a subset nobody noticed shrank.
- **Forward compatible.** Unknown categories, intents and fields warn instead of
  breaking.

---

## Relationship to a memory *layer*

This is an **engine**, not a filing system. It does not tell you where sessions,
decisions or handoffs live. If you already run a memory layer — Owledge, a
`.memory/` convention, an Obsidian vault, a `CLAUDE.md` hierarchy — point this at
its knowledge directory and let the layer keep owning structure.

See [`docs/PORTING.md`](docs/PORTING.md) for embedding it into an existing project,
and [`agent/`](agent/) for Claude Code and MCP integration.

## License

MIT.
