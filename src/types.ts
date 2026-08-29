/**
 * Atomic Memory Kit — shared types.
 *
 * This module (and everything in `src/`) is intentionally dependency-free:
 * no framework imports, no Node built-ins, no project-relative imports outside
 * this folder. It must stay copy-paste extractable into any TypeScript project
 * (Node, Nuxt/Nitro, Next.js, Deno, Bun, browser).
 *
 * Syntax constraint: this file must remain *type-strippable* (no enums, no
 * parameter properties, no namespaces) so `node src/...` runs it without a
 * build step on Node >= 22.6.
 */

/** Raw markdown file as delivered by a host adapter (fs, CMS, HTTP, storage). */
export interface MemoryFileRaw {
  /** Path relative to the memory root, e.g. `services/audit.md`. POSIX or Windows. */
  path: string
  content: string
}

/**
 * One atom = one self-contained fact/topic.
 *
 * Field classes (see CONTRACT.md):
 *   Core      — id, title, category, lang  (missing => hard error)
 *   Standard  — optional but type-checked   (wrong type => hard error)
 *   Extension — anything else               (pass-through into `extensions`)
 */
export interface MemoryAtom {
  /** Stable citation id, e.g. `services.audit`. Target of [[source:id]] and related[]. */
  id: string
  title: string
  category: string
  /** ISO language tag of the content, e.g. `de`, `en`. Retrieval is language-agnostic. */
  lang: string
  summary: string
  body: string
  /** Injected into every context bundle regardless of the query (index, scope map). */
  alwaysInclude: boolean
  intents: string[]
  keywords: string[]
  synonyms: string[]
  /** Raw `priority` frontmatter value, preserved verbatim for round-tripping. */
  priority?: number
  /** Bonus added to every score of this atom (`priority: 100` => +1, `-100` => -1). */
  priorityBonus: number
  /** Optional deep link to a canonical surface covering this atom. */
  link?: string
  /** Human label for `link`. */
  linkLabel?: string
  /** Graph edges: ids of related atoms — integrity is enforced by the loader. */
  related?: string[]
  /** Unregistered frontmatter fields, pass-through per contract. Never scored. */
  extensions: Record<string, unknown>
  /** Host-relative path this atom was parsed from. Derived, never round-tripped. */
  sourcePath?: string
}

export type ScopeStatus = 'match' | 'no_match'

export interface RetrievedChunk {
  id: string
  title: string
  category: string
  content: string
  score: number
  /** True when this chunk entered via a related[] edge, not via direct scoring. */
  viaEdge?: boolean
}

export interface MemorySearchResult {
  chunks: RetrievedChunk[]
  scopeStatus: ScopeStatus
  bestScore: number
}

/** Precomputed tokenize() output per atom field (see loader.buildTokenCache). */
export interface MemoryAtomTokenSets {
  title: Set<string>
  summary: Set<string>
  body: Set<string>
}

/** Serializable language tuning (JSON-friendly — lives in memory.config.json). */
export interface LanguageConfig {
  /** Character folding applied before tokenizing, e.g. { "ä": "ae" }. */
  fold?: Record<string, string>
  /** Words removed from queries and atom fields before scoring. */
  stopwords?: string[]
  /** Suffixes stripped by the light stemmer, longest first. */
  stemSuffixes?: string[]
  /** Tokens at or below this length are never stemmed. */
  minStemLength?: number
  /** Minimum length for prefix-fuzzy matching (guards against false friends). */
  minPrefixLength?: number
  /** Drop bare year tokens (1900-2099) — weak signals, many false positives. */
  dropYearTokens?: boolean
}

/** Runtime form of LanguageConfig with Sets resolved. Built once per base. */
export interface LanguageProfile {
  fold: Record<string, string>
  stopwords: Set<string>
  stemSuffixes: string[]
  minStemLength: number
  minPrefixLength: number
  dropYearTokens: boolean
}

export interface MemoryBase {
  atoms: MemoryAtom[]
  byId: Map<string, MemoryAtom>
  alwaysInclude: MemoryAtom[]
  config: MemoryConfig
  language: LanguageProfile
  /** Eager one-pass tokenize cache keyed by atom.id — no re-tokenizing per query. */
  tokenCache: Map<string, MemoryAtomTokenSets>
}

export interface MemoryConfig {
  /** Score threshold below which retrieval reports `no_match`. */
  minScore: number
  /** Max retrieved atoms per request. */
  maxChunks: number
  /** Character budget for retrieved chunk bodies combined. */
  charBudget: number
  /** How many trailing history messages (user role) extend the query context. */
  historyContextMessages: number
  weights: {
    keywords: number
    synonyms: number
    title: number
    summary: number
    body: number
  }
  /** Known categories — unknown ones only warn (forward compatibility). */
  categories: string[]
  /** Known intents — unknown ones only warn (forward compatibility). */
  intents: string[]
  /** Score multiplier for related[] neighbours pulled in by edge expansion. */
  edgeBoost: number
  /** Hard cap of edge-derived chunks per search. */
  edgeMaxChunks: number
  /** Character budget reserved for the single edge chunk before seeds fill up. */
  edgeReserveChars: number
  /** Bonus added to atoms whose category matches the caller-reported context. */
  contextBoost?: number
  /** Normalized context key (route, workspace, task type) => boosted categories. */
  contextCategories?: Record<string, string[]>
  /** Atom count above which a generated `_index.md` becomes mandatory. */
  indexRequiredAtAtoms?: number
  /** Language tuning. Defaults cover German + English. */
  language?: LanguageConfig
}

/**
 * Thrown when an atom violates a core contract rule. Written without a
 * parameter property so the file stays type-strippable.
 */
export class MemoryContractError extends Error {
  filePath?: string

  constructor(message: string, filePath?: string) {
    super(filePath ? `${filePath}: ${message}` : message)
    this.name = 'MemoryContractError'
    this.filePath = filePath
  }
}
