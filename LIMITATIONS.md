# LIMITATIONS

Read this before adopting. Everything here is a known, deliberate boundary — not
a bug backlog. Where a workaround exists it is stated; where none exists that is
stated too.

---

## Retrieval

**No semantic understanding.** Scoring is keyword, synonym and field matching
with umlaut folding and a light suffix stemmer. A question phrased entirely in
vocabulary that appears nowhere in an atom will not find it, no matter how
obviously related a human would find it.

> *Mitigation:* keywords are the whole game. Write them as the words users type,
> not as internal terminology, and include both languages if you serve both.
> This is manual work and cannot be automated away — see `CONCEPT.md` §3.

**The prefix heuristic is a heuristic.** Tokens of 5+ characters match by shared
prefix, which handles German compound morphology (`webseiten` → `webseite`)
without an NLP dependency. It will also occasionally match things it should not
(`kosten` / `kostenlos`). It reduces synonym maintenance; it does not replace it.

**Stopwords and folding are German + English by default.** Other language
families need a different `language` profile in config (`fold`, `stopwords`,
`stemSuffixes`). Non-Latin scripts will tokenize poorly: `tokenize()` splits on
`[^a-z0-9]+`, so CJK text collapses to nothing. **This is a hard limitation** —
CJK support needs a different tokenizer, not a config change.

**Scale ceiling ~500 atoms.** Scoring is linear over all atoms per query. At a
few hundred atoms this is sub-millisecond; at several thousand it becomes
noticeable and precision degrades regardless of speed.

> *Path:* BM25 with an inverted index at 500–2000 atoms; hybrid embeddings above
> that. Both fit behind the existing `searchMemory()` signature. Triggers to
> watch: atom count > 300, or eval precision < 0.6.

**Body scoring is presence, not frequency.** Each field contributes its weight at
most once. This deliberately prevents a long body from outshouting an explicit
keyword — but it also means a body that discusses a topic ten times scores no
higher than one that mentions it once.

**Edge expansion is 1 hop, capped at 1 chunk.** Multi-hop reasoning across the
graph is not supported and is not planned here; that is a job for the reasoning
layer, which can call `searchMemory` again.

---

## The frontmatter parser

**It is a YAML subset, not YAML.** Supported: scalars (quoted or bare), inline
arrays `[a, b, "c d"]`, block scalars `key: |`, and `#` comments. Anything else
is a hard error with line context.

Not supported, and will fail:

- nested maps (`owner:\n  name: X`)
- block sequences (`keywords:\n  - a\n  - b`)
- anchors, aliases, tags, multi-document files
- escape sequences inside quoted strings

**Quotes are stripped, not unescaped.** A value containing both `"` and `'` must
use a block scalar — the emitter does this automatically, but hand-written atoms
can trip on it.

**Numbers in inline arrays become numbers.** `keywords: [1500]` fails schema
validation. Write `keywords: ["1500"]`. This bites everyone once.

> *Why not use a YAML library:* the restricted grammar is what makes lossless
> round-tripping provable. A full YAML parser has many representations for the
> same value, so `parse → emit → parse` stops being identity, and the guarantee
> that makes the bundle workflow safe evaporates.

---

## Round-trip

**Guaranteed:** all core and standard fields, string/number/boolean/string-array
extension fields, bodies, and multiline summaries.

**Not preserved:**

- **Field order and formatting.** Output is normalized. Your hand-written field
  order will change on the first import. This is cosmetic but shows up in diffs.
- **Comments in frontmatter.** `#` lines are parsed and discarded.
- **Complex extension values.** Nested objects and arrays of non-strings survive
  in `compiled.json` but are **dropped by `serializeAtom`**, because the parser
  cannot read them back. If you keep structured extension data, do not rely on
  the markdown path for it.
- **Prose in the bundle.** Everything outside `<!-- amk:atom -->` fences is
  discarded on import, by design.

**The digest is not importable.** It is lossy on purpose and says so in its own
header. Only `bundle.md` and `compiled.json` round-trip.

