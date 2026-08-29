# MCP server — stateless, headless, 2026-07-28

```bash
node agent/mcp-server.mjs --config ./memory.config.json            # stdio
node agent/mcp-server.mjs --config ./memory.config.json --http 8787 # streamable HTTP
```

```bash
claude mcp add memory -- node /abs/path/agent/mcp-server.mjs --config /abs/path/memory.config.json
```

Zero dependencies. One file, ~700 lines, no SDK.

---

## Why the 2026 revision matters here

The [2026-07-28 revision](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
removed the `initialize` handshake and `Mcp-Session-Id`. There is no connection
state. Every request carries its own protocol version and client capabilities in
`_meta`, and any state a server needs across calls travels in an opaque,
integrity-protected `requestState` blob the client echoes back.

For this kit that is not an inconvenience to work around — it is the transport
the gap loop always wanted. The loop is:

```
  gap found  ->  ask the human  ->  human answers  ->  restructure into atoms
```

which is precisely Multi Round-Trip Requests. The server returns
`resultType: "input_required"` with one elicitation per gap, the client collects
answers, and retries the *same* tool call with `inputResponses` plus the
`requestState`. The server reconstitutes what it asked and produces a plan.

Two consecutive requests can land on different processes. Nothing is pinned.

```
Client                                   Server (any instance)
  │  tools/call memory_close_gaps          │
  ├───────────────────────────────────────►│  reads gap ledger
  │                                        │  signs {gaps, category, lang}
  │◄───────────────────────────────────────┤  input_required + requestState
  │  elicitation/create × N                │
  │                                        │
[ user answers ]                           │
  │  tools/call memory_close_gaps          │
  │    + inputResponses + requestState     │
  ├───────────────────────────────────────►│  verifies HMAC, TTL, tool binding
  │                                        │  → atom proposals → planApply()
  │◄───────────────────────────────────────┤  complete: a diff to approve
```

---

## Tools

| Tool | Direction | What it is for |
|---|---|---|
| `memory_contract` | — | The machine-readable contract. **Read before authoring atoms.** |
| `memory_scope` | read | Everything the memory covers, by category |
| `memory_search` | read | Deterministic retrieval + a `match` / `no_match` verdict |
| `memory_get` | read | One atom with its graph neighbours |
| `memory_compile` | **out** | Whole memory → bundle / json / digest |
| `memory_restructure` | **in** | Material → validated atom proposals (writes nothing) |
| `memory_apply` | **in** | Write proposals, all-or-nothing |
| `memory_gaps` | gaps | Open gaps, highest recurrence first |
| `memory_gap_add` | gaps | Record what the memory could not answer |
| `memory_gap_close` | gaps | Close one, with the atom that closed it |
| `memory_close_gaps` | **loop** | The whole ask→answer→restructure cycle, as one MRTR call |

### The contract tool is not optional

`memory_contract` returns field classes, types, severities, grammar patterns,
diagnostic codes, and which subsystem consumes which field. An agent that
authors atoms from a *remembered* contract writes invalid atoms; an agent that
reads this one cannot. It costs one call and it is cacheable.

### The two directions

```
memory_compile      atoms ──────────────► one document (+ open gaps inline)
memory_restructure  material ───────────► atom proposals
memory_apply        proposals ──────────► atoms on disk
```

`memory_restructure` has two modes, and the difference is honesty about who did
the thinking:

- **`atoms`** — you read the contract, did the semantic split yourself, and pass
  proposals. The server validates, diffs against the live memory, and returns a
  plan. This is the intended path.
- **`text`** — a purely *structural* split on markdown headings. It never invents
  keywords or summaries; it returns `needs: ["keywords", "summary"]` and
  `confidence: "structural"` so nothing downstream mistakes a draft for an atom.

There is no third mode where the server understands the content. This kit
contains no model.

### Nothing is written by accident

`memory_apply` refuses the entire batch unless every proposal is contract-clean
**and** the merged file set still loads with intact graph integrity. There is no
partial write. `memory_close_gaps` returns a plan rather than writing, unless you
pass `autoApply: true` — the default assumes a human should see the diff.

---

## Implemented from the revision

| Feature | Status |
|---|---|
| `server/discover` (mandatory) | yes, with `ttlMs` / `cacheScope` |
| Per-request `_meta` version + capabilities | yes |
| `resultType` on every result | yes |
| MRTR `input_required` / `inputResponses` | yes, in `memory_close_gaps` |
| Signed, TTL-bounded, tool-bound `requestState` | yes (HMAC-SHA256) |
| `Mcp-Method` / `Mcp-Name` validation, `-32020` | yes (HTTP) |
| `UnsupportedProtocolVersionError` `-32022` | yes, with `supportedVersions` |
| Cacheable list results | yes |
| Deterministic `tools/list` order | yes |
| Structured tool output (`structuredContent`) | yes |

### Deliberately not implemented

**`subscriptions/listen`.** This memory changes when a human edits files. A
long-lived notification stream would be infrastructure with nothing to carry;
clients re-read, and `ttlMs` tells them when.

**Sampling and Roots.** Both are Deprecated in this revision. This server never
asks a client to run a model — the semantic work happens agent-side by
construction.

**Resumability.** Removed from the transport. Every tool here is safe to
re-issue; `memory_apply` is idempotent by content, so a retry after a broken
stream writes the same bytes or reports `unchanged`.

---

## Running more than one instance

`requestState` is signed with `AMK_STATE_SECRET`. If it is unset, the server
generates a random per-process key and prints a warning.

That is fine for stdio and for a single HTTP process. Behind a load balancer it
is not: an MRTR retry that lands on a different process would fail integrity
verification. Set the same secret everywhere.

```bash
AMK_STATE_SECRET="$(openssl rand -hex 32)" node agent/mcp-server.mjs --config ./memory.config.json --http 8787
```

Rotating the secret invalidates in-flight MRTR state. Since the TTL is 30
minutes, rotate and accept that a handful of users have to answer again.

### What `requestState` actually carries

The gap ids that were asked about, the target category and language, an expiry,
and the tool name it is bound to. It carries no credentials and no user content.

Per the spec, it is treated as attacker-controlled input on the way back in:

- **HMAC-SHA256**, compared in constant time — a tampered blob is rejected
- **TTL**, 30 minutes — an old blob is rejected
- **Tool binding** — state minted for `memory_close_gaps` cannot be replayed
  against another tool

Tampering can at worst produce a rejected plan, since everything downstream
still goes through the contract. The checks exist anyway, because they are free.

---

## Caching

| Response | `ttlMs` | `cacheScope` |
|---|---|---|
| `server/discover` | 1 h | `public` |
| `tools/list` | 5 min | `public` |
| everything else | — | — |

Tool *results* are never marked cacheable. Retrieval depends on memory contents
that a human may edit at any moment, and a stale answer that looks authoritative
is worse than a slow one.

Set `"watch": true` in `memory.config.json` to reload atoms on every request
during authoring. Leave it off in production and restart, or call
`memory_apply`, which invalidates the cache itself.

---

## Client capability degradation

If a client does not declare `elicitation`, `memory_close_gaps` **does not
fail**. It returns `stage: "no-elicitation"` with the questions as plain data,
so the agent can ask them itself and come back through `memory_restructure`.

Sending an elicitation to a client that cannot answer it would strand the loop
with no way for the user to find out why.

---

## Backward compatibility

An `initialize` request still gets a valid 2025-era response, and a request with
no `_meta` at all is accepted and answered in the modern shape. Per-request
negotiation makes supporting both essentially free, so there is no reason to
break 2025 clients.

Declared: `2026-07-28`, `2025-11-25`, `2025-06-18`.
