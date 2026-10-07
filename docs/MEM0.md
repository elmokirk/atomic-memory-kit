# Mem0

AMK wraps a running [Mem0](https://github.com/mem0ai/mem0) open-source
instance: it records searches that found nothing as gaps, runs eval cases
against Mem0's search, and can refuse a write that breaks the atom contract
before Mem0 sees it. Mem0 stays the store; AMK never updates or deletes in it.

| Whose behaviour | What |
|---|---|
| Mem0 | Storing, embedding, extracting memories with its LLM (`infer`), searching, scoring, its own score floor (`threshold`, default 0.1) |
| AMK, [`src/backend.ts`](../src/backend.ts) | Deciding that a search was a miss (the threshold you set), recording the `scope` gap, eval metrics, the contract and durability check before a write |
| AMK, [`adapters/mem0.ts`](../adapters/mem0.ts) | `POST /search` and `POST /memories` over `fetch`; maps a result to `{id, text, score}`, preferring `metadata.amk_id` over Mem0's uuid |

## Entry check (2026-10-06)

Recorded before building, as [the MVP batch](strategy/batches/MVP.md) I6 requires.

| Item | Result |
|---|---|
| Pinned version | `mem0ai` 2.2.1, repository commit `94c3fe9f238f3dbf29c9ce98643bd71eb13077cd` (2026-09-25) |
| Official REST server with Ollama | Not possible without code changes. `server/main.py` hard-codes `openai` as the startup LLM and embedder, and `POST /configure` rejects any provider outside `BUNDLED_LLM_PROVIDERS = ("openai", "anthropic", "gemini")` and `BUNDLED_EMBEDDER_PROVIDERS = ("openai", "gemini")`. The server image does not install the `ollama` package. |
| How it was run instead | The `mem0ai` library from that commit in a Python 3.12 virtualenv, behind the stdlib wrapper below, which copies the server's `POST /memories` and `POST /search` request and response shapes |
| Search shape | `POST /search` `{query, filters: {user_id \| agent_id \| run_id}, top_k?, threshold?}` returns `{"results": [{id, memory, score, hash, metadata, created_at, updated_at, user_id, ...}]}`, best first |
| Add shape | `POST /memories` `{messages: [{role, content}], user_id \| agent_id \| run_id, metadata?, infer?}` returns `{"results": [{id, memory, event: "ADD"}]}`; at least one identifier is required (400 otherwise) |
| Does Mem0 record searches that returned nothing? | No. `Memory.search` returns `{"results": []}` and keeps nothing; its telemetry event `mem0.search` carries limit, threshold and filter keys, not the result count; the server's `request_logs` table stores method, path, status, latency and auth type only. Entry check passed. |

## Run it locally

Tested on Windows 11 with Git Bash; the commands are POSIX shell and the
`PY=` line picks the right interpreter path on Linux and macOS. Needs Node
22.18 or newer, `git`, [uv](https://docs.astral.sh/uv/) and
[Ollama](https://ollama.com) with two models:

```bash
ollama pull qwen3.5:4b
ollama pull nomic-embed-text:v1.5
```

Everything below lives in a work directory outside this repository. Set `AMK`
to the absolute path of your clone of it.

```bash
AMK="$HOME/atomic-memory-kit"            # adjust
mkdir amk-mem0 && cd amk-mem0
git clone https://github.com/mem0ai/mem0 && git -C mem0 checkout 94c3fe9f238f3dbf29c9ce98643bd71eb13077cd
uv venv --python 3.12 venv
uv pip install --python venv ./mem0 "ollama>=0.3.0"
PY=venv/bin/python; [ -x venv/Scripts/python.exe ] && PY=venv/Scripts/python.exe
```

### 1. Start Mem0 (Mem0's behaviour)

The wrapper listens on `127.0.0.1:18888` without auth, stores in
`./mem0-data`, and turns Mem0's anonymous telemetry off unless you set
`MEM0_TELEMETRY` yourself.

```bash
cat > serve.py <<'EOF'
"""POST /memories, /search and /reset over the mem0ai library, with the request
and response shapes of mem0's server/main.py. Loopback only, no auth."""
import json
import os

os.environ.setdefault("MEM0_TELEMETRY", "false")  # read by mem0 at import
from http.server import BaseHTTPRequestHandler, HTTPServer

from mem0 import Memory

ROOT = os.environ.get("MEM0_DATA", os.path.join(os.getcwd(), "mem0-data"))
OLLAMA = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
DIMS = int(os.environ.get("MEM0_DIMS", "768"))
memory = Memory.from_config({
    "llm": {"provider": "ollama", "config": {"model": os.environ.get("MEM0_LLM", "qwen3.5:4b"), "ollama_base_url": OLLAMA, "temperature": 0}},
    "embedder": {"provider": "ollama", "config": {"model": os.environ.get("MEM0_EMBEDDER", "nomic-embed-text:v1.5"), "ollama_base_url": OLLAMA, "embedding_dims": DIMS}},
    "vector_store": {"provider": "qdrant", "config": {"path": os.path.join(ROOT, "qdrant"), "on_disk": True, "embedding_model_dims": DIMS, "collection_name": "memories"}},
    "history_db_path": os.path.join(ROOT, "history.db"),
})


class Handler(BaseHTTPRequestHandler):
    def reply(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        req = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        scope = {k: req[k] for k in ("user_id", "agent_id", "run_id") if req.get(k)}
        try:
            if self.path == "/memories":
                if not scope:
                    return self.reply(400, {"detail": "At least one identifier (user_id, agent_id, run_id) is required."})
                extra = {k: req[k] for k in ("metadata", "infer") if req.get(k) is not None}
                return self.reply(200, memory.add(messages=req["messages"], **scope, **extra))
            if self.path == "/search":
                extra = {k: req[k] for k in ("top_k", "threshold") if req.get(k) is not None}
                filters = {**(req.get("filters") or {}), **scope}
                return self.reply(200, memory.search(query=req["query"], filters=filters, **extra))
            if self.path == "/reset":
                memory.reset()
                return self.reply(200, {"message": "Reset all memories"})
            return self.reply(404, {"detail": "Not Found"})
        except ValueError as e:
            return self.reply(400, {"detail": str(e)})


port = int(os.environ.get("PORT", "18888"))
print(f"mem0 wrapper on http://127.0.0.1:{port}", flush=True)
HTTPServer(("127.0.0.1", port), Handler).serve_forever()
EOF
"$PY" serve.py &
```

Wait for `mem0 wrapper on http://127.0.0.1:18888`. Mem0 also prints that spaCy
and fastembed are not installed, which disables its BM25 keyword boost and
leaves semantic search only. That is the configuration recorded here.

### 2. Point AMK at it (AMK's behaviour)

`run.mjs` writes four facts through `writeValidated`, searches twice through
`searchBackend`, and runs four eval cases through `runBackendEval`.

```bash
cat > run.mjs <<'EOF'
// AMK against a running Mem0. Usage: node run.mjs <path to atomic-memory-kit>
import { pathToFileURL } from 'node:url'

const repo = pathToFileURL(`${process.argv[2] ?? '.'}/`).href
const { createGapLedger, renderGapReport, runBackendEval, searchBackend, writeValidated, checkThresholds } = await import(`${repo}src/index.ts`)
const { createMem0Backend } = await import(`${repo}adapters/mem0.ts`)

const mem0 = createMem0Backend({ baseUrl: process.env.MEM0_URL ?? 'http://127.0.0.1:18888', userId: 'amk-demo', topK: 5 })
const threshold = Number(process.env.AMK_THRESHOLD ?? 0.6)

const facts = [
  { id: 'support.hours', title: 'Support hours', category: 'support', lang: 'en', keywords: ['support', 'hours'], body: 'The support desk is open Monday to Friday, 9:00 to 17:00 Berlin time.' },
  { id: 'shipping.eu', title: 'Shipping in the EU', category: 'shipping', lang: 'en', keywords: ['shipping', 'delivery'], body: 'Shipping inside the EU is free for orders over 50 EUR.' },
  { id: 'returns.window', title: 'Return window', category: 'returns', lang: 'en', keywords: ['return', 'refund'], body: 'Products can be returned within 30 days of delivery for a full refund.' },
  { id: 'session.note', title: 'Meeting', category: 'support', lang: 'en', durability: 'volatile', body: 'Call the customer back on Wednesday.' },
]
console.log('== validated writes')
for (const fact of facts) {
  const outcome = await writeValidated(mem0, fact)
  const errors = outcome.issues.filter((issue) => issue.severity === 'error').map((issue) => issue.code)
  console.log(`${fact.id}: ${outcome.written ? `written (${outcome.result.results.map((r) => r.event).join(',')})` : `refused ${errors.join(',')}`}`)
}

console.log(`\n== searches (threshold ${threshold})`)
const ledger = createGapLedger()
for (const q of ['When can I reach the support desk?', 'Can I pay with cryptocurrency?']) {
  const raw = await mem0.search(q)
  const result = await searchBackend(mem0, q, { threshold, ledger, source: 'mem0' })
  console.log(`${q}\n  mem0 returned: ${raw.map((c) => `${c.id}=${c.score.toFixed(3)}`).join(' ') || '(nothing)'}\n  AMK: ${result.scopeStatus}${result.gap ? `, gap: ${result.gap.detail}` : `, ${result.candidates.map((c) => c.id).join(',')}`}`)
}
console.log(`\n${renderGapReport(ledger.all()).split('\n').filter((line) => line.startsWith('- [') || line.startsWith('    ')).join('\n')}`)

console.log('\n== eval')
const summary = await runBackendEval(mem0, [
  { q: 'When can I reach the support desk?', expectScope: 'match', expectIds: ['support.hours'], mustNotRetrieve: ['shipping.eu'] },
  { q: 'Is delivery free within Europe?', expectScope: 'match', expectIds: ['shipping.eu'] },
  { q: 'How long do I have to send a product back?', expectScope: 'match', expectIds: ['returns.window'], mustNotRetrieve: ['shipping.eu'] },
  { q: 'Can I pay with cryptocurrency?', expectScope: 'no_match' },
], { threshold, source: 'mem0' })
console.log(JSON.stringify(summary, null, 2))
console.log(`checkThresholds: ${JSON.stringify(checkThresholds(summary))}`)
EOF
curl -s -X POST http://127.0.0.1:18888/reset; echo
node run.mjs "$AMK"
```

### 3. What you should see

Recorded on 2026-10-06 with mem0ai 2.2.1, Ollama 0.35.0,
`nomic-embed-text:v1.5` and Node 24.11.1. The writes use `infer: false`, so
the LLM is loaded but not called; the run takes about a second.

```text
== validated writes
support.hours: written (ADD)
shipping.eu: written (ADD)
returns.window: written (ADD)
session.note: refused E_DURABILITY_VOLATILE

== searches (threshold 0.6)
When can I reach the support desk?
  mem0 returned: support.hours=0.773 returns.window=0.506 shipping.eu=0.439
  AMK: match, support.hours
Can I pay with cryptocurrency?
  mem0 returned: shipping.eu=0.443 support.hours=0.404 returns.window=0.390
  AMK: no_match, gap: best score 0.443 < 0.6 across 3 candidate(s)

- [ ] `scope-73c28742` can i pay with cryptocurrency
      best score 0.443 < 0.6 across 3 candidate(s)

== eval
{
  "total": 4,
  "matchCases": 3,
  "scopeAccuracy": 1,
  "hitRate": 1,
  "precision": 1,
  "confusionPairs": [],
  "failures": []
}
checkThresholds: []
```

Read it as:

- `session.note` declares itself volatile and is refused with
  `E_DURABILITY_VOLATILE`; Mem0 receives no request for it.
- Mem0 does not say "nothing found" here: for the cryptocurrency question it
  returns all three memories, the best at 0.443. AMK's threshold of 0.6 turns
  that into an open `scope` gap. Without it, the caller would hand an
  unrelated shipping fact to the model.
- The eval passes `checkThresholds` with no violations. A threshold set too
  low shows what the eval is for:

  ```text
  $ AMK_THRESHOLD=0.4 node run.mjs "$AMK"
  ...
  checkThresholds: ["scopeAccuracy 0.75 < 0.95","precision 0.273 < 0.6",
    "forbidden retrieval: When can I reach the support desk? → shipping.eu",
    "forbidden retrieval: How long do I have to send a product back? → shipping.eu"]
  ```

Stop the wrapper with `kill %1` in the same shell. `rm -rf mem0-data` deletes
the stored memories.

## Use it in your own code

Import by path; there is no npm package yet.

```ts
import { createGapLedger, searchBackend, writeValidated } from './atomic-memory-kit/src/index.ts'
import { readGapLedger, writeGapLedger } from './atomic-memory-kit/adapters/fs.ts'
import { createMem0Backend } from './atomic-memory-kit/adapters/mem0.ts'

const mem0 = createMem0Backend({ baseUrl: 'http://127.0.0.1:18888', userId: 'support-bot' })
const ledger = createGapLedger(readGapLedger('gaps.jsonl'))
const { candidates } = await searchBackend(mem0, question, { threshold: 0.6, ledger, source: 'mem0' })
writeGapLedger('gaps.jsonl', ledger.all())
```

- **Threshold.** There is no default on purpose. Mem0's score depends on the
  embedder, and on whether fastembed is installed (then it is a semantic plus
  BM25 combination). Run your eval cases, look at `bestScore` for questions
  that should miss and for those that should hit, and set the threshold
  between the two. Retune after changing either.
- **The official server.** Pointed at `server/` of the same commit (port 8888,
  with an OpenAI, Anthropic or Gemini key), pass `apiKey`; it is sent as
  `X-API-Key`. The request shapes are the same, but the recorded run above
  used the wrapper, not the server.
- **Writes.** `writeValidated` is the only path that calls the adapter's
  `write`. It sends `infer: false`, so Mem0 stores the validated text as given
  and keeps `amk_id`, `category` and `durability` in `metadata`. With
  `infer: true` Mem0's LLM rewrites the text, and what is stored is no longer
  what was validated.
- **Eval ids.** A candidate's id is `metadata.amk_id` when present, otherwise
  Mem0's uuid. Memories added outside `writeValidated` have only the uuid, and
  a Mem0 reset changes it.

Limits: [LIMITATIONS.md](../LIMITATIONS.md#mem0-adapter). Sources:
[LINKMAP.md](../LINKMAP.md) §7.
