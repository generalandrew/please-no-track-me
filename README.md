# please-no-track-me

A Firefox extension that strips tracking parameters from links **in the page, before you
click them** — so what you hover, copy, bookmark and click is already clean — and unwraps
redirector links (`l.facebook.com/l.php?u=…`, `t.co`, `out.reddit.com`) to their real
destination.

`utm_*`, `fbclid`, `gclid`, `msclkid`, `igshid`, `mc_eid`, `?ref=`, `?si=`, `?source=`
and several hundred others.

**Status: design complete, implementation not started.**
The full product and technical specification is in **[PRODUCT.md](PRODUCT.md)**.

## How it is built

| | |
|---|---|
| Platform | Firefox, Manifest V3, to be listed on addons.mozilla.org |
| Rule data | [`url-no-track-me`](https://github.com/generalandrew/url-no-track-me) — a separate, open, versioned catalog |
| Rule delivery | Snapshot bundled in the extension, plus a daily signature-verified update |
| Default posture | Conservative — strip only what is confidently tracking-only; per-site pause as the escape hatch |
| Telemetry | None. One outbound request per day, to fetch rules. Nothing else leaves the browser. |

## Why the rules live in another repo

Tracker discovery is continuous; add-on review is not. Keeping the catalog in
`url-no-track-me` means a rule fix ships in hours instead of weeks, a one-line JSON
addition is reviewable by someone who has never opened the extension source, and the
dataset is reusable by other tools.

See [PRODUCT.md §6](PRODUCT.md) for the split and [§9](PRODUCT.md) for the data contract.

## Non-goals for v1

No request blocking, no clipboard interception, no ad blocking, no cookie or
fingerprinting defenses, no Chrome build. Reasons for each are in
[PRODUCT.md §4](PRODUCT.md).

## License

MIT (planned).
