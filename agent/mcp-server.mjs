#!/usr/bin/env node
/**
 * MCP server — protocol revision 2026-07-28 (stateless, headless).
 *
 *   node agent/mcp-server.mjs --config ./memory.config.json          # stdio
 *   node agent/mcp-server.mjs --config ./memory.config.json --http 8787
 *
 * ## Why this file looks the way it does
 *
 * The 2026-07-28 revision removed the `initialize` / `notifications/initialized`
 * handshake and the `Mcp-Session-Id` header. There is no connection state and no
 * server-side session. Every request carries its own protocol version and client
 * capabilities in `_meta`, every result declares a `resultType`, and any state a
 * server needs across calls travels in an opaque, integrity-protected
 * `requestState` blob that the client echoes back verbatim.
 *
 * That change is unusually good news for this kit. The gap-closing loop —
 *
 *     gap found -> agent asks the human -> human answers -> restructure to atoms
 *
 * is exactly the Multi Round-Trip Requests (MRTR) pattern: the server returns
 * `resultType: "input_required"` with `inputRequests` (elicitations, one per
 * open gap), the client collects the answers from the user, and retries the
 * same tool call with `inputResponses` plus the `requestState`. The server
 * reconstitutes what it asked, turns the answers into atom proposals, and
 * returns a plan. No session, no sticky routing, no shared store: two
 * consecutive requests can land on different instances of this process.
 *
 * ## Implemented from the revision
 *
 *   - `server/discover` (mandatory), with `ttlMs` / `cacheScope`
 *   - `_meta` protocol version + client capabilities per request
 *   - `resultType: "complete" | "input_required"` on every result
 *   - MRTR with HMAC-signed, TTL-bounded, request-bound `requestState`
 *   - `Mcp-Method` / `Mcp-Name` header validation, `HeaderMismatchError` -32020
 *   - `UnsupportedProtocolVersionError` -32022
 *   - `MissingRequiredClientCapability` -32021 (elicitation is required to close
 *     gaps interactively; without it the server degrades to a report instead of
 *     failing)
 *   - Deterministic `tools/list` ordering for prompt-cache hits
 *   - Cacheable list results
 *
 * ## Deliberately not implemented
 *
 *   - `subscriptions/listen`. This memory changes when a human edits files; a
 *     long-lived notification stream would be infrastructure with nothing to
 *     carry. Clients re-read; `ttlMs` tells them when.
 *   - Sampling and Roots. Both are Deprecated in this revision. The server never
 *     asks a client to run a model — the semantic work happens on the agent side
 *     by construction (see `src/restructure.ts`).
 *   - Resumability. Removed from the transport in this revision; a broken stream
 *     means the client re-issues the request. Every tool here is safe to re-issue
 *     except `memory_apply`, which is idempotent by content hash.
 *
 * Zero dependencies, on purpose. Stateless JSON-RPC over stdio or plain HTTP
 * POST is a few hundred lines; an SDK would cost this kit the property that you
 * can copy the folder and run it.
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'

import { readGapLedger, readMemoryDir, writeGapLedger, writeMemoryFiles } from '../adapters/fs.ts'
import { compileMemory, renderBundle, renderDigest } from '../src/compile.ts'
import { defineMemoryConfig } from '../src/config.ts'
import { CONTRACT_VERSION, describeContract } from '../src/contract.ts'
import { createGapLedger, renderGapReport } from '../src/gaps.ts'
import { loadMemory } from '../src/loader.ts'
import { draftFromMarkdown, materialize, planApply } from '../src/restructure.ts'
import { searchMemory } from '../src/search.ts'

const PROTOCOL_VERSION = '2026-07-28'
const SUPPORTED_VERSIONS = [PROTOCOL_VERSION, '2025-11-25', '2025-06-18']
const SERVER_INFO = { name: 'atomic-memory-kit', version: '0.2.0' }

const META = {
  protocolVersion: 'io.modelcontextprotocol/protocolVersion',
  clientInfo: 'io.modelcontextprotocol/clientInfo',
  clientCapabilities: 'io.modelcontextprotocol/clientCapabilities',
  serverInfo: 'io.modelcontextprotocol/serverInfo',
}

// -32000..-32019 implementation-defined, -32020..-32099 reserved by the spec.
const ERROR = {
  HEADER_MISMATCH: -32020,
  MISSING_CAPABILITY: -32021,
  UNSUPPORTED_VERSION: -32022,
  INVALID_PARAMS: -32602,
  INTERNAL: -32000,
}

/** How long a `requestState` blob stays redeemable. Short by design. */
const STATE_TTL_MS = 30 * 60 * 1000

