# Documentation map

## Use the current kit

| Need | Read |
|---|---|
| Start with the working sample | [Example](../example/README.md) and [repository quickstart](../README.md) |
| Understand the concept and limits | [Concept](../CONCEPT.md), [limitations](../LIMITATIONS.md) |
| Author valid atoms | [Contract](../CONTRACT.md) |
| Understand search | [Retrieval](RETRIEVAL.md) |
| Edit and return a bundle | [Bidirectional workflow](BIDIRECTIONAL.md) |
| Understand missing-knowledge records | [Gap spotlighting](GAP-SPOTLIGHTING.md) |
| Integrate a host | [LLM integration](INTEGRATION-LLM.md), [porting](PORTING.md), [filesystem adapter](../adapters/README.md) |
| Connect an agent | [Agent integration](../agent/README.md), [MCP reference](MCP.md) |

## Develop the next increment

Start at [the strategy index](strategy/README.md). It separates current behavior, proposed architecture, executable batches, and evidence.

The existing technical docs describe the baseline and contain known claims that need rechecking in B0. In particular, transport compatibility, native Node installation, strict budget enforcement, and transactional writes are not proven by documentation alone. See [the review register](strategy/reviews/RED-TEAM.md).

The root contract remains the normative format reference until an approved implementation updates it. Strategy documents do not silently change that contract.
