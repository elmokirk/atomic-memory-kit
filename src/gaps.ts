/**
 * Gap spotlighting — the second defining capability of this kit.
 *
 * A gap is a *recorded moment where the memory was asked for something it did
 * not have*. Gaps are not errors and not exceptions: they are the highest-value
 * signal a memory system produces, because they are demand data. Every other
 * knowledge base throws this signal away.
 *
 * Five detectors, one ledger:
 *
 *   runtime — the consuming agent emits `[GAP: topic]` when it knows the memory
 *             does not cover the question. Detected mid-stream, stripped from
 *             the user-visible text, logged. THE ONLY detector that needs the
 *             consumer to cooperate — and the only one that catches
 *             "we have the topic but not this detail".
 *   scope   — deterministic: retrieval returned `no_match`. No agent needed.
 *   eval    — a curated question no longer retrieves its expected atom.
 *   drift   — a claim in a source of truth is not backed by any atom.
 *   todo    — an author left an explicit `TODO(...)` marker inside an atom.
 *
 * Plus two structural signals from the loader: `cycle` and `orphan`.
 *
 * The ledger deduplicates by (kind, topic), counts recurrences, and keeps
 * first/last seen. Recurrence is the priority signal: a gap seen 40 times is
 * a missing product page, a gap seen once is noise.
 *
 * Storage is host-supplied on purpose (this file stays dependency-free) —
 * see adapters/fs.ts for the JSONL implementation.
 */

export type GapKind = 'runtime' | 'scope' | 'eval' | 'drift' | 'todo' | 'cycle' | 'orphan' | 'manual'

export type GapStatus = 'open' | 'closed' | 'wontfix'

export interface GapRecord {
  /** Stable, content-derived id — same gap always gets the same id. */
  id: string
  kind: GapKind
  /** Short normalized subject, e.g. "app development pricing". */
  topic: string
  /** Free-form context: the failing query, the drifting number, the file. */
  detail?: string
  /** Atom this gap points at, when known (todo/drift/cycle/orphan). */
  atomId?: string
  /** Where the observation came from: a route, a script, a session id. */
  source?: string
  firstSeen: string
  lastSeen: string
  count: number
  status: GapStatus
  /** Atom id (or free text) that closed this gap. */
  resolvedBy?: string
}

export interface GapObservation {
  kind: GapKind
  topic: string
  detail?: string
  atomId?: string
  source?: string
  /** Defaults to now. Injectable for deterministic tests. */
  at?: string
}

/* ------------------------------------------------------------------ *
 * Marker protocol (runtime detector)
 * ------------------------------------------------------------------ */

/**
 * The marker an agent appends when it hits a gap. Kept deliberately ugly and
 * unlikely to appear in natural prose. Topic is capped so a runaway generation
 * cannot write an essay into the ledger.
 */
export const GAP_MARKER_PATTERN = /\[GAP:\s*([^\]]{0,80})\]/g

/** Instruction text to paste into your agent's system prompt. */
export const GAP_PROTOCOL_INSTRUCTION = [
  'When the provided memory does not cover the question — even partially — say so plainly instead of guessing.',
  'End such an answer with the marker [GAP: <short topic>]. The system removes the marker before the user sees it and uses it to find holes in the memory.',
  'Use the marker for missing knowledge inside your subject area. Do not use it for questions that are simply off-topic.',
].join('\n')

/** All gap topics contained in a complete text. */
export function extractGapTopics(text: string): string[] {
  return [...text.matchAll(GAP_MARKER_PATTERN)]
    .map((match) => match[1]!.trim())
    .filter((topic) => topic !== '')
}

/** Remove markers from text destined for a human. Always call before display. */
export function stripGapMarkers(text: string): string {
  return text.replace(GAP_MARKER_PATTERN, '').replace(/[ \t]{2,}/g, ' ').trimEnd()
}

export interface GapDetector {
  /** Feed a streaming delta; returns topics discovered by this delta. */
  push: (delta: string) => string[]
  /** Reset between turns. */
  reset: () => void
}

/**
 * Streaming detector for token-by-token output.
 *
 * A marker can be split across deltas ("… [GA" + "P: pricing]"), so a rolling
 * tail is kept rather than testing each delta in isolation. The tail must be
 * comfortably longer than the longest possible marker.
 */
