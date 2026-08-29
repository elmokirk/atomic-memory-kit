# AGENTS.md / CLAUDE.md snippet

Paste into your project's agent instructions. Adjust paths.

---

## Memory (atomic-memory-kit)

Durable project knowledge lives in `memory/` as atoms: one self-contained fact
or topic per Markdown file with typed frontmatter. `memory/_kit/` is meta and is
never ingested.

**Before answering a factual question about this project**, retrieve rather than
recall:

```bash
amk search "<the question>"
```

If the result is `no_match`, the memory does not cover it. Say so, and record it:

```bash
amk gaps add "<the topic>" --kind scope
```

**Never invent a fact to fill a gap.** A recorded gap is useful; a confident
wrong answer costs trust and is expensive to find later.

### When you learn something durable

Use the `memory-ingest` skill. Rules that matter most:

- One atom = one thing. Split anything that answers two questions.
- `keywords` are **user vocabulary** — what someone would type, not internal
  terminology. At least 2. Quote numbers: `["1500"]`.
- `related` targets must already exist — a dangling edge fails the entire load.
- Uncertain? Write `<!-- TODO(owner): ... -->`, not a guess. It becomes a tracked
  gap automatically.
- Every new atom ships with 2 eval cases: one positive, one `mustNotRetrieve`.

### When you hit a wall

Record it instead of working around it silently:

```bash
amk gaps add "<what you needed and did not have>" --kind runtime
```

### Handing off

Compile the memory and its open questions into one artifact:

```bash
amk compile      # .memory-out/bundle.md — atoms + open gaps as checkboxes
```

The next agent, or the human, gets everything that is known plus everything that
is missing in a single editable document. They answer in place and run
`amk import`.

### Gates — never skip after touching `memory/`

```bash
amk validate     # contract + graph integrity; 0 errors
amk eval         # retrieval quality, no regression
```

An atom that validates but does not retrieve is functionally absent. Verify with
`amk search` that a real question actually finds it.

### Reference

`CONCEPT.md` (the idea) · `CONTRACT.md` (frontmatter rules) · `LIMITATIONS.md`
(what it cannot do) · `docs/GAP-SPOTLIGHTING.md` (the gap system).
