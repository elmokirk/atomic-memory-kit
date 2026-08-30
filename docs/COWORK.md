# Connecting to Claude Cowork

Cowork uses the same custom-connector mechanism as claude.ai and Claude Desktop.
Two fields, and one constraint that decides everything else.

> **The constraint:** custom connectors are dialled **from Anthropic's cloud**,
> not from your machine — even though Cowork runs locally. `localhost` is
> unreachable. The `claude_desktop_config.json` mechanism for local stdio servers
> is a different thing and is not available in Cowork.
>
> So the server needs a public HTTPS URL, and therefore authentication, because
> `memory_apply` writes files.

---

## 1. Run the server

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
| `AMK_AUTH_TOKEN` | Bearer token. Without it every caller who reaches the port can write to your memory. The server warns on startup. |
| `AMK_STATE_SECRET` | Signs the MRTR `requestState`. Required if you run more than one instance, or gap-closing retries fail across processes. |

Keep both. Note the token — you need it in step 3.

## 2. Expose it over HTTPS

Any tunnel or host works. During development:

```bash
cloudflared tunnel --url http://localhost:8787
# or
ngrok http 8787
```

Both print an `https://…` URL. In production, put it behind your normal ingress.
The server is stateless — no session store, no sticky routing — so N replicas
behind a round-robin balancer behave identically to one, provided they share
`AMK_STATE_SECRET`.

## 3. Add the connector

**Cowork / Claude / Claude Desktop (Pro, Max, individual):**

Settings → **Connectors** → **Add custom connector**. If asked for a type, choose
**Web**.

| Field | Value |
|---|---|
| **Name** | `Atomic Memory` (display only) |
| **Remote MCP server URL** | `https://your-tunnel-url/` |
| Advanced → OAuth Client ID | leave empty |
| Advanced → OAuth Client Secret | leave empty |

**Team / Enterprise:** only Owners can add connectors, under Organization
settings → Connectors. Members then enable it individually.

### The token

This server uses a static bearer token, not OAuth. The connector dialog does not
have a plain "header" field, so put the token in the URL path and have your
ingress translate it to the `Authorization` header — or terminate auth at the
proxy, which is the cleaner option:

```nginx
location /amk/ {
    proxy_set_header Authorization "Bearer YOUR_TOKEN";
    proxy_pass http://127.0.0.1:8787/;
}
```

Then the connector URL is `https://your-host/amk/` and the token never leaves
your infrastructure.

## 4. Verify before you trust it

```bash
curl -X POST https://your-tunnel-url/ \
  -H 'content-type: application/json' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'Mcp-Method: server/discover' \
  -d '{"jsonrpc":"2.0","id":1,"method":"server/discover",
       "params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28"}}}'
```

You should get `"resultType":"complete"` and `"supportedVersions":["2026-07-28", …]`.
A `401` means the token is not arriving; a `405` means something rewrote your
POST into a GET.

In Cowork, ask: *"list what the memory covers"* — that should call `memory_scope`.

---

## Notes

- **Transport.** Streamable HTTP, POST-only. SSE is deprecated; do not configure it.
- **No edit option.** Changing a connector URL means removing it and adding it again.
- **Free plan** allows one custom connector.
- **Ask Cowork to read the contract first.** `memory_contract` is cacheable and
  costs one call. An agent authoring atoms from a remembered contract writes
  invalid ones.

## If you only need Claude Code

Skip all of the above — stdio needs no network, no tunnel, no token:

```bash
claude mcp add memory -- node /abs/path/agent/mcp-server.mjs --config /abs/path/memory.config.json
```

---

*Sources for the connector mechanics, retrieved 2026-08-29:
[Get started with custom connectors using remote MCP](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp) ·
[Use connectors to extend Claude's capabilities](https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities) ·
[Third party connectors with remote MCP](https://claude.com/docs/connectors/custom/remote-mcp)*