/* ------------------------------------------------------------------ *
 * Config — read once at boot. There is no per-connection state below.
 * ------------------------------------------------------------------ */

const argv = process.argv.slice(2)
const flag = (name) => {
  const index = argv.indexOf(name)
  return index === -1 ? undefined : argv[index + 1]
}

const configPath = resolve(flag('--config') ?? 'memory.config.json')
const configDir = dirname(configPath)

let fileConfig = {}
let configError = null
try {
  fileConfig = JSON.parse(readFileSync(configPath, 'utf8'))
} catch (error) {
  // Surface on the first tool call rather than dying before the client can
  // render anything useful.
  configError = error instanceof Error ? error.message : String(error)
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

/**
 * Signing key for `requestState`.
 *
 * The spec requires integrity protection on state that influences behaviour.
 * Ours carries gap ids and a category, so tampering can at worst produce a
 * rejected plan — but a per-process random key is free, so there is no reason
 * to accept even that. Set `AMK_STATE_SECRET` when running more than one
 * instance behind a load balancer, since a retry may hit a different process.
 */
const STATE_SECRET = process.env.AMK_STATE_SECRET ?? randomUUID()
const STATE_SECRET_IS_EPHEMERAL = process.env.AMK_STATE_SECRET === undefined

/* ------------------------------------------------------------------ *
 * Memory access — reloaded per request when `watch` is on.
 * ------------------------------------------------------------------ */

let cache = null
function getBase({ fresh = false } = {}) {
  if (configError) throw new Error(`config ${configPath}: ${configError}`)
  if (fresh || cache === null || fileConfig.watch === true) {
    cache = loadMemory(readMemoryDir(paths.root), memoryConfig)
  }
  return cache.base
}
function getReport() {
  getBase()
  return cache
}
function getLedger() {
  return createGapLedger(readGapLedger(paths.ledger))
}

/* ------------------------------------------------------------------ *
 * requestState: sign / verify
 * ------------------------------------------------------------------ */

const b64url = (buffer) => Buffer.from(buffer).toString('base64url')

function signState(payload, boundTo) {
  const body = b64url(JSON.stringify({ ...payload, exp: Date.now() + STATE_TTL_MS, bind: boundTo }))
  const mac = createHmac('sha256', STATE_SECRET).update(body).digest('base64url')
  return `${body}.${mac}`
}

/**
 * Verify and decode. Rejects on bad MAC, expiry, or a mismatch with the tool
 * the state is being replayed against — the three checks the spec calls for
 * (integrity, TTL, originating request).
 */
function verifyState(state, boundTo) {
  if (typeof state !== 'string' || !state.includes('.')) return { ok: false, reason: 'malformed requestState' }
  const [body, mac] = state.split('.')
  const expected = createHmac('sha256', STATE_SECRET).update(body).digest('base64url')
  const a = Buffer.from(mac ?? '')
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'requestState failed integrity check' }

  let payload
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return { ok: false, reason: 'requestState is not decodable' }
  }
  if (typeof payload.exp !== 'number' || payload.exp < Date.now()) {
    return { ok: false, reason: 'requestState expired — start the request again' }
  }
  if (payload.bind !== boundTo) {
    return { ok: false, reason: `requestState belongs to "${payload.bind}", not "${boundTo}"` }
  }
  return { ok: true, payload }
}

