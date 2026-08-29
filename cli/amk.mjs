#!/usr/bin/env node
/**
 * amk — Atomic Memory Kit CLI.
 *
 * Every command is a thin shell over `src/`: config in, pure functions, files
 * out. Nothing here contains logic worth testing; the logic lives in src/ and
 * is tested there.
 *
 * Requires Node >= 22.6 (native TypeScript type stripping, no build step).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  readGapLedger,
  readMemoryDir,
  writeGapLedger,
  writeMemoryFiles,
  writeText,
} from '../adapters/fs.ts'
import {
  buildScopeIndex,
  compileMemory,
  decompile,
  parseBundle,
  renderBundle,
  renderDigest,
} from '../src/compile.ts'
import { checkDrift, driftToGaps, findUncoveredAtoms } from '../src/drift.ts'
import {
  checkThresholds,
  compareBaseline,
  defaultThresholds,
  evalToGaps,
  runEval,
} from '../src/eval.ts'
import {
  createGapLedger,
  findTodoMarkers,
  parseGapReport,
  renderGapReport,
} from '../src/gaps.ts'
import { findOrphanAtoms, loadMemory } from '../src/loader.ts'
import { searchMemory } from '../src/search.ts'
import { MemoryContractError } from '../src/types.ts'

import {
  error,
  fail,
  heading,
  info,
  loadConfig,
  ok,
  parseArgs,
  readJsonFile,
  style,
  warn,
} from './lib.mjs'
import { readFileSync } from 'node:fs'

const USAGE = `
${style.bold('amk')} — atomic memory kit

  ${style.bold('amk init')} [--root memory]        scaffold a memory root + config
  ${style.bold('amk validate')}                    load, verify the contract and the graph
  ${style.bold('amk stats')}                       counts, categories, edges, budget health
  ${style.bold('amk search')} <query> [--context c] retrieve against the memory, show scores

  ${style.bold('amk compile')} [--gaps]            write bundle.md + compiled.json + digest.md
  ${style.bold('amk import')} <file>               bundle.md or compiled.json back into atoms
  ${style.bold('amk index')}                       regenerate the scope index atom

  ${style.bold('amk eval')} [--update-baseline]    run eval cases, record eval gaps
  ${style.bold('amk drift')}                       check external claims against atoms
  ${style.bold('amk gaps')} [--report] [--sync f]  show / render / reconcile the gap ledger
  ${style.bold('amk gaps add')} <topic>            record a gap by hand
  ${style.bold('amk doctor')}                      validate + eval + drift + gaps in one run

  Global flags: --config <file>  --root <dir>  --out <dir>  --json  --quiet
`

const { flags, positional } = parseArgs(process.argv.slice(2))
const command = positional[0]

if (!command || flags.help || command === 'help') {
  console.log(USAGE)
  process.exit(0)
}

const config = loadConfig(flags)

/* ------------------------------------------------------------------ *
 * Shared loading
 * ------------------------------------------------------------------ */

function load({ quiet = false } = {}) {
  if (!existsSync(config.rootDir)) {
    fail(`memory root not found: ${config.rootDir}\nRun \`amk init\` or set "root" in ${config.configPath}.`)
  }
  const files = readMemoryDir(config.rootDir)
  try {
    const report = loadMemory(files, config.memoryConfig)
    if (!quiet && report.base.atoms.length === 0) {
      warn(`no atoms found under ${config.root} — is the path right?`)
    }
    return report
  } catch (err) {
    if (err instanceof MemoryContractError) {
      fail(`contract violation\n  ${err.message}\n\nThe memory was NOT loaded. Fix the atom and re-run.`)
    }
    throw err
  }
}

function ledgerFromDisk() {
  return createGapLedger(readGapLedger(config.gapLedgerPath))
}

function persistLedger(ledger) {
  writeGapLedger(config.gapLedgerPath, ledger.all())
}

