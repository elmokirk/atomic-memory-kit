#!/usr/bin/env node
/**
 * Chatbot demo: two questions through the whole AMK path, no API key, no network.
 *
 *   node example/chatbot/demo.mjs [--out <dir>]
 *
 * 1. In scope: searchMemory -> prompt from the retrieved atoms -> streamed answer
 *    through the gap detector. The user sees the answer without the marker; the
 *    marker's topic lands in the ledger as a `runtime` gap.
 * 2. Out of scope: searchMemory says `no_match`, the model is never called, the
 *    question lands in the ledger as a `scope` gap.
 *
 * The ledger is written to a fresh temp directory (or --out), never into the
 * repository, so running the demo leaves `git status` clean.
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Same floor and same reason as cli/amk.mjs: a static .ts import on older Node
// fails with an error that names neither the cause nor the fix.
const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number)
if (nodeMajor < 22 || (nodeMajor === 22 && nodeMinor < 18)) {
  console.error(`this demo requires Node >= 22.18.0, this is ${process.versions.node}. Upgrade Node and re-run.`)
  process.exit(1)
}

const {
  GAP_PROTOCOL_INSTRUCTION,
  createGapDetector,
  createGapLedger,
  defineMemoryConfig,
  loadMemory,
  searchMemory,
} = await import('../../src/index.ts')
const { readGapLedger, readMemoryDir, writeGapLedger } = await import('../../adapters/fs.ts')

const EXAMPLE = fileURLToPath(new URL('..', import.meta.url))
const IN_SCOPE = 'How many seats do I get on Starter, and is SSO included?'
const OUT_OF_SCOPE = 'Give me a recipe for strawberry jam'

/* ------------------------------------------------------------------ *
 * The model. REPLACE THIS FUNCTION to use a real one.
 *
 * Contract: an async iterable of text deltas. Any streaming chat API fits:
 * send `system` as the system prompt and `question` as the user message, then
 * `yield` each text delta as it arrives. Use whatever client you already have;
 * this repository ships none and the scripted version makes no network call.
 * ------------------------------------------------------------------ */
let modelCalls = 0
async function* callModel(system, question) {
  modelCalls++
  // Scripted reply to IN_SCOPE. The cuts are deliberate: the marker arrives in
  // three pieces, as it does with real token streaming.
  yield 'Starter includes 5 seats [[source:product.limits]]. '
  yield 'Whether SSO is part of Starter is not in my memory, so I will not guess. '
  yield 'I have passed the question on. [GA'
  yield 'P: SSO on the Star'
  yield 'ter plan]'
}

/* ------------------------------------------------------------------ */

function prompt(base, result) {
  const block = (atom) => `<memory-atom id="${atom.id}" title="${atom.title}">\n${atom.content ?? atom.body}\n</memory-atom>`
  return [
    'Your only source of facts is the MEMORY block below. Never invent facts.',
    GAP_PROTOCOL_INSTRUCTION,
    '# MEMORY',
    ...base.alwaysInclude.map(block),
    ...result.chunks.map(block),
  ].join('\n\n')
}

const args = process.argv.slice(2)
const outIndex = args.indexOf('--out')
const outDir = outIndex === -1 ? mkdtempSync(join(tmpdir(), 'amk-demo-')) : args[outIndex + 1]
const ledgerPath = join(outDir, 'gaps.jsonl')

const settings = JSON.parse(readFileSync(join(EXAMPLE, 'memory.config.json'), 'utf8'))
const config = defineMemoryConfig(settings.retrieval)
const { base } = loadMemory(readMemoryDir(join(EXAMPLE, settings.root)), config)
const ledger = createGapLedger(readGapLedger(ledgerPath))

console.log(`== Memory\n${base.atoms.length} atoms loaded from example/${settings.root}, threshold ${config.minScore}\n`)

console.log(`== Question 1 (in scope)\n> ${IN_SCOPE}\n`)
const hit = searchMemory(base, IN_SCOPE)
console.log(`scope: ${hit.scopeStatus}, best score ${hit.bestScore}`)
console.log('atoms in the prompt:')
for (const atom of base.alwaysInclude) console.log(`  always  ${atom.id}`)
for (const chunk of hit.chunks) console.log(`  ${String(chunk.score).padStart(6)}  ${chunk.id}${chunk.viaEdge ? ' (via edge)' : ''}`)
const system = prompt(base, hit)
console.log(`prompt: ${system.length} chars${hit.overBudget ? ', over the char budget' : ''}\n`)

const detector = createGapDetector()
let visible = ''
const forward = ({ text, topics }) => {
  visible += text
  for (const topic of topics) ledger.observe({ kind: 'runtime', topic, source: 'demo' })
}
for await (const delta of callModel(system, IN_SCOPE)) forward(detector.write(delta))
forward(detector.end())
console.log(`answer shown to the user:\n${visible}\n`)

console.log(`== Question 2 (out of scope)\n> ${OUT_OF_SCOPE}\n`)
const miss = searchMemory(base, OUT_OF_SCOPE)
console.log(`scope: ${miss.scopeStatus}, best score ${miss.bestScore}`)
if (miss.scopeStatus === 'no_match') {
  // The gate runs before the model: nothing retrieved means nothing to ground
  // an answer in, and a model asked anyway answers from general knowledge.
  ledger.observe({ kind: 'scope', topic: OUT_OF_SCOPE, source: 'demo' })
  console.log('model not called; the bot declines and the question is recorded\n')
}

writeGapLedger(ledgerPath, ledger.all())
console.log(`== Gap ledger\n${ledgerPath}`)
for (const gap of ledger.open()) console.log(`  ${gap.kind.padEnd(8)} ${gap.topic}  (seen ${gap.count}x)`)
console.log(`\nmodel calls: ${modelCalls}`)