export function createGapDetector(tailLength = 128): GapDetector {
  let tail = ''
  let seen = 0
  return {
    push(delta: string): string[] {
      tail = (tail + delta).slice(-tailLength)
      const matches = [...tail.matchAll(GAP_MARKER_PATTERN)]
      if (matches.length <= seen) return []
      const fresh = matches.slice(seen).map((match) => match[1]!.trim()).filter(Boolean)
      seen = matches.length
      return fresh
    },
    reset(): void {
      tail = ''
      seen = 0
    },
  }
}

/* ------------------------------------------------------------------ *
 * Ledger
 * ------------------------------------------------------------------ */

/** FNV-1a — small, stable, dependency-free. Not cryptographic, not meant to be. */
function hash(input: string): string {
  let value = 0x811c9dc5
  for (let index = 0; index < input.length; index++) {
    value ^= input.charCodeAt(index)
    value = Math.imul(value, 0x01000193) >>> 0
  }
  return value.toString(16).padStart(8, '0')
}

export function normalizeTopic(topic: string): string {
  return topic.toLowerCase().replace(/\s+/g, ' ').replace(/[.!?,;:]+$/, '').trim()
}

export function gapId(kind: GapKind, topic: string): string {
  return `${kind}-${hash(`${kind}|${normalizeTopic(topic)}`)}`
}

export interface GapLedger {
  /** Record an observation; returns the (created or updated) record. */
  observe: (observation: GapObservation) => GapRecord
  close: (id: string, resolvedBy?: string) => boolean
  reopen: (id: string) => boolean
  get: (id: string) => GapRecord | undefined
  all: () => GapRecord[]
  open: () => GapRecord[]
  /** Drop closed records older than `days` — keeps the ledger from growing forever. */
  prune: (days: number, now?: Date) => number
}

/**
 * In-memory ledger over an existing record list.
 *
 * Deduplication key is (kind, normalized topic). Re-observing a CLOSED gap
 * reopens it and bumps the count: that is the signal that a gap was closed
 * badly — the atom exists but retrieval still misses it.
 */
export function createGapLedger(existing: GapRecord[] = []): GapLedger {
  const records = new Map<string, GapRecord>(existing.map((record) => [record.id, record]))

  return {
    observe(observation: GapObservation): GapRecord {
      const at = observation.at ?? new Date().toISOString()
      const id = gapId(observation.kind, observation.topic)
      const current = records.get(id)
      if (current) {
        current.count++
        current.lastSeen = at
        if (observation.detail) current.detail = observation.detail
        if (observation.source) current.source = observation.source
        if (current.status === 'closed') {
          current.status = 'open'
          current.resolvedBy = undefined
        }
        return current
      }
      const created: GapRecord = {
        id,
        kind: observation.kind,
        topic: normalizeTopic(observation.topic),
        ...(observation.detail ? { detail: observation.detail } : {}),
        ...(observation.atomId ? { atomId: observation.atomId } : {}),
        ...(observation.source ? { source: observation.source } : {}),
        firstSeen: at,
        lastSeen: at,
        count: 1,
        status: 'open',
      }
      records.set(id, created)
      return created
    },
    close(id: string, resolvedBy?: string): boolean {
      const record = records.get(id)
      if (!record) return false
      record.status = 'closed'
      if (resolvedBy) record.resolvedBy = resolvedBy
      return true
    },
    reopen(id: string): boolean {
      const record = records.get(id)
      if (!record) return false
      record.status = 'open'
      record.resolvedBy = undefined
      return true
    },
    get: (id: string) => records.get(id),
    all: () => [...records.values()].sort((a, b) => b.count - a.count || a.id.localeCompare(b.id)),
    open() {
      return [...records.values()]
        .filter((record) => record.status === 'open')
        .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
    },
    prune(days: number, now = new Date()): number {
      const cutoff = now.getTime() - days * 86_400_000
      let removed = 0
      for (const [id, record] of records) {
        if (record.status === 'closed' && Date.parse(record.lastSeen) < cutoff) {
          records.delete(id)
          removed++
        }
      }
      return removed
    },
  }
}

