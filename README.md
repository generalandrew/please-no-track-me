# please-no-track-me

A Firefox extension that **lies to trackers instead of hiding from them**.

When you arrive at a site, it rewrites the tracking parameters in the URL to values that
are well-formed, internally coherent, and false. The site records an attribution story
that looks entirely ordinary and is about nobody. For the rest of that visit, tracking
parameters are simply removed from links.

```
you clicked:    example.com/article?utm_source=nytimes&utm_medium=referral&fbclid=IwAR9x…
site receives:  example.com/article?utm_source=newsletter&utm_medium=email&fbclid=IwAR3q…
you then copy:  example.com/article
```

Every value in the middle line is fabricated. None of it contradicts anything else in it.

**Status: M3 — entry substitution and in-page link rewriting work in the test harness;
not yet verified in a real Firefox profile.** The full product and technical specification is in
**[PRODUCT.md](PRODUCT.md)**.

## Try it

```bash
npm test          # taxonomy validation + coherence + M2 suites, no dependencies
npm run build     # bundles data/*.json into src/data.js for the extension
```

Then in Firefox: `about:debugging` → *This Firefox* → *Load Temporary Add-on…* → pick
`manifest.json`. Navigate to a URL carrying `utm_*` or `fbclid` and watch the address bar:
the values you arrive with are not the ones you clicked. Navigate again within the same
site and they are simply gone.

What exists today: the navigation-time half (§7.3A — blocking listener, visit registry,
loop guard) and the in-page half (§7.3B — links are rewritten where they sit, so what you
hover and copy is already the clean or the fabricated form). Redirector unwrapping (M4)
and the popup (M5) are not built yet.

## Why fabricate instead of strip

Stripping abstains from the dataset. Substitution corrupts it.

A stripped URL lands in the "direct / unknown" bucket that analytics systems have always
estimated around — and it marks you as someone running a privacy tool, because arriving
from a social network with no click ID is a recognizable combination. A URL carrying a
plausible campaign lands as a high-confidence record that happens to be wrong. A gap in
someone's data is cheap. A defect in it is not.

## How it works

| | |
|---|---|
| **Entry** | First navigation to a domain: tracking values are replaced with a coherent fake persona — channel, source, medium, campaign and click IDs that all agree with each other |
| **Interior** | Rest of the visit: tracking parameters are stripped, nothing further is fabricated |
| **Redirectors** | `l.facebook.com/l.php?u=…`, `out.reddit.com`, `google.com/url` and friends are unwrapped, then the destination gets the entry treatment. Wrappers that do not carry their destination — `t.co` — are left alone, because resolving them would need a network request |
| **Opaque IDs** | `fbclid`, `gclid`, `msclkid` get values conforming to that vendor's real grammar — valid shape, no real click behind it |
| **Unknown params** | Shape-preserving substitution: a word becomes a different word, hex becomes different hex of the same length |
| **Rule data** | Bundled in this repo. No external database, no update service, **zero outbound requests** |
| **Platform** | Firefox, Manifest V3, to be listed on addons.mozilla.org |

## Engine

```bash
npm test     # taxonomy validation + coherence assertions, no dependencies
```

`src/engine/` is pure: no browser APIs, no I/O, the taxonomy passed in as an argument, so
the same modules run in the extension, in tests and in CI. A visit's entire persona is
derived from one seed, which makes coherence within a visit free and lets a breakage report
carry a seed instead of the user's browsing history.

```
utm_source=nytimes&utm_medium=referral&utm_campaign=spring2019&fbclid=IwAR9xQlmBz3kKpQ7vN2
                              ↓  seed → channel → source, medium, campaign
utm_source=pinterest&utm_medium=retargeting&utm_campaign=fall-2026-update&fbclid=ch2GvpFNSvmm1v574Mga
```

Every persona is checked against an independent re-implementation of GA4's default channel
group rules: a source/medium pair GA4 does not recognize lands in **Unassigned**, and an
Unassigned row is the first thing an analyst filters out. Channels are drawn by weight, so
the population mix looks like real traffic rather than a uniform spread.

## Hard limits

Written into the schema and the code, not left to judgment:

- **Never move money** — affiliate tags, referral codes, partner IDs and coupon codes are
  never substituted, and commercial wrappers are never unwrapped. Swapping one affiliate's
  tag for another's is fraud, not privacy.
- **Never touch authentication or state** — a fabricated `code` or `state` attacks the
  user's own session. Any URL carrying one is passed through untouched, entirely.
- **Never impersonate a person** — generated tokens are structurally valid and semantically
  empty; nothing is derived from or collided with a real user's identifier.
- **Never fabricate on sensitive origins** — banking, health, government and tax sites are
  strip-only.
- **Never fabricate silently to the user** — the popup states in plain language what each
  site was told. The user is the one party this extension may never mislead.

## Non-goals

No ad blocking, no cookie or fingerprinting defenses, no clipboard interception, no Chrome
build, no user-agent or referrer forgery, and no coordinated poisoning campaign — each
installation makes local choices about its own traffic. Reasons in
[PRODUCT.md §5](PRODUCT.md) and [§11.4](PRODUCT.md).

## License

MIT (planned).
