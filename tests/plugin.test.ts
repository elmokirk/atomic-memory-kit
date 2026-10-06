/**
 * Claude Code plugin — the manifest, not a copy of it, drives the server.
 *
 * Each test expands the `mcpServers` entry of `.claude-plugin/plugin.json` the
 * way Claude Code does (`${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PROJECT_DIR}`,
 * `${user_config.*}`) and spawns the result. If someone edits the manifest so
 * writes are on by default, or points it at a path that does not exist, these
 * fail.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, describe, it } from 'node:test'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const plugin = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'))
const marketplace = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'))
const server = plugin.mcpServers.memory as { command: string, args: string[] }

let project: string

before(() => {
  project = mkdtempSync(join(tmpdir(), 'amk-plugin-'))
  mkdirSync(join(project, 'memory', 'pricing'), { recursive: true })
  writeFileSync(
    join(project, 'memory', 'pricing', 'plans.md'),
    '---\nid: pricing.plans\ntitle: "Plans"\ncategory: pricing\nlang: en\nkeywords: [price, cost]\nsummary: "Plan prices."\n---\n\nStarter costs 49 EUR.\n',
  )
  writeFileSync(join(project, 'memory.config.json'), JSON.stringify({
    root: 'memory',
    gapLedger: '.memory-out/gaps.jsonl',
    retrieval: { categories: ['pricing'] },
  }))
})

after(() => rmSync(project, { recursive: true, force: true }))

/** Expand placeholders; a `user_config` key absent from `options` stays literal, as an unset value might. */
function expand(value: string, projectDir: string, options: Record<string, string>): string {
  return value
    .replaceAll('${CLAUDE_PLUGIN_ROOT}', ROOT.replace(/[\\/]$/, ''))
    .replaceAll('${CLAUDE_PROJECT_DIR}', projectDir)
    .replace(/\$\{user_config\.(\w+)\}/g, (literal, key) => options[key] ?? literal)
}

const defaults = (): Record<string, string> => Object.fromEntries(
  Object.entries(plugin.userConfig as Record<string, { default?: unknown }>)
    .filter(([, option]) => option.default !== undefined)
    .map(([key, option]) => [key, String(option.default)]),
)

function callTool(name: string, args: Record<string, unknown>, options: Record<string, string>, projectDir = project) {
  return new Promise<{ result?: Record<string, unknown>, error?: { message: string } }>((resolve, reject) => {
    const command = server.command === 'node' ? process.execPath : server.command
    const child = spawn(command, server.args.map((arg) => expand(arg, projectDir, options)), { stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { out += chunk })
    child.stderr.on('data', (chunk) => { err += chunk })
    child.on('error', reject)
    child.on('close', () => {
      const line = out.split('\n').find((entry) => entry.trim() !== '')
      if (!line) return reject(new Error(`no reply\nstderr: ${err}`))
      resolve(JSON.parse(line))
    })
    child.stdin.end(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })}\n`)
  })
}

const ledger = () => join(project, '.memory-out', 'gaps.jsonl')

describe('plugin manifest', () => {
  it('lists the plugin from the marketplace root, so agent/ and src/ are inside the plugin', () => {
    assert.equal(marketplace.plugins[0].name, plugin.name)
    assert.equal(marketplace.plugins[0].source, './')
  })

  it('starts the existing server, not a copy', () => {
    assert.equal(server.args[0], '${CLAUDE_PLUGIN_ROOT}/agent/mcp-server.mjs')
    assert.ok(existsSync(expand(server.args[0], project, {})))
  })

  it('ships with writes off', () => {
    assert.equal(plugin.userConfig.allow_writes.default, false)
  })
})

describe('plugin server: read-only by default', () => {
  it('answers reads with the default options', async () => {
    const reply = await callTool('memory_search', { query: 'price' }, defaults())
    assert.equal(reply.error, undefined)
    assert.match(JSON.stringify(reply.result), /pricing\.plans/)
  })

  it('records a gap with the default options: the ledger is the point, atoms stay untouched', async () => {
    rmSync(join(project, '.memory-out'), { recursive: true, force: true })
    const reply = await callTool('memory_gap_add', { topic: 'SSO pricing' }, defaults())
    assert.equal(reply.error, undefined)
    assert.ok(existsSync(ledger()))
  })

  it('refuses memory_gap_close with the default options', async () => {
    const reply = await callTool('memory_gap_close', { id: 'runtime:sso pricing' }, defaults())
    assert.match(reply.error?.message ?? '', /read-only/)
    assert.match(reply.error?.message ?? '', /allow_writes/)
  })

  it('refuses memory_apply with the default options', async () => {
    const reply = await callTool('memory_apply', { atoms: [] }, defaults())
    assert.match(reply.error?.message ?? '', /read-only/)
  })

  it('refuses writes when allow_writes was never substituted (fails closed)', async () => {
    const { allow_writes: _, ...rest } = defaults()
    const reply = await callTool('memory_apply', { atoms: [] }, rest)
    assert.match(reply.error?.message ?? '', /read-only/)
  })

  it('writes once allow_writes is true', async () => {
    rmSync(join(project, '.memory-out'), { recursive: true, force: true })
    const reply = await callTool('memory_gap_add', { topic: 'SSO pricing' }, { ...defaults(), allow_writes: 'true' })
    assert.equal(reply.error, undefined)
    assert.ok(existsSync(ledger()))
  })
})

describe('plugin server: memory config', () => {
  it('tells the user what to do when the project has no memory.config.json', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'amk-plugin-empty-'))
    try {
      const reply = await callTool('memory_scope', {}, defaults(), empty)
      const text = JSON.stringify(reply)
      assert.match(text, /no memory config at/)
      assert.match(text, /memory\.config\.json/)
      assert.match(text, /INTEGRATIONS\.md/)
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  })
})
