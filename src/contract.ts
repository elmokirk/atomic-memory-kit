/**
 * The contract, as data.
 *
 * `CONTRACT.md` is the prose. This file is the machine-readable mirror, and it
 * is the reason the contract can be the glue: a foreign system — an agent, a
 * CMS, a validator written in another language, an MCP client — can read the
 * field table, the severities, the consumer map and the error codes without
 * parsing English.
 *
 * Two invariants hold this together and are enforced by `tests/contract.test.ts`:
 *
 *   1. Every field this module declares is handled by `schema.ts`, and every
 *      field `schema.ts` handles is declared here.
 *   2. Every declared consumer name exists in `CONSUMERS`.
 *
 * Dependency direction is one-way and total:
 *
 *   contract.ts  ->  (nothing)
 *   everything   ->  contract.ts
 *
 * This module imports no runtime value from anywhere. Breaking that is what
 * turns a contract into a coupling.
 */

/** Contract identity. Foreign systems compare this, not the kit version. */
export const CONTRACT_ID = 'io.atomicmemory/contract'

/**
 * Contract semver. Independent of the kit version.
 *
 *   major — a previously valid atom becomes invalid, or a field changes meaning
 *   minor — an additive optional field, or a new consumer for an existing field
 *   patch — wording, diagnostics, non-normative guidance
 */
export const CONTRACT_VERSION = '1.0.0'

/** Contract versions this build can load. Used for negotiation. */
export const CONTRACT_COMPATIBLE = ['1.x'] as const

export type FieldClass = 'core' | 'standard' | 'extension'
export type FieldType = 'string' | 'string[]' | 'number' | 'boolean'
export type Severity = 'error' | 'warning' | 'info'

/**
 * Subsystems that read atom fields. A field's `consumers` list is its blast
 * radius: change the field, and exactly these break.
 */
export const CONSUMERS = {
  loader: 'Parses, validates, indexes, and enforces graph integrity.',
  retrieval: 'Scores atoms against a query and decides match / no_match.',
  graph: 'Resolves related[] edges and expands 1 hop from seed hits.',
  compile: 'Projects atoms to bundle / json / digest and back to atoms.',
  index: 'Generates the scope index atom (_index.md).',
  gaps: 'Detects, deduplicates, and reports what the memory does not know.',
  citation: 'Resolves [[source:id]] back to an atom for attribution.',
  host: 'Application-side use — deep links, language mirroring, UI.',
} as const

export type ConsumerName = keyof typeof CONSUMERS

export interface FieldSpec {
  name: string
  class: FieldClass
  type: FieldType
  required: boolean
  /** Severity when the value is present but the wrong type. */
  onTypeViolation: Severity
  /** Severity when the value is well-typed but not registered / conventional. */
  onValueViolation: Severity
  consumers: ConsumerName[]
  /** True when a value change alters retrieval results rather than only display. */
  affectsRetrieval: boolean
  /** True when other artifacts point at this value, so changing it breaks links. */
  isReferenceTarget: boolean
  summary: string
}

/**
 * The field table.
 *
 * Ordering is stable and meaningful: core first, then standard in the order a
 * template writes them. Renderers may rely on it.
 */
