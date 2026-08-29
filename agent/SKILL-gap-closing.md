---
name: gap-closing
description: "Work the memory gap backlog: review recorded gaps, close the ones that are answerable, prepare the rest for a human. Trigger: close gaps, review the gap report, what is the memory missing, knowledge backlog."
---

# gap-closing

Turn the gap ledger into atoms. This is the maintenance loop of the memory.

## Steps

1. **Refresh the detectors.**

   ```bash
   amk gaps          # todo markers, orphans, cycles
   amk eval          # retrieval regressions
   amk drift         # claims that disagree with the memory
   ```

2. **Read the ledger, sorted by count.**

   ```bash
   amk gaps --json
   ```

   `count` is the priority signal: a gap seen forty times is a missing product
   page, a gap seen once is noise. Work top-down.

3. **Triage each gap by kind** — they need different work:

   | Kind | What it means | Action |
   |---|---|---|
   | `runtime` | Someone asked, the memory did not have it | Needs a **fact you may not have**. If unknown → escalate |
   | `scope` | Nothing scored above the threshold | Either a genuinely new area, or the threshold is wrong |
   | `eval` | A curated question stopped retrieving | **Fix keywords**, do not write a new atom |
   | `drift` | The memory disagrees with a source of truth | Determine which side is right, then correct one of them |
   | `todo` | The author flagged it | Fill in the fact **and delete the marker** |
   | `orphan` | No graph edges | Add `related` edges, or accept it as standalone |
   | `cycle` | 3+ atom loop in the graph | Simplify the topology |

4. **Close what you can answer from established knowledge.** Use the
   `memory-ingest` skill for each atom. Then:

   ```bash
   amk gaps close <gap-id> --by <atom.id>
   ```

5. **Escalate what you cannot.** Do not guess. Compile a bundle and hand it over:

   ```bash
   amk compile      # bundle.md carries the atoms AND the open gaps as checkboxes
   ```

   Tell the human: read the *Open gaps* section, answer inline or paste a new
   atom block, tick the boxes, send it back.

6. **Fold their answers back in.**

   ```bash
   amk import bundle.md    # writes atoms, closes ticked gaps
   amk validate
   amk eval
   ```

## Critical rules

- **Never close a gap by guessing.** A confidently wrong atom is worse than an
  open gap, because the gap was at least honest.
- **An `eval` gap is a keyword problem, not a content problem.** The knowledge is
  already there; retrieval cannot find it. Writing a second atom makes precision
  worse.
- **A `todo` gap only closes when the marker is deleted.** The detector rescans
  bodies on every run, so a ticked TODO whose comment is still in the file
  reopens immediately. That is correct.
- **A gap that reopens after being closed means the fix did not work.** Almost
  always: the atom exists but its keywords do not match how people ask. Fix the
  keywords, do not write another atom.
- **For `drift`, decide which side is authoritative before editing.** Sometimes
  the source of truth is the thing that is wrong.

## Completion

- Every closed gap has an atom that `amk search` actually retrieves.
- `amk validate` and `amk eval` are green.
- Everything unanswerable is in a bundle handed to someone who can answer it.
