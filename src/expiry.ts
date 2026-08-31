/**
 * Expiry — the seventh gap detector.
 *
 * Knowledge that came from outside goes stale on a schedule its author can
 * usually predict. `validUntil` records that prediction, and this compares it
 * against a clock.
 *
 * ## The one design decision worth stating
 *
 * **Nothing is deleted, hidden, or down-ranked.** An expired atom keeps serving
 * exactly as before and produces a gap.
 *
 * That is deliberate. Silent removal is the same failure as silent truncation:
 * the system gets quieter about what it does not know, which is precisely
 * backwards for a project whose argument is that absence should be recorded. An
 * expired-but-present atom the user can see beats an absent one they cannot,
 * every time — and the gap is what makes it visible.
 *
 * ## No clock in here
 *
 * `now` is a parameter. `src/` has no `Date.now()` anywhere, which is what keeps
 * every test deterministic and the whole engine runnable in a Worker. The
 * adapter supplies the clock, same as it supplies the filesystem.
 */
import type { GapObservation } from './gaps.ts'
import type { MemoryAtom, MemoryBase } from './types.ts'

export interface ExpiryFinding {
  atomId: string
  validUntil: string
  /** Negative when already expired, positive when still ahead. */
  daysRemaining: number
  expired: boolean
  source?: string
  retrievedAt?: string
}

/** Whole days between two calendar dates, positive when `to` is later. */
function daysBetween(from: Date, to: Date): number {
  const MS_PER_DAY = 86_400_000
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate())
  return Math.round((b - a) / MS_PER_DAY)
}

function parseDate(value: string): Date | null {
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/**
 * Atoms carrying `validUntil`, sorted by urgency: most overdue first.
 *
 * `withinDays` bounds how far ahead to look. Omit it for expired atoms only —
 * which is what the gap detector wants, since a gap for something that goes
 * stale in three months is noise today.
 */
export function findExpiring(
  base: MemoryBase,
  now: Date,
  options: { withinDays?: number } = {},
): ExpiryFinding[] {
  const horizon = options.withinDays ?? 0
  const findings: ExpiryFinding[] = []

  for (const atom of base.atoms) {
    if (!atom.validUntil) continue
    const until = parseDate(atom.validUntil)
    // A malformed date already warned at load time (W_DATE_FORM). Warning twice
    // about the same thing trains people to skim.
    if (!until) continue

    const daysRemaining = daysBetween(now, until)
    if (daysRemaining > horizon) continue

    findings.push({
      atomId: atom.id,
      validUntil: atom.validUntil,
      daysRemaining,
      expired: daysRemaining < 0,
      source: atom.source,
      retrievedAt: atom.retrievedAt,
    })
  }

  return findings.sort((a, b) => a.daysRemaining - b.daysRemaining || a.atomId.localeCompare(b.atomId))
}

/**
 * Expired atoms as gap observations.
 *
 * **Only genuinely expired ones.** `findExpiring` at horizon 0 also returns
 * atoms whose last valid day is today — correct for the report, wrong for a gap:
 * an atom that is still valid has nothing missing about it, and a gap reading
 * "expired 0d ago" is simply false.
 *
 * Looking ahead belongs to `amk expiring`, where the point is to act before the
 * date. A gap means "this needs attention now".
 *
 * The `source` rides along in the detail so a research agent can act on the gap
 * without a second lookup — the difference between a gap that gets closed and
 * one that gets read.
 *
 * **The topic must not move.** The ledger deduplicates by
 * `(kind, normalized topic)`, so anything derived from the clock — "expired 30d
 * ago" — mints a brand-new record every day and turns one stale atom into an
 * ever-growing pile of gaps that can never be closed. Topic carries the atom id
 * and the date it declared; the elapsed days are detail, where they can change
 * freely.
 */
export function expiryToGaps(base: MemoryBase, now: Date): GapObservation[] {
  return findExpiring(base, now).filter((finding) => finding.expired).map((finding) => ({
    kind: 'expiry',
    topic: `${finding.atomId} is past validUntil ${finding.validUntil}`,
    detail: [
      `expired ${Math.abs(finding.daysRemaining)}d ago`,
      finding.retrievedAt ? `last checked ${finding.retrievedAt}` : undefined,
      finding.source ? `re-check ${finding.source}` : 'no source recorded',
    ].filter((part) => part !== undefined).join('; '),
    atomId: finding.atomId,
    source: 'expiry',
  }))
}

/** Atoms with provenance but no expiry — knowledge that can never go stale. */
export function findUnboundedProvenance(base: MemoryBase): MemoryAtom[] {
  return base.atoms.filter((atom) => atom.source !== undefined && atom.validUntil === undefined)
}
