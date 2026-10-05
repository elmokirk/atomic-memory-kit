# Roadmap and priority decisions

This roadmap replaces the earlier feature-first P00-P11 sequence. Priorities are product decisions, not measured performance scores. Ticket state lives only in batch documents.

## Priority order

| Priority | Capability | Why now or later | Core or extension |
|---|---|---|---|
| P0 | Reproducible safety, round-trip, evaluation, and installed-package behavior | New features cannot rely on incorrect foundations | Core and adapters |
| P0 | A complete correction-and-replay workflow in a real agent | Tests product value before search complexity | Companion |
| P0 for writes | Minimal provenance, scope, stale-write handling | Required before promoting knowledge as reviewed | Application boundary |
| P1 | Temporal revision resolution | Addresses changing facts without overwriting history | Optional core capability |
| P1 | Retrieval hints and measured lexical improvements | Add only what real missed questions justify | Optional retrieval module |
| P1 | Hermes portability and Mem0 guidance | Tests that AMK complements rather than replaces memory | Integrations |
| Later | Full benchmark orchestration, physical shards, embedding fallback | Add when small fixtures or profiling show a need | Optional tooling/adapters |
| Demand-led | Enterprise stores, roles, audit, governance | Requires a concrete customer workflow and budget | Host/platform extensions |

## Batches

| Batch | Working outcome | Entry | Exit |
|---|---|---|---|
| [B0](batches/B0-foundation.md) | Existing starter works on a hardened, installable baseline | Implementation assignment | Critical regressions tested, controlled writes, package smoke test, starter user test |
| [B1](batches/B1-agent-companion.md) | Claude Code can complete and replay a knowledge correction; Pi reference works | B0 gate | Real-session evidence, explicit write permission, native memory preserved |
| B2 | Current and historical facts have explicit identity and provenance | B1 feedback and temporal ADR | Revision/interval/conflict/round-trip tests; human historical-query test |
| B3 | Better retrieval on held-out questions within a measured budget | Correct evaluator and observed misses | Comparison to the existing retriever; no new hard-negative violations |
| B4 | Hermes companion and Mem0 promotion guide | Stable host-neutral contract | Same correction fixtures in Hermes; existing provider preserved |
| B5 | Public, supportable release with reproducible evidence | B1-B4 gates or explicitly reduced release scope | External installs, documented limits, approved claim ledger |
| B6 | Customer-funded enterprise increment | Validated enterprise demand | Agreed isolation, recovery, retention, and operational tests |

## B2: time and provenance

Draft unique revision IDs, a stable fact key, source references, and validity intervals. Keep `recordedAt` separate from valid time. Derive current status; reject or surface ambiguous overlapping revisions. Support explicit `asOf` queries before automatic date interpretation. Unversioned legacy atoms remain usable and are visibly unversioned.

A product replacement's reason is a separate decision record, not an inference from `supersedes`. The source owner or connector must supply changes; AMK cannot discover all external changes from timestamps. No full bitemporal database in this batch.

## B3: retrieval driven by misses

Try curated retrieval hints and tokenization fixes first. Use one field-aware inverted index if the measured problem requires it. BM25/BM25F is a candidate, not an obligation to replace a sufficient scorer. Do not add ranking fusion, n-grams, vector search, and routing together.

Evaluate held-out paraphrases, exact identifiers, confusable pricing terms, empty queries, out-of-scope questions, and oversized atoms. Compare latency, relevant recall, false positives, and the full returned context budget. A score is not confidence in truth.

## B4: interoperability

Hermes: start with the existing MCP surface and a versioned installation guide. Package a general plugin only when an observed workflow needs hooks. Keep the selected external memory provider enabled. Label MCP configuration as MCP configuration, not a tested native plugin.

Mem0: provide a guide and a minimal example of explicit candidate selection, source reference, human review, AMK proposal, and replay. Avoid automatic two-way synchronization and inferred-to-verified promotion. Pin the Mem0 edition and SDK before documenting exact calls. Native episodic memory stays authoritative for its own records.

## B5: product release and evidence

Ship a small fixture/result format that can grow into a benchmark kit. Keep conformance, retrieval, host use, and end-to-end answer quality separate. Compare native memory plus equivalent facts against AMK with comparable authoring effort. Validate a clean install with external developers before claiming easy onboarding.

Prepare a quickstart, correction-loop demo, integration pages, limitations, support boundaries, migration notes, and a claims ledger. Record exact sample sizes and versions. Marketing must not imply that schema validation proves truth or that a small fixture proves universal reliability.

## B6: enterprise and standardization

Start from a paid workflow, not a dashboard wish list. Add only the required transactional store, authorization, audit, retention, deletion, and recovery controls. Local root confinement and safe writes are B0 requirements, not enterprise upsells.

A standard is a later adoption result: small published semantics, portable conformance cases, independent implementations, and external maintainers. An acquisition is not a deliverable or a release gate.

## Dependencies and parallelism

B0 precedes any accepted live write integration. B1 precedes broad optimization. B2 and B3 may overlap after identity/query contracts are agreed; B3 must test temporal filtering before combined acceptance. B4 adapter work may proceed against a stable API while B3 is measured. B5 combines only tested capabilities.

Detail the active and next batch only. A batch that fails to show value can shrink or stop the roadmap. Preserve the starter at every checkpoint.
