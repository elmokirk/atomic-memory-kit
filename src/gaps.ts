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

export type GapKind = 'runtime' | 'scope' | 'eval' | 'drift' | 'todo' | 'cycle' | 'orphan' | 'expiry' | 'manual'

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

export interface GapDetectorOutput {
  /** Text safe to show now: the input minus markers, whitespace untouched. */
  text: string
  /** Topics of markers completed by this call. */
  topics: string[]
}

export interface GapDetector {
  /** Feed a streaming delta; returns visible text and topics it completed. */
  write: (delta: string) => GapDetectorOutput
  /**
   * End of stream. A held-back marker that never closed is not a marker, so it
   * is released verbatim, matching what `GAP_MARKER_PATTERN` does on the whole
   * text. Leaves the detector clean for the next turn.
   */
  end: () => GapDetectorOutput
  /** Topics only, for callers that do not display through the detector. */
  push: (delta: string) => string[]
  /** Reset between turns; drops held-back text. */
  reset: () => void
}

const MARKER_HEAD = '[GAP:'
// Derived, not restated, so the streaming and batch paths cannot disagree.
const MARKER_AT = new RegExp(GAP_MARKER_PATTERN.source, 'y')
const TOPIC_MAX = 80

/** Could `text[open..]` still become a marker once more input arrives? */
function couldBecomeMarker(text: string, open: number): boolean {
  if (text.length - open < MARKER_HEAD.length) return MARKER_HEAD.startsWith(text.slice(open))
  if (!text.startsWith(MARKER_HEAD, open) || text.includes(']', open)) return false
  // `\s*` absorbs any leading whitespace, so only what follows it is capped.
  // ponytail: a head followed by endless whitespace is held until end().
  return text.slice(open + MARKER_HEAD.length).trimStart().length <= TOPIC_MAX
}

/**
 * Streaming decoder for token-by-token output.
 *
 * Stateful and lossless: text is released as soon as it cannot be part of a
 * marker, and only a possible marker prefix is held back, however long the
 * stream and wherever the deltas are cut. A fixed rolling tail lost every
 * marker after the first once it scrolled out, and stripping each delta on its
 * own leaked split markers and ate whitespace at delta boundaries.
 *
 * `tailLength` is accepted for compatibility and ignored; nothing is windowed.
 */
export function createGapDetector(_tailLength?: number): GapDetector {
  let held = ''

  function decode(delta: string, final: boolean): GapDetectorOutput {
    const input = held + delta
    held = ''
    let text = ''
    const topics: string[] = []
    let index = 0
    while (index < input.length) {
      const open = input.indexOf('[', index)
      if (open === -1) break
      text += input.slice(index, open)
      MARKER_AT.lastIndex = open
      const match = MARKER_AT.exec(input)
      if (match) {
        const topic = match[1]!.trim()
        if (topic !== '') topics.push(topic)
        index = open + match[0].length
        continue
      }
      if (!final && couldBecomeMarker(input, open)) {
        held = input.slice(open)
        return { text, topics }
      }
      text += '['
      index = open + 1
    }
    return { text: text + input.slice(index), topics }
  }

  return {
    write: (delta: string) => decode(delta, false),
    end: () => decode('', true),
    push: (delta: string) => decode(delta, false).topics,
    reset(): void {
      held = ''
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
