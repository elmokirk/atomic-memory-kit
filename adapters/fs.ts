/**
 * Filesystem host adapter.
 *
 * This is the ONLY file in the kit that touches I/O. `src/` is pure so it runs
 * unchanged in a browser, a worker, an edge runtime, or a test — the host
 * decides where bytes come from. See adapters/README.md for Nitro, Next.js,
 * HTTP and CMS variants.
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import type { GapRecord } from '../src/gaps.ts'
import type { MemoryFileRaw } from '../src/types.ts'

/**
 * Resolve a root-relative path to an absolute one, refusing anything the OS
 * would place outside `root`.
 *
 * String checks catch `../`, absolute and drive-letter forms; they cannot see a
 * symlink or junction, so the deepest existing ancestor is also realpath'd and
 * compared with the real root. That ancestor is where the OS will actually
 * create the file. Both separators are treated as separators on every platform,
 * so a path refused on Windows is refused on POSIX too.
 */
export function resolveInside(root: string, path: string): string {
  const refuse = (): never => {
    throw new Error(`refused: ${JSON.stringify(path)} resolves outside the memory root ${root}`)
  }
  const normalized = path.replace(/\\/g, '/')
  if (normalized === '' || normalized.includes('\0') || normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)
    || isAbsolute(path) || normalized.split('/').includes('..')) refuse()

  const realRoot = realpathSync(root)
  const target = join(realRoot, normalized)
  for (let probe = target; ; probe = dirname(probe)) {
    let real: string
    try {
      real = realpathSync(probe)
    } catch {
      // Exists as a link but resolves nowhere: following it would create the
      // file wherever the link points, so treat it as an escape.
      if (isLink(probe)) refuse()
      continue
    }
    const inside = relative(realRoot, real)
    if (inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) refuse()
    return target
  }
}

function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}

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
        // readFileSync follows a symlinked file wherever it points; confine it.
        if (entry.isSymbolicLink()) resolveInside(root, relative(root, full))
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
  mkdirSync(root, { recursive: true })
  // Every path is checked before the first byte lands: one escaping path
  // refuses the batch, so a refusal never leaves a partial write behind.
  const targets = files.map((file) => resolveInside(root, file.path))
  for (const [index, file] of files.entries()) {
    const target = targets[index]
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

/**
 * Read the ledger, keeping every valid line.
 *
 * A corrupt line must never take down the whole ledger, but skipping it
 * silently loses evidence nobody knows is gone. So each one is reported with
 * its 1-based line number: to `onCorrupt` if given, else as a process warning
 * (stderr, which leaves an MCP stdio stream intact).
 */
export function readGapLedger(
  file: string,
  onCorrupt: (line: number, text: string) => void = (line) => process.emitWarning(
    `${file}:${line}: corrupt gap ledger line skipped; it is dropped on the next ledger write`,
    { code: 'AMK_CORRUPT_LEDGER_LINE' },
  ),
): GapRecord[] {
  if (!existsSync(file)) return []
  const records: GapRecord[] = []
  for (const [index, line] of readFileSync(file, 'utf8').split('\n').entries()) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    try {
      records.push(JSON.parse(trimmed) as GapRecord)
    } catch {
      onCorrupt(index + 1, trimmed)
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
