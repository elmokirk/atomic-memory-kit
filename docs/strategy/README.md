# AMK implementation handoff

Planning revision: 2026-10-05 (roadmap and positioning revised; first written 2026-09-26). This is a documentation-only change, not a feature release.

## Start here

| Task | Document |
|---|---|
| Understand what the product is for and how it is positioned | [`PRODUCT.md`](../../PRODUCT.md) |
| Execute an assigned batch | [Agent handoff](AGENT-HANDOFF.md) |
| Understand priorities and phase boundaries | [Roadmap](ROADMAP.md) |
| Preserve the core and add optional capabilities | [Architecture](ARCHITECTURE.md) |
| Run gates or prepare a human test | [QA](QA.md) |
| Verify an external assumption | [Sources](SOURCES.md) |
| Reproduce audit findings | [Red-team register](reviews/RED-TEAM.md) |
| See why the plan changed on 2026-10-05 | [Plan review](reviews/PLAN-REVIEW-2026-10-05.md) |
| Execute PoC increments I1-I5 | [PoC batch](batches/POC.md) |
| Execute MVP increments I6-I8 | [MVP batch](batches/MVP.md) |
| Earlier foundation batch (superseded) | [B0: foundation](batches/B0-foundation.md) |
| Earlier companion batch (withdrawn) | [B1: agent companion](batches/B1-agent-companion.md) |

## Product direction

Keep AMK as a small, inspectable knowledge engine that works standalone. Add read-only adapters that audit other memory stores, and a companion that makes corrections traceable and tests whether they work on later questions. Keep native episodic memory in place.

Since 2026-10-05, [`PRODUCT.md`](../../PRODUCT.md) defines the product: a retrieval engine for chatbots on curated knowledge, plus an add-on that gives existing memory systems (first Mem0) missed-retrieval tracking, regression tests and write validation. No competing memory product. Work runs as a PoC (I1-I5) and an MVP (I6-I8); see [Roadmap](ROADMAP.md). No acquisition, standard adoption, accuracy improvement, or commercial return is assumed. The local release train in [`docs/plans/`](../plans/README.md) is parked; see [Roadmap](ROADMAP.md).

## Baselines and status ownership

- Core baseline: `af24e19664816966591281f91d6c8c23a98992e4` on `master`.
- Documentation parent: `188dce607d799b93e8643a9aa1586b261fc78a37` from `docs/amk-product-handoff`.
- The current change completes the earlier strategy index and replaces its unresolved links. It does not fork the product or start B0.
- Ticket state belongs to the relevant batch file. This index and the roadmap are navigation, not duplicate progress trackers.
- Active batches are [PoC](batches/POC.md) and [MVP](batches/MVP.md). B0 and B1 are kept as records only.
- `master` now also contains contract 1.1.0 (durability and provenance) and the memory-tool backend, which postdate the core baseline above. B0-T01 records the current head as its baseline.

Existing technical references remain in [the documentation map](../README.md). The prior conversation is context, not an authority above the code, tests, contract, or this revised plan.
