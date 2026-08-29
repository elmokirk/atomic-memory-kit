#!/usr/bin/env node
/**
 * MCP stdio server exposing the memory to any MCP client (Claude Code, Codex,
 * OpenCode, Cursor, …).
 *
 * Zero dependencies: MCP over stdio is newline-delimited JSON-RPC 2.0, which is
 * about eighty lines of plumbing. Pulling in an SDK for that would undo the
 * "copy the folder and it works" property this kit is built on.
 *
 * Register (Claude Code):
 *   claude mcp add memory -- node /abs/path/agent/mcp-server.mjs --config /abs/path/memory.config.json
 *
 * The memory is loaded once at startup and cached. Restart the server after
 * editing atoms, or call the `memory_reload` tool.
 */
import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'

import { readGapLedger, readMemoryDir, writeGapLedger } from '../adapters/fs.ts'
import { compileMemory, renderBundle } from '../src/compile.ts'
import { defineMemoryConfig } from '../src/config.ts'
import { createGapLedger, renderGapReport } from '../src/gaps.ts'
import { loadMemory } from '../src/loader.ts'
import { searchMemory } from '../src/search.ts'

const PROTOCOL_VERSION = '2024-11-05'

/* ------------------------------------------------------------------ *
 * Config
 * ------------------------------------------------------------------ */

const configFlagIndex = process.argv.indexOf('--config')
const configPath = resolve(
  configFlagIndex !== -1 ? process.argv[configFlagIndex + 1] : 'memory.config.json',
)
const configDir = dirname(configPath)

let fileConfig = {}
try {
  fileConfig = JSON.parse(readFileSync(configPath, 'utf8'))
} catch {
  // Fall back to defaults; the error surfaces on the first tool call instead of
  // killing the server before the client can show anything useful.
}

const abs = (value, fallback) => {
  const target = value ?? fallback
  return isAbsolute(target) ? target : join(configDir, target)
}

const paths = {
  root: abs(fileConfig.root, 'memory'),
  ledger: abs(fileConfig.gapLedger, '.memory-out/gaps.jsonl'),
}
const memoryConfig = defineMemoryConfig(fileConfig.retrieval ?? {})

let cached = null
function getBase() {
  if (!cached) cached = loadMemory(readMemoryDir(paths.root), memoryConfig).base
  return cached
}
function getLedger() {
  return createGapLedger(readGapLedger(paths.ledger))
}

/* ------------------------------------------------------------------ *
 * Tools
 * ------------------------------------------------------------------ */