/* ------------------------------------------------------------------ *
 * Result helpers
 * ------------------------------------------------------------------ */

const complete = (extra = {}) => ({
  resultType: 'complete',
  _meta: { [META.serverInfo]: SERVER_INFO },
  ...extra,
})

const cacheable = (extra, ttlMs, scope = 'private') => ({
  ...complete(extra),
  ttlMs,
  cacheScope: scope,
})

/** A tool result whose payload is JSON the model should read. */
const toolResult = (payload) => complete({
  content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  structuredContent: payload,
  isError: Boolean(payload?.error),
})

/** MRTR interim result: the server needs the human before it can continue. */
const inputRequired = (inputRequests, requestState) => ({
  resultType: 'input_required',
  _meta: { [META.serverInfo]: SERVER_INFO },
  ...(inputRequests ? { inputRequests } : {}),
  ...(requestState ? { requestState } : {}),
})

class RpcError extends Error {
  constructor(code, message, data) {
    super(message)
    this.code = code
    this.data = data
  }
}

/* ------------------------------------------------------------------ *
 * Tools
 *
 * Ordering is fixed and alphabetical within group, because the revision asks
 * for deterministic `tools/list` output so client and prompt caches hit.
 * ------------------------------------------------------------------ */

const TOOLS = [
  /* --- contract ------------------------------------------------- */
  {
    name: 'memory_contract',
    title: 'Read the atom contract',
    description:
      'Return the machine-readable frontmatter contract: field classes, types, severities, '
      + 'grammar patterns, diagnostic codes, and which subsystem consumes which field. '
      + 'Call this BEFORE authoring or editing any atom. Authoring against a remembered '
      + 'contract instead of this one is how invalid atoms get written.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: () => toolResult(describeContract()),
  },

  /* --- read ------------------------------------------------------ */
  {
    name: 'memory_scope',
    title: 'List what the memory covers',
    description:
      'Every category, atom id, title and summary. Call this first to decide whether a '
      + 'question belongs to this memory at all — it is far cheaper than guessing.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: () => {
      const base = getBase()
      const categories = {}
      for (const atom of base.atoms) {
        categories[atom.category] ??= []
        categories[atom.category].push({ id: atom.id, title: atom.title, summary: atom.summary })
      }
      return toolResult({
        contractVersion: CONTRACT_VERSION,
        atomCount: base.atoms.length,
        categories,
      })
    },
  },
  {
    name: 'memory_search',
    title: 'Search the memory',
    description:
      'Deterministic keyword retrieval over the curated memory. Returns scored atoms and a '
      + 'scope verdict. When scopeStatus is "no_match" the memory genuinely does not cover the '
      + 'question: say so plainly and call memory_gap_add. Do not fill the hole from general '
      + 'knowledge — an unrecorded gap is a gap that never gets closed.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The question, phrased as a user would ask it.' },
        context: { type: 'string', description: 'Optional situational key that boosts categories, e.g. "/pricing".' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    run: ({ query, context }) => {
      const base = getBase()
      const result = searchMemory(base, query, { context })
      return toolResult({
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
          : 'Answer only from these atoms, cite by id, and record a gap if they miss the specific point.',
      })
    },
  },
  {
    name: 'memory_get',
    title: 'Fetch one atom',
    description: 'Fetch one atom by exact id, with its graph neighbours resolved.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
    run: ({ id }) => {
      const base = getBase()
      const atom = base.byId.get(id)
      if (!atom) return toolResult({ error: `unknown atom id: ${id}` })
      return toolResult({
        ...atom,
        neighbours: (atom.related ?? []).map((target) => ({
          id: target,
          title: base.byId.get(target)?.title,
        })),
      })
    },
  },

  /* --- outbound direction: atoms -> one document ------------------ */
  {
    name: 'memory_compile',
    title: 'Compile the memory into one document',
    description:
      'Project the whole memory, plus its open gaps, into a single artifact. '
      + '"bundle" is lossless markdown that imports straight back into atoms — use it for handoff '
      + 'to a human or another agent. "json" is the same content as machine transport. '
      + '"digest" is a lossy overview for skimming and is NOT re-importable.',
    inputSchema: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['bundle', 'json', 'digest'], default: 'bundle' },
        includeGaps: { type: 'boolean', default: true },
      },
      additionalProperties: false,
    },
    run: ({ format = 'bundle', includeGaps = true }) => {
      const base = getBase()
      const gaps = includeGaps ? getLedger().open() : []
      if (format === 'json') return toolResult(compileMemory(base, gaps))
      if (format === 'digest') return toolResult({ digest: renderDigest(compileMemory(base, gaps)) })
      return toolResult({
        bundle: renderBundle(base, { name: fileConfig.name, gaps }),
        note: 'Edit in place, then send the whole document back through memory_restructure.',
      })
    },
  },

  /* --- inbound direction: material -> atoms ----------------------- */
  {
    name: 'memory_restructure',
    title: 'Split submitted content into atom proposals',
    description:
      'Turn raw material into contract-conformant atom proposals, WITHOUT writing anything. '
      + 'Preferred usage: you read memory_contract, do the semantic split yourself, and pass '
      + '`atoms`. This tool then validates, diffs against the live memory, and returns a plan. '
      + 'Passing `text` instead falls back to a purely structural split on markdown headings — '
      + 'it never invents keywords or summaries, and reports what is still missing in `needs`.',
    inputSchema: {
      type: 'object',
      properties: {
        atoms: {
          type: 'array',
          description: 'Atom proposals you authored against the contract.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              category: { type: 'string' },
              lang: { type: 'string' },
              body: { type: 'string' },
              summary: { type: 'string' },
              keywords: { type: 'array', items: { type: 'string' } },
              synonyms: { type: 'array', items: { type: 'string' } },
              intents: { type: 'array', items: { type: 'string' } },
              related: { type: 'array', items: { type: 'string' } },
              alwaysInclude: { type: 'boolean' },
              priority: { type: 'number' },
              link: { type: 'string' },
              linkLabel: { type: 'string' },
              closesGaps: { type: 'array', items: { type: 'string' } },
            },
            required: ['id', 'title', 'category', 'lang', 'body'],
          },
        },
        text: { type: 'string', description: 'Raw markdown to split structurally as a fallback.' },
        category: { type: 'string', description: 'Category for drafts produced from `text`.' },
        lang: { type: 'string', default: 'en' },
        idPrefix: { type: 'string' },
      },
      additionalProperties: false,
    },
    run: ({ atoms, text, category, lang = 'en', idPrefix }) => {
      const base = getBase()
      if (Array.isArray(atoms) && atoms.length > 0) {
        return toolResult({ mode: 'authored', ...planApply(base, atoms, { contractVersion: CONTRACT_VERSION }) })
      }
      if (typeof text === 'string' && text.trim() !== '') {
        if (!category) return toolResult({ error: 'text mode needs a `category`' })
        const drafts = draftFromMarkdown(text, { category, lang, idPrefix })
        return toolResult({
          mode: 'structural-draft',
          warning:
            'These are structural drafts, not finished atoms. Nothing here understood the content. '
            + 'Fill every field listed in `needs`, then send them back as `atoms`.',
          drafts,
          plan: planApply(base, drafts, { contractVersion: CONTRACT_VERSION }),
        })
      }
      return toolResult({ error: 'provide either `atoms` or `text` + `category`' })
    },
  },
  {
    name: 'memory_apply',
    title: 'Write atom proposals to the memory',
    description:
      'Write proposals to disk. Refuses the entire batch unless every proposal is contract-clean '
      + 'AND the merged result still loads with intact graph integrity — there is no partial write. '
      + 'Set dryRun to see the plan without touching anything. Gaps listed in closesGaps are closed '
      + 'only after a successful write.',
    inputSchema: {
      type: 'object',
      properties: {
        atoms: { type: 'array', items: { type: 'object' } },
        dryRun: { type: 'boolean', default: false },
      },
      required: ['atoms'],
      additionalProperties: false,
    },
    run: ({ atoms, dryRun = false }) => {
      const report = getReport()
      const plan = planApply(report.base, atoms, { contractVersion: CONTRACT_VERSION })
      if (!plan.ok) {
        return toolResult({
          written: false,
          reason: 'plan rejected — nothing was written',
          ...plan,
        })
      }
      if (dryRun) return toolResult({ written: false, dryRun: true, ...plan })

      const current = readMemoryDir(paths.root)
      const { files } = materialize(current, plan, memoryConfig)
      const write = writeMemoryFiles(paths.root, files)
      cache = null

      const closed = []
      const ledger = getLedger()
      for (const entry of plan.plans) {
        for (const gap of entry.closesGaps) {
          if (ledger.close(gap, entry.id)) closed.push({ gap, resolvedBy: entry.id })
        }
      }
      if (closed.length > 0) writeGapLedger(paths.ledger, ledger.all())

      return toolResult({
        written: true,
        summary: plan.summary,
        files: write,
        closedGaps: closed,
        next: 'Add eval cases for the new atoms, then re-run the eval — an unproven atom is a future gap.',
      })
    },
  },

  /* --- gaps ------------------------------------------------------- */
  {
    name: 'memory_gaps',
    title: 'List what the memory does not know',
    description:
      'Recorded gaps, highest recurrence first. Recurrence is the priority signal: a gap seen '
      + 'nine times is nine people who did not get an answer.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['open', 'all'], default: 'open' },
        format: { type: 'string', enum: ['json', 'markdown'], default: 'json' },
      },
      additionalProperties: false,
    },
    run: ({ status = 'open', format = 'json' }) => {
      const ledger = getLedger()
      const records = status === 'all' ? ledger.all() : ledger.open()
      if (format === 'markdown') {
        return toolResult({ report: renderGapReport(records, { includeClosed: status === 'all' }) })
      }
      return toolResult({ count: records.length, gaps: records })
    },
  },
  {
    name: 'memory_gap_add',
    title: 'Record a gap',
    description:
      'Record that the memory was asked for something it did not have. Use kind "runtime" when '
      + 'the topic is in scope but the detail is missing, "scope" when nothing matched at all. '
      + 'Recurrence is counted automatically and a closed gap reopens if it comes back.',
    inputSchema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'Short subject, e.g. "SSO pricing on the Growth plan".' },
        kind: { type: 'string', enum: ['runtime', 'scope', 'manual'], default: 'runtime' },
        detail: { type: 'string', description: 'The exact question that was asked.' },
      },
      required: ['topic'],
      additionalProperties: false,
    },
    run: ({ topic, kind = 'runtime', detail }) => {
      const ledger = getLedger()
      const record = ledger.observe({ kind, topic, detail, source: 'mcp' })
      writeGapLedger(paths.ledger, ledger.all())
      return toolResult({ recorded: record.id, kind: record.kind, seenCount: record.count, status: record.status })
    },
  },
  {
    name: 'memory_gap_close',
    title: 'Close a gap',
    description: 'Close a gap once an atom genuinely covers it. It reopens by itself if the topic recurs.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        resolvedBy: { type: 'string', description: 'Atom id that closed it.' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    run: ({ id, resolvedBy }) => {
      const ledger = getLedger()
      if (!ledger.close(id, resolvedBy)) return toolResult({ error: `unknown gap id: ${id}` })
      writeGapLedger(paths.ledger, ledger.all())
      return toolResult({ closed: id, resolvedBy })
    },
  },

  /* --- the loop, as one interactive call -------------------------- */
  {
    name: 'memory_close_gaps',
    title: 'Interactively close open gaps with the user',
    description:
      'The full loop in one call. First invocation: the server picks the highest-recurrence open '
      + 'gaps and returns elicitation requests — one question per gap — as an MRTR '
      + 'input_required result. Collect the answers from the user, then RETRY this same tool with '
      + 'inputResponses and the requestState echoed back verbatim. The server then turns the '
      + 'answers into atom proposals and returns a plan for memory_apply. '
      + 'Use this instead of hand-rolling the ask-and-file dance.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 10, default: 3 },
        category: { type: 'string', description: 'Category to file the resulting atoms under.' },
        lang: { type: 'string', default: 'en' },
        autoApply: {
          type: 'boolean',
          default: false,
          description: 'Write immediately instead of returning a plan. Off by default: a human should see the diff.',
        },
      },
      additionalProperties: false,
    },
    run: (args, ctx) => {
      const { limit = 3, category, lang = 'en', autoApply = false } = args
      const base = getBase()
      const responses = ctx.inputResponses

      /* --- round 2: answers came back --- */
      if (responses && ctx.requestState) {
        const verified = verifyState(ctx.requestState, 'memory_close_gaps')
        if (!verified.ok) throw new RpcError(ERROR.INVALID_PARAMS, verified.reason)

        const asked = verified.payload.gaps ?? []
        const proposals = []
        const declined = []

        for (const gap of asked) {
          const answer = responses[gap.key]
          if (!answer || answer.action !== 'accept' || !answer.content) {
            declined.push({ gap: gap.id, topic: gap.topic })
            continue
          }
          const bodyText = String(answer.content.body ?? '').trim()
          if (bodyText === '') {
            declined.push({ gap: gap.id, topic: gap.topic, reason: 'empty answer' })
            continue
          }
          const keywords = String(answer.content.keywords ?? '')
            .split(',').map((entry) => entry.trim()).filter(Boolean)

          proposals.push({
            id: gap.suggestedId,
            title: answer.content.title || gap.topic,
            category: verified.payload.category,
            lang: verified.payload.lang,
            summary: answer.content.summary || undefined,
            keywords: keywords.length > 0 ? keywords : undefined,
            body: bodyText,
            closesGaps: [gap.id],
          })
        }

        if (proposals.length === 0) {
          return toolResult({
            stage: 'no-answers',
            declined,
            note: 'Nothing was answered, so nothing was proposed. The gaps stay open.',
          })
        }

        const plan = planApply(base, proposals, { contractVersion: CONTRACT_VERSION })
        if (!autoApply || !plan.ok) {
          return toolResult({
            stage: 'plan',
            applied: false,
            declined,
            plan,
            next: plan.ok
              ? 'Show the user this diff, then call memory_apply with the same atoms.'
              : 'Fix the rejected proposals against memory_contract and try again.',
          })
        }

        const current = readMemoryDir(paths.root)
        const { files } = materialize(current, plan, memoryConfig)
        const write = writeMemoryFiles(paths.root, files)
        cache = null
        const ledger = getLedger()
        const closed = []
        for (const entry of plan.plans) {
          for (const gap of entry.closesGaps) {
            if (ledger.close(gap, entry.id)) closed.push(gap)
          }
        }
        if (closed.length > 0) writeGapLedger(paths.ledger, ledger.all())
        return toolResult({ stage: 'applied', applied: true, summary: plan.summary, files: write, closedGaps: closed, declined })
      }

      /* --- round 1: ask --- */
      const open = getLedger().open()
        .filter((gap) => gap.kind !== 'orphan' && gap.kind !== 'cycle')
        .sort((a, b) => (b.count ?? 1) - (a.count ?? 1))
        .slice(0, limit)

      if (open.length === 0) {
        return toolResult({ stage: 'idle', note: 'No answerable gaps are open. Nothing to ask.' })
      }

      const targetCategory = category ?? base.atoms[0]?.category ?? 'general'

      // Without elicitation support there is no way to reach the human, so
      // degrade to a report rather than erroring: a client that cannot ask can
      // still show the list to its user.
      if (!ctx.clientCapabilities?.elicitation) {
        return toolResult({
          stage: 'no-elicitation',
          note:
            'This client did not declare elicitation support, so the server cannot ask the user directly. '
            + 'Ask these questions yourself, then call memory_restructure with the answers.',
          questions: open.map((gap) => ({
            gapId: gap.id,
            topic: gap.topic,
            seenCount: gap.count,
            question: questionFor(gap),
            suggestedId: suggestId(targetCategory, gap.topic),
          })),
        })
      }

      const asked = open.map((gap, index) => ({
        key: `gap_${index}`,
        id: gap.id,
        topic: gap.topic,
        suggestedId: suggestId(targetCategory, gap.topic),
      }))

      const inputRequests = {}
      for (let index = 0; index < open.length; index += 1) {
        const gap = open[index]
        inputRequests[asked[index].key] = {
          method: 'elicitation/create',
          params: {
            mode: 'form',
            message: questionFor(gap),
            requestedSchema: {
              type: 'object',
              properties: {
                body: {
                  type: 'string',
                  title: 'The answer',
                  description: 'One checkable fact per line. Only things you can defend.',
                },
                title: { type: 'string', title: 'Atom title', description: 'Short human label.' },
                summary: { type: 'string', title: 'One-sentence summary' },
                keywords: {
                  type: 'string',
                  title: 'Keywords (comma separated)',
                  description: 'How people actually phrase this question. Include every language you serve.',
                },
              },
              required: ['body'],
            },
          },
        }
      }

      return inputRequired(
        inputRequests,
        signState({ gaps: asked, category: targetCategory, lang }, 'memory_close_gaps'),
      )
    },
  },
]

