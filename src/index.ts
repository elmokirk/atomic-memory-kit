/**
 * Atomic Memory Kit — public surface.
 *
 * Note for Nuxt/Nitro users: Nitro auto-imports every file in `server/utils/**`
 * and a barrel like this one causes duplicate-import warnings. When copying
 * `src/` into a Nitro project, import the individual modules instead of this
 * barrel and delete this file. Everywhere else, use it.
 */
export type {
  LanguageConfig,
  LanguageProfile,
  MemoryAtom,
  MemoryAtomTokenSets,
  MemoryBase,
  MemoryConfig,
  MemoryFileRaw,
  MemorySearchResult,
  RetrievedChunk,
  ScopeStatus,
} from './types.ts'
export { MemoryContractError } from './types.ts'

export {
  defaultLanguageConfig,
  defaultMemoryConfig,
  defineMemoryConfig,
  resolveLanguageProfile,
} from './config.ts'

export {
  CONFORMANCE,
  CONSUMERS,
  CONTRACT_COMPATIBLE,
  CONTRACT_ID,
  CONTRACT_VERSION,
  CORE_FIELD_NAMES,
  DIAGNOSTICS,
  FIELDS,
  GRAMMAR,
  IMPLEMENTED_CONFORMANCE,
  RESERVED_FIELD_NAMES,
  STANDARD_FIELD_NAMES,
  blastRadius,
  describeContract,
  fieldSpec,
  isContractCompatible,
} from './contract.ts'
export type {
  ConformanceLevel,
  ConsumerName,
  ContractDescriptor,
  DiagnosticCode,
  FieldClass,
  FieldSpec,
  FieldType,
} from './contract.ts'

export { parseFrontmatter } from './parse-frontmatter.ts'
export type { FrontmatterResult } from './parse-frontmatter.ts'

export { validateAtom } from './schema.ts'
export type { ValidateOptions, ValidationIssue, ValidationResult } from './schema.ts'

export { buildTokenCache, findOrphanAtoms, isContentFile, loadMemory } from './loader.ts'
export type { LoadIssue, LoadReport } from './loader.ts'

export { normalize, scoreAtom, stem, tokenize } from './score.ts'

export { buildQuery, normalizeContext, searchMemory } from './search.ts'
export type { SearchOptions } from './search.ts'

export {
  BUNDLE_CONTRACT_VERSION,
  BUNDLE_VERSION,
  buildScopeIndex,
  compileMemory,
  decompile,
  parseBundle,
  pathForId,
  renderBundle,
  renderDigest,
  serializeAtom,
} from './compile.ts'
export type { BundleOptions, CompiledAtom, CompiledMemory, ParsedBundle } from './compile.ts'

export {
  GAP_MARKER_PATTERN,
  GAP_PROTOCOL_INSTRUCTION,
  createGapDetector,
  createGapLedger,
  extractGapTopics,
  findTodoMarkers,
  gapId,
  normalizeTopic,
  parseGapReport,
  renderGapReport,
  stripGapMarkers,
} from './gaps.ts'
export type { GapDetector, GapKind, GapLedger, GapObservation, GapRecord, GapStatus } from './gaps.ts'

export {
  checkThresholds,
  compareBaseline,
  defaultThresholds,
  evalToGaps,
  runEval,
} from './eval.ts'
export type { EvalCase, EvalSummary, EvalThresholds } from './eval.ts'

export { checkDrift, driftToGaps, findUncoveredAtoms } from './drift.ts'
export type { Claim, ClaimType, DriftFinding } from './drift.ts'

export { draftFromMarkdown, materialize, planApply } from './restructure.ts'
export type {
  ApplyPlan,
  AtomDraft,
  AtomProposal,
  DraftOptions,
  ProposalPlan,
  ProposalVerdict,
} from './restructure.ts'
