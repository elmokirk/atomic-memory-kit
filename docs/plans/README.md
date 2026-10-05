# Release plans

One file per release. Each is a contract with the future: what ships, what it
costs, what would make us cancel it.

Derived from [`IDEAS.md`](../../IDEAS.md), which captured the raw thinking and
scored it. Anything marked "does not hold" there does not appear here — that
filtering already happened and is not re-litigated per release.

| Release | Theme | Contract | Status |
|---|---|---|---|
| [0.3.0](0.3.0-durability-and-provenance.md) | Durability & provenance | **1.1.0** | **shipped** |
| [0.4.0](0.4.0-scopes.md) | Scopes | 1.1.0 | parked |
| [0.5.0](0.5.0-escalation.md) | Two-stage retrieval | 1.1.0 | parked |
| [0.6.0](0.6.0-audit.md) | The audit pass | 1.1.0 | parked |
| [1.0.0](1.0.0-freeze.md) | Freeze & conformance | **1.1.0 frozen** | parked |

**Parked 2026-10-05.** Sequencing now follows [`docs/strategy/ROADMAP.md`](../strategy/ROADMAP.md): foundation fixes, a read-only audit of Claude Code memory, and a reviewed correction loop come first. The plans below stay valid as designs and are revisited after the correction loop ships, with real audit findings as input. Nothing in them is cancelled.

## Why this order

Each release makes the next one cheaper, and the order is forced by dependency
rather than by preference:

```
0.3  durability + validUntil        ← the entry gate. Without it, scopes fill
      │                               with episodic noise and the audit has
      │                               nothing to expire.
      ▼
0.4  scopes                          ← needs durability to be worth separating.
      │                               Gap routing needs a scope to route by.
      ▼
0.5  escalation                      ← writes back into a scope, records into a
      │                               routed ledger. Needs both above.
      ▼
0.6  audit                           ← consumes expiry (0.3), scope policy (0.4)
      │                               and escalation history (0.5).
      ▼
1.0  freeze                          ← only honest once the contract has
                                      survived four releases of pressure.
```

Doing 0.5 first is tempting — it is the most interesting — and it would produce
an escalation record with nowhere correct to write it.

## The rules every plan follows

**No release breaks a valid atom.** Contract changes are additive through 1.x.
If a release cannot be additive, it does not ship in 1.x.

**Every feature needs an oracle.** The test from `IDEAS.md`: what fixed point
tells us it worked? A feature whose success can only be asserted does not get a
plan.

**Docs ship with the code, not after.** Each plan lists the documents it must
update. A release is not done while `LIMITATIONS.md` still describes the old
behaviour — that file is load-bearing for trust.

**Every plan has kill criteria.** Written before the work starts, when it is
still cheap to be honest.

## Plan structure

Each file has the same sections, in the same order:

1. **Goal** — one sentence
2. **Why now** — what is blocked without it
3. **Contract impact** — additive? version bump? migration?
4. **Design** — the shape, with the decisions that were close
5. **Surfaces** — CLI, MCP, library, memory tool
6. **UX / DX / AX** — human, developer, agent experience, separately
7. **Tests** — the oracle, concretely
8. **Docs** — files that must change
9. **Risks** — what goes wrong
10. **Done when** — checkable exit criteria
11. **Kill criteria** — what makes us stop

## Working on one

Plans are checked into the repo and edited as work proceeds. Tick nothing you
have not verified; the checkbox is a navigation aid, the test output is the
evidence. If a plan turns out wrong mid-flight, change the plan in the same
commit as the code — a plan that lags its implementation is worse than none,
for the same reason a stale sourcemap is.
