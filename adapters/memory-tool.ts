/**
 * Filesystem wiring for the Anthropic memory tool.
 *
 * `src/memory-tool.ts` decides *what* should happen; this decides *when it hits
 * the disk*. Everything here is I/O, caching and atomicity — no policy.
 *
 * Usage with any SDK's tool-use loop:
 *
 * ```js
 * import { createMemoryToolHandler } from 'atomic-memory-kit/adapters/memory-tool'
 *
 * const memory = createMemoryToolHandler({
 *   root: './memory',
 *   gapLedger: './.memory-out/gaps.jsonl',
 *   config: defineMemoryConfig({ categories: ['pricing', 'product'] }),
 * })
 *
 * // in the loop, for each tool_use block named "memory":
 * const { content, is_error } = memory.handle(block.input)
 * ```
 *
 * The returned object is deliberately shaped like a `tool_result` payload so the
 * call site is one line.
 */
import { rmSync } from 'node:fs'

import { readGapLedger, readMemoryDir, resolveInside, writeGapLedger, writeMemoryFiles } from './fs.ts'
import { createGapLedger } from '../src/gaps.ts'
import type { GapRecord } from '../src/gaps.ts'
import { loadMemory } from '../src/loader.ts'
import { runMemoryToolCommand } from '../src/memory-tool.ts'
import type { MemoryToolInput, MemoryToolOutcome } from '../src/memory-tool.ts'
import type { MemoryBase, MemoryConfig, MemoryFileRaw } from '../src/types.ts'

export interface MemoryToolHandlerOptions {
  /** Memory root on disk. `/memories/x.md` maps to `<root>/x.md`. */
  root: string
  /** Gap ledger path. Omit to keep gaps in memory only (they are then lost). */
  gapLedger?: string
  config: MemoryConfig
  /**
   * Re-read from disk on every command. Correct but O(atoms) per call; leave
   * off unless something outside this handler writes to the root.
   */
  alwaysReload?: boolean
}

export interface MemoryToolResult {
  /** Text for the `tool_result` content field. */
  content: string
  /** Set the `is_error` field from this. */
  is_error: boolean
  /** Gap records touched by this command, for logging. */
  gaps: GapRecord[]
  /** Contract diagnostic code when a write was refused. */
  code?: string
}

export interface MemoryToolHandler {
  handle: (input: MemoryToolInput) => MemoryToolResult
  /** Drop the cache. Call after editing atoms outside this handler. */
  invalidate: () => void
  /** Current open gaps, highest recurrence first. */
  gaps: () => GapRecord[]
}

interface Snapshot {
  files: MemoryFileRaw[]
  base: MemoryBase | null
  loadError?: string
}

export function createMemoryToolHandler(options: MemoryToolHandlerOptions): MemoryToolHandler {
  let snapshot: Snapshot | null = null

  /**
   * Read and load, tolerating a memory that does not currently satisfy the
   * contract.
   *
   * A broken atom must not brick the agent: it still needs to `view` the store
   * to find and repair the damage. So a load failure degrades to
   * `base: null` — commands still run, graph-dependent checks are skipped, and
   * the reason is surfaced to the model on the next listing.
   */
  function read(): Snapshot {
    if (snapshot && !options.alwaysReload) return snapshot
    const files = readMemoryDir(options.root)
    try {
      snapshot = { files, base: loadMemory(files, options.config).base }
    } catch (error) {
      snapshot = { files, base: null, loadError: error instanceof Error ? error.message : String(error) }
    }
    return snapshot
  }

  function applyEffects(outcome: MemoryToolOutcome): void {
    if (outcome.writes.length === 0 && outcome.deletes.length === 0) return

    // Writes before deletes, always. A rename is expressed as write-destination
    // + delete-source, so this ordering means a crash between the two leaves a
    // duplicate — recoverable — rather than a hole. `writeMemoryFiles` skips
    // byte-identical files, so a no-op rewrite does not touch mtimes.
    // Deletes are confined before anything is written, so a refused delete
    // cannot strand a half-applied rename.
    const deletes = outcome.deletes.map((relative) => resolveInside(options.root, relative))
    if (outcome.writes.length > 0) writeMemoryFiles(options.root, outcome.writes)
    for (const target of deletes) rmSync(target, { force: true })
    snapshot = null
  }

  function recordGaps(outcome: MemoryToolOutcome): GapRecord[] {
    if (outcome.gaps.length === 0) return []
    const ledger = createGapLedger(options.gapLedger ? readGapLedger(options.gapLedger) : [])
    const touched = outcome.gaps.map((observation) => ledger.observe(observation))
    if (options.gapLedger) writeGapLedger(options.gapLedger, ledger.all())
    return touched
  }

  return {
    handle(input) {
      const { files, base, loadError } = read()
      const outcome = runMemoryToolCommand(input, { files, base, loadError })
      try {
        applyEffects(outcome)
      } catch (error) {
        // A symlink or junction out of the root is only visible on disk, so the
        // pure layer cannot refuse it. Report it the way the model reads every
        // other refusal; all paths are checked before any write, so this is true.
        const message = error instanceof Error ? error.message : String(error)
        return { content: `Error: ${message}. Nothing was written.`, is_error: true, gaps: [] }
      }
      const gaps = recordGaps(outcome)
      return {
        content: outcome.content,
        is_error: outcome.isError,
        gaps,
        ...(outcome.code ? { code: outcome.code } : {}),
      }
    },

    invalidate() {
      snapshot = null
    },

    gaps() {
      if (!options.gapLedger) return []
      return createGapLedger(readGapLedger(options.gapLedger)).open()
    },
  }
}
