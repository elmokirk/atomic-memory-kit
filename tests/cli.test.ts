/**
 * CLI exit codes and smoke runs, against a real process.
 *
 * Exit codes are the CLI's contract with CI: a pipeline cannot read "error" in
 * red, only a non-zero status. Each case runs in a throwaway copy of example/
 * so the planted problems are the fixture and the repo is never written to.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, it } from 'node:test'

const CLI = fileURLToPath(new URL('../cli/amk.mjs', import.meta.url))
const EXAMPLE = fileURLToPath(new URL('../example', import.meta.url))

let workspace: string

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'amk-cli-'))
  cpSync(EXAMPLE, workspace, {
    recursive: true,
    filter: (source) => !source.includes('.memory-out'),
  })
})

afterEach(() => rmSync(workspace, { recursive: true, force: true }))

function amk(args: string[], nodeArgs: string[] = []) {
  const result = spawnSync(process.execPath, [...nodeArgs, CLI, ...args], {
    cwd: workspace,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  })
  return { status: result.status, out: `${result.stdout}${result.stderr}` }
}

describe('amk drift', () => {
  it('exits non-zero when the planted SLA contradiction is reported as an error', () => {
    const { status, out } = amk(['drift'])
    assert.match(out, /error unbacked-number: "website:support\.sla"/)
    assert.equal(status, 1)
  })

  it('exits zero when every claim is backed, even with untested-atom warnings', () => {
    writeFileSync(join(workspace, 'memory', '_kit', 'claims.json'), '[]\n')
    writeFileSync(join(workspace, 'memory', '_kit', 'eval-cases.json'), '[]\n')
    const { status, out } = amk(['drift'])
    assert.match(out, /warn /)
    assert.doesNotMatch(out, /error /)
    assert.equal(status, 0)
  })
})

/** Every file outside .memory-out/, with its content: what a user would commit. */
function snapshot(dir: string) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((path) => !path.includes('.memory-out'))
    .sort()
    .map((path) => `${path}\n${readFileSync(path, 'utf8')}`)
}

describe('every command runs in example/', () => {
  // [args, expected exit]. drift and doctor exit 1 because example/ plants a
  // drift error on purpose; every other command must succeed.
  const runs: [string[], number][] = [
    [['validate'], 0],
    [['stats'], 0],
    [['contract'], 0],
    [['contract', '--json'], 0],
    [['search', 'what does it cost'], 0],
    [['compile'], 0],
    [['import', '.memory-out/bundle.md', '--dry-run'], 0],
    [['import', '.memory-out/compiled.json'], 0],
    [['index'], 0],
    [['eval'], 0],
    [['drift'], 1],
    [['expiring', '--within', '30'], 0],
    [['gaps', 'add', 'sso setup'], 0],
    [['gaps'], 0],
    [['gaps', '--report'], 0],
    [['gaps', 'sync', '.memory-out/GAPS.md'], 0],
    [['doctor'], 1],
  ]

  it('each command exits with its documented status, in order', () => {
    for (const [args, expected] of runs) {
      const { status, out } = amk(args)
      assert.equal(status, expected, `amk ${args.join(' ')}\n${out}`)
    }
  })

  it('doctor still reaches the gap summary after drift reports an error', () => {
    const { out } = amk(['doctor'])
    assert.match(out, /gaps — \d+ open/)
  })

  it('the README quickstart writes nothing outside .memory-out/', () => {
    const before = snapshot(workspace)
    assert.ok(before.length >= 6, 'snapshot must see the example atoms')
    for (const args of [['validate'], ['eval'], ['drift'], ['compile'], ['search', 'what does it cost']]) amk(args)
    assert.deepEqual(snapshot(workspace), before)
  })

  it('init scaffolds a memory that validates', () => {
    rmSync(workspace, { recursive: true, force: true })
    mkdirSync(workspace)
    assert.equal(amk(['init']).status, 0)
    assert.equal(amk(['validate']).status, 0)
  })
})

describe('Node version floor', () => {
  // Simulates an old Node: the version reads 22.17.0 and any .ts import throws,
  // as it does without type stripping. The message must win that race.
  const OLD_NODE = [
    '--import',
    'data:text/javascript,import { registerHooks } from "node:module";'
      + 'Object.defineProperty(process.versions, "node", { value: "22.17.0" });'
      + 'registerHooks({ resolve(s, c, next) { if (s.endsWith(".ts")) throw new Error("no type stripping"); return next(s, c) } })',
  ]

  it('refuses to start below 22.18.0 with one clear line, before any .ts import', () => {
    const { status, out } = amk(['contract'], OLD_NODE)
    assert.match(out, /requires Node >= 22\.18\.0, this is 22\.17\.0/)
    assert.doesNotMatch(out, /no type stripping/)
    assert.equal(status, 1)
  })
})
