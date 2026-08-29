/**
 * Filesystem host adapter.
 *
 * This is the ONLY file in the kit that touches I/O. `src/` is pure so it runs
 * unchanged in a browser, a worker, an edge runtime, or a test — the host
 * decides where bytes come from. See adapters/README.md for Nitro, Next.js,
 * HTTP and CMS variants.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import type { GapRecord } from '../src/gaps.ts'
import type { MemoryFileRaw } from '../src/types.ts'

/** Recursively collect every `.md` file under `root`, path-relative to it. */
export function readMemoryDir(root: string): MemoryFileRaw[] {
  const files: MemoryFileRaw[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue
        walk(full)
      } else if (entry.name.endsWith('.md')) {
        files.push({
          path: relative(root, full).split(sep).join('/'),
          content: readFileSync(full, 'utf8'),
        })
      }
    }
  }
  walk(root)
  return files.sort((a, b) => a.path.localeCompare(b.path))
}

export interface WriteResult {
  written: string[]
  unchanged: string[]
}

/**
 * Write atom files, skipping byte-identical ones.
 *
 * Skipping matters: an import that rewrites every file produces a diff nobody
 * reads, and a diff nobody reads is how bad memory gets committed.
 */
export function writeMemoryFiles(root: string, files: MemoryFileRaw[]): WriteResult {
  const written: string[] = []
  const unchanged: string[] = []
  for (const file of files) {
    const target = join(root, file.path)
    if (existsSync(target) && readFileSync(target, 'utf8').replace(/\r\n/g, '\n') === file.content.replace(/\r\n/g, '\n')) {
      unchanged.push(file.path)
      continue
    }
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, file.content, 'utf8')
    written.push(file.path)
  }
  return { written, unchanged }
}

/* ------------------------------------------------------------------ *
 * Gap ledger persistence (JSONL: append-friendly, diff-friendly, greppable)
 * ------------------------------------------------------------------ */

export function readGapLedger(file: string): GapRecord[] {
  if (!existsSync(file)) return []
  const records: GapRecord[] = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    try {
      records.push(JSON.parse(trimmed) as GapRecord)
    } catch {
      // A corrupt line must never take down the whole ledger.
    }
  }
  return records
}

export function writeGapLedger(file: string, records: GapRecord[]): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8')
}

/**
 * Append a single observation without reading the whole ledger — safe for a
 * hot request path. `amk gaps sync` folds appended lines into the ledger.
 */
export function appendGapLine(file: string, record: GapRecord): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(record)}\n`, { encoding: 'utf8', flag: 'a' })
}

export function readJson<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

export function writeText(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content, 'utf8')
}
