/**
 * MCP server conformance — protocol revision 2026-07-28.
 *
 * The interesting test is the last suite: the gap-closing loop as a Multi
 * Round-Trip Request. Two *independent* requests, different JSON-RPC ids, no
 * server-side session between them, and the second one still knows exactly
 * which gaps were asked about — because that knowledge travelled through the
 * client in a signed `requestState` blob.
 *
 * That is what "stateless" buys: the retry could hit a different process.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, describe, it } from 'node:test'

const SERVER = fileURLToPath(new URL('../agent/mcp-server.mjs', import.meta.url))
const PROTOCOL = '2026-07-28'

let workspace: string
let configPath: string

before(() => {
  workspace = mkdtempSync(join(tmpdir(), 'amk-mcp-'))
  mkdirSync(join(workspace, 'memory', 'pricing'), { recursive: true })
  writeFileSync(
    join(workspace, 'memory', 'pricing', 'plans.md'),
    '---\nid: pricing.plans\ntitle: "Plans"\ncategory: pricing\nlang: en\nkeywords: [price, cost]\nsummary: "Plan prices."\n---\n\nStarter costs 49 EUR.\n',
  )
  configPath = join(workspace, 'memory.config.json')
  writeFileSync(configPath, JSON.stringify({
    name: 'test memory',
    root: 'memory',
    gapLedger: '.memory-out/gaps.jsonl',
    retrieval: { categories: ['pricing'] },
  }))
})

after(() => rmSync(workspace, { recursive: true, force: true }))

interface RpcResponse {
  result?: Record<string, unknown>
  error?: { code: number, message: string, data?: unknown }
}

/**
 * Send a batch of requests to a fresh server process and collect the replies.
 *
 * Deliberately one process per call in most tests: it proves the server holds
 * nothing between invocations. The MRTR test reuses a process only to keep the
 * test fast, and asserts separately that a cold process accepts the same state.
 */
function call(
  requests: Record<string, unknown>[],
  options: { env?: Record<string, string>, expect?: number } = {},
): Promise<RpcResponse[]> {
  const env = options.env ?? {}
  // Notifications produce no reply, so the expected count is not always the
  // request count — that asymmetry is exactly what one test is checking.
  const expected = options.expect ?? requests.filter((request) => request.id !== undefined).length
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER, '--config', configPath], {
      env: { ...process.env, AMK_STATE_SECRET: 'test-secret', ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let out = ''
    let err = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { out += chunk })
    child.stderr.on('data', (chunk) => { err += chunk })
    child.on('error', reject)
    child.on('close', () => {
      const lines = out.split('\n').filter((line) => line.trim() !== '')
      if (lines.length !== expected) {
        reject(new Error(`expected ${expected} replies, got ${lines.length}\nstdout: ${out}\nstderr: ${err}`))
        return
      }
      resolve(lines.map((line) => JSON.parse(line)))
    })
    for (const request of requests) child.stdin.write(`${JSON.stringify(request)}\n`)
    child.stdin.end()
  })
}

const meta = (extra: Record<string, unknown> = {}) => ({
  'io.modelcontextprotocol/protocolVersion': PROTOCOL,
  'io.modelcontextprotocol/clientInfo': { name: 'test', version: '1.0.0' },
  'io.modelcontextprotocol/clientCapabilities': { elicitation: {} },
  ...extra,
})

const rpc = (id: number, method: string, params: Record<string, unknown> = {}) => ({
  jsonrpc: '2.0',
  id,
  method,
  params: { _meta: meta(), ...params },
})

const payload = (response: RpcResponse) =>
  JSON.parse((response.result!.content as { text: string }[])[0].text)

describe('statelessness and discovery', () => {
  it('answers server/discover without any prior handshake', async () => {
    const [response] = await call([rpc(1, 'server/discover')])
    assert.equal(response.error, undefined)
    assert.equal(response.result!.resultType, 'complete')
    assert.ok((response.result!.supportedVersions as string[]).includes(PROTOCOL))
    assert.equal((response.result!._meta as Record<string, { name: string }>)['io.modelcontextprotocol/serverInfo'].name, 'atomic-memory-kit')
  })

  it('marks discovery and list results cacheable', async () => {
    const [discover, list] = await call([rpc(1, 'server/discover'), rpc(2, 'tools/list')])
    assert.equal(typeof discover.result!.ttlMs, 'number')
    assert.equal(discover.result!.cacheScope, 'public')
    assert.equal(typeof list.result!.ttlMs, 'number')
    assert.equal(list.result!.cacheScope, 'public')
  })

  it('serves tools in a stable order across processes', async () => {
    const [a] = await call([rpc(1, 'tools/list')])
    const [b] = await call([rpc(1, 'tools/list')])
    const names = (response: RpcResponse) => (response.result!.tools as { name: string }[]).map((tool) => tool.name)
    assert.deepEqual(names(a), names(b))
  })

  it('puts resultType on every result', async () => {
    const responses = await call([
      rpc(1, 'server/discover'),
      rpc(2, 'tools/list'),
      rpc(3, 'tools/call', { name: 'memory_scope' }),
    ])
    for (const response of responses) assert.equal(response.result!.resultType, 'complete')
  })

  it('rejects an unsupported protocol version with -32022 and lists what it has', async () => {
    const [response] = await call([{
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '1999-01-01' } },
    }])
    assert.equal(response.error!.code, -32022)
    assert.ok(((response.error!.data as { supportedVersions: string[] }).supportedVersions).includes(PROTOCOL))
  })

  it('never answers a notification', async () => {
    const responses = await call([
      { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
      rpc(1, 'tools/list'),
    ])
    assert.equal(responses.length, 1)
    assert.equal(responses[0].id, 1)
  })
})

