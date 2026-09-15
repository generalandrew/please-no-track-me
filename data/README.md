# The taxonomy

This directory is the whole of what the extension knows. There is no external database and
no update service — everything here ships inside the XPI and is versioned with the code
that reads it. See [PRODUCT.md §9](../PRODUCT.md).

```bash
npm test     # or: node tools/validate.mjs
```

The validator is dependency-free and runs on a fresh clone with nothing installed.

## The files

| File | Holds | Read by |
|---|---|---|
| `tracking-params.json` | The registry: every recognized parameter name → its class | classify |
| `vocabularies.json` | C1 closed vocabularies, and the channel model everything else hangs off | substitute |
| `campaigns.json` | C2 campaign-name templates and slot vocabularies | substitute |
| `grammars.json` | C3 vendor token grammars, with verification status | substitute |
| `never-touch.json` | C5 — parameters that exempt the entire URL | classify (wins over everything) |
| `redirectors.json` | Wrapper hosts, destination extraction, and whether unwrapping is permitted | unwrap |
| `strip-only.json` | Origins where stripping is allowed but fabrication is not | classify |

## The five classes

| Class | Meaning | Substitution |
|---|---|---|
| **C1** | Closed-vocabulary semantic (`utm_source`, `ref`) | A different value from the same vocabulary, in the visit's channel |
| **C2** | Open-vocabulary semantic (`utm_campaign`) | Generated from a template, dated to the current quarter |
| **C3** | Opaque vendor token (`fbclid`, `gclid`) | A value conforming to that vendor's grammar — **only once the grammar is verified** |
| **C4** | Tracking-shaped but unrecognized | Shape-preserving substitution derived from the value actually present |
| **C5** | Never touch | Nothing. Its presence exempts the entire URL. |

## Adding a rule

**A new tracking parameter.** Add it to `tracking-params.json` with a class. If it is C1 it
needs a vocabulary in `vocabularies.json`; if C3, a grammar entry. Add a case to
`test/invariants/invariants.jsonl` if there is any URL it must not touch.

**A new vendor grammar.** Add it to `grammars.json` with `status: "hypothesis"`, `samples: 0`
and a `needs` field. It will emit nothing and the parameter falls back to C4 — which is the
point. Promote it to `verified` only when you have **30 or more real observed values**,
recorded with the date. The validator enforces this, and verified grammars expire after 180
days.

Do not write a grammar from memory or from a blog post. A generated token of the wrong
shape can fail ingest validation, which both defeats the substitution and flags the traffic
as synthetic — worse than not substituting at all.

**A new redirector.** Add hosts, the destination extraction, `unwrappable`, and `evidence`.
Mark it `unwrappable: false` if the destination is not in the URL, if removing the wrapper
changes a commercial outcome, or if the wrapper is a security control.

## Things the validator will stop you doing

- registering a parameter that is also in `never-touch.json`
- adding a shape pattern that matches a protected name
- shipping a `verified` grammar with fewer than 30 samples, no date, or an expired one
- giving a hypothesis grammar an `emit` block
- referencing a channel, vocabulary, grammar, generator or slot that does not exist
- leaving a channel with no source, no medium, or no campaign template
- adding an invariant-corpus URL that no existing rule actually protects
- defining a commercial channel, or a redirector with no evidence

## The two rules behind all of it

1. **Never move money.** Affiliate tags, referral codes, partner IDs and coupon codes live
   in `never-touch.json` and stay there. Substituting one affiliate's identifier for
   another's redirects a commission to someone who did not earn it. That is fraud, not
   privacy, and no coverage argument outweighs it.
2. **A wrong value is worse than a missing one.** Stripping usually makes a site fall back
   to a default; substituting makes it act on something false. When it is unclear whether a
   parameter is purely a tracker, it belongs in `never-touch.json`, not in the registry.