/* ------------------------------------------------------------------ *
 * Report rendering + the return channel
 * ------------------------------------------------------------------ */

const KIND_HEADINGS: Record<GapKind, string> = {
  runtime: 'Asked for, not known (runtime)',
  scope: 'Out of scope (no atom scored above threshold)',
  eval: 'Regressions (curated question stopped retrieving)',
  drift: 'Drift (claim in a source of truth is unbacked)',
  todo: 'Author TODOs inside atoms',
  cycle: 'Graph cycles',
  orphan: 'Graph islands (no edges in or out)',
  manual: 'Manually recorded',
}

/**
 * Render the gap ledger as an actionable checklist.
 *
 * The checkboxes are not decoration: `parseGapReport` reads them back, so this
 * file is a two-way interface. Tick a box, run `amk gaps sync`, the ledger
 * closes the gap.
 */
export function renderGapReport(records: GapRecord[], options: { title?: string, includeClosed?: boolean } = {}): string {
  const open = records.filter((record) => record.status === 'open')
  const closed = records.filter((record) => record.status !== 'open')
  const lines: string[] = [
    `# ${options.title ?? 'Gap Report'}`,
    '',
    `Generated: ${new Date().toISOString()}`,
    `Open: ${open.length} · Closed: ${closed.length} · Total observations: ${records.reduce((sum, record) => sum + record.count, 0)}`,
    '',
    'Tick a box once the gap is genuinely covered by an atom, then run `amk gaps sync <this file>`.',
    '',
  ]

  const kinds = [...new Set(open.map((record) => record.kind))]
  for (const kind of kinds) {
    lines.push(`## ${KIND_HEADINGS[kind] ?? kind}`, '')
    for (const record of open.filter((entry) => entry.kind === kind)) {
      const seen = record.count > 1 ? ` _(${record.count}×, last ${record.lastSeen.slice(0, 10)})_` : ''
      const where = record.atomId ? ` → \`${record.atomId}\`` : ''
      lines.push(`- [ ] \`${record.id}\` ${record.topic}${where}${seen}`)
      if (record.detail) lines.push(`      ${record.detail}`)
    }
    lines.push('')
  }
  if (open.length === 0) lines.push('_No open gaps._', '')

  if (options.includeClosed && closed.length > 0) {
    lines.push('## Closed', '')
    for (const record of closed) {
      lines.push(`- [x] \`${record.id}\` ${record.topic}${record.resolvedBy ? ` → ${record.resolvedBy}` : ''}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * Read a gap report (or an edited bundle) back and return the gap ids that were
 * ticked off. This closes the loop: report out, human or agent works on it,
 * report in.
 */
export function parseGapReport(markdown: string): { closed: string[], stillOpen: string[] } {
  const closed: string[] = []
  const stillOpen: string[] = []
  for (const line of markdown.replace(/\r\n/g, '\n').split('\n')) {
    const match = /^\s*-\s*\[([ xX])\]\s*`([^`]+)`/.exec(line)
    if (!match) continue
    if (match[1] === ' ') stillOpen.push(match[2]!)
    else closed.push(match[2]!)
  }
  return { closed, stillOpen }
}

/** Strip comment terminators an author's TODO text tends to drag along. */
function cleanTodoText(text: string): string {
  return text.replace(/(-->|\*\/|]]>)\s*$/, '').trim()
}

/** Scan atom bodies for author TODO markers. Default matches `TODO(...)` and `TODO:`. */
export function findTodoMarkers(
  atoms: Array<{ id: string, body: string, sourcePath?: string }>,
  pattern = /TODO\((\w+)\)\s*:?\s*([^\n<]*)|TODO:\s*([^\n<]*)/g,
): GapObservation[] {
  const observations: GapObservation[] = []
  for (const atom of atoms) {
    for (const match of atom.body.matchAll(pattern)) {
      const text = cleanTodoText(match[2] ?? match[3] ?? '')
      observations.push({
        kind: 'todo',
        topic: text !== '' ? text : `unspecified TODO in ${atom.id}`,
        atomId: atom.id,
        source: atom.sourcePath,
      })
    }
  }
  return observations
}