export const FIELDS: FieldSpec[] = [
  {
    name: 'id',
    class: 'core',
    type: 'string',
    required: true,
    onTypeViolation: 'error',
    onValueViolation: 'warning',
    consumers: ['loader', 'graph', 'compile', 'index', 'gaps', 'citation'],
    affectsRetrieval: false,
    isReferenceTarget: true,
    summary: 'Stable, unique, permanent citation target. Dots map to directories.',
  },
  {
    name: 'title',
    class: 'core',
    type: 'string',
    required: true,
    onTypeViolation: 'error',
    onValueViolation: 'info',
    consumers: ['retrieval', 'compile', 'index', 'host'],
    affectsRetrieval: true,
    isReferenceTarget: false,
    summary: 'Human label. Scored at weights.title.',
  },
  {
    name: 'category',
    class: 'core',
    type: 'string',
    required: true,
    onTypeViolation: 'error',
    onValueViolation: 'warning',
    consumers: ['retrieval', 'compile', 'index', 'host'],
    affectsRetrieval: true,
    isReferenceTarget: false,
    summary: 'Taxonomy slot. Drives context boosting and every grouping.',
  },
  {
    name: 'lang',
    class: 'core',
    type: 'string',
    required: true,
    onTypeViolation: 'error',
    onValueViolation: 'warning',
    consumers: ['host'],
    affectsRetrieval: false,
    isReferenceTarget: false,
    summary: 'ISO tag describing the content. Retrieval itself is language-agnostic.',
  },
  {
    name: 'summary',
    class: 'standard',
    type: 'string',
    required: false,
    onTypeViolation: 'error',
    onValueViolation: 'info',
    consumers: ['retrieval', 'compile', 'index'],
    affectsRetrieval: true,
    isReferenceTarget: false,
    summary: 'One sentence that fully describes the atom. Carries the scope index.',
  },
  {
    name: 'keywords',
    class: 'standard',
    type: 'string[]',
    required: false,
    onTypeViolation: 'error',
    onValueViolation: 'warning',
    consumers: ['retrieval'],
    affectsRetrieval: true,
    isReferenceTarget: false,
    summary: 'User vocabulary. The single strongest determinant of what is found.',
  },
  {
    name: 'synonyms',
    class: 'standard',
    type: 'string[]',
    required: false,
    onTypeViolation: 'error',
    onValueViolation: 'info',
    consumers: ['retrieval'],
    affectsRetrieval: true,
    isReferenceTarget: false,
    summary: 'Alternative phrasings, scored below keywords.',
  },
  {
    name: 'intents',
    class: 'standard',
    type: 'string[]',
    required: false,
    onTypeViolation: 'error',
    onValueViolation: 'warning',
    consumers: ['host'],
    affectsRetrieval: false,
    isReferenceTarget: false,
    summary: 'Free routing labels. Declared, validated, deliberately not scored.',
  },
  {
    name: 'related',
    class: 'standard',
    type: 'string[]',
    required: false,
    onTypeViolation: 'error',
    onValueViolation: 'error',
    consumers: ['loader', 'graph', 'gaps'],
    affectsRetrieval: true,
    isReferenceTarget: false,
    summary: 'Curated edges. Integrity-enforced: a dangling target fails the load.',
  },
  {
    name: 'alwaysInclude',
    class: 'standard',
    type: 'boolean',
    required: false,
    onTypeViolation: 'error',
    onValueViolation: 'info',
    consumers: ['retrieval', 'index'],
    affectsRetrieval: true,
    isReferenceTarget: false,
    summary: 'Inject into every context, bypassing scoring and budget.',
  },
  {
    name: 'priority',
    class: 'standard',
    type: 'number',
    required: false,
    onTypeViolation: 'error',
    onValueViolation: 'info',
    consumers: ['retrieval', 'compile'],
    affectsRetrieval: true,
    isReferenceTarget: false,
    summary: 'Score nudge, priority/100 clamped to ±1. Tie-breaking, not forcing.',
  },
  {
    name: 'link',
    class: 'standard',
    type: 'string',
    required: false,
    onTypeViolation: 'error',
    onValueViolation: 'error',
    consumers: ['host', 'citation'],
    affectsRetrieval: false,
    isReferenceTarget: false,
    summary: 'Absolute path or URL of the canonical surface this atom describes.',
  },
  {
    name: 'linkLabel',
    class: 'standard',
    type: 'string',
    required: false,
    onTypeViolation: 'error',
    onValueViolation: 'warning',
    consumers: ['host'],
    affectsRetrieval: false,
    isReferenceTarget: false,
    summary: 'Human label for link. Without link it warns.',
  },
]

export const CORE_FIELD_NAMES = FIELDS.filter((f) => f.class === 'core').map((f) => f.name)
export const STANDARD_FIELD_NAMES = FIELDS.filter((f) => f.class === 'standard').map((f) => f.name)
/** Every name the contract knows. Anything else is an extension. */
export const RESERVED_FIELD_NAMES = FIELDS.map((f) => f.name)

/**
 * Grammar rules foreign implementations must reproduce byte-for-byte to stay
 * interoperable. Exported as source strings so a Python or Go port can compile
 * the same expressions instead of re-deriving them.
 */
export const GRAMMAR = {
  id: '^[a-z0-9]+(?:[.-][a-z0-9]+)*$',
  lang: '^[a-z]{2}(-[a-zA-Z0-9]+)?$',
  link: '^(\\/|https?:\\/\\/)[^\\s]*$',
  /** Directory separator that `id` maps to on disk. */
  idPathSeparator: '.',
  /** Prefix marking a path as meta content, never ingested. */
  metaPrefix: '_',
  /** The one `_`-prefixed file that is ingested anyway. */
  metaException: '_index.md',
} as const

/**
 * Stable diagnostic codes. Messages are prose and may be reworded in a patch
 * release; codes are API and may not. Tooling should branch on these.
 */
