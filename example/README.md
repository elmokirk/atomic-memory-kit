# Example memory

A small working memory with problems planted on purpose, so every detector has
something to find.

```
memory/
  _index.md                generated scope index (alwaysInclude)
  _kit/eval-cases.json     6 cases: 4 positive, 2 negative
  _kit/claims.json         4 external claims, one of them wrong
  pricing/plans.md         priority: 10, link, reciprocal edge
  process/support.md       the atom the bad claim points at
  product/limits.md
  product/onboarding.md    carries a TODO marker
```

## Planted findings

| Detector | What it finds |
|---|---|
| `drift` | `website:support.sla` claims 12 business hours; the atom says 24 |
| `todo` | `TODO(owner)` about undocumented SSO setup |
| `scope` | "recipe for jam" and "world cup 1998" correctly return `no_match` |

## Walk the loop

```bash
node ../cli/amk.mjs validate     # clean contract, intact graph
node ../cli/amk.mjs eval         # scope 1.0, hit 1.0, precision 0.875
node ../cli/amk.mjs drift        # finds the SLA contradiction
node ../cli/amk.mjs gaps         # + the TODO, as a checklist
node ../cli/amk.mjs compile      # .memory-out/bundle.md
```

Then open `.memory-out/bundle.md`, tick the TODO gap, paste a new atom block for
SSO, and:

```bash
node ../cli/amk.mjs import .memory-out/bundle.md
node ../cli/amk.mjs validate
```

Also worth trying:

```bash
node ../cli/amk.mjs search "what does it cost"
#   pricing.plans, plus product.limits pulled in via the related[] edge —
#   a question about price also surfaces the seat limits
node ../cli/amk.mjs search "how many seats" --context /pricing
node ../cli/amk.mjs search "wie schnell antwortet der support"
#   German question, English atom: retrieval is language-agnostic
```

`.memory-out/` is gitignored — everything in it is regenerable.
