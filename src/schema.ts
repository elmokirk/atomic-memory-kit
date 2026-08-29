/**
 * Frontmatter contract v1 — field classes and validation.
 *
 * Field classes (see CONTRACT.md):
 *   Core      — required: id, title, category, lang
 *   Standard  — optional, type-checked when present
 *   Extension — anything else: pass-through into atom.extensions, never scored
 *               until registered in config (weights/filters).
 *
 * Forward compatibility is the load-bearing design rule: unknown categories
 * and intents produce WARNINGS, not errors, so a memory written by a future
 * version of your taxonomy still loads today. Broken CORE fields are errors —
 * the file is rejected loudly, because silent degradation of an agent's memory
 * is the failure mode that costs the most trust.
 */
import type { MemoryAtom } from './types.ts'

const CORE_FIELDS = ['id', 'title', 'category', 'lang'] as const

const STRING_ARRAY_FIELDS = ['keywords', 'synonyms', 'intents', 'related'] as const
const BOOLEAN_FIELDS = ['alwaysInclude'] as const
const NUMBER_FIELDS = ['priority'] as const
const LINK_FIELDS = ['link', 'linkLabel'] as const

const ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/
const LANG_PATTERN = /^[a-z]{2}(-[a-zA-Z0-9]+)?$/

export interface ValidationIssue {
  /** error = file rejected · warning = loaded but flagged · info = FYI only. */
  severity: 'error' | 'warning' | 'info'
  message: string
}

export interface ValidationResult {
  atom?: MemoryAtom
  issues: ValidationIssue[]
}

export interface ValidateOptions {
  knownCategories?: string[]
  knownIntents?: string[]
  /** Minimum keyword count before warning. Default 2. */
  minKeywords?: number
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

/** Map raw frontmatter + body to a validated atom; collects errors and warnings. */
export function validateAtom(
  data: Record<string, unknown>,
  body: string,
  options: ValidateOptions = {},
): ValidationResult {
  const issues: ValidationIssue[] = []
  const fail = (message: string) => issues.push({ severity: 'error', message })
  const warn = (message: string) => issues.push({ severity: 'warning', message })
  const minKeywords = options.minKeywords ?? 2

  for (const field of CORE_FIELDS) {
    const value = data[field]
    if (typeof value !== 'string' || value.trim() === '') {
      fail(`core field "${field}" is missing or not a non-empty string`)
    }
  }
  if (issues.some((issue) => issue.severity === 'error')) {
    return { issues }
  }

  const id = data.id as string
  if (!ID_PATTERN.test(id)) warn(`id "${id}" deviates from lowercase dotted/kebab convention`)

  const category = data.category as string
  if (options.knownCategories?.length && !options.knownCategories.includes(category)) {
    warn(`unregistered category "${category}" — register it in config.categories or fix the typo`)
  }

  const lang = data.lang as string
  if (!LANG_PATTERN.test(lang)) warn(`lang "${lang}" is not an ISO tag like "de" or "en"`)

  for (const field of STRING_ARRAY_FIELDS) {
    const value = data[field]
    if (value !== undefined && !isStringArray(value)) {
      fail(`field "${field}" must be an inline array of strings (quote numbers: ["1500"])`)
    }
  }
  for (const field of BOOLEAN_FIELDS) {
    const value = data[field]
    if (value !== undefined && typeof value !== 'boolean') fail(`field "${field}" must be true or false`)
  }
  for (const field of NUMBER_FIELDS) {
    const value = data[field]
    if (value !== undefined && typeof value !== 'number') fail(`field "${field}" must be a number`)
  }

  const link = data.link as string | undefined
  if (link !== undefined && !/^(\/|https?:\/\/)[^\s]*$/.test(link)) {
    fail(`field "link" must be an absolute path or URL (got "${link}")`)
  }
  if (link === undefined && data.linkLabel !== undefined) {
    warn('field "linkLabel" without "link" has no effect')
  }

  const related = data.related as string[] | undefined
  if (related) {
    for (const target of related) {
      if (!ID_PATTERN.test(target)) fail(`related target "${target}" is not a valid atom id`)
    }
    if (related.includes(id)) fail('self-reference in related[] is not allowed')
  }

  if (issues.some((issue) => issue.severity === 'error')) {
    return { issues }
  }

  const keywords = data.keywords as string[] | undefined
  if (keywords !== undefined && keywords.length < minKeywords) {
    warn(keywords.length === 0
      ? 'empty keywords array — this atom will rarely be retrieved'
      : `only ${keywords.length} keyword(s) — add at least ${minKeywords} (user vocabulary, both languages, compounds)`)
  }
  if (keywords === undefined) warn('no keywords — this atom is only reachable via title/summary/body tokens')
  if (body.trim() === '') warn('empty body')

  const intents = (data.intents as string[] | undefined) ?? []
  for (const intent of intents) {
    if (options.knownIntents?.length && !options.knownIntents.includes(intent)) {
      warn(`unregistered intent "${intent}" — register it in config.intents or fix the typo`)
    }
  }

  const priority = data.priority
  const priorityBonus = typeof priority === 'number' ? Math.max(-1, Math.min(1, priority / 100)) : 0

  const standardFields = new Set<string>([
    ...CORE_FIELDS,
    ...STRING_ARRAY_FIELDS,
    ...BOOLEAN_FIELDS,
    ...NUMBER_FIELDS,
    ...LINK_FIELDS,
    'summary',
  ])

  const extensions: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (!standardFields.has(key)) extensions[key] = value
  }
  // Extension fields are listed as info, never warnings: they are legitimate
  // per contract, and surfacing them is how typos ("keywrods:") become visible.
  for (const key of Object.keys(extensions)) {
    issues.push({ severity: 'info', message: `extension field "${key}" is inert until registered in config` })
  }

  const atom: MemoryAtom = {
    id,
    title: data.title as string,
    category,
    lang,
    summary: typeof data.summary === 'string' ? data.summary : '',
    body,
    alwaysInclude: data.alwaysInclude === true,
    intents,
    keywords: keywords ?? [],
    synonyms: (data.synonyms as string[] | undefined) ?? [],
    ...(typeof priority === 'number' ? { priority } : {}),
    priorityBonus,
    link: typeof data.link === 'string' ? data.link : undefined,
    linkLabel: typeof data.linkLabel === 'string' ? data.linkLabel : undefined,
    related,
    extensions,
  }

  return { atom, issues }
}
