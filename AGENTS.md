# Developing Atomic Memory Kit

For an assigned implementation task, read [the execution handoff](docs/strategy/AGENT-HANDOFF.md), then the assigned batch. For product scope, read [PRODUCT.md](PRODUCT.md); for sequencing, [the roadmap](docs/strategy/ROADMAP.md). For existing technical documentation, use [the documentation map](docs/README.md).

## Boundaries

- Preserve `example/` as the minimal starter and compatibility fixture. Keep optional capabilities out of its required configuration.
- Keep the core deterministic and free of mandatory network, model, database, and host-SDK dependencies. Put host behavior in adapters or integration packages.
- Before changing atom fields, serialization, or identifiers, read [the contract](CONTRACT.md) and [the proposed compatibility rules](docs/strategy/ARCHITECTURE.md).
- Before modifying imports, writes, transport, or evaluation, read [the red-team register](docs/strategy/reviews/RED-TEAM.md). Reproduce findings against real modules before fixing them.
- Before running tests, read [QA](docs/strategy/QA.md). Use temporary memory roots; the example and personal agent memories are not test scratch space.
- Implement only the assigned, authorized batch. A roadmap entry is not permission to implement later features, publish a package, change personal agent settings, or merge a PR.
- Record ticket state in the batch file only. Record a missing human test as `awaiting_user`, not `done`.

This directory's `agent/AGENTS.snippet.md` is for agents consuming AMK; this file is for agents developing AMK.