function questionFor(gap) {
  const seen = gap.count > 1 ? ` It has come up ${gap.count} times.` : ''
  const detail = gap.detail ? `\n\nExact question asked: "${gap.detail}"` : ''
  return `The memory has no answer for: ${gap.topic}.${seen}${detail}\n\nWhat is the answer?`
}

function suggestId(category, topic) {
  const slug = topic
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
  return `${category}.${slug || 'untitled'}`
}

const BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]))

/* ------------------------------------------------------------------ *
 * Dispatch — pure function of one request. No connection state exists.
 * ------------------------------------------------------------------ */

function negotiate(meta) {
  const requested = meta?.[META.protocolVersion]
  // Absent version means a pre-2026 client that never sent one. Accept and
  // answer in the modern shape; the extra `resultType` is additive.
  if (requested === undefined) return PROTOCOL_VERSION
  if (!SUPPORTED_VERSIONS.includes(requested)) {
    throw new RpcError(
      ERROR.UNSUPPORTED_VERSION,
      `unsupported protocol version: ${requested}`,
      { supportedVersions: SUPPORTED_VERSIONS },
    )
  }
  return requested
}

function dispatch(method, params) {
  const meta = params?._meta
  negotiate(meta)

  if (method === 'server/discover') {
    return cacheable({
      supportedVersions: SUPPORTED_VERSIONS,
      capabilities: { tools: {}, extensions: {} },
      instructions:
        'Curated atomic memory with gap tracking. Read memory_contract before authoring atoms. '
        + 'Call memory_scope to see coverage, memory_search to answer, memory_gap_add whenever the '
        + 'memory falls short, and memory_close_gaps to turn open gaps into atoms with the user. '
        + 'Never answer in-scope questions from general knowledge without recording a gap.',
    }, 3_600_000, 'public')
  }

  if (method === 'tools/list') {
    return cacheable({
      tools: TOOLS.map(({ name, title, description, inputSchema }) => ({
        name,
        title,
        description,
        inputSchema,
      })),
    }, 300_000, 'public')
  }

  if (method === 'tools/call') {
    const tool = BY_NAME.get(params?.name)
    if (!tool) throw new RpcError(ERROR.INVALID_PARAMS, `unknown tool: ${params?.name}`)
    return tool.run(params.arguments ?? {}, {
      inputResponses: params.inputResponses,
      requestState: params.requestState,
      clientCapabilities: meta?.[META.clientCapabilities] ?? {},
      clientInfo: meta?.[META.clientInfo],
    })
  }

  // `initialize` was removed in this revision. Answering it anyway costs four
  // lines and keeps 2025-era clients working, which is the whole point of
  // negotiation being per-request.
  if (method === 'initialize') {
    return {
      protocolVersion: params?.protocolVersion ?? '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
    }
  }
  if (method === 'notifications/initialized') return {}

  throw new RpcError(ERROR.INVALID_PARAMS, `unsupported method: ${method}`)
}

