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

**Status: design complete, implementation not started.**
The full product and technical specification is in **[PRODUCT.md](PRODUCT.md)**.

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
