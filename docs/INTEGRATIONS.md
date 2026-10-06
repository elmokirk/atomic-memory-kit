# Integrations

Four ways to attach this memory to an agent. Pick by where the agent runs, not by
preference — the choice is mostly made for you.

| Surface | Transport | Network | Auth | Guide |
|---|---|---|---|---|
| **Claude Code** | plugin, MCP over stdio | none | none needed | [§1](#1-claude-code-stdio) |
| **Claude Cowork / claude.ai / Desktop** | MCP over HTTPS | **public** | required | [§2](#2-cowork-claudeai-and-desktop-connector) |
| **Anthropic API agents** | memory tool handler | none | yours | [§3](#3-the-memory-tool-handler) |
| **Your own code** | library import | none | none | [§4](#4-library) |

The one constraint that decides most of this:

> **Custom connectors are dialled from Anthropic's cloud, not from your machine —
> even when Cowork or Desktop runs locally.** `localhost` is unreachable to them.
> Local stdio servers configured through `claude_desktop_config.json` are a
> different mechanism and are not available in Cowork or on claude.ai.
>
> So anything hosted needs a public HTTPS URL, and therefore authentication,
> because `memory_apply` writes files.

---

## 1. Claude Code (stdio)

No network, no tunnel, no token.

The plugin connects Claude Code to a curated knowledge base with gap tracking.
It sits next to Claude Code's own memory (`CLAUDE.md`, auto memory) and does not
replace or read it.

### 1.1 Plugin (recommended)

Two commands in a Claude Code session:

```text
/plugin marketplace add elmokirk/atomic-memory-kit
/plugin install amk@atomic-memory-kit
```

From a shell, the same is `claude plugin marketplace add elmokirk/atomic-memory-kit`
and `claude plugin install amk@atomic-memory-kit`. Restart the session; the
server appears in `/mcp` and `claude mcp list` as `plugin:amk:memory`, and its
tools are named `mcp__plugin_amk_memory__memory_search` and so on.

Requirements and defaults:

| Item | Value |
|---|---|
| Node | >= 22.18 on `PATH`. The plugin runs `node` from your environment; the server exits with a message on older versions |
| Memory | `memory.config.json` in the project root. Without it, every tool call answers with `no memory config at <path>` and what to do. Copy `example/memory.config.json` as a start |
| Writes | **Off.** `memory_apply`, `memory_gap_add`, `memory_gap_close` and `memory_close_gaps` with `autoApply` are refused by the server |

Two plugin options, set in `/plugin` or `/config`, or from a shell:

| Option | Default | Effect |
|---|---|---|
| `config` | `memory.config.json` | Path to the config, relative to the project root. To use a memory outside the project, keep a config in the project and make its `root` and `gapLedger` absolute |
| `allow_writes` | `false` | `true` lets the write tools above change atoms and the gap ledger |

```bash
echo '{"allow_writes":"true"}' | claude plugin configure amk@atomic-memory-kit --values-stdin
```

Restart Claude Code after changing an option. With writes off, the agent can
still search and report a `no_match`, but cannot record the gap; that is the
price of the safe default.

Uninstall with `/plugin uninstall amk@atomic-memory-kit`. It removes the
plugin's install record, options and data directory; your memory files, gap
ledger, auto memory and other plugins are not touched.

The plugin's root is this repository's root, because the server imports `src/`
and `adapters/`, and a plugin cannot reference files above its own root.
Installing therefore copies the whole repository into Claude Code's plugin cache.

### 1.2 Manual (fallback)

For a checkout you manage yourself, or a client without plugin support:

```bash
claude mcp add memory -- node /abs/path/agent/mcp-server.mjs --config /abs/path/memory.config.json
```

This route keeps writes on, as before the plugin. Add `--allow-writes false` to
make it read-only. Use absolute paths — the server is launched from an
unspecified working directory. Verify with `/mcp` in a session, or:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"server/discover","params":{}}' \
  | node agent/mcp-server.mjs --config ./memory.config.json
```

You should see `"resultType":"complete"` and the supported protocol versions.

**First thing to tell the agent:** *read `memory_contract` before writing any
atom.* It is one cacheable call, and an agent authoring from a remembered
contract writes invalid atoms.

---

## 2. Cowork, claude.ai, and Desktop (connector)

### 2.1 Run the server

```bash
cd /path/to/your/memory-project

AMK_AUTH_TOKEN="$(openssl rand -hex 32)" \
AMK_STATE_SECRET="$(openssl rand -hex 32)" \
node /path/to/atomic-memory-kit/agent/mcp-server.mjs \
  --config ./memory.config.json \
  --http 8787
```

| Variable | Why |
|---|---|
| `AMK_AUTH_TOKEN` | Bearer token, compared in constant time. Without it, the writing tools are refused over HTTP and read tools are open to whoever reaches the port. The server binds `127.0.0.1` unless `--host` says otherwise. |
| `AMK_STATE_SECRET` | Signs the MRTR `requestState`. Required across replicas, or gap-closing retries fail when a retry lands on a different process. |

Note the token — you need it in 2.3.

### 2.2 Expose it over HTTPS

```bash
cloudflared tunnel --url http://localhost:8787
# or
ngrok http 8787
```

In production, put it behind your normal ingress. The server is stateless — no
session store, no sticky routing — so N replicas behind round-robin behave
identically to one, provided they share `AMK_STATE_SECRET`.

### 2.3 Add the connector

Settings → **Connectors** → **Add custom connector**. If asked for a type, choose
**Web**.

| Field | Value |
|---|---|
| **Name** | `Atomic Memory` (display only) |
| **Remote MCP server URL** | `https://your-host/` |
| Advanced → OAuth Client ID | leave empty |
| Advanced → OAuth Client Secret | leave empty |

**Team / Enterprise:** only Owners can add connectors, under Organization
settings → Connectors. Members then enable it individually.

### 2.4 Getting the token in

This server uses a static bearer token, not OAuth, and the connector dialog has
no header field. Terminate auth at your proxy — the token then never leaves your
infrastructure:

```nginx
location /amk/ {
    proxy_set_header Authorization "Bearer YOUR_TOKEN";
    proxy_pass http://127.0.0.1:8787/;
}
```

Connector URL becomes `https://your-host/amk/`.

### 2.5 Verify before trusting it

```bash
curl -X POST https://your-host/ \
  -H 'content-type: application/json' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'Mcp-Method: server/discover' \
  -d '{"jsonrpc":"2.0","id":1,"method":"server/discover",
       "params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28"}}}'
```

Expect `"resultType":"complete"`. Then in Cowork: *"list what the memory
covers"* → should call `memory_scope`.

| Symptom | Cause |
|---|---|
| `401` | Token is not arriving — check the proxy header |
| `405` | Something rewrote POST into GET; this server is POST-only |
| `-32022` | Client sent a protocol version the server does not support |
| `-32020` | `Mcp-Method` / `Mcp-Name` header disagrees with the body |

### 2.6 Notes

- **Transport:** Streamable HTTP, POST-only. SSE is deprecated; do not configure it.
- **No edit option.** Changing a connector URL means removing and re-adding it.
- **Free plan** allows one custom connector.

---

## 3. The memory tool handler

For agents built on the Anthropic API with `{"type": "memory_20250818", "name":
"memory"}`. The handler is client-side by design, so it can be backed by the
contract instead of a filesystem:

```js
import { createMemoryToolHandler } from 'atomic-memory-kit/adapters/memory-tool'
import { defineMemoryConfig } from 'atomic-memory-kit'

const memory = createMemoryToolHandler({
  root: './memory',
  gapLedger: './.memory-out/gaps.jsonl',
  config: defineMemoryConfig({ categories: ['pricing', 'product'] }),
})

// in the tool-use loop, for each tool_use block named "memory":
const { content, is_error } = memory.handle(block.input)
```

A `view` of a path that does not exist becomes a recorded gap; an invalid write
is refused with its diagnostic so the model self-corrects; a `delete` that would
orphan an edge is refused; a `rename` rewrites inbound references.

Full behaviour and limits: [`MEMORY-TOOL.md`](MEMORY-TOOL.md).

---

## 4. Library

No agent at all — just the engine:

```ts
import { loadMemory, searchMemory, defineMemoryConfig } from 'atomic-memory-kit'
import { readMemoryDir } from 'atomic-memory-kit/adapters/fs'

const config = defineMemoryConfig({ categories: ['product', 'pricing'] })
const { base } = loadMemory(readMemoryDir('./memory'), config)
const result = searchMemory(base, question, { context: '/pricing' })

if (result.scopeStatus === 'no_match') {
  // Deterministic: nothing scored above the threshold. Record it and refuse.
}
```

Embedding into an existing project, including framework pitfalls:
[`PORTING.md`](PORTING.md).

---

## 5. Choosing between them

**Both a connector and stdio?** Yes, and it is the normal setup: stdio for your
own machine, a connector for Cowork. They are separate processes over the same
files. Note there is no locking — do not run a write-heavy session in both at
once.

**Connector *and* memory tool?** Only if the agent is on the API. The connector
gives an agent explicit tools it chooses to call; the memory tool bridge makes
the store the agent's `/memories`, always present. The bridge is more invasive
and more automatic — pick it when you want every write gated, not when you want
memory to be one capability among many.

---

## 6. Security posture, stated plainly

| | Risk |
|---|---|
| stdio | Whatever can spawn the process can read and write the memory. Same as any local file. |
| HTTP without `AMK_AUTH_TOKEN` | Writes are refused. Anyone who can reach the port can read the memory; by default that is only this machine (`127.0.0.1`). |
| HTTP with the token | One static shared secret. No OAuth, no per-tool permissions, no rate limiting, no audit of who wrote what. |
| Tunnel in development | Your memory is on the public internet for the life of the tunnel. |

For anything beyond a single trusted operator, terminate auth at a gateway and
put the server on a private network. See `LIMITATIONS.md` § *The MCP server*.

---

*Connector mechanics retrieved 2026-08-29:
[Get started with custom connectors using remote MCP](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp) ·
[Use connectors to extend Claude's capabilities](https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities) ·
[Third party connectors with remote MCP](https://claude.com/docs/connectors/custom/remote-mcp)*
