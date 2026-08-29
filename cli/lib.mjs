/**
 * CLI plumbing: config resolution, argument parsing, output helpers.
 *
 * Kept separate from amk.mjs so the commands read as commands.
 */
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { defineMemoryConfig } from '../src/config.ts'

export const DEFAULT_CONFIG_FILE = 'memory.config.json'

const CONFIG_DEFAULTS = {
  name: '',
  root: 'memory',
  out: '.memory-out',
  indexAtomId: 'index.scope',
  evalCases: 'memory/_kit/eval-cases.json',
  claims: 'memory/_kit/claims.json',
  gapLedger: '.memory-out/gaps.jsonl',
  baseline: '.memory-out/eval-baseline.json',
  retrieval: {},
  thresholds: null,
}

/** Parse `--key value`, `--key=value` and `--flag` into an object plus positionals. */
export function parseArgs(argv) {
  const flags = {}
  const positional = []
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]
    if (!token.startsWith('--')) {
      positional.push(token)
      continue
    }
    const body = token.slice(2)
    const eq = body.indexOf('=')
    if (eq !== -1) {
      flags[body.slice(0, eq)] = body.slice(eq + 1)
      continue
    }
    const next = argv[index + 1]
    if (next !== undefined && !next.startsWith('--')) {
      flags[body] = next
      index++
    } else {
      flags[body] = true
    }
  }
  return { flags, positional }
}

export function loadConfig(flags = {}) {
  const cwd = process.cwd()
  const configPath = resolve(cwd, flags.config ?? DEFAULT_CONFIG_FILE)
  let fileConfig = {}
  if (existsSync(configPath)) {
    try {
      fileConfig = JSON.parse(readFileSync(configPath, 'utf8'))
    } catch (error) {
      fail(`${configPath} is not valid JSON: ${error.message}`)
    }
  }

  const merged = { ...CONFIG_DEFAULTS, ...fileConfig }
  if (flags.root) merged.root = flags.root
  if (flags.out) merged.out = flags.out

  const abs = (value) => (isAbsolute(value) ? value : join(cwd, value))

  return {
    ...merged,
    configPath,
    configExists: existsSync(configPath),
    rootDir: abs(merged.root),
    outDir: abs(merged.out),
    evalCasesPath: abs(merged.evalCases),
    claimsPath: abs(merged.claims),
    gapLedgerPath: abs(merged.gapLedger),
    baselinePath: abs(merged.baseline),
    memoryConfig: defineMemoryConfig(merged.retrieval ?? {}),
  }
}

/* ------------------------------------------------------------------ *
 * Output
 * ------------------------------------------------------------------ */

const useColor = process.stdout.isTTY && !process.env.NO_COLOR
const ESC = String.fromCharCode(27)
const paint = (code, text) => (useColor ? ESC + `[${code}m` + text + ESC + `[0m` : text)

export const style = {
  bold: (text) => paint('1', text),
  dim: (text) => paint('2', text),
  red: (text) => paint('31', text),
  green: (text) => paint('32', text),
  yellow: (text) => paint('33', text),
  cyan: (text) => paint('36', text),
}

export function heading(text) {
  console.log(`\n${style.bold(text)}`)
}

export function ok(text) {
  console.log(`${style.green('  ok')} ${text}`)
}

export function warn(text) {
  console.log(`${style.yellow('  warn')} ${text}`)
}

export function info(text) {
  console.log(`${style.dim(`  ${text}`)}`)
}

export function error(text) {
  console.error(`${style.red('  error')} ${text}`)
}

export function fail(message, code = 1) {
  console.error(`\n${style.red('amk:')} ${message}\n`)
  process.exit(code)
}

export function readJsonFile(path, fallback = null) {
  if (!existsSync(path)) return fallback
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    fail(`${path} is not valid JSON: ${err.message}`)
  }
}
