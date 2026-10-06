# Mem0

## Entry check (2026-10-06)

Recorded before building, as [the MVP batch](strategy/batches/MVP.md) I6 requires.

| Item | Result |
|---|---|
| Pinned version | `mem0ai` 2.2.1, mem0 repository commit `94c3fe9` (2026-09-25) |
| Official REST server with Ollama | Not possible without code changes. `server/main.py` hard-codes `openai` as the startup LLM and embedder, and `POST /configure` rejects any provider outside `BUNDLED_LLM_PROVIDERS = ("openai", "anthropic", "gemini")` and `BUNDLED_EMBEDDER_PROVIDERS = ("openai", "gemini")`. The server image does not install the `ollama` package. |
| How it was run instead | The `mem0ai` library from the same commit in a Python 3.12 virtualenv, behind a stdlib HTTP wrapper that copies the server's `POST /memories` and `POST /search` request and response shapes (below) |
| Search shape | `POST /search` `{query, filters: {user_id \| agent_id \| run_id}, top_k?, threshold?}` returns `{"results": [{id, memory, score, hash, metadata, created_at, updated_at, user_id, ...}]}` |
| Add shape | `POST /memories` `{messages: [{role, content}], user_id \| agent_id \| run_id, metadata?, infer?}` returns `{"results": [{id, memory, event: "ADD"}]}`; at least one identifier is required (400 otherwise) |
| Does Mem0 record searches that returned nothing? | No. `Memory.search` returns `{"results": []}` and records nothing; its telemetry event `mem0.search` carries limit, threshold and filter keys, not the result count; the server's `request_logs` table stores method, path, status, latency and auth type only. Entry check passed. |
