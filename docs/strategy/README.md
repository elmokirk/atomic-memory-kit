# AMK implementation handoff

Planning revision: 2026-09-26. This is a documentation-only change, not a feature release.

## Start here

| Task | Document |
|---|---|
| Execute an assigned batch | [Agent handoff](AGENT-HANDOFF.md) |
| Understand priorities and phase boundaries | [Roadmap](ROADMAP.md) |
| Preserve the core and add optional capabilities | [Architecture](ARCHITECTURE.md) |
| Understand the target user and honest product claim | [Positioning](POSITIONING.md) |
| Run gates or prepare a human test | [QA](QA.md) |
| Verify an external assumption | [Sources](SOURCES.md) |
| Reproduce audit findings | [Red-team register](reviews/RED-TEAM.md) |
| Start foundation work after authorization | [B0: foundation](batches/B0-foundation.md) |
| Build the first working integration after B0 | [B1: agent companion](batches/B1-agent-companion.md) |

## Product direction

Keep AMK as a small, inspectable knowledge engine. Add a companion that makes corrections to critical agent knowledge traceable and tests whether the correction works on later questions. Keep native episodic memory in place.

The initial demonstration is Claude Code plus AMK, with Pi as a reference host. Hermes portability and a Mem0 integration guide follow. No acquisition, standard adoption, accuracy improvement, or commercial return is assumed.

## Baselines and status ownership

- Core baseline: `af24e19664816966591281f91d6c8c23a98992e4` on `master`.
- Documentation parent: `188dce607d799b93e8643a9aa1586b261fc78a37` from `docs/amk-product-handoff`.
- The current change completes the earlier strategy index and replaces its unresolved links. It does not fork the product or start B0.
- Ticket state belongs to the relevant batch file. This index and the roadmap are navigation, not duplicate progress trackers.
- Only B0 and B1 are ticketed now. Expand a later batch when its dependencies and user evidence exist.

Existing technical references remain in [the documentation map](../README.md). The prior conversation is context, not an authority above the code, tests, contract, or this revised plan.