function respond(request) {
  try {
    return { jsonrpc: '2.0', id: request.id, result: dispatch(request.method, request.params) }
  } catch (error) {
    const rpc = error instanceof RpcError
    return {
      jsonrpc: '2.0',
      id: request.id,
      error: {
        code: rpc ? error.code : ERROR.INTERNAL,
        message: error instanceof Error ? error.message : String(error),
        ...(rpc && error.data ? { data: error.data } : {}),
      },
    }
  }
}

/* ------------------------------------------------------------------ *
 * Transport A — stdio
 * ------------------------------------------------------------------ */

function runStdio() {
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
      process.stdout.write(`${JSON.stringify(respond(request))}\n`)
    }
  })
  process.stdin.on('end', () => process.exit(0))
}

/* ------------------------------------------------------------------ *
 * Transport B — Streamable HTTP, stateless
 *
 * POST only. No GET endpoint, no session header, no resumability — all removed
 * in this revision. Because nothing here is connection-scoped, N copies of this
 * process behind a round-robin balancer behave identically to one.
 * ------------------------------------------------------------------ */

function runHttp(port) {
  const server = createServer((req, res) => {
    const json = (status, payload, headers = {}) => {
      const text = JSON.stringify(payload)
      res.writeHead(status, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(text),
        ...headers,
      })
      res.end(text)
    }

    if (req.method !== 'POST') {
      // The GET/SSE endpoint is gone in 2026-07-28. Say so, rather than 404.
      return json(405, { error: 'this server is POST-only; the GET endpoint was removed in MCP 2026-07-28' }, { allow: 'POST' })
    }

    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > 8_000_000) req.destroy()
    })
    req.on('end', () => {
      let request
      try {
        request = JSON.parse(body)
      } catch {
        return json(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } })
      }

      // SEP-2243: gateways route and meter on these headers, so the server must
      // reject any request where header and body disagree — otherwise the
      // header becomes a lie a proxy has already acted on.
      const headerMethod = req.headers['mcp-method']
      const headerName = req.headers['mcp-name']
      if (headerMethod !== undefined && headerMethod !== request.method) {
        return json(400, {
          jsonrpc: '2.0',
          id: request.id ?? null,
          error: { code: ERROR.HEADER_MISMATCH, message: `Mcp-Method "${headerMethod}" does not match body method "${request.method}"` },
        })
      }
      const bodyName = request.params?.name
      if (headerName !== undefined && bodyName !== undefined && headerName !== bodyName) {
        return json(400, {
          jsonrpc: '2.0',
          id: request.id ?? null,
          error: { code: ERROR.HEADER_MISMATCH, message: `Mcp-Name "${headerName}" does not match body name "${bodyName}"` },
        })
      }

      if (request.id === undefined) return json(202, {})
      json(200, respond(request), { 'mcp-protocol-version': PROTOCOL_VERSION })
    })
  })

  server.listen(port, () => {
    process.stderr.write(`atomic-memory-kit MCP (${PROTOCOL_VERSION}) on http://127.0.0.1:${port}\n`)
    if (STATE_SECRET_IS_EPHEMERAL) {
      process.stderr.write(
        'warning: AMK_STATE_SECRET is unset, so requestState is signed with a per-process key. '
        + 'Set it before running more than one instance, or MRTR retries will fail across instances.\n',
      )
    }
  })
}

const httpPort = flag('--http')
if (httpPort) runHttp(Number(httpPort))
else runStdio()
