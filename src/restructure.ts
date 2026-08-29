/**
 * The inbound direction: raw material -> contract-conformant atoms.
 *
 * `compile.ts` goes atoms -> bundle. This module goes prose -> atoms, which is
 * the half the original chatbot kit never had, and the half the gap-closing
 * loop actually needs: the user answers a question in plain text, and something
 * has to turn that answer into a filed, retrievable, citable atom.
 *
 * ## The division of labour, stated plainly
 *
 * Deciding *where one topic ends and the next begins* is a semantic judgement.
 * This kit contains no model and will not pretend otherwise. So:
 *
 *   - The **agent** proposes the split and writes ids, titles, keywords.
 *   - This module **validates, normalizes, diffs and applies** the proposal,
 *     and refuses anything the contract rejects.
 *   - `draftFromMarkdown` exists as a deterministic *fallback* for the common
 *     case where the submitted text already has headings. It is a structural
 *     split, not an understanding of the content, and it says so in the
 *     `confidence` it returns.
 *
 * That boundary is the point. An agent that hallucinates a plausible atom still
 * cannot produce a dangling edge, a duplicate id, or an unquoted number,
 * because the plan is checked against the same loader the memory runs on.
 */
import { pathForId, serializeAtom } from './compile.ts'
import type { CompiledAtom } from './compile.ts'
import { GRAMMAR } from './contract.ts'
import { loadMemory } from './loader.ts'
import { validateAtom } from './schema.ts'
import type { ValidationIssue } from './schema.ts'
import type { MemoryBase, MemoryConfig, MemoryFileRaw } from './types.ts'

const ID_PATTERN = new RegExp(GRAMMAR.id)

/** An atom an agent (or `draftFromMarkdown`) wants to add or change. */
export interface AtomProposal {
  id: string
  title: string
  category: string
  lang: string
  body: string
  summary?: string
  keywords?: string[]
  synonyms?: string[]
  intents?: string[]
  related?: string[]
  alwaysInclude?: boolean
  priority?: number
  link?: string
  linkLabel?: string
  extensions?: Record<string, unknown>
  /** Gap ids this proposal is meant to close. Carried into the apply report. */
  closesGaps?: string[]
}

export type ProposalVerdict = 'create' | 'update' | 'unchanged' | 'rejected'

export interface ProposalPlan {
  id: string
  verdict: ProposalVerdict
  path: string
  /** Contract findings for this proposal. Any `error` forces `rejected`. */
  issues: ValidationIssue[]
  /** Frontmatter fields whose value differs from the atom already on disk. */
  changedFields: string[]
  /** Rendered file content, present unless rejected. */
  content?: string
  closesGaps: string[]
}

export interface ApplyPlan {
  ok: boolean
  /** Contract version the plan was checked against. */
  contractVersion: string
  plans: ProposalPlan[]
  /** Reasons the whole plan is refused, independent of any single proposal. */
  blockers: string[]
  summary: { create: number, update: number, unchanged: number, rejected: number }
}

function toCompiled(proposal: AtomProposal): CompiledAtom {
  return {
    id: proposal.id,
    title: proposal.title,
    category: proposal.category,
    lang: proposal.lang,
    summary: proposal.summary ?? '',
    body: proposal.body,
    keywords: proposal.keywords ?? [],
    synonyms: proposal.synonyms ?? [],
    intents: proposal.intents ?? [],
    related: proposal.related ?? [],
    alwaysInclude: proposal.alwaysInclude ?? false,
    priority: proposal.priority,
    link: proposal.link,
    linkLabel: proposal.linkLabel,
    extensions: proposal.extensions ?? {},
  }
}

function frontmatterOf(proposal: AtomProposal): Record<string, unknown> {
  const data: Record<string, unknown> = {
    id: proposal.id,
    title: proposal.title,
    category: proposal.category,
    lang: proposal.lang,
    ...proposal.extensions,
  }
  if (proposal.summary !== undefined) data.summary = proposal.summary
  if (proposal.keywords !== undefined) data.keywords = proposal.keywords
  if (proposal.synonyms !== undefined) data.synonyms = proposal.synonyms
  if (proposal.intents !== undefined) data.intents = proposal.intents
  if (proposal.related !== undefined) data.related = proposal.related
  if (proposal.alwaysInclude !== undefined) data.alwaysInclude = proposal.alwaysInclude
  if (proposal.priority !== undefined) data.priority = proposal.priority
  if (proposal.link !== undefined) data.link = proposal.link
  if (proposal.linkLabel !== undefined) data.linkLabel = proposal.linkLabel
  return data
}