export const DIAGNOSTICS = {
  E_CORE_MISSING: 'A core field is absent or not a non-empty string.',
  E_TYPE: 'A standard field is present with the wrong type.',
  E_LINK_FORM: 'link is neither an absolute path nor an absolute URL.',
  E_EDGE_SELF: 'related[] points at the atom itself.',
  E_EDGE_DANGLING: 'related[] points at an id that does not exist.',
  E_EDGE_MALFORMED: 'A related[] target does not match the id grammar.',
  E_ID_DUPLICATE: 'Two atoms declare the same id.',
  E_PARSE: 'Frontmatter is outside the supported YAML subset.',
  W_ID_FORM: 'id deviates from the lowercase dotted/kebab convention.',
  W_LANG_FORM: 'lang is not an ISO tag.',
  W_CATEGORY_UNKNOWN: 'category is not registered in config.',
  W_INTENT_UNKNOWN: 'intent is not registered in config.',
  W_KEYWORDS_FEW: 'Fewer keywords than the configured minimum.',
  W_KEYWORDS_NONE: 'No keywords; only title/summary/body tokens can match.',
  W_BODY_EMPTY: 'Body is empty.',
  W_LABEL_ORPHAN: 'linkLabel without link.',
  W_CYCLE: 'A cycle of three or more atoms in the edge graph.',
  I_EXTENSION: 'An extension field is present and inert.',
  I_ORPHAN: 'The atom has no inbound or outbound edges.',
} as const

export type DiagnosticCode = keyof typeof DIAGNOSTICS

/**
 * Conformance levels. A foreign implementation declares the level it reaches;
 * `server/discover` and `memory_contract` report it.
 *
 * The levels are cumulative and deliberately cheap at the bottom: L1 is a
 * weekend of work in any language, and an L1 implementation can already
 * exchange atoms with an L3 one without loss.
 */
export const CONFORMANCE = {
  L1_READ: [
    'Parses the frontmatter subset, or rejects the file with E_PARSE.',
    'Enforces core fields with E_CORE_MISSING.',
    'Preserves unknown fields verbatim instead of dropping them.',
  ],
  L2_INTEGRITY: [
    'Everything in L1.',
    'Enforces id uniqueness and related[] integrity.',
    'Emits the warning codes, and does not upgrade them to errors.',
  ],
  L3_ROUND_TRIP: [
    'Everything in L2.',
    'Serializes an atom back to bytes that re-parse to an equal atom.',
    'Preserves extension fields, priority, and quoting decisions across the trip.',
  ],
  L4_GAPS: [
    'Everything in L3.',
    'Maintains a gap ledger keyed by (kind, normalized topic).',
    'Reopens a closed gap when its topic is observed again.',
  ],
} as const

export type ConformanceLevel = keyof typeof CONFORMANCE

/** What this build actually implements. */
export const IMPLEMENTED_CONFORMANCE: ConformanceLevel = 'L4_GAPS'

export interface ContractDescriptor {
  contract: string
  version: string
  compatible: readonly string[]
  conformance: ConformanceLevel
  fields: FieldSpec[]
  grammar: typeof GRAMMAR
  diagnostics: typeof DIAGNOSTICS
  consumers: typeof CONSUMERS
  reserved: {
    fieldNames: string[]
    metaPrefix: string
    metaException: string
    neverClaimed: string[]
  }
}

/**
 * The whole contract as one JSON-serializable object. This is what an agent
 * should read before authoring atoms, and what `memory_contract` returns.
 */
export function describeContract(): ContractDescriptor {
  return {
    contract: CONTRACT_ID,
    version: CONTRACT_VERSION,
    compatible: CONTRACT_COMPATIBLE,
    conformance: IMPLEMENTED_CONFORMANCE,
    fields: FIELDS,
    grammar: GRAMMAR,
    diagnostics: DIAGNOSTICS,
    consumers: CONSUMERS,
    reserved: {
      fieldNames: RESERVED_FIELD_NAMES,
      metaPrefix: GRAMMAR.metaPrefix,
      metaException: GRAMMAR.metaException,
      /** Name shapes the contract promises never to claim. Yours in perpetuity. */
      neverClaimed: ['x-*', '_*'],
    },
  }
}

/** Look up one field's spec. */
export function fieldSpec(name: string): FieldSpec | undefined {
  return FIELDS.find((field) => field.name === name)
}

/**
 * Which subsystems a change to `name` can break. Extension fields return an
 * empty list — that is exactly what makes them safe to add.
 */
export function blastRadius(name: string): ConsumerName[] {
  return fieldSpec(name)?.consumers ?? []
}

/**
 * Negotiate a producer's contract version against this build.
 *
 * Same major → accepted. Newer minor → accepted, because minor changes are
 * additive and unknown additions land in `extensions`. Older major → refused,
 * since the meaning of a field may have changed underneath us.
 */
export function isContractCompatible(declared: string | undefined): {
  ok: boolean
  reason?: string
} {
  if (declared === undefined) return { ok: true }
  const parts = declared.split('.')
  const major = Number(parts[0])
  if (!Number.isInteger(major)) {
    return { ok: false, reason: `contractVersion "${declared}" is not semver` }
  }
  const ourMajor = Number(CONTRACT_VERSION.split('.')[0])
  if (major !== ourMajor) {
    return {
      ok: false,
      reason: `contract major ${major} != ${ourMajor}; migration required (see CHANGELOG.md)`,
    }
  }
  return { ok: true }
}