**Import is destructive.** `amk import` overwrites atom files whose content
differs. It skips byte-identical files, and `--dry-run` shows what would change,
but there is no undo beyond version control. **Commit before importing.**

**Deletion does not propagate.** Removing an atom block from a bundle does not
delete the file on import. Delete atoms explicitly.

---

## Gap detection

**Runtime gaps need consumer cooperation.** The `[GAP: topic]` marker only
appears if the reasoning layer is instructed to emit it and complies. A model
that ignores the instruction produces no runtime gaps, and its silence is
indistinguishable from having no gaps. Smaller models comply less reliably.

> *Mitigation:* the deterministic `scope` detector needs no cooperation and
> catches the "nothing at all" case regardless. Treat runtime gaps as a bonus
> signal, not a guarantee.

**Gap topics are model-generated free text.** Deduplication normalizes case and
whitespace, but *"SSO pricing"* and *"cost of single sign-on"* are two records.
Counts are therefore a lower bound on real demand.

**Drift checks numbers only.** A claim whose prose contradicts an atom while its
numbers agree passes silently. There is no mechanism here for prose
contradiction, and adding one would require a model — which would make the check
non-deterministic and therefore untrustworthy as a gate.

**Drift needs a hand-maintained claims map.** Nothing discovers claims for you.
An unmapped claim is an unchecked claim.

**Closing a `todo` gap means removing the marker.** The detector re-scans atom
bodies on every run, so a ticked-off TODO whose `TODO(...)` comment is still in
the file will reopen immediately. This is correct behaviour — the marker *is* the
gap — but it surprises people once.

**The ledger is a file, not a database.** JSONL, rewritten wholesale on sync. Two
processes writing concurrently will lose records. Fine for CLI and single-server
use; not safe for multi-instance serverless without an external store.

---

## Evaluation

**Eval cases are hand-written.** Nothing generates them. Without at least two per
atom, precision rots invisibly as the memory grows.

**Metrics measure retrieval, not truth.** A perfectly-retrieved atom full of
false statements scores 1.0. Content correctness is a human responsibility and
always will be.

**Precision counts category matches as relevant**, which is generous. A retrieved
atom from the right category but the wrong topic counts as a hit.

---

## Runtime

**Node ≥ 22.6 for the CLI and tests**, because `src/` ships as TypeScript and
relies on native type stripping rather than a build step. Older Node cannot run
the CLI. The library imports fine into any bundler.

**Type-strippable syntax only.** No enums, no parameter properties, no
namespaces, no decorators. If you extend `src/`, keep it erasable or the no-build
promise breaks.

**`.ts` extensions in import specifiers.** Required by Node's resolver. `tsc`
needs `allowImportingTsExtensions: true`; Vite, esbuild and Rollup handle it
natively. See `docs/PORTING.md`.

**No barrel in Nitro.** Nuxt/Nitro auto-imports `server/utils/**` and a barrel
export causes duplicate-import warnings. Import individual modules there and
delete `src/index.ts`.

**Everything is loaded into memory.** The whole base plus its token cache lives
in RAM. At a few hundred atoms that is a few megabytes. There is no lazy loading
and no partial load.

**No concurrency control anywhere.** No file locking on import, no ledger
locking. Single-writer assumptions throughout.

---

## Explicitly out of scope

These are not gaps in the implementation. They are things this project has
decided not to be.

- **Multi-tenancy.** One memory root per config. Isolation is your host's job.
- **Access control.** Every atom is equally visible to every consumer. There is
  no per-atom permission model.
- **Versioning and history.** Use git. The kit has no notion of an atom's past.
- **Automatic knowledge extraction.** Nothing reads your documents and writes
  atoms. An agent can draft them; a human still owns whether they are true.
- **Keyword generation.** Deliberate — see `CONCEPT.md` §3.
- **Translation.** Atoms carry `lang`; nothing translates them. Multilingual
  memories keep parallel atoms with distinct ids.
- **Any LLM code.** No prompts, no providers, no streaming transport. See
  `docs/INTEGRATION-LLM.md` for wiring one up yourself.