const sameValue = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/**
 * Dry-run a set of proposals against the live memory.
 *
 * Nothing is written. The plan is complete and honest: every proposal is
 * validated against the contract, edges are resolved against the union of
 * existing and proposed ids, and the result is a diff a human can read before
 * anything touches disk.
 *
 * Why edges resolve against the union: a batch that adds A and B where A links
 * to B is legitimate and common. Checking each proposal in isolation would
 * reject it.
 */
export function planApply(
  base: MemoryBase,
  proposals: AtomProposal[],
  options: { contractVersion?: string } = {},
): ApplyPlan {
  const blockers: string[] = []
  const seen = new Set<string>()
  for (const proposal of proposals) {
    if (seen.has(proposal.id)) blockers.push(`duplicate id in this batch: ${proposal.id}`)
    seen.add(proposal.id)
  }

  const futureIds = new Set<string>([...base.byId.keys(), ...seen])
  const plans: ProposalPlan[] = []

  for (const proposal of proposals) {
    const issues: ValidationIssue[] = []
    const data = frontmatterOf(proposal)
    const result = validateAtom(data, proposal.body, {
      knownCategories: base.config.categories,
      knownIntents: base.config.intents,
    })
    issues.push(...result.issues)

    // Edge integrity against the post-apply world, not the current one.
    for (const target of proposal.related ?? []) {
      if (!futureIds.has(target)) {
        issues.push({
          severity: 'error',
          code: 'E_EDGE_DANGLING',
          message: `related target "${target}" exists neither in the memory nor in this batch`,
        })
      }
    }

    const rejected = issues.some((issue) => issue.severity === 'error')
    const existing = base.byId.get(proposal.id)
    const changedFields: string[] = []
    if (existing) {
      const before = {
        title: existing.title,
        category: existing.category,
        lang: existing.lang,
        summary: existing.summary,
        keywords: existing.keywords,
        synonyms: existing.synonyms,
        intents: existing.intents,
        related: existing.related,
        alwaysInclude: existing.alwaysInclude,
        priority: existing.priority,
        link: existing.link,
        linkLabel: existing.linkLabel,
        body: existing.body.trim(),
      }
      const after = {
        title: proposal.title,
        category: proposal.category,
        lang: proposal.lang,
        summary: proposal.summary ?? '',
        keywords: proposal.keywords ?? [],
        synonyms: proposal.synonyms ?? [],
        intents: proposal.intents ?? [],
        related: proposal.related,
        alwaysInclude: proposal.alwaysInclude ?? false,
        priority: proposal.priority,
        link: proposal.link,
        linkLabel: proposal.linkLabel,
        body: proposal.body.trim(),
      }
      for (const key of Object.keys(after)) {
        if (!sameValue((before as Record<string, unknown>)[key], (after as Record<string, unknown>)[key])) {
          changedFields.push(key)
        }
      }
    }

    const verdict: ProposalVerdict = rejected
      ? 'rejected'
      : !existing
          ? 'create'
          : changedFields.length === 0 ? 'unchanged' : 'update'

    plans.push({
      id: proposal.id,
      verdict,
      path: pathForId(proposal.id),
      issues,
      changedFields,
      content: rejected ? undefined : serializeAtom(toCompiled(proposal)),
      closesGaps: proposal.closesGaps ?? [],
    })
  }

  const summary = { create: 0, update: 0, unchanged: 0, rejected: 0 }
  for (const plan of plans) summary[plan.verdict] += 1

  return {
    ok: blockers.length === 0 && summary.rejected === 0,
    contractVersion: options.contractVersion ?? '1.0.0',
    plans,
    blockers,
    summary,
  }
}

/**
 * Turn an accepted plan into files, then prove the result still loads.
 *
 * The second half is the part that matters. Writing files that individually
 * validate is not enough: a batch can still break id uniqueness or graph
 * integrity at the base level. This re-runs the real loader over the merged
 * file set and refuses to hand back anything that would not load.
 */