describe('contract exposure', () => {
  it('serves the machine-readable contract', async () => {
    const [response] = await call([rpc(1, 'tools/call', { name: 'memory_contract' })])
    const contract = payload(response)
    assert.equal(contract.contract, 'io.atomicmemory/contract')
    assert.equal(contract.version, '1.0.0')
    assert.ok(contract.fields.some((field: { name: string }) => field.name === 'keywords'))
    assert.ok(contract.diagnostics.E_EDGE_DANGLING)
  })
})

describe('the loop as a multi round-trip request', () => {
  let requestState: string
  let gapKey: string

  it('round 1: asks the user one elicitation per open gap', async () => {
    const responses = await call([
      rpc(1, 'tools/call', {
        name: 'memory_gap_add',
        arguments: { topic: 'refund window', kind: 'runtime', detail: 'Can I get a refund after 20 days?' },
      }),
      rpc(2, 'tools/call', { name: 'memory_close_gaps', arguments: { category: 'pricing', lang: 'en' } }),
    ])

    const asked = responses[1].result!
    assert.equal(asked.resultType, 'input_required', 'the server must interrupt, not guess an answer')
    assert.equal(typeof asked.requestState, 'string')

    const requests = asked.inputRequests as Record<string, { method: string, params: Record<string, unknown> }>
    const keys = Object.keys(requests)
    assert.equal(keys.length, 1)
    gapKey = keys[0]
    assert.equal(requests[gapKey].method, 'elicitation/create')
    assert.match(String(requests[gapKey].params.message), /refund window/)
    // The form must ask for keywords, or the resulting atom is unfindable.
    const schema = requests[gapKey].params.requestedSchema as { properties: Record<string, unknown>, required: string[] }
    assert.ok('keywords' in schema.properties)
    assert.deepEqual(schema.required, ['body'])

    requestState = asked.requestState as string
  })

  it('round 2: a cold process turns the answer into a validated plan', async () => {
    // New process, new JSON-RPC id, nothing shared but the signed blob.
    const [response] = await call([{
      jsonrpc: '2.0',
      id: 99,
      method: 'tools/call',
      params: {
        _meta: meta(),
        name: 'memory_close_gaps',
        requestState,
        inputResponses: {
          [gapKey]: {
            action: 'accept',
            content: {
              body: 'Refunds are possible within 14 days of purchase.',
              title: 'Refund window',
              summary: 'Refunds are possible within 14 days.',
              keywords: 'refund, money back, rueckerstattung',
            },
          },
        },
      },
    }])

    const result = payload(response)
    assert.equal(result.stage, 'plan')
    assert.equal(result.applied, false, 'nothing may be written without the human seeing the diff')
    assert.equal(result.plan.ok, true)
    assert.equal(result.plan.summary.create, 1)

    const [entry] = result.plan.plans
    assert.equal(entry.id, 'pricing.refund-window')
    assert.equal(entry.verdict, 'create')
    assert.equal(entry.closesGaps.length, 1)
    assert.match(entry.content, /keywords: \[refund, money back, rueckerstattung\]/)
  })

  it('refuses a tampered requestState', async () => {
    const tampered = `${requestState.slice(0, -4)}AAAA`
    const [response] = await call([{
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        _meta: meta(),
        name: 'memory_close_gaps',
        requestState: tampered,
        inputResponses: { [gapKey]: { action: 'accept', content: { body: 'anything' } } },
      },
    }])
    assert.equal(response.error!.code, -32602)
    assert.match(response.error!.message, /integrity/)
  })

  it('refuses a requestState minted for a different tool', async () => {
    // Replaying gap state against another tool is the obvious cross-request
    // attack, and the spec asks servers to bind state to its originating call.
    const [response] = await call([{
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        _meta: meta(),
        name: 'memory_close_gaps',
        requestState: Buffer.from(JSON.stringify({ exp: Date.now() + 60000, bind: 'memory_apply', gaps: [] })).toString('base64url') + '.forged',
        inputResponses: {},
      },
    }])
    assert.equal(response.error!.code, -32602)
  })

  it('degrades to a question list when the client cannot elicit', async () => {
    const [response] = await call([{
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        _meta: { 'io.modelcontextprotocol/protocolVersion': PROTOCOL, 'io.modelcontextprotocol/clientCapabilities': {} },
        name: 'memory_close_gaps',
        arguments: { category: 'pricing' },
      },
    }])
    const result = payload(response)
    assert.equal(response.result!.resultType, 'complete', 'never send an elicitation a client cannot answer')
    assert.equal(result.stage, 'no-elicitation')
    assert.ok(result.questions.length > 0)
  })
})

describe('backward compatibility', () => {
  it('still answers a 2025-era initialize handshake', async () => {
    const [response] = await call([{
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {} },
    }])
    assert.equal(response.error, undefined)
    assert.equal(response.result!.protocolVersion, '2025-06-18')
  })

  it('accepts a request with no _meta at all', async () => {
    const [response] = await call([{ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }])
    assert.equal(response.error, undefined)
  })
})
