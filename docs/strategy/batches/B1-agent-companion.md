# B1: a working agent companion

Outcome: demonstrate a complete, reviewed knowledge correction in Claude Code, retain native memory, and exercise the same application boundary through a Pi reference.

Entry gate: B0 is accepted for the used read/write paths and the owner assigns B1. Read [Architecture](../ARCHITECTURE.md) and check host references in [Sources](../SOURCES.md). Actual installed Claude/Pi versions and the private chatbot integration point are not yet known.

Non-goals: replacing Claude Code auto-memory, intercepting undocumented host internals, mandatory second-model retrieval, temporal platform, autonomous personality inference, Hermes implementation, and hosted sync.

## Tickets and state

| Ticket | Status | Owner | Depends on | Evidence |
|---|---|---|---|---|
| B1-T01 | planned | unassigned | B1 assignment; read-only probing may be separately assigned earlier | none |
| B1-T02 | planned | unassigned | T01, B0 acceptance | none |
| B1-T03 | planned | unassigned | T01, B0 safe writes | none |
| B1-T04 | planned | unassigned | T01, common operation contract | none |
| B1-T05 | planned | unassigned | T02-T04 | none |
| B1-T06 | planned | unassigned | T05 | none |

## B1-T01: prove host surfaces

Scope: a sanitized capability record and proposed integration contract; no personal agent configuration changes.

Record installed Claude Code, Pi SDK, Node, and MCP versions. Verify plugin loading, tool discovery, tool calls, and the supported route for contextual instructions. Examine hooks only where a measured invocation or latency problem justifies them. Confirm a non-elicitation approval path. Identify the actual Pi package and application boundary; if private chatbot access is missing, use a synthetic reference and leave personal acceptance pending.

Acceptance: a real read-only host trace or explicit access blocker for each target; tested assumptions distinguished from docs-only assumptions; no claim that Claude API memory is Claude Code's replaceable backend. Freeze minimum retrieve/propose/commit/observe behavior for dependent workers.

## B1-T02: package the Claude Code companion

Scope: future `integrations/claude-code/`, consumer skills, installation/removal docs; coordinate any MCP change with T03.

Bundle the already tested MCP entry and small skills using the host's current plugin structure. Resolve package and memory-root paths without hardcoded workstation values. Start read-only; write enablement is an explicit user choice enforced by AMK's service, not merely a prompt. Declare exactly what the integration modifies and how to remove it. Avoid duplicate skills/tools and mandatory full-memory injection.

Acceptance: clean install can find and call tools; disabled writes fail server-side; removal preserves native memory and unrelated settings; host calls succeed from an installed artifact, not only from the development repo. A mocked manifest test does not replace a host test.

## B1-T03: correction, approval, and replay

Scope: the common application boundary, gap evidence, MCP call sites, focused tests. Add the minimum metadata needed for this workflow; no temporal engine yet.

Represent a diagnostic with an observation ID, reason, scope/root reference, and base revision. Separate content uncertainty from retrieval errors. Show a diff and source before a controlled write; reject stale approvals. Record the actual source/reviewer when supplied, then replay a linked question against the committed state. Mark verified closure only when replay passes; retain ordinary legacy closure semantics with clearly different evidence.

Acceptance: retrying an observation does not inflate demand; rejecting a proposal does not change content; a stale/failed write cannot close a gap; original and held-out replay evidence is attached; ordinary scans are not counted as new users. Plain-text instructions inside retrieved content never confer tool authority. Personal transcripts are not required in the ledger.

## B1-T04: Pi reference integration

Scope: future `integrations/pi/`, synthetic example, and adapter tests. Core retrieval and write logic stay shared.

Use the actual SDK confirmed in T01 or a clearly labeled host-neutral example while access is blocked. Retrieve before answer generation where the SDK permits it; keep model work in the consuming agent. Use the corrected streaming decoder when applicable. Supply source references and explicit diagnostics to the consumer.

Acceptance: synthetic product/personal preference cases run through the shared boundary; scope, stream text, events, and rejection behavior are observable; no second reasoning model is needed by AMK. A synthetic run is not recorded as acceptance of the owner's private chatbot.

## B1-T05: real-session comparison and regression

Scope: shared integration fixtures, sanitized traces, and a B1 verification record. Use [QA](../QA.md) for metric definitions and the user script.

Run at least three distinct correction cases with original and held-out questions across fresh sessions. Include natural prompts without AMK/tool names, rejection, wrong-scope requests, unavailable-source behavior, restart, and removal. Compare native memory with equivalent relevant facts and comparable maintenance effort. Report host invocation and model outcomes separately from deterministic core tests.

Acceptance: critical scripted scenarios pass; denominators, failed cases, host/model versions, and context/turn overhead are recorded; absence of credentials is a blocker. Pre-agree any paid evaluation budget. Do not turn a small acceptance fixture into an advertised percentage improvement.

## B1-T06: user acceptance and next-scope decision

Scope: documentation and user test evidence; no unassigned feature additions.

Have the owner perform install, natural query, correction review, replay in a later session, and removal in an approved sandbox. Capture friction and manual interventions. Compare the result against the stated job in [Positioning](../POSITIONING.md). Decide whether the next work is B2, an invocation fix, a smaller integration, or stopping an unsupported path.

Acceptance: named user feedback and shared definition of done; core starter still works independently; unsupported claims removed; B2 is ticketed only after feedback. User not available means `awaiting_user`.

## Parallelization

After T01 freezes the application contract, Claude packaging and Pi reference work can proceed independently. T03 owns repair semantics; integration workers consume them. T05 verifies the combined branch. Use isolated roots and host profiles, even when worktrees are separate.

## Success and exit checklist

- [ ] Claude companion completes the documented correction loop in real sessions.
- [ ] Pi reference runs, and private-agent acceptance is separately labeled.
- [ ] At least three corrections have original and held-out replay evidence.
- [ ] Native memory and unrelated configuration remain intact.
- [ ] Invocation, cost/latency overhead, and maintenance effort are measured.
- [ ] All critical negative cases and the B0 regression gate pass.
- [ ] User acceptance is recorded and release claims remain proportional to evidence.
- [ ] Next batch is proposed from observed gaps, not automatically started.
