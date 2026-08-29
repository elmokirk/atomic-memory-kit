/**
 * Drift detection — the third gap direction.
 *
 * Runtime gaps say "someone asked and we did not know".
 * Eval gaps say "we knew but could not find it".
 * Drift gaps say "we know something DIFFERENT from the source of truth".
 *
 * The last one is the dangerous class: the memory is confidently wrong, and
 * nothing about a retrieval metric can see it. A price changed on a website, in
 * a contract, in a spec — and the agent keeps quoting the old number with a
 * citation, which makes the wrong answer look verified.
 *
 * The mechanism is deliberately dumb and therefore trustworthy: map each
 * externally-owned claim to the atom that is supposed to back it, then check
 * that the claim's *numbers* appear in that atom's body. Numbers are the part
 * of a claim that is unambiguously checkable without a model. Prose drift is
 * explicitly out of scope — see LIMITATIONS.md.
 */
import type { GapObservation } from './gaps.ts'
import type { MemoryBase } from './types.ts'

export type ClaimType = 'number' | 'price' | 'duration' | 'fact'

export interface Claim {
  /** Where the claim lives, e.g. `i18n:pricing.tierOne` or `docs/spec.md:L42`. */
  key: string
  /** The literal text of the claim in the source of truth. */
  value: string
  /** Atom expected to back it. */
  atomId: string
  /** `fact` claims are only checked for atom existence; the rest for numbers. */
  claimType?: ClaimType
}

export interface DriftFinding {
  key: string
  atomId: string
  kind: 'missing-atom' | 'unbacked-number' | 'uncovered-atom'
  detail: string
}

/** Digits with optional grouping/decimal separators. */
const NUMBER_TOKEN = /\d[\d.,]*/g

function numbersIn(text: string): Set<string> {
  const found = new Set<string>()
  for (const match of text.matchAll(NUMBER_TOKEN)) {
    const raw = match[0].replace(/[.,]$/, '')
    found.add(raw)
    // Compare grouping-insensitively: "1.500" and "1500" are the same claim.
    found.add(raw.replace(/[.,]/g, ''))
  }
  return found
}

export function checkDrift(base: MemoryBase, claims: Claim[]): DriftFinding[] {
  const findings: DriftFinding[] = []

  for (const claim of claims) {
    const atom = base.byId.get(claim.atomId)
    if (!atom) {
      findings.push({
        key: claim.key,
        atomId: claim.atomId,
        kind: 'missing-atom',
        detail: `claim "${claim.key}" maps to atom "${claim.atomId}", which does not exist`,
      })
      continue
    }
    if ((claim.claimType ?? 'number') === 'fact') continue

    const known = numbersIn(`${atom.body}\n${atom.summary}\n${atom.title}`)
    for (const match of claim.value.matchAll(NUMBER_TOKEN)) {
      const raw = match[0].replace(/[.,]$/, '')
      const bare = raw.replace(/[.,]/g, '')
      // Single digits are almost always list markers or grammar, not claims.
      if (bare.length < 2) continue
      if (known.has(raw) || known.has(bare)) continue
      findings.push({
        key: claim.key,
        atomId: claim.atomId,
        kind: 'unbacked-number',
        detail: `"${claim.key}" states ${raw} ("${truncate(claim.value)}") but atom ${claim.atomId} does not contain it`,
      })
    }
  }

  return findings
}

/**
 * Atoms that no eval case exercises. An atom nobody tests is an atom whose
 * retrieval behaviour is unknown — a latent gap rather than an observed one.
 */
export function findUncoveredAtoms(base: MemoryBase, coveredIds: Iterable<string>): DriftFinding[] {
  const covered = new Set(coveredIds)
  return base.atoms
    .filter((atom) => !atom.alwaysInclude && !covered.has(atom.id))
    .map((atom) => ({
      key: atom.sourcePath ?? atom.id,
      atomId: atom.id,
      kind: 'uncovered-atom' as const,
      detail: `no eval case references ${atom.id} — its retrieval behaviour is untested`,
    }))
}

export function driftToGaps(findings: DriftFinding[], source = 'amk drift'): GapObservation[] {
  return findings.map((finding) => ({
    kind: 'drift' as const,
    topic: `${finding.kind}: ${finding.key}`,
    detail: finding.detail,
    atomId: finding.atomId,
    source,
  }))
}

function truncate(text: string, max = 60): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}
