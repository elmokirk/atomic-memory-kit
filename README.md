# Atomic Memory Kit

**Bidirectional atomic memory for agents.** Store knowledge as small Markdown
atoms, compile the whole thing into one editable document, hand it to a human or
an agent, get it back, fan it out into atoms again — and along the way, record
everything the memory *did not* know.

Zero dependencies. No build step. No embeddings. No network.

```
atoms/ ──compile──► one bundle (+ open gaps) ──► human edits ──► import ──► atoms/
   ▲                                                                          │
   └────────────────────── validate: contract + graph ─────────────────────────┘
```

- **The concept** — [`CONCEPT.md`](CONCEPT.md). Portable, implementation-independent. Start here.
- **The limits** — [`LIMITATIONS.md`](LIMITATIONS.md). Read before adopting.
- **The rules** — [`CONTRACT.md`](CONTRACT.md). Contract `1.0.0`: dependencies, core rules, conformance levels.
- **The server** — [`docs/MCP.md`](docs/MCP.md). Stateless MCP, revision `2026-07-28`.
- **The comparison** — [`ANALYSIS-ANTHROPIC-MEMORY.md`](ANALYSIS-ANTHROPIC-MEMORY.md). Against Anthropic's memory stack, red-teamed.

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
node agent/mcp-server.mjs --config ./memory.config.json --http 8787 # streamable HTTP
```

---

## Quickstart

Requires **Node ≥ 22.6** (native TypeScript type stripping — that is why there is
no build step).

```bash
git clone <this-repo> && cd atomic-memory-kit
npm link                 # optional: puts `amk` on your PATH

cd example
node ../cli/amk.mjs validate    # 5 atoms, contract clean, graph intact
node ../cli/amk.mjs eval        # scope accuracy, hit rate, precision
node ../cli/amk.mjs drift       # finds the planted price inconsistency
node ../cli/amk.mjs compile     # writes bundle.md + compiled.json + digest.md
node ../cli/amk.mjs search "what does it cost"
```

In your own project:

```bash
mkdir my-memory && cd my-memory
amk init                 # scaffolds memory/ + memory.config.json + eval cases
amk validate
```

---

## The full loop, concretely

```bash
# 1. An agent hits a hole while working. Recorded:
amk gaps add "SSO pricing on the Growth plan" --kind runtime

# 2. Structural detectors add their own findings:
amk eval      # curated questions that stopped retrieving
amk drift     # claims in a source of truth with no backing atom
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
import { createGapDetector, stripGapMarkers } from 'atomic-memory-kit'

const detector = createGapDetector()
for await (const delta of modelStream) {
  for (const topic of detector.push(delta)) {
    ledger.observe({ kind: 'runtime', topic, source: route })
  }
  send(stripGapMarkers(delta))   // the user never sees the marker
}
```

The marker survives being split across deltas — that is the normal case with
token streaming, and it is covered by tests.

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
adapters/fs.ts      the only file that touches I/O
cli/                thin shell over src/
agent/              skills, MCP server (2026-07-28), AGENTS.md snippet
docs/               deep dives + porting guide + MCP reference
example/            working memory with planted gaps
tests/              110 tests, node:test, zero deps
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
