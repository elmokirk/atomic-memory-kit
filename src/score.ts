/**
 * Deterministic retrieval scoring — no embeddings, no model call, no network.
 *
 * Language handling is driven by the LanguageProfile (see config.ts), so the
 * defaults (German umlaut folding + light suffix stemmer) can be swapped for
 * another language family without touching this file.
 *
 * Because morphology is asymmetric (German "Webseite" and "Webseiten" stem to
 * different forms), single-token matching falls back to a length-guarded
 * prefix comparison. This is a deliberate, documented heuristic — it reduces
 * synonym maintenance, it does not replace it. See LIMITATIONS.md §Retrieval.
 */
import type { LanguageProfile, MemoryAtom, MemoryAtomTokenSets, MemoryConfig } from './types.ts'

/** Lowercase + character folding. */
export function normalize(text: string, language: LanguageProfile): string {
  const lowered = text.toLowerCase()
  let out = ''
  for (const char of lowered) out += language.fold[char] ?? char
  return out
}

/** Light suffix stemmer with a minimum-length guard to avoid over-stemming. */
export function stem(token: string, language: LanguageProfile): string {
  if (token.length <= language.minStemLength) return token
  for (const suffix of language.stemSuffixes) {
    if (token.length - suffix.length >= language.minStemLength && token.endsWith(suffix)) {
      return token.slice(0, -suffix.length)
    }
  }
  return token
}

export function tokenize(text: string, language: LanguageProfile): Set<string> {
  const normalized = normalize(text, language)
  const tokens = new Set<string>()
  for (const raw of normalized.split(/[^a-z0-9]+/)) {
    if (raw.length < 2 || language.stopwords.has(raw)) continue
    // Bare years are weak signals ("buy in 2026") — excluded from title/summary/
    // body scoring. Explicit `keywords` entries still match via their own path.
    if (language.dropYearTokens && /^(19|20)\d{2}$/.test(raw)) continue
    // Both forms cover morphology asymmetries (webseiten -> webseit -> website).
    tokens.add(raw)
    tokens.add(stem(raw, language))
  }
  return tokens
}

function fuzzyMatch(needle: string, haystack: Set<string>, language: LanguageProfile): boolean {
  if (haystack.has(needle)) return true
  const stemmed = stem(needle, language)
  if (haystack.has(stemmed)) return true
  if (stemmed.length < language.minPrefixLength) return false
  for (const token of haystack) {
    if (token.length < language.minPrefixLength) continue
    if (token.startsWith(stemmed) || stemmed.startsWith(token)) return true
  }
  return false
}

function countMatches(atomTokens: Set<string>, queryTokens: Set<string>, language: LanguageProfile): number {
  let matched = 0
  for (const token of atomTokens) {
    if (queryTokens.has(token)) matched++
    else if (fuzzyMatch(token, queryTokens, language)) matched++
  }
  return matched
}

/**
 * Score one atom against the query.
 *
 * Multi-word keywords/synonyms match as phrases on the normalized query.
 * `cached` carries precomputed field tokens (loader.buildTokenCache); when
 * omitted, fields are tokenized on the fly — results are identical either way.
 *
 * Title/summary/body contribute their weight AT MOST ONCE (distinct-token
 * presence, not frequency), so a long body cannot outshout an explicit keyword.
 */
export function scoreAtom(
  atom: MemoryAtom,
  config: MemoryConfig,
  language: LanguageProfile,
  query: string,
  queryTokens: Set<string>,
  cached?: MemoryAtomTokenSets,
): number {
  const w = config.weights
  const normalizedQuery = normalize(query, language)
  let points = 0

  for (const phrase of atom.keywords) {
    const normalizedPhrase = normalize(phrase, language)
    if (normalizedPhrase.includes(' ')) {
      if (normalizedQuery.includes(normalizedPhrase)) points += w.keywords
    } else if (fuzzyMatch(normalizedPhrase, queryTokens, language)) {
      points += w.keywords
    }
  }

  for (const phrase of atom.synonyms) {
    const normalizedPhrase = normalize(phrase, language)
    if (normalizedPhrase.includes(' ')) {
      if (normalizedQuery.includes(normalizedPhrase)) points += w.synonyms
    } else if (fuzzyMatch(normalizedPhrase, queryTokens, language)) {
      points += w.synonyms
    }
  }

  const titleTokens = cached?.title ?? tokenize(atom.title, language)
  const summaryTokens = cached?.summary ?? tokenize(atom.summary, language)
  const bodyTokens = cached?.body ?? tokenize(atom.body, language)
  points += countMatches(titleTokens, queryTokens, language) > 0 ? w.title : 0
  points += countMatches(summaryTokens, queryTokens, language) > 0 ? w.summary : 0
  points += countMatches(bodyTokens, queryTokens, language) > 0 ? w.body : 0

  return Math.round((points + atom.priorityBonus) * 100) / 100
}
