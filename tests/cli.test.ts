/**
 * CLI exit codes and smoke runs, against a real process.
 *
 * Exit codes are the CLI's contract with CI: a pipeline cannot read "error" in
 * red, only a non-zero status. Each case runs in a throwaway copy of example/
 * so the planted problems are the fixture and the repo is never written to.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
