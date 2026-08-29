---
name: memory-ingest
description: "Create or update an atom in the atomic memory. Trigger: new atom, add knowledge, update the memory, record a fact, extend the knowledge base."
---

# memory-ingest

Write one atom into the memory. One atom = one self-contained fact or topic.

## When to use

- A fact was established that the memory does not hold.
- An existing fact changed.
- A gap from the ledger is being closed.

**Do not** use this to dump a document. Split it into atoms first — if a single
question could be answered by half the atom, it should have been two atoms.

## Steps

1. **Check for an existing atom first.** `amk search "<the topic>"`. Updating
   beats creating a near-duplicate; two atoms covering the same thing degrade
   precision for both.

2. **Pick the id.** `<category>.<topic>`, lowercase, dot- or dash-separated. It
   maps to the file path (`services.audit` → `memory/services/audit.md`) and it
   is a **permanent citation target** — never rename, never reuse for different
   content.

3. **Write the frontmatter.**
   - Required: `id`, `title`, `category` (must be registered in the config),
     `lang`.
   - `keywords`: at least 2, in **user vocabulary** — the words someone would
     actually type, not internal terminology. Both languages if the memory serves
     both. Write compounds out. **Quote numbers**: `["1500"]`, never `[1500]`.
   - `summary`: exactly one sentence that fully describes the atom.
   - `related`: only ids that already exist. A dangling target fails the entire
     load.

4. **Write the body.** Checkable facts, one per line, compact. Anything uncertain
   goes in as `<!-- TODO(owner): ... -->` rather than being guessed — the TODO
   becomes a tracked gap automatically.

5. **Add at least 2 eval cases** to the eval-cases file: one positive
   (`expectIds` contains the new atom) and one negative (`mustNotRetrieve`
   containing the atom most likely to be confused with it).

6. **If the atom backs an external claim** (a price on a website, a number in a
   spec), add it to the claims map so drift detection covers it.

## Gates

```bash
amk validate        # 0 errors; read every warning
amk eval            # green, no regression against the baseline
amk search "<a question this atom should answer>"   # it must actually rank
```

The `search` check is not optional. An atom that validates but does not retrieve
is functionally absent, and validation cannot tell you that.

## Rules

- Never invent facts, numbers, dates, prices or capabilities. If it is not
  established, it is a `TODO`, not a sentence.
- Never write `related` targets that do not exist yet.
- Never rename an existing id.
- Register new categories in the config before using them.
- Keywords are an authoring decision, not a generation task. Ask what the user
  would type.

## Reference

Contract and decision matrix: `CONTRACT.md`. Concept: `CONCEPT.md`. Retrieval
behaviour: `docs/RETRIEVAL.md`.
