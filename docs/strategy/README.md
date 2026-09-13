# Atomic Memory Kit — Strategy Vault

This vault is the product and implementation handoff for the next phase of Atomic Memory Kit (AMK).

## Start here

1. [`AGENT-HANDOFF.md`](./AGENT-HANDOFF.md) — execution brief for the coding agent.
2. [`PRIORITY-MATRIX.md`](./PRIORITY-MATRIX.md) — what matters now vs later.
3. [`ROADMAP.md`](./ROADMAP.md) — PoC → MVP → Release/Enterprise phases.
4. [`POSITIONING.md`](./POSITIONING.md) — what AMK is, is not, and where it wins.
5. [`POC-TESTING.md`](./POC-TESTING.md) — lightweight tests for the prototype; no heavy benchmark program yet.
6. [`INTEGRATIONS.md`](./INTEGRATIONS.md) — Hermes, Claude/Claude Code, Mem0 and existing-memory integration strategy.
7. [`PRODUCT-CASES.md`](./PRODUCT-CASES.md) — product/service use cases and commercial packaging.
8. [`SOURCES.md`](./SOURCES.md) — external projects, docs and benchmark references used in this strategy.

## Product thesis

AMK should **not** become another general-purpose agent memory database.

Its strongest product direction is:

> **A vendor-neutral memory assurance and coverage layer for AI agents.**

Existing systems optimize storing and recalling memories. AMK should optimize:

- what knowledge an agent can safely rely on,
- whether that knowledge is current,
- where important knowledge is missing,
- whether a gap was actually fixed,
- whether an update regressed retrieval,
- and how trusted knowledge can be promoted into a compact canonical layer.

## Core design constraints to preserve

- deterministic runtime retrieval by default,
- zero LLM call required for retrieval,
- zero embeddings required for the core path,
- small, inspectable, portable memory domains,
- lossless round-trip where supported by the contract,
- explicit failure over silent partial load,
- easy integration beside existing memory systems,
- human/agent editable Markdown as a first-class interface.

## Current product phase

**Prototype / proof of concept.**

The immediate goal is not to prove AMK against every academic memory benchmark. The immediate goal is to strengthen the core, integrate it into real personal-agent workflows, and gather credible evidence from those workflows.

The near-term proof surface is:

- this repository's example memory,
- Kirk's Pi-based personal/product chatbot,
- a Hermes Agent integration,
- a Claude client-side memory integration,
- small deterministic capability test sets.