const TOOLS = [
  {
    name: 'memory_search',
    description:
      'Search the curated memory. Returns scored atoms and a scope verdict. '
      + 'When scopeStatus is "no_match" the memory genuinely does not cover the question — '
      + 'say so and record a gap with memory_gap_add instead of answering from general knowledge.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The question, phrased as a user would ask it.' },
        context: { type: 'string', description: 'Optional situational key that boosts categories, e.g. "/pricing".' },
      },
      required: ['query'],
    },
    handler: ({ query, context }) => {
      const base = getBase()
      const result = searchMemory(base, query, { context })
      return {
        scopeStatus: result.scopeStatus,
        bestScore: result.bestScore,
        threshold: base.config.minScore,
        alwaysInclude: base.alwaysInclude.map((atom) => ({ id: atom.id, title: atom.title, body: atom.body })),
        chunks: result.chunks.map((chunk) => ({
          id: chunk.id,
          title: chunk.title,
          category: chunk.category,
          score: chunk.score,
          viaEdge: chunk.viaEdge ?? false,
          content: chunk.content,
        })),
        hint: result.scopeStatus === 'no_match'
          ? 'Nothing scored above the threshold. Do not improvise — record a gap.'
          : 'Answer only from these atoms. If they do not cover the specific question, record a gap.',
      }
    },
  },
  {
    name: 'memory_get',
    description: 'Fetch one atom by its exact id, including its graph neighbours.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    handler: ({ id }) => {
      const base = getBase()
      const atom = base.byId.get(id)
      if (!atom) return { error: `unknown atom id: ${id}` }
      return {
        ...atom,
        extensions: atom.extensions,
        neighbours: (atom.related ?? []).map((target) => ({
          id: target,
          title: base.byId.get(target)?.title,
        })),
      }
    },
  },
  {
    name: 'memory_scope',
    description:
      'List everything this memory covers: categories, atom ids, titles and summaries. '
      + 'Call this first to decide whether a question belongs to this memory at all.',
    inputSchema: { type: 'object', properties: {} },
    handler: () => {
      const base = getBase()
      const byCategory = {}
      for (const atom of base.atoms) {
        byCategory[atom.category] ??= []
        byCategory[atom.category].push({ id: atom.id, title: atom.title, summary: atom.summary })
      }
      return { atomCount: base.atoms.length, categories: byCategory }
    },
  },
  {
    name: 'memory_gap_add',
    description:
      'Record that the memory was asked for something it did not have. '
      + 'Use kind "runtime" when the topic is in scope but the detail is missing, '
      + '"scope" when nothing matched at all. Recurrence is counted automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'Short subject, e.g. "SSO pricing on Growth".' },
        kind: { type: 'string', enum: ['runtime', 'scope', 'manual'], default: 'runtime' },
        detail: { type: 'string', description: 'Optional context: the exact question asked.' },
      },
      required: ['topic'],
    },
    handler: ({ topic, kind = 'runtime', detail }) => {
      const ledger = getLedger()
      const record = ledger.observe({ kind, topic, detail, source: 'mcp' })
      writeGapLedger(paths.ledger, ledger.all())
      return { recorded: record.id, kind: record.kind, seenCount: record.count, status: record.status }
    },
  },
  {
    name: 'memory_gaps',
    description: 'List recorded gaps, highest recurrence first. Recurrence is the priority signal.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['open', 'all'], default: 'open' },
        format: { type: 'string', enum: ['json', 'markdown'], default: 'json' },
      },
    },
    handler: ({ status = 'open', format = 'json' }) => {
      const ledger = getLedger()
      const records = status === 'all' ? ledger.all() : ledger.open()
      if (format === 'markdown') return { report: renderGapReport(records, { includeClosed: status === 'all' }) }
      return { count: records.length, gaps: records }
    },
  },
  {
    name: 'memory_gap_close',
    description: 'Close a gap once an atom genuinely covers it. Reopens automatically if it recurs.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        resolvedBy: { type: 'string', description: 'Atom id that closed it.' },
      },
      required: ['id'],
    },
    handler: ({ id, resolvedBy }) => {
      const ledger = getLedger()
      if (!ledger.close(id, resolvedBy)) return { error: `unknown gap id: ${id}` }
      writeGapLedger(paths.ledger, ledger.all())
      return { closed: id, resolvedBy }
    },
  },
  {
    name: 'memory_bundle',
    description:
      'Compile the entire memory plus its open gaps into one editable document. '
      + 'Use for handoff to a human or another agent: they answer the gaps in place, '
      + 'and the result imports straight back into atoms.',
    inputSchema: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['markdown', 'json'], default: 'markdown' },
      },
    },
    handler: ({ format = 'markdown' }) => {
      const base = getBase()
      const gaps = getLedger().open()
      if (format === 'json') return compileMemory(base, gaps)
      return { bundle: renderBundle(base, { name: fileConfig.name, gaps }) }
    },
  },
  {
    name: 'memory_reload',
    description: 'Reload atoms from disk after editing them. Returns contract warnings.',
    inputSchema: { type: 'object', properties: {} },
    handler: () => {
      cached = null
      const report = loadMemory(readMemoryDir(paths.root), memoryConfig)
      cached = report.base
      return {
        atoms: report.base.atoms.length,
        warnings: report.warnings,
        skipped: report.skipped.length,
      }
    },
  },
]

const BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]))

/* ------------------------------------------------------------------ *
 * JSON-RPC over stdio
 * ------------------------------------------------------------------ */

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function handle(request) {
  const { id, method, params } = request

  if (method === 'initialize') {
    return {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: 'atomic-memory-kit', version: '0.1.0' },
    }
  }

  if (method === 'tools/list') {
    return {
      tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    }
  }

  if (method === 'tools/call') {
    const tool = BY_NAME.get(params?.name)
    if (!tool) throw new Error(`unknown tool: ${params?.name}`)
    const result = tool.handler(params.arguments ?? {})
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      isError: Boolean(result?.error),
    }
  }

  if (method === 'ping') return {}

  throw new Error(`unsupported method: ${method}`)
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let newline = buffer.indexOf('\n')
  while (newline !== -1) {
    const line = buffer.slice(0, newline).trim()
    buffer = buffer.slice(newline + 1)
    newline = buffer.indexOf('\n')
    if (line === '') continue

    let request
    try {
      request = JSON.parse(line)
    } catch {
      continue
    }

    // Notifications carry no id and must never be answered.
    if (request.id === undefined) continue

    try {
      send({ jsonrpc: '2.0', id: request.id, result: handle(request) })
    } catch (error) {
      send({
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32000, message: error instanceof Error ? error.message : String(error) },
      })
    }
  }
})

process.stdin.on('end', () => process.exit(0))