/**
 * Detectors that read the memory itself rather than an external run: author
 * TODOs, graph cycles, graph islands. Shared by `gaps` and `doctor` so the two
 * can never report different numbers.
 */
function refreshStructuralGaps(ledger) {
  const { base, warnings } = load({ quiet: true })
  for (const observation of findTodoMarkers(base.atoms)) ledger.observe(observation)
  for (const warning of warnings.filter((entry) => entry.message.startsWith('related[] cycle'))) {
    ledger.observe({ kind: 'cycle', topic: warning.message, atomId: warning.path, source: 'amk gaps' })
  }
  for (const atom of findOrphanAtoms(base)) {
    ledger.observe({ kind: 'orphan', topic: `no edges to or from ${atom.id}`, atomId: atom.id, source: 'amk gaps' })
  }
  persistLedger(ledger)
  return base
}

function loadEvalCases() {
  const cases = readJsonFile(config.evalCasesPath, null)
  if (!cases) return null
  return Array.isArray(cases) ? cases : cases.cases ?? null
}

/* ------------------------------------------------------------------ *
 * Commands
 * ------------------------------------------------------------------ */

const commands = {
  init() {
    if (config.configExists && !flags.force) {
      fail(`${config.configPath} already exists. Use --force to overwrite.`)
    }
    mkdirSync(join(config.rootDir, '_kit'), { recursive: true })
    mkdirSync(join(config.rootDir, 'general'), { recursive: true })

    writeFileSync(config.configPath, `${JSON.stringify({
      name: flags.name ?? 'my memory',
      root: config.root,
      out: config.out,
      indexAtomId: config.indexAtomId,
      evalCases: config.evalCases,
      claims: config.claims,
      gapLedger: config.gapLedger,
      baseline: config.baseline,
      retrieval: {
        categories: ['general', 'scope'],
        intents: [],
        minScore: 3,
        maxChunks: 4,
        charBudget: 2500,
      },
    }, null, 2)}\n`, 'utf8')

    const example = join(config.rootDir, 'general', 'example.md')
    if (!existsSync(example)) {
      writeFileSync(example, `---
id: general.example
title: "Example atom"
category: general
lang: en
keywords: [example, starter, beispiel]
summary: "One sentence that fully describes what this atom holds."
---

# Example atom

- One checkable fact per line.
- Replace this file with real knowledge.

<!-- TODO(you): this marker becomes a gap in \`amk gaps\` -->
`, 'utf8')
    }

    const cases = join(config.rootDir, '_kit', 'eval-cases.json')
    if (!existsSync(cases)) {
      writeFileSync(cases, `${JSON.stringify([
        { q: 'what is the example about', expectScope: 'match', expectIds: ['general.example'], expectCategories: ['general'], mustNotRetrieve: [] },
        { q: 'how do I bake sourdough bread', expectScope: 'no_match', expectIds: [], mustNotRetrieve: ['general.example'] },
      ], null, 2)}\n`, 'utf8')
    }

    ok(`config    ${config.configPath}`)
    ok(`memory    ${config.rootDir}`)
    ok(`eval      ${cases}`)
    console.log(`\nNext: ${style.cyan('amk validate')} → ${style.cyan('amk eval')} → ${style.cyan('amk compile')}\n`)
  },

  validate() {
    const { base, warnings, infos, skipped } = load()
    heading(`validate — ${base.atoms.length} atoms from ${config.root}`)

    for (const issue of warnings) warn(`${issue.path}: ${issue.message}`)
    for (const issue of infos) info(`${issue.path}: ${issue.message}`)
    if (skipped.length > 0) info(`skipped ${skipped.length} meta/non-atom file(s)`)

    const indexThreshold = config.memoryConfig.indexRequiredAtAtoms ?? Infinity
    const hasIndex = base.atoms.some((atom) => atom.id === config.indexAtomId)
    if (base.atoms.length >= indexThreshold && !hasIndex) {
      warn(`${base.atoms.length} atoms without a scope index — run \`amk index\``)
    }

    const orphans = findOrphanAtoms(base)
    if (orphans.length > 0) info(`${orphans.length} atom(s) have no graph edges (see \`amk gaps\`)`)

    if (warnings.length === 0) ok('contract clean, graph intact')
    else console.log(`\n${style.yellow(`${warnings.length} warning(s)`)} — atoms loaded, but read them.`)

    if (flags.strict && warnings.length > 0) process.exit(1)
  },

  stats() {
    const { base } = load({ quiet: true })
    const byCategory = new Map()
    let edges = 0
    let bodyChars = 0
    for (const atom of base.atoms) {
      byCategory.set(atom.category, (byCategory.get(atom.category) ?? 0) + 1)
      edges += (atom.related ?? []).length
      bodyChars += atom.body.length
    }
    heading(`stats — ${config.name || config.root}`)
    console.log(`  atoms            ${base.atoms.length}`)
    console.log(`  always-include   ${base.alwaysInclude.length}`)
    console.log(`  categories       ${byCategory.size}`)
    console.log(`  edges            ${edges}`)
    console.log(`  orphans          ${findOrphanAtoms(base).length}`)
    console.log(`  avg body chars   ${base.atoms.length ? Math.round(bodyChars / base.atoms.length) : 0}`)
    console.log(`  char budget      ${base.config.charBudget} (max ${base.config.maxChunks} chunks)`)
    heading('by category')
    for (const [category, count] of [...byCategory].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(count).padStart(4)}  ${category}`)
    }
    console.log()
  },

  search() {
    const query = positional.slice(1).join(' ')
    if (!query) fail('usage: amk search <query> [--context /pricing]')
    const { base } = load({ quiet: true })
    const result = searchMemory(base, query, { context: typeof flags.context === 'string' ? flags.context : undefined })

    if (flags.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }

    heading(`search — "${query}"`)
    console.log(`  scope: ${result.scopeStatus === 'match' ? style.green('match') : style.yellow('no_match')}  best score: ${result.bestScore} (threshold ${base.config.minScore})`)
    if (result.scopeStatus === 'no_match') {
      console.log(`\n  ${style.dim('Nothing scored above the threshold. In production this is a `scope` gap:')}`)
      console.log(`  ${style.dim(`amk gaps add "${query}" --kind scope`)}\n`)
      return
    }
    heading('always injected')
    for (const atom of base.alwaysInclude) console.log(`  ${atom.id}`)
    heading('retrieved')
    for (const chunk of result.chunks) {
      const tag = chunk.viaEdge ? style.cyan(' via edge') : ''
      console.log(`  ${String(chunk.score).padStart(6)}  ${chunk.id}${tag}`)
      console.log(`          ${style.dim(chunk.content.replace(/\s+/g, ' ').slice(0, 110))}`)
    }
    console.log()
  },

  compile() {
    const { base } = load({ quiet: true })
    const ledger = ledgerFromDisk()
    const gaps = flags.gaps === false ? [] : ledger.open()

    const compiled = compileMemory(base, gaps)
    const bundlePath = join(config.outDir, 'bundle.md')
    const jsonPath = join(config.outDir, 'compiled.json')
    const digestPath = join(config.outDir, 'digest.md')

    writeText(bundlePath, renderBundle(base, { name: config.name, gaps }))
    writeText(jsonPath, `${JSON.stringify(compiled, null, 2)}\n`)
    writeText(digestPath, renderDigest(compiled))

    heading(`compile — ${base.atoms.length} atoms, ${gaps.length} open gaps`)
    ok(`bundle    ${bundlePath}   ${style.dim('editable, round-trips back via `amk import`')}`)
    ok(`compiled  ${jsonPath}     ${style.dim('machine transport (agents, RAG, MCP)')}`)
    ok(`digest    ${digestPath}   ${style.dim('read-only overview')}`)
    console.log()
  },

  import() {
    const source = positional[1]
    if (!source) fail('usage: amk import <bundle.md | compiled.json>')
    if (!existsSync(source)) fail(`file not found: ${source}`)
    const raw = readFileSync(source, 'utf8')

    let files
    let closedGapIds = []
    if (source.endsWith('.json')) {
      files = decompile(JSON.parse(raw), config.indexAtomId)
    } else {
      const parsed = parseBundle(raw, config.indexAtomId)
      if (parsed.problems.length > 0) {
        heading('bundle problems')
        for (const problem of parsed.problems) error(problem)
        if (!flags.force) fail('refusing to import a bundle with problems. Fix them, or pass --force to import the valid blocks only.')
      }
      files = parsed.files
      closedGapIds = parsed.closedGapIds
    }

    if (flags['dry-run']) {
      heading(`import (dry run) — ${files.length} atom file(s)`)
      for (const file of files) info(file.path)
      return
    }

    const { written, unchanged } = writeMemoryFiles(config.rootDir, files)
    heading(`import — ${files.length} atom file(s) from ${source}`)
    for (const path of written) ok(path)
    if (unchanged.length > 0) info(`${unchanged.length} file(s) unchanged`)

    if (closedGapIds.length > 0) {
      const ledger = ledgerFromDisk()
      let closed = 0
      for (const id of closedGapIds) if (ledger.close(id, 'closed via bundle import')) closed++
      persistLedger(ledger)
      ok(`closed ${closed} gap(s) ticked in the bundle`)
    }

    console.log(`\n  ${style.cyan('amk validate')} now — an import that does not validate is a broken memory.\n`)
  },

  index() {
    const { base } = load({ quiet: true })
    const content = buildScopeIndex(base, {
      id: config.indexAtomId,
      title: config.name ? `${config.name} — scope` : 'Scope index',
      lang: base.atoms[0]?.lang ?? 'en',
    })
    const target = join(config.rootDir, '_index.md')
    writeText(target, content)
    heading('index')
    ok(`regenerated ${target} (${base.atoms.length} atoms mapped)`)
    console.log()
  },

  eval() {
    const { base } = load({ quiet: true })
    const cases = loadEvalCases()
    if (!cases) {
      fail(`no eval cases at ${config.evalCasesPath}\nCreate a JSON array of { q, expectScope, expectIds, mustNotRetrieve }.`)
    }

    const summary = runEval(base, cases)
    heading(`eval — ${summary.total} cases`)
    console.log(`  scope accuracy   ${summary.scopeAccuracy}`)
    console.log(`  hit rate         ${summary.hitRate}`)
    console.log(`  precision        ${summary.precision}`)

    const thresholds = config.thresholds ?? defaultThresholds
    const violations = checkThresholds(summary, thresholds)
    const baseline = readJsonFile(config.baselinePath, null)
    const regressions = baseline ? compareBaseline(summary, baseline) : []

    if (summary.failures.length > 0) {
      heading('failures')
      for (const failure of summary.failures) error(`${failure.q} — ${failure.reason}`)
    }
    if (summary.confusionPairs.length > 0) {
      heading('confusion pairs')
      for (const pair of summary.confusionPairs) warn(pair)
    }
    for (const violation of violations) error(`threshold: ${violation}`)
    for (const regression of regressions) error(`regression: ${regression}`)

    const ledger = ledgerFromDisk()
    for (const observation of evalToGaps(summary)) ledger.observe(observation)
    persistLedger(ledger)

    if (flags['update-baseline']) {
      writeText(config.baselinePath, `${JSON.stringify(summary, null, 2)}\n`)
      ok(`baseline updated: ${config.baselinePath}`)
    }

    if (violations.length + regressions.length + summary.failures.length === 0) ok('retrieval quality holds')
    console.log()
    if (violations.length + regressions.length > 0) process.exit(1)
  },

  drift() {
    const { base } = load({ quiet: true })
    const claims = readJsonFile(config.claimsPath, null)
    heading('drift')
    if (!claims) {
      info(`no claims map at ${config.claimsPath} — skipping external claim check`)
    }

    const findings = claims ? checkDrift(base, Array.isArray(claims) ? claims : claims.claims ?? []) : []
    const cases = loadEvalCases() ?? []
    const covered = new Set(cases.flatMap((entry) => entry.expectIds ?? []))
    const uncovered = findUncoveredAtoms(base, covered)

    for (const finding of findings) error(`${finding.kind}: ${finding.detail}`)
    for (const finding of uncovered) warn(finding.detail)

    const ledger = ledgerFromDisk()
    for (const observation of driftToGaps([...findings, ...uncovered])) ledger.observe(observation)
    persistLedger(ledger)

    if (findings.length === 0 && uncovered.length === 0) ok('no drift, every atom is exercised by a case')
    else console.log(`\n  ${findings.length} drift finding(s), ${uncovered.length} untested atom(s) recorded in the ledger.`)
    console.log()
  },

  gaps() {
    const sub = positional[1]
    const ledger = ledgerFromDisk()

    if (sub === 'add') {
      const topic = positional.slice(2).join(' ')
      if (!topic) fail('usage: amk gaps add "<topic>" [--kind runtime|scope|manual] [--detail "…"]')
      const record = ledger.observe({
        kind: typeof flags.kind === 'string' ? flags.kind : 'manual',
        topic,
        detail: typeof flags.detail === 'string' ? flags.detail : undefined,
        source: 'cli',
      })
      persistLedger(ledger)
      ok(`recorded ${record.id} (${record.kind}, seen ${record.count}×)`)
      return
    }

    if (sub === 'close') {
      const id = positional[2]
      if (!id) fail('usage: amk gaps close <gap-id> [--by atom.id]')
      if (!ledger.close(id, typeof flags.by === 'string' ? flags.by : undefined)) fail(`unknown gap id: ${id}`)
      persistLedger(ledger)
      ok(`closed ${id}`)
      return
    }

    if (sub === 'sync') {
      const file = positional[2]
      if (!file || !existsSync(file)) fail('usage: amk gaps sync <edited-report-or-bundle.md>')
      const { closed } = parseGapReport(readFileSync(file, 'utf8'))
      let applied = 0
      for (const id of closed) if (ledger.close(id, `ticked in ${file}`)) applied++
      persistLedger(ledger)
      ok(`closed ${applied} of ${closed.length} ticked gap(s)`)
      return
    }

    // Default: refresh structural detectors, then show or write the report.
    refreshStructuralGaps(ledger)

    const records = ledger.all()
    if (flags.json) {
      console.log(JSON.stringify(records, null, 2))
      return
    }

    const report = renderGapReport(records, {
      title: config.name ? `${config.name} — gaps` : 'Gap Report',
      includeClosed: Boolean(flags['include-closed']),
    })

    if (flags.report) {
      const target = typeof flags.report === 'string' ? flags.report : join(config.outDir, 'GAPS.md')
      writeText(target, report)
      ok(`wrote ${target}`)
      info('tick boxes, then: amk gaps sync <that file>')
      return
    }

    console.log(report)
  },

  doctor() {
    commands.validate()
    if (loadEvalCases()) commands.eval()
    else info('no eval cases — skipping retrieval eval')
    commands.drift()
    const ledger = ledgerFromDisk()
    refreshStructuralGaps(ledger)
    const open = ledger.open()
    heading(`gaps — ${open.length} open`)
    for (const record of open.slice(0, 12)) {
      console.log(`  ${style.dim(record.id)}  ${record.kind.padEnd(8)} ${record.topic}${record.count > 1 ? style.dim(` (${record.count}×)`) : ''}`)
    }
    if (open.length > 12) info(`… and ${open.length - 12} more (amk gaps --report)`)
    console.log()
  },
}

const handler = commands[command]
if (!handler) {
  console.error(`\nUnknown command: ${command}`)
  console.log(USAGE)
  process.exit(1)
}

try {
  handler()
} catch (err) {
  if (err instanceof MemoryContractError) fail(err.message)
  throw err
}