export function materialize(
  currentFiles: MemoryFileRaw[],
  plan: ApplyPlan,
  config: MemoryConfig,
): { files: MemoryFileRaw[], verified: true } {
  if (!plan.ok) {
    const reasons = [...plan.blockers, ...plan.plans.filter((p) => p.verdict === 'rejected').map((p) => p.id)]
    throw new Error(`refusing to materialize a plan that is not ok: ${reasons.join(', ')}`)
  }

  const byPath = new Map(currentFiles.map((file) => [file.path.replace(/\\/g, '/'), file]))
  for (const entry of plan.plans) {
    if (entry.verdict === 'unchanged' || entry.content === undefined) continue
    byPath.set(entry.path, { path: entry.path, content: entry.content })
  }

  const files = [...byPath.values()]
  // Throws MemoryContractError if the merged set is not loadable.
  loadMemory(files, config)
  return { files, verified: true }
}

export interface DraftOptions {
  category: string
  lang: string
  /** Prefix for generated ids, e.g. `inbox` -> `inbox.deployment-rollback`. */
  idPrefix?: string
  /** Heading depth that starts a new atom. Default 2 (`##`). */
  splitLevel?: number
}

export interface AtomDraft extends AtomProposal {
  /**
   * How much the split can be trusted.
   *   `structural` — the text had headings at the split level; the boundaries
   *                  are the author's, not ours.
   *   `fallback`   — no headings found; the whole text became one atom.
   * Never `semantic`. Nothing here understands the content.
   */
  confidence: 'structural' | 'fallback'
  /** Fields a human or agent must still supply. Never silently invented. */
  needs: string[]
}

function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '')
  return slug || 'untitled'
}

/**
 * Deterministic structural split of submitted markdown into atom drafts.
 *
 * Splits on headings at `splitLevel`. Content before the first such heading is
 * kept as a preamble draft only if it is non-trivial — otherwise it is dropped,
 * because a stray sentence above the first heading is usually a lead-in, not a
 * fact.
 *
 * What it deliberately does NOT do: invent keywords, write summaries, or guess
 * edges. Those come back in `needs` so the caller knows the draft is unfinished.
 * An atom with machine-guessed keywords is worse than one with none — it looks
 * done, and it silently fails retrieval.
 */
export function draftFromMarkdown(markdown: string, options: DraftOptions): AtomDraft[] {
  const level = options.splitLevel ?? 2
  const marker = '#'.repeat(level)
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')

  const sections: { title: string, lines: string[] }[] = []
  let current: { title: string, lines: string[] } | null = null
  const preamble: string[] = []
  let inFence = false

  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence
    const heading = !inFence && line.startsWith(`${marker} `) ? line.slice(marker.length + 1).trim() : null
    if (heading !== null) {
      if (current) sections.push(current)
      current = { title: heading, lines: [] }
      continue
    }
    if (current) current.lines.push(line)
    else preamble.push(line)
  }
  if (current) sections.push(current)

  const preambleText = preamble.join('\n').trim()
  if (sections.length === 0) {
    if (preambleText === '') return []
    return [makeDraft(firstSentence(preambleText) || 'Untitled', preambleText, options, 'fallback')]
  }
  // A substantial preamble is content someone wrote on purpose; a short one is
  // almost always "here are my notes:".
  if (preambleText.length > 200) {
    sections.unshift({ title: firstSentence(preambleText) || 'Overview', lines: preamble })
  }

  return sections
    .filter((section) => section.lines.join('\n').trim() !== '')
    .map((section) => makeDraft(section.title, section.lines.join('\n').trim(), options, 'structural'))
}

function firstSentence(text: string): string {
  const line = text.split('\n').find((entry) => entry.trim() !== '')?.trim() ?? ''
  const stripped = line.replace(/^#+\s*/, '').replace(/^[-*]\s*/, '')
  const match = stripped.match(/^.{0,80}?[.!?](\s|$)/)
  return (match ? match[0] : stripped.slice(0, 80)).trim().replace(/[.!?]$/, '')
}

function makeDraft(
  title: string,
  body: string,
  options: DraftOptions,
  confidence: 'structural' | 'fallback',
): AtomDraft {
  const slug = slugify(title)
  const id = options.idPrefix ? `${options.idPrefix}.${slug}` : `${slugify(options.category)}.${slug}`
  const needs = ['keywords', 'summary']
  if (!ID_PATTERN.test(id)) needs.push('id')
  return {
    id,
    title,
    category: options.category,
    lang: options.lang,
    body,
    confidence,
    needs,
  }
}
