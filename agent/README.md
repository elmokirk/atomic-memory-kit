# Agent Integration

Three ways to give an agent access to the memory. They compose.

---

## 1. Instructions — `AGENTS.snippet.md`

Paste into `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` or your equivalent. Establishes
the two behaviours that matter:

- **retrieve, do not recall** — call the memory instead of answering from
  training data
- **record, do not invent** — a `no_match` becomes a gap, never a guess

Adjust the paths, keep the rules.

---

## 2. Skills

| Skill | Trigger |
|---|---|
| `SKILL-memory-ingest.md` | writing or updating an atom |
| `SKILL-gap-closing.md` | working the gap backlog |

Copy into your skills directory. For Claude Code:

```bash
mkdir -p .claude/skills/memory-ingest
cp agent/SKILL-memory-ingest.md .claude/skills/memory-ingest/SKILL.md
mkdir -p .claude/skills/gap-closing
cp agent/SKILL-gap-closing.md .claude/skills/gap-closing/SKILL.md
```

Both are written to be readable by any agent runtime — the frontmatter is the
only Claude-specific part, and it is harmless elsewhere.

---

## 3. MCP server — `mcp-server.mjs`

Zero-dependency stdio server. MCP over stdio is newline-delimited JSON-RPC 2.0,
which is about eighty lines of plumbing; pulling in an SDK would undo the "copy
the folder and it works" property.

For Claude Code, the plugin starts this server for you, read-only by default.
Setup, options and the `allow_writes` switch: [`docs/INTEGRATIONS.md` §1](../docs/INTEGRATIONS.md#1-claude-code-stdio).

```text
/plugin marketplace add elmokirk/atomic-memory-kit
/plugin install amk@atomic-memory-kit
```

Manual registration, writes on unless you add `--allow-writes false`:

```bash
# Claude Code
claude mcp add memory -- node /abs/path/agent/mcp-server.mjs --config /abs/path/memory.config.json
```

```json
// .mcp.json / opencode / codex
{
  "mcpServers": {
    "memory": {
      "command": "node",
      "args": ["/abs/path/agent/mcp-server.mjs", "--config", "/abs/path/memory.config.json"]
    }
  }
}
```

### Tools

| Tool | Purpose | Writes |
|---|---|---|
| `memory_contract` | The machine-readable atom contract — read before authoring | |
| `memory_scope` | Everything the memory covers — call first to check territory | |
| `memory_search` | Retrieve with scores and a scope verdict | |
| `memory_get` | One atom by id, with graph neighbours | |
| `memory_compile` | Atoms + open gaps as one bundle, JSON, or digest | |
| `memory_restructure` | Validate atom proposals and plan the change, writing nothing | |
| `memory_apply` | Write a validated plan | yes |
| `memory_gaps` | List gaps, highest recurrence first | |
| `memory_gap_add` | Record something the memory did not have | yes |
| `memory_gap_close` | Close a gap once an atom covers it | yes |
| `memory_close_gaps` | Ask the user about open gaps and plan atoms from the answers | with `autoApply` |

Tools marked as writing are refused when the server runs with
`--allow-writes false` (the plugin default) and over HTTP without
`AMK_AUTH_TOKEN`.

The tool **descriptions carry the behavioural rules** — `memory_search` tells the
model in-band what `no_match` means and what to do about it. Agents follow
tool descriptions more reliably than distant system-prompt instructions, so the
guidance is placed where it will actually be read.

The memory is loaded on first use and cached. After editing atoms by hand,
restart the server, or set `"watch": true` in `memory.config.json` to reload on
every request.

---

## The multi-agent handoff

This is what the combination is for.

```
subagent works ──► hits a wall ──► memory_gap_add
                                        │
        several agents, several sessions │
                                        ▼
                              memory_compile
                                        │
                    one document: everything known
                    + everything missing, as checkboxes
                                        │
                                        ▼
                      human or orchestrator answers in place
                                        │
                                        ▼
                              amk import → validate
                                        │
                                        ▼
                    next agent starts from a better memory
```

The property that makes it work: **what an agent could not resolve travels in the
same artifact as what it learned.** Conventional handoffs keep the first and lose
the second — open questions end up in a transcript nobody re-reads.

Here they are checkboxes in the document that also contains the knowledge, so
answering them is a reading task rather than an archaeology task.
