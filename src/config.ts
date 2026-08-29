/**
 * Configuration — the single adaptation point per project.
 *
 * Point `categories`/`intents` at your own taxonomy, tune weights and budgets.
 * No other file in `src/` needs to change when you adopt the kit.
 *
 * Two ways to supply it:
 *   - library: `defineMemoryConfig({ categories: [...] })`
 *   - CLI:     a `memory.config.json` next to your memory root (same shape)
 */
import type { LanguageConfig, LanguageProfile, MemoryConfig } from './types.ts'

/** German + English defaults. Replace wholesale for other language families. */
export const defaultLanguageConfig: LanguageConfig = {
  fold: { 'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'ß': 'ss' },
  stopwords: [
    'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einer', 'einen',
    'und', 'oder', 'ist', 'sind', 'war', 'wie', 'was', 'wer', 'wann', 'wo', 'warum',
    'ich', 'du', 'er', 'sie', 'es', 'wir', 'ihr', 'mich', 'mir', 'sich',
    'mit', 'für', 'von', 'vom', 'zum', 'zur', 'auf', 'aus', 'bei', 'nach', 'im',
    'the', 'and', 'or', 'is', 'are', 'how', 'what', 'who',
    'when', 'where', 'why', 'you', 'she', 'they',
    'with', 'for', 'of', 'to', 'at', 'from', 'by', 'on', 'in', 'do', 'does',
  ],
  stemSuffixes: ['ern', 'er', 'es', 'em', 'en', 'e', 'n', 's'],
  minStemLength: 4,
  minPrefixLength: 5,
  dropYearTokens: true,
}

export const defaultMemoryConfig: MemoryConfig = {
  minScore: 3,
  maxChunks: 4,
  charBudget: 2500,
  historyContextMessages: 2,
  weights: {
    keywords: 3,
    synonyms: 2,
    title: 2,
    summary: 1,
    body: 0.5,
  },
  categories: [],
  intents: [],
  edgeBoost: 0.4,
  edgeMaxChunks: 1,
  edgeReserveChars: 700,
  contextBoost: 2,
  contextCategories: {},
  indexRequiredAtAtoms: 41,
  language: defaultLanguageConfig,
}

/** Shallow-merge with a nested merge for `weights` and `language`. */
export function defineMemoryConfig(partial: Partial<MemoryConfig> = {}): MemoryConfig {
  return {
    ...defaultMemoryConfig,
    ...partial,
    weights: { ...defaultMemoryConfig.weights, ...(partial.weights ?? {}) },
    language: { ...defaultLanguageConfig, ...(partial.language ?? {}) },
  }
}

/** Resolve the JSON-friendly LanguageConfig into runtime lookups (Sets). */
export function resolveLanguageProfile(config?: LanguageConfig): LanguageProfile {
  const merged = { ...defaultLanguageConfig, ...(config ?? {}) }
  return {
    fold: merged.fold ?? {},
    stopwords: new Set(merged.stopwords ?? []),
    stemSuffixes: merged.stemSuffixes ?? [],
    minStemLength: merged.minStemLength ?? 4,
    minPrefixLength: merged.minPrefixLength ?? 5,
    dropYearTokens: merged.dropYearTokens !== false,
  }
}
