/**
 * HTTP transport safety (red-team R16).
 *
 * The oracle is the operating system, not the server's own log: a socket that
 * accepts a connection on a non-loopback address is exposed, whatever the
 * startup line claims. The log is then checked against the address that
 * actually answered.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { networkInterfaces, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, afterEach, before, describe, it } from 'node:test'

const SERVER = fileURLToPath(new URL('../agent/mcp-server.mjs', import.meta.url))

let workspace: string
let configPath: string
const children: ChildProcess[] = []

before(() => {
  workspace = mkdtempSync(join(tmpdir(), 'amk-http-'))
  mkdirSync(join(workspace, 'memory', 'pricing'), { recursive: true })
  writeFileSync(
    join(workspace, 'memory', 'pricing', 'plans.md'),
    '---\nid: pricing.plans\ntitle: "Plans"\ncategory: pricing\nlang: en\nkeywords: [price, cost]\nsummary: "Plan prices."\n---\n\nStarter costs 49 EUR.\n',
  )
  configPath = join(workspace, 'memory.config.json')
  writeFileSync(configPath, JSON.stringify({
    root: 'memory',
    gapLedger: '.memory-out/gaps.jsonl',
    retrieval: { categories: ['pricing'] },
  }))
})

afterEach(() => {
  for (const child of children.splice(0)) child.kill()
  rmSync(join(workspace, '.memory-out'), { recursive: true, force: true })
})

after(() => rmSync(workspace, { recursive: true, force: true }))

interface Started { host: string, port: number, log: string }

/** Start the server on an OS-chosen port and wait for the address it reports. */
function start(extraArgs: string[] = [], env: Record<string, string> = {}): Promise<Started> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER, '--config', configPath, '--http', '0', ...extraArgs], {
      env: { ...process.env, AMK_STATE_SECRET: 'test-secret', AMK_AUTH_TOKEN: '', ...env },
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    children.push(child)
    let log = ''
    const timer = setTimeout(() => reject(new Error(`no address logged:\n${log}`)), 5000)
    child.stderr!.setEncoding('utf8')
    child.stderr!.on('data', (chunk: string) => {
      log += chunk
      const match = /on http:\/\/(?:\[([^\]]+)\]|([^:\s]+)):(\d+)/.exec(log)
      if (match) {
        clearTimeout(timer)
        resolve({ host: match[1] ?? match[2], port: Number(match[3]), log })
      }
    })
    child.on('exit', () => { clearTimeout(timer); reject(new Error(`server exited:\n${log}`)) })
  })
}

function canConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port })
    socket.setTimeout(1500)
    socket.on('connect', () => { socket.destroy(); resolve(true) })
    socket.on('error', () => resolve(false))
    socket.on('timeout', () => { socket.destroy(); resolve(false) })
  })
}

/** A non-loopback IPv4 address of this machine, if it has one. */
function externalAddress(): string | undefined {
  for (const list of Object.values(networkInterfaces())) {
    for (const entry of list ?? []) if (entry.family === 'IPv4' && !entry.internal) return entry.address
  }
  return undefined
}

async function callTool(target: Started, name: string, args: Record<string, unknown>, token?: string) {
  const host = target.host.includes(':') ? `[${target.host}]` : target.host
  const response = await fetch(`http://${host}:${target.port}/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  })
  return await response.json() as { result?: { content: { text: string }[] }, error?: { code: number, message: string } }
}

describe('http binding (R16)', () => {
  it('binds loopback by default and logs the address that actually answers', async () => {
    const started = await start()
    assert.equal(started.host, '127.0.0.1')
    assert.notEqual(started.port, 0, 'the log must print the bound port, not the requested one')
    assert.equal(await canConnect('127.0.0.1', started.port), true)
    const external = externalAddress()
    if (external) assert.equal(await canConnect(external, started.port), false, `reachable on ${external}`)
  })

  it('binds the host named by --host and logs it', async (t) => {
    const hasIpv6Loopback = Object.values(networkInterfaces()).some((list) =>
      (list ?? []).some((entry) => entry.address === '::1'))
    if (!hasIpv6Loopback) return t.skip('no ::1 on this machine')
    const started = await start(['--host', '::1'])
    assert.equal(started.host, '::1')
    assert.equal(await canConnect('::1', started.port), true)
    assert.equal(await canConnect('127.0.0.1', started.port), false)
  })
})

describe('writes over http need a token (R16)', () => {
  const writes: [string, Record<string, unknown>][] = [
    ['memory_apply', { atoms: [] }],
    ['memory_gap_add', { topic: 'sso pricing' }],
    ['memory_gap_close', { id: 'whatever' }],
    ['memory_close_gaps', { autoApply: true }],
  ]

  for (const [name, args] of writes) {
    it(`refuses ${name} without a configured token and writes nothing`, async () => {
      const started = await start()
      const before = readdirSync(join(workspace, 'memory'), { recursive: true }).sort()
      const reply = await callTool(started, name, args)
      assert.ok(reply.error, `expected a refusal, got ${JSON.stringify(reply)}`)
      assert.match(reply.error.message, /AMK_AUTH_TOKEN/)
      assert.equal(existsSync(join(workspace, '.memory-out')), false)
      assert.deepEqual(readdirSync(join(workspace, 'memory'), { recursive: true }).sort(), before)
    })
  }

  it('keeps read tools working without a token', async () => {
    const started = await start()
    const reply = await callTool(started, 'memory_search', { query: 'price' })
    assert.equal(reply.error, undefined)
    assert.match(reply.result!.content[0].text, /pricing\.plans/)
  })

  it('leaves stdio writes untouched: no token needed', async () => {
    const child = spawn(process.execPath, [SERVER, '--config', configPath], {
      env: { ...process.env, AMK_AUTH_TOKEN: '' },
      stdio: ['pipe', 'pipe', 'ignore'],
    })
    let out = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { out += chunk })
    const closed = new Promise((resolve) => child.on('close', resolve))
    child.stdin.end(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'memory_gap_add', arguments: { topic: 'sso pricing' } } })}\n`)
    await closed
    assert.equal(JSON.parse(out).error, undefined)
    assert.equal(existsSync(join(workspace, '.memory-out', 'gaps.jsonl')), true)
  })

  it('accepts a write when a token is configured and presented', async () => {
    const started = await start([], { AMK_AUTH_TOKEN: 'secret-token' })
    const reply = await callTool(started, 'memory_gap_add', { topic: 'sso pricing' }, 'secret-token')
    assert.equal(reply.error, undefined)
    assert.equal(existsSync(join(workspace, '.memory-out', 'gaps.jsonl')), true)
  })
})
