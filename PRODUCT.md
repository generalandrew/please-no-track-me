# please-no-track-me — Product Feature Document

**Version 2.0 · 2026-09-15 · Status: approved for build · Supersedes v1.0 (2026-09-04)**

A Firefox extension that **lies to trackers instead of hiding from them**.

When you enter a site, the extension rewrites the tracking parameters in the URL to values
that are well-formed, internally coherent, and wrong. The site records an attribution
story that is plausible, useful-looking, and about nobody. For the rest of that visit, the
extension simply removes tracking parameters from links — the lie is told once, at the
door, where attribution is actually captured.

---

## 1. Summary

| | |
|---|---|
| **Product** | `please-no-track-me` — Firefox extension, self-contained |
| **Core behavior** | Substitute tracking parameter values on site entry; strip them for the rest of the visit |
| **Substitution quality** | Format-conforming and semantically coherent — it must look like a real attribution record, not like noise |
| **Redirectors** | Unwrapped to the destination, whose parameters are then substituted |
| **Rule data** | Bundled in this repository. No external database, no update service, no network calls. |
| **Platform** | Firefox, Manifest V3, listed on addons.mozilla.org |
| **Default posture** | Conservative — functional parameters are never touched; per-site pause as the escape hatch |
| **Telemetry** | None. The extension makes **zero** outbound requests of its own. |

---

## 2. What changed from v1.0, and why

v1.0 was a **subtractive** product: identify tracking parameters, remove them, and keep the
catalog of what-to-remove in a separate repository that the extension fetched daily.

v2.0 makes three changes.

**2.1 Substitution replaces removal at the point of entry.** Removal abstains from the
dataset; substitution corrupts it. A stripped URL arrives at an analytics pipeline as
"direct / none" — a bucket analysts already know how to discount, and one that marks the
visitor as somebody running a privacy tool. A URL carrying `utm_source=newsletter`,
`utm_medium=email`, `utm_campaign=fall-longread` arrives as an ordinary, high-confidence
record that is entirely false. The first is a gap in their data. The second is a defect in
it, and defects are far more expensive than gaps.

It also removes a signal. A browser that strips every tracking parameter is identifiable
*by that fact*. A browser that arrives with well-formed, plausible parameters looks like
every other browser.

**2.2 The separate rules database is gone.** v1.0 split the catalog into
`url-no-track-me` so rules could ship faster than the extension. That reasoning was sound
for a subtractive product, where coverage of a long tail of parameter names is the whole
game and a missed parameter is a leak. It is much weaker here: substitution depends on a
*taxonomy* — vendor grammars and semantic vocabularies — which changes on the timescale of
ad platforms, not of marketing campaigns. That taxonomy is design work, it is versioned
with the code that interprets it, and it does not benefit from an independent release
cadence.

Removing the split also removes an entire subsystem: the update fetcher, signature
verification, schema-compatibility negotiation, rollback, and the AMO conversation about
remote data. The extension now ships everything it knows and makes no network requests at
all.

**2.3 Redirectors are unwrapped *and* the destination is substituted.** v1.0 unwrapped and
cleaned. v2.0 unwraps and then applies the full entry-substitution to the destination, so
a click through `l.facebook.com` arrives at the real site with a coherent story that does
not mention Facebook.

The companion repository `url-no-track-me` has been deleted.

---

## 3. Problem

Almost every link that reaches a person has been decorated with identifiers that have
nothing to do with finding the content:

- **Campaign parameters** — `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`,
  `utm_content`, `utm_id`, and vendor variants (`mc_cid`, `mkt_tok`, `_hsenc`).
- **Click identifiers** — `fbclid`, `gclid`, `gbraid`, `wbraid`, `msclkid`, `ttclid`,
  `igshid`, `twclid`, `dclid`, `yclid`. These are per-click, per-user values. They
  identify *you*, not the page.
- **Referrer and attribution fields** — `?source=`, `?ref=`, `?referrer=`, `?share_id=`,
  `?si=` on YouTube.
- **Redirector wrappers** — `l.facebook.com/l.php?u=…`, `t.co`, `out.reddit.com`,
  `googleadservices.com/pagead/aclk`, `linkedin.com/redir/redirect`. A logging hop between
  the click and the destination.

The costs are the familiar ones: cross-site identification, sharing a token minted for you
with everyone you send the link to, and URLs too long and too unstable to bookmark, cite
or deduplicate.

### 3.1 Why removal is not enough

Every existing tool in this space — ClearURLs, uBlock Origin's `removeparam`, Firefox's
own ETP query-stripping — removes. Removal has three weaknesses that this product targets:

1. **Abstention is cheap to handle.** Analytics systems have always had a large "direct /
   unknown" bucket — bookmarks, apps, copied links, mail clients that drop referrers. Your
   removed parameters land in a bucket that was already being estimated around.
2. **Absence is a signal.** Arriving at a site with a referrer from a social network and
   no `fbclid` is a recognizable combination. Removal makes a browser unusual; unusual is
   the opposite of the goal.
3. **Removal leaves the record empty, not wrong.** It costs the tracker nothing to have
   one fewer row. It costs them a great deal to have rows they believe and should not.

Substitution attacks the *value* of the data rather than the *volume* of it. That is a
meaningfully different and stronger position, and it is the premise of this product.

### 3.2 Why only at entry

Attribution is captured on arrival. The `utm_*` set and the click ID exist to answer "how
did this person get here", and that question is answered once, by the first request of a
visit. Subsequent internal links carry internal tracking — `?ref=sidebar`,
`?source=related` — which does not feed cross-site attribution and is not worth lying
about.

So the product tells one coherent lie per visit, at the moment it is believed, and
otherwise keeps the user's URLs clean. This is also the safer engineering choice: the
substitution logic runs on a small number of URLs per visit, not on every link on every
page, which bounds both the breakage surface and the performance cost.

---

## 4. Users

**Primary — the privacy-conscious everyday user.** Installs it and never thinks about it
again. Will uninstall immediately if a site breaks.

**Secondary — the sharer.** Copies links into chat, email, documents, issue trackers. Wants
the link they copy to carry neither their own identifiers nor a fabricated campaign. Served
by interior stripping: within a visit, links in the page are cleaned, so what is copied is
clean.

**Tertiary — the adversarially-minded user.** Understands the difference between abstaining
from a dataset and corrupting it, and wants the second. Served by the taxonomy's quality:
this user's measure of the product is whether the fabricated records are good enough to be
believed.

### Use cases

| # | Situation | Expected behavior |
|---|---|---|
| U1 | Clicks a newsletter link carrying `utm_*` + `mkt_tok` | Site is entered with a coherent but false campaign record; the real one is never sent |
| U2 | Clicks a Facebook link | `l.facebook.com` wrapper is skipped; the destination receives a well-formed `fbclid` that maps to no real click |
| U3 | Browses ten more pages on that site | Interior links are stripped clean; nothing further is fabricated |
| U4 | Copies a link from page six of that visit | Clipboard gets a clean URL — no tracking parameters, no fabricated ones |
| U5 | Returns to the same site tomorrow | A new visit, a new entry, a new and unrelated coherent story |
| U6 | A site misbehaves after install | Popup offers one-click "pause on this site"; the site is remembered and never touched again |

---

## 5. Goals and non-goals

### Goals

- **G1** On entry to a site, replace tracking parameter values with values that are
  format-valid, semantically coherent, and false.
- **G2** For the remainder of that visit, remove tracking parameters from links rather
  than fabricating more.
- **G3** Unwrap known redirectors and apply entry substitution to the destination.
- **G4** Never break a page, and never fabricate a value that could have consequences
  beyond analytics (see §11 — money, auth, and identity are hard boundaries).
- **G5** Be entirely self-contained: all rules and vocabularies bundled, no network
  requests, no external dependency.
- **G6** Collect nothing and transmit nothing.
- **G7** Impose no perceptible cost on page load or navigation.

### Non-goals for v2.0

- **N1 Ad or content blocking.** Requests are not blocked. Only URLs are rewritten.
- **N2 Cookie, fingerprint or referrer-header defenses.** Firefox's ETP covers these.
- **N3 Clipboard or share-sheet interception.** Unnecessary — interior links in the DOM
  are already clean, so the browser's own "Copy Link" copies clean text.
- **N4 Chrome / Edge / Safari.** Firefox-only.
- **N5 Fabricating an entire browsing identity.** The product lies about *how you arrived*,
  not about who or where you are. No user-agent spoofing, no referrer forgery, no cookie
  fabrication.
- **N6 Poisoning at scale as a service.** No coordination between users, no shared value
  pools, no campaign of deliberate mass corruption. Each installation makes its own local
  choices about its own traffic. See §11.4.

---

## 6. Principles

1. **Plausible beats random.** A fabricated record that is obviously synthetic is filtered
   out in one query and costs the tracker nothing. The entire value of this product is in
   the quality of the forgery. Coherence is a feature requirement, not a polish item.
2. **One lie per visit.** Fabricate at the door, then be quiet. Repeated contradictory
   fabrication within a session is both detectable and pointless.
3. **Functional parameters are sacred.** Substituting a value is strictly more dangerous
   than removing it: a removed parameter often falls back to a default, while a wrong one
   is acted upon. The never-touch list is the most important data in the product.
4. **Never move money, never touch auth, never impersonate a person.** §11.1. These are
   hard prohibitions, not defaults.
5. **Silence is the success state.** No badges demanding attention, no onboarding tour. A
   counter for the curious, nothing otherwise.
6. **Escape hatches are one click away.** A user must be able to disable it for a site
   faster than they can uninstall it.

---

## 7. The visit model

Everything in this product hangs off one distinction: is this navigation an **entry** into
a site, or is it **interior** to a visit already underway?

### 7.1 Definitions

A **visit** is scoped to a **registrable domain** (eTLD+1, so `www.example.com` and
`shop.example.com` share a visit) and has a lifetime:

- it **begins** at the first top-level navigation to that domain with no visit already
  active;
- it **stays alive** while any tab is open on that domain, and for **30 minutes** after the
  last top-level navigation to it;
- it **ends** on expiry, on the extension being disabled, or when the browser session ends.

Visit state lives **in memory only**. It is never written to disk. Closing Firefox erases
every visit, which is why U5 gets a fresh, unrelated story tomorrow — the product cannot
remember yesterday's lie even in principle.

### 7.2 The two phases

| | **Entry** | **Interior** |
|---|---|---|
| **Trigger** | Top-level navigation to a domain with no active visit | Any link or navigation within an active visit |
| **Action on tracking parameters** | **Substitute** — replace values per the taxonomy (§9) | **Strip** — remove them |
| **Applies to** | The navigating URL, and cross-origin links in the page pointing at domains with no active visit | Same-domain links in the page; subsequent navigations within the visit |
| **Redirectors** | Unwrapped, then the destination is treated as an entry | Unwrapped, then stripped |
| **Volume** | A handful of URLs per visit | Every link on every page |

### 7.3 Where the two phases are applied

The extension acts at two points, and the visit model determines what it does at each.

**A. Navigation-time substitution** (the entry). A top-level navigation to a domain with no
active visit is intercepted and redirected to its substituted form before the request is
sent. This is the only place the entry lie can be told reliably, because entries arrive
from everywhere: clicked in a mail client, pasted into the address bar, opened from a
native app, restored from history.

> **Decision note — this reverses non-goal N1 of v1.0.** v1.0 explicitly excluded request
> interception to keep permissions narrow. v2.0 requires it: a product whose central
> feature is what the site learns *on arrival* cannot only handle arrivals that originate
> from another web page. In-page rewriting alone would cover web→web clicks and miss mail
> clients, address-bar pastes, and every native app — which is most real entries.
>
> The cost is one additional permission and a longer AMO review. If that trade is not
> acceptable, the fallback is in-page rewriting only, and the feature degrades to "clicks
> that start in Firefox on another web page" — roughly a third of entries, and it fails on
> exactly the newsletter case that motivates the product. See §16.1.

**B. In-page link rewriting** (both phases). Links in the page are rewritten so that what
the user hovers, copies, bookmarks and clicks is already correct:

- a link to a domain with **no active visit** → substituted, so a copied link carries a
  fabricated story rather than the user's own identifiers;
- a link **within the current visit** → stripped clean.

The two points cooperate. When (B) emits a substituted URL, the background records that
exact string for the visit-to-be; if (A) later sees it as a navigation, it passes it
through unchanged rather than substituting twice. Substitution is idempotent by
bookkeeping, not by guesswork.

---

## 8. Feature specification

### 8.1 Entry substitution

**F1.1** On a top-level navigation to a registrable domain with no active visit, where the
URL carries at least one tracking parameter, the extension redirects to the substituted
URL before the request leaves the browser.

**F1.2** The substitution derives from a **visit seed** — a random value generated at entry
and held in memory for the visit's lifetime. Every fabricated value for that visit derives
from that seed, so the whole record is internally consistent (§9.4).

**F1.3** Parameter **names, order, and count are preserved**. Only values change. A URL that
arrived with five tracking parameters leaves with five. Shape-preservation is what makes
the record indistinguishable in aggregate.

**F1.4** Sub-resource, XHR, WebSocket and frame requests are never touched. Top-level
document navigations only.

**F1.5** Substitution is skipped entirely, leaving the URL untouched, when:
- the domain is on the user's allowlist;
- the domain is a **strip-only origin** (§11.2);
- the URL contains any never-touch parameter (§9.5) — the whole URL is left alone rather
  than partially rewritten;
- no tracking parameter is recognized;
- the engine throws for any reason.

**F1.6** A redirect loop guard: a given navigation is rewritten at most once, tracked by
request id, and never more than three times for one tab in ten seconds. If the guard trips,
substitution disables itself for that tab and the popup says so.

### 8.2 Interior stripping

**F2.1** Within an active visit, tracking parameters are **removed** from links in the page
and from subsequent top-level navigations to that domain.

**F2.2** Stripping follows the conservative rules carried over from v1.0: only parameters
recognized as tracking-only, never anything on the never-touch list, and for
domain-scoped parameters only on the domains they are scoped to.

**F2.3** If stripping would produce an invalid or empty URL, the original is kept. The `?`
is dropped entirely when no parameters survive.

### 8.3 In-page link rewriting

**F3.1** The content script rewrites `a[href]` and `area[href]`. `form[action]`,
`iframe[src]` and resource URLs are not touched.

**F3.2** The `ping` attribute is removed from `<a>` elements — it fires a background POST to
a tracking endpoint on click and has no user-facing function. There is nothing to
substitute, so it is simply dropped.

**F3.3** Rewriting runs at `document_idle`, then on DOM mutation (nodes added, `href`
changed), batched through `requestIdleCallback` with a time slice, and covers open shadow
roots.

**F3.4** Rewriting is idempotent and non-destructive. Cleaned elements are tracked in a
`WeakSet`; originals are held in a `WeakMap` so "pause on this site" can restore them
without a reload.

**F3.5 Performance budget.** Under **5 ms per 1,000 links**, no forced synchronous layout,
no delay to first paint. Enforced by a benchmark in CI.

**F3.6** Never touched: `about:*`, `moz-extension://*`, `view-source:`,
`addons.mozilla.org`, allowlisted origins, and strip-only origins (which are stripped, not
substituted).

### 8.4 Redirector unwrapping

**F4.1** When a link or navigation targets a known redirector, the destination is extracted
from the catalogued parameter or path position, decoded, and used in place of the wrapper.
The destination is then processed by the phase that applies to *it* — entry substitution if
it is a new domain, stripping if it is within the current visit.

**F4.2 Safety gates.** The unwrap is abandoned, leaving the original link, if:
- the extracted value does not parse as an absolute URL;
- the scheme is not `http:` or `https:`;
- unwrapping recurses more than **3** levels;
- the redirector is catalogued as **not unwrappable** — signed exit links, paywall proxies,
  and any wrapper whose removal changes a commercial outcome (§11.1).

**F4.3** The destination's own fragment is preserved; the wrapper's is discarded.

**F4.4** A wrapper that does **not** carry its destination in the URL cannot be unwrapped at
all. `t.co` is the common case: it holds an opaque short code, and resolving it requires an
HTTP request, which §12's zero-outbound-requests commitment forbids. Such wrappers are
catalogued with `unwrappable: false` and left untouched. Earlier drafts of this document
used `t.co` as an example of unwrapping; that was wrong.

### 8.5 Controls

**F5.1 Per-site pause.** The popup offers "Pause on this site", which stops all
intervention on that registrable domain immediately and for future visits, restores the
current page's original links without a reload, and is listed in options for removal.

**F5.2 Global pause.** One switch disables everything.

**F5.3 Mode override.** Per-site, the user can force **strip-only** (never fabricate here)
or **off**. Strip-only is the middle setting for sites where the user wants cleaning but
not a fabricated record.

**F5.4 Report a problem.** Opens a pre-filled GitHub issue containing the hostname, the
rules that matched, and the extension version. Nothing is sent automatically — the user
sees the text and submits it, or does not.

### 8.6 Popup

For the active tab only:

- the current phase — "Entered with a substituted record" or "Interior — stripping";
- **what was fabricated**, in plain language: *"This site was told you arrived from a
  newsletter link in an email campaign. You did not."* Showing the lie is a trust
  requirement — a product that fabricates data and does not show the user what it
  fabricated is indistinguishable from one that is lying to the user too;
- counts of links stripped on this page;
- pause / strip-only / off;
- report a problem.

Badge shows the per-tab stripped count and can be turned off. All counters are in memory
and die with the tab.

### 8.7 Options

Substitution on/off · redirector unwrapping on/off · `ping` removal on/off · visit lifetime
(15 / 30 / 60 minutes) · badge on/off · allowlist and per-site modes (view, add, remove,
export/import as plain text) · view the bundled taxonomy version · reset to defaults.

---

## 9. The substitution taxonomy

This section is the heart of the product. A fabricated attribution record has value only if
an analyst looking at it cannot tell it from a real one. That requires two properties:
every value must be **well-formed for its parameter**, and the values must be **coherent
with each other**.

The taxonomy lives in `data/` in this repository and is versioned with the extension.

### 9.1 Parameter classes

| Class | Examples | Substitution strategy |
|---|---|---|
| **C1 Closed-vocabulary semantic** | `utm_source`, `utm_medium`, `ref`, `source`, `platform` | Draw a different value from the same real-world vocabulary, subject to coherence constraints |
| **C2 Open-vocabulary semantic** | `utm_campaign`, `utm_term`, `utm_content` | Generate from naming-convention templates observed in the wild, seeded per visit |
| **C3 Opaque vendor token** | `fbclid`, `gclid`, `msclkid`, `ttclid`, `igshid`, `mc_eid` | Generate a value conforming to that vendor's grammar (§9.3) |
| **C4 Unrecognized but tracking-shaped** | anything matching `*_source`, `*_campaign`, `*clid`, `*_id` heuristics | Shape-preserving substitution from the observed value itself (§9.6) |
| **C5 Never-touch** | `q`, `id`, `token`, `code`, `state`, `redirect_uri`, `sig`, OAuth/OIDC set, affiliate tags | Left exactly as found; their presence suppresses substitution for the whole URL |

### 9.2 Closed vocabularies (C1) and the channel model

Vocabularies are organized by **channel**, not by parameter. A channel owns the sources and
mediums that go together, and the persona draws a channel once per visit; `utm_source` and
`utm_medium` then draw from that channel rather than independently. This is what makes
coherence structural instead of a rule somebody has to remember to apply.

Each channel is modelled on a **real GA4 default channel group**, with the rule that defines
it recorded alongside:

```jsonc
{
  "organic_social": {
    "weight": 14,
    "ga4": "Organic Social",
    "$rule": "Source in GA4's social sites list OR medium in (social, social-network, social-media, sm).",
    "mediums": ["social", "social-network", "social-media", "sm"],
    "sources": ["facebook", "instagram", "twitter", "reddit", "linkedin", "..."]
  }
}
```

**Why model GA4's rules rather than invent vocabularies.** GA4 assigns any source/medium
pair its rules do not recognize to **Unassigned**, and an Unassigned row is the first thing
an analyst filters out. An incoherent persona is therefore not merely implausible — it is
discarded before anyone looks at it, which would make the whole product a no-op with extra
steps. Values like `utm_medium=newsletter` or `utm_medium=partner` look entirely reasonable
to a human and land in Unassigned; the earlier draft of this taxonomy contained several.
`test/ga4-channels.mjs` re-implements the GA4 rules independently of the engine and asserts
that every generated persona lands in a named channel.

Three GA4 channels are deliberately never generated: **Affiliates** (§11.1 forbids
fabricating affiliate attribution), **Paid/Organic Shopping** (same reasoning), and
**Direct** (the absence of attribution, which is what stripping already produces).

### 9.3 Vendor grammars (C3)

Each opaque token gets a grammar describing how real values of that parameter are shaped —
alphabet, length, structural prefix, encoding — so a generated value passes any
client-side or ingest-side validation and looks native in the tracker's own logs.

```jsonc
{
  "param": "msclkid",
  "grammar": { "alphabet": "hex-lower", "length": 32 },
  "verified": "2026-09-15",
  "samples": 40
}
```

| Parameter | Shape (illustrative — see the note below) |
|---|---|
| `msclkid` | fixed-length lowercase hex |
| `fbclid` | structural prefix + base64url body, length varies by generation |
| `gclid` / `dclid` | base64url, wide length range, recognizable leading bytes |
| `igshid` | short base64url |
| `mc_eid` | short hex |
| `ttclid` / `twclid` / `yclid` | vendor-specific; to be characterized |

> **These shapes are illustrative and must not be implemented from this table.** Each
> grammar is to be derived empirically during M1 from a corpus of at least 30 observed
> real values per parameter, recorded with the date observed and re-verified before each
> release. A grammar with no verified sample count does not ship; the parameter falls back
> to C4 shape-preserving substitution, which requires no vendor knowledge at all.

Grammars describe *structure only*. No grammar ever encodes a real identifier, and no
generated value is drawn from, derived from, or collided with a real user's token (§11.4).

### 9.4 The coherence engine

At entry, the extension derives a **visit persona** from the visit seed:

```
seed ──► channel        (email | social | search | referral | display)
     ──► source         drawn from vocabulary ∩ channel
     ──► medium         drawn from the channel's allowed mediums
     ──► campaign shape template + slug vocabulary
     ──► token values   generated per §9.3, consistent with the channel
```

Constraints the persona must satisfy:

1. **Channel agreement.** `utm_medium=cpc` never pairs with `utm_source=newsletter`.
   `utm_medium=email` never pairs with `utm_source=google`.
2. **Token agreement.** A `gclid` is only emitted alongside a search or display channel; an
   `fbclid` only alongside social. If the incoming URL carries a token whose vendor
   contradicts the drawn channel, **the channel is redrawn to match the token** — the
   incoming parameter set is the stronger constraint, because it is the thing whose shape
   must be preserved (F1.3).
3. **Campaign plausibility.** Campaign slugs come from templates that mirror real naming
   conventions — `{season}-{year}-{theme}`, `{product}_{geo}_{quarter}` — not random
   strings.
4. **Temporal plausibility.** Date-like fragments in campaign names use the current
   quarter and year. A campaign named for a season three years ago is a tell.
5. **Stability within the visit.** Every URL substituted during a visit uses the same
   persona. A site that receives two different entry stories in one session learns that
   something is fabricating them.
6. **Plausible channel mix.** Channels are drawn by weight, not uniformly. Real traffic is
   dominated by organic search, social and email; a population arriving evenly across
   eleven channels — one ninth of it by SMS — would stand out in any aggregate channel
   report even though each individual record looked fine. The weights are a coarse
   judgement rather than a measurement, and the corpus checks only for gross deviation.

The output for one visit might be:

```
utm_source=newsletter  utm_medium=email  utm_campaign=fall-2026-longform
utm_content=body-link  mc_eid=<grammar-conforming hex>
```

Every value is false. Nothing in the set contradicts anything else in it.

### 9.5 The never-touch list (C5)

Checked **after** every other rule, and it wins unconditionally. A URL containing any of
these is passed through entirely untouched — no substitution, no stripping:

- **Auth and state** — `token`, `access_token`, `id_token`, `code`, `state`, `nonce`,
  `redirect_uri`, `client_id`, `scope`, `session`, `sid`, `auth`, `sig`, `signature`,
  `expires`, `X-Amz-*`, `Key-Pair-Id`.
- **Function** — `q`, `query`, `s`, `search`, `id`, `page`, `p`, `offset`, `limit`, `sort`,
  `lang`, `locale`, `v`, `t`.
- **Commerce** — affiliate tags, partner ids, referral codes, coupon and discount codes.
  See §11.1: these are a hard prohibition, not a heuristic.

Because substitution can cause a site to act on a wrong value rather than fall back to a
default, this list is deliberately **broader** than the equivalent list in v1.0, and
ambiguity resolves toward inclusion.

### 9.6 Shape-preserving fallback (C4)

This is the "if no logical other is identified, replace with a different keyword" case. The
extension does not know what the parameter means, so it derives the substitute from the
value it was given:

| Observed value | Substitute |
|---|---|
| A dictionary word or hyphenated phrase | A **different** word or phrase from a generic vocabulary of comparable length, coherent with the visit persona's channel where possible |
| A pure integer | A different integer of the same digit count |
| Fixed-length hex | Different hex of the same length |
| base64url-looking token | Different token, same length and alphabet |
| A UUID | A different well-formed UUID of the same version |
| Anything else | Left untouched |

The fallback is **never** applied to a parameter that is not first recognized as
tracking-shaped by name, and never to a C5 name. An unrecognized parameter with an
unrecognized name is left alone — that is the conservative default, and it is the common
case.

### 9.7 Sources

The taxonomy is grounded in published platform documentation rather than invented:

- GA4 default channel groups, which define the source/medium pairings that land in a named
  channel — `support.google.com/analytics/answer/9756891`
- GA4 campaign URL parameters, for the `utm_*` family including `utm_id`,
  `utm_source_platform`, `utm_creative_format` and `utm_marketing_tactic` —
  `support.google.com/analytics/answer/10917952`
- Matomo's URL parameter reference, for the `mtm_*` family and for the active/passive
  parameter distinction that underpins the never-touch list — `matomo.org`

Click-identifier *names* are taken from platform documentation and public reference lists.
Click-identifier *shapes* are not: §9.3's verification policy requires observed samples, and
no amount of documentation substitutes for them.

### 9.8 Maintaining the taxonomy in-repo

There is no external database, but the quality gates from v1.0 survive as CI in this
repository, because the taxonomy needs them more than a strip-list did:

- **Schema validation** of every file in `data/`.
- **Lint** — duplicate entries, vocabulary values with no channel, grammars with no
  verified sample count, C5 collisions.
- **Invariant corpus** — URLs that must come back byte-identical: OAuth callbacks, signed
  S3 URLs, search queries, payment returns, checkout flows. Every taxonomy change must add
  to it.
- **Coherence corpus** — seeded persona generations with asserted outputs, so a vocabulary
  edit cannot silently start emitting `utm_medium=email` with `utm_source=google`.
- **Plausibility review** — a human reads a sample of 50 generated records before each
  release and answers one question: would this look real in an analytics table? This is a
  judgment gate and it is not automatable.

---

## 10. Technical design

### 10.1 Structure

Manifest V3 for Firefox, which uses a non-persistent **event page** rather than a service
worker.

```
please-no-track-me/
  manifest.json
  src/
    background.js        event page: visit registry, navigation interception, message hub
    visits.js            visit lifecycle, seeds, persona derivation, expiry
    engine/
      classify.js        URL → which parameters, which class, which phase
      substitute.js      persona → values; grammars; shape-preserving fallback
      strip.js           interior stripping
      unwrap.js          redirector extraction + §8.4 safety gates
      rng.js             seeded deterministic RNG (a visit is reproducible from its seed)
    content/
      content.js         DOM traversal, MutationObserver, rewriting
    ui/
      popup.html/.js     phase, the fabricated record in plain language, controls
      options.html/.js
  data/
    vocabularies.json    C1 closed vocabularies with channel labels
    grammars.json        C3 vendor grammars, with verification dates and sample counts
    campaigns.json       C2 naming templates and slug vocabularies
    redirectors.json     wrapper hosts, extraction, unwrappable flag
    tracking-params.json names recognized as tracking, with scope and class
    never-touch.json     C5
    strip-only.json      sensitive origin classes (§11.2)
  test/
    invariants/          must-not-change corpus
    coherence/           seeded persona assertions
    bench/               the F3.5 performance budget
```

The `engine/` modules are pure and dependency-free: same code in the extension, in tests,
and in the CI corpus runner.

### 10.2 Permissions

| Permission | Why |
|---|---|
| `storage` | Settings, allowlist, per-site modes |
| `webRequest`, `webRequestBlocking`, or `declarativeNetRequestWithHostAccess` | Entry substitution on top-level navigation (§7.3A) — the mechanism is chosen at M2 |
| `<all_urls>` host permission | Entries and links can occur anywhere |

Not requested: `tabs`, `cookies`, `history`, `downloads`, `clipboardWrite`, `management`,
`nativeMessaging`. **No network permission of any kind** — the extension has no endpoint to
talk to.

`webRequest` is the heaviest ask and the one that determines the AMO review. §16.1 records
the alternative if it is refused.

**Mechanism decision (M2).** Entry substitution uses a blocking
`webRequest.onBeforeRequest` listener filtered to `main_frame`, returning `{ redirectUrl }`.
`declarativeNetRequest` was considered and cannot express it: the substituted values depend
on state that does not exist until the navigation happens — whether a visit is active, and
a seed generated at that moment — and DNR rules are precomputed patterns with literal
values. Interior stripping *could* be a DNR `removeParams` rule and may move there later to
shrink the blocking listener's scope; for now both phases go through the one handler so
there is a single tested code path.

**Exit check that cannot be done in Node.** Firefox MV3 runs the background as a
non-persistent event page. The listener is registered synchronously at top level so
Firefox can wake the page for it, but whether a *blocking* listener reliably answers after
a suspension — or whether the first navigation after idle slips past while the page loads
— has to be observed in a real profile. M2 is not closed until that is done with
`about:debugging`, and §16.1's fallback applies if it fails.

### 10.3 The pipeline

```
top-level navigation to URL
  │
  ├─ allowlisted / strip-only / never-touch present? ──► pass through unchanged
  │
  ├─ redirector? ──► unwrap (≤3 deep, §8.4 gates) ──► continue with destination
  │
  ├─ URL already emitted by our own content script for this visit? ──► pass through
  │
  ├─ active visit on this registrable domain?
  │     │
  │     ├─ NO  ──► ENTRY
  │     │          open visit, generate seed, derive persona (§9.4)
  │     │          substitute every recognized tracking value, preserve names/order/count
  │     │          redirect to the substituted URL
  │     │
  │     └─ YES ──► INTERIOR
  │                strip recognized tracking parameters
  │
  └─ any exception ──► original URL, untouched
```

Every failure path is "leave it alone". There is no state in which a malformed
substitution is preferred to the original URL.

### 10.4 Determinism and the seed

`rng.js` is a seeded PRNG, so a visit's entire persona is reproducible from its seed. This
matters for three reasons: coherence within the visit is free; the coherence corpus can
assert exact outputs; and a breakage report can carry a seed that reproduces the exact
fabricated record without carrying the user's URL history.

Seeds come from `crypto.getRandomValues`, live in memory, and are never persisted.

### 10.5 Content script

```
document_idle
  ↓
initial sweep: a[href], area[href], plus open shadow roots
  ↓
MutationObserver { childList, subtree, attributes, attributeFilter: ['href','ping'] }
  ↓
batch → requestIdleCallback → time-sliced processing
  ↓
per element:  WeakSet check
              → same registrable domain as an active visit?  strip
              → cross-domain, no active visit?               substitute (persona for that
                                                             domain's visit-to-be, recorded
                                                             with the background)
              → write href only if changed; retain original in WeakMap
```

`all_frames: true`, `match_about_blank: true`. The observer ignores its own writes by
comparing against the last value written.

**Where the decision runs (M3 deviation).** This section originally had the taxonomy and
settings *pushed* into every content script so nothing sat on the hot path. Built, the
decision also depends on the visit registry — which domains are active, which pending
seeds are reserved — and mirroring that into every frame is state synchronisation with all
its failure modes. Instead the content script owns the DOM and nothing else: it batches the
absolute hrefs it finds into **one message per batch** to the background, which runs the
engine against the one registry and returns the rewrites. Per link, nothing crosses the
boundary; per batch, one round trip. Measured (`test/m3/bench.mjs`, 2026-09-16): the engine
decides 1,000 links in 5.6 ms and the rewriter's own DOM-side work costs 1.6 ms per 1,000
elements, both inside F3.5's budget, with a fake DOM isolating our cost from layout's. The
`ping` attribute is dropped locally without a round trip. If the background is asleep or
unreachable, the batch is marked done and the links are left exactly as they were.

**Known limitation.** Sites that rebuild the URL in a `mousedown`/`click` handler can
re-add parameters after rewriting. Navigation-time interception (§7.3A) catches those on
arrival, which is precisely why the two mechanisms are both present — B improves what the
user sees and copies, A guarantees what the site receives.

### 10.6 Storage

| Key | Area | Contents |
|---|---|---|
| `settings` | `storage.sync` | Toggles, visit lifetime, badge |
| `allowlist` | `storage.sync` | Origins and per-site modes |
| *(none)* | `storage.local` | Nothing. The taxonomy is bundled; visits are in memory. |

No browsing history is written to disk in any form, and no record of any fabricated
persona survives the browser session.

---

## 11. Ethics, safety, and the AMO posture

This product deliberately sends false data to third parties. That deserves a clear-eyed
section rather than a sentence, because it is the difference between this and every
subtractive privacy tool, and it is what an AMO reviewer will ask about.

**The position.** Spoofing what you disclose about yourself to a party collecting it
without meaningful consent is long-established browser practice — user-agent spoofing,
referrer trimming, Do Not Track, `resistFingerprinting` — and the tracking parameters here
are data *about the user*, attached to *the user's own request*. Misreporting how you
arrived is a statement about yourself, and the user is entitled to make it. The boundaries
below are where that entitlement stops.

### 11.1 Hard prohibitions

These are enforced in code and in the taxonomy schema, not left to rule authors:

1. **Never move money.** Affiliate tags, referral codes, partner ids, coupon and discount
   codes are never substituted, and a redirector whose removal changes a commercial
   outcome is never unwrapped. Substituting one affiliate's tag for another's redirects
   somebody's commission — that is fraud, not privacy. This is the single most important
   line in the document.
2. **Never touch authentication or state.** §9.5. A fabricated `state` or `code` is an
   attack on the user's own session.
3. **Never impersonate an identifiable person.** No generated value is derived from,
   seeded by, or colliding with another real user's identifier. Fabricated tokens are
   structurally valid and semantically empty.
4. **Never fabricate on sensitive origins.** §11.2.
5. **Never fabricate silently to the user.** The popup states plainly what the site was
   told (§8.6). The user is the one party this product is never allowed to mislead.

### 11.2 Strip-only origins

A bundled class list where fabrication is disabled and only stripping applies: banking and
payments, healthcare and pharmacy, government and tax, education enrolment, and any origin
the user marks strip-only. The reasoning is that these are the contexts where an unexpected
value is most likely to be acted on rather than merely logged, and where the consequences
of being wrong are borne by the user.

### 11.3 AMO review

The listing will state, in the first paragraph of the description, that the extension
replaces tracking parameters with fabricated values, and the privacy policy will say the
same. Nothing about the mechanism is concealed from the user or the reviewer. The review
will turn on the `webRequest` permission (§10.2) and on the honesty of the disclosure; both
are addressed by design rather than by argument.

Specific review points to pre-empt: no remote code and no remote data of any kind; no
`eval`, `Function`, `innerHTML` with non-literal content, or `RegExp` built from
non-bundled strings; default MV3 CSP retained; every taxonomy file treated as trusted
bundled data and still schema-validated at load.

### 11.4 What this product is not

It is not a coordinated poisoning campaign. There is no shared value pool, no
synchronization between installations, and no attempt to maximize aggregate damage to any
particular company's data (N6). Each installation makes local choices about its own
traffic. The distinction matters legally and ethically: an individual misreporting their
own arrival is exercising a choice about their own data; a coordinated system engineered to
degrade a specific target's systems is something else, and this product declines to be it.

---

## 12. Privacy

**Collected: nothing.** No analytics, no crash reporting, no identifiers, no "anonymous
usage statistics".

**Sent: nothing.** v2.0 has no update channel and no endpoint. The extension makes zero
outbound requests. This is a strict improvement over v1.0's daily rule fetch.

**Read from pages:** link URLs, from the DOM. Page text, form contents, cookies and storage
are never accessed.

**Stored:** settings and the allowlist. Visits, seeds, personas and counters are in memory
and die with the browser session.

---

## 13. Success metrics

No telemetry, so everything is public or local:

| Metric | Source | Target at 6 months |
|---|---|---|
| AMO installs (active daily users) | AMO stats | 2,000 |
| AMO rating | AMO | ≥ 4.5 with ≥ 25 reviews |
| Open breakage reports at any time | GitHub issues | < 5, median time-to-fix < 24 h |
| Taxonomy coverage | repo | ≥ 250 tracking parameters classified, ≥ 8 vendor grammars verified |
| Invariant corpus | repo | ≥ 500 must-not-change URLs |
| **Plausibility** | quarterly manual review | ≥ 90% of a 50-record sample judged indistinguishable from real by a reviewer who did not generate it |

The leading indicator is the **breakage-to-install ratio**. The defining one is
**plausibility** — it is the only metric that measures whether the product's premise is
being delivered, and a product that scores badly on it is a subtractive tool wearing a
costume.

---

## 14. Milestones

**M0 — Foundations (week 1).** This document. Taxonomy schemas. `classify.js` and the
invariant corpus. `url-no-track-me` deleted. No UI.

**M1 — Taxonomy (weeks 2–3).** Vocabularies with channel labels, campaign templates,
coherence engine, seeded RNG, coherence corpus. Vendor grammars derived empirically from
observed samples with verification dates. First plausibility review.

**M2 — Entry substitution (week 4).** Choose the interception mechanism (`webRequest`
blocking vs `declarativeNetRequest` redirect), visit registry, navigation handler, loop
guard, never-touch and strip-only enforcement. End-to-end: click a `utm`-laden link, watch
a coherent false record arrive.

*Status 2026-09-16:* built and tested in Node — `src/visits.js`, `src/guard.js`,
`src/navigation.js`, `src/engine/domain.js`, a thin `src/background.js`, `manifest.json`,
77 checks in `test/m2/`. The end-to-end property holds in the harness: a `utm`-laden
`fbclid` link produces a redirect whose record lands in a named social channel, the
redirect target is recognised and not rewritten twice, the next navigation on the site is
stripped, and a fourth rewrite in one tab within ten seconds disables the guard for that
tab. **Open:** the real-profile event-page check above.

**M3 — Interior and links (week 5).** Content script, MutationObserver, stripping,
cross-origin substitution with background bookkeeping, `ping` removal, performance
benchmark in CI.

*Status 2026-09-16:* built and tested — `src/links.js` (pure decisions),
`src/content/rewriter.js` (a plain script the tests execute under a fake DOM via `vm`),
`src/content/content.js`, the `links` handler and per-tab counts in `background.js`. 41
checks in `test/m3/` and a benchmark gated in CI. A link to a domain with no visit is
substituted with the persona its visit will use, and clicking it is recognised as the same
story (`personaFor` reserves the seed; `markEmitted` records the string). Relative and
query-only hrefs keep their form — only the query and fragment change. Restore and resume
work, ready for M5's per-site pause. **Open:** the same real-profile check as M2, now also
covering the content script on a live page.

**M4 — Redirectors (week 6).** Unwrapping with all §8.4 gates, then entry substitution of
the destination. Commercial-outcome wrappers catalogued as not unwrappable.

**M5 — UI and control (week 7).** Popup including the plain-language statement of what was
fabricated, per-site modes, options, breakage reporting.

**M6 — AMO submission (week 8).** Permission justifications, listing copy leading with the
substitution disclosure, privacy policy, screenshots, source-availability statement.

**M7 — Post-launch (weeks 9–12).** Breakage triage, grammar re-verification cadence,
quarterly plausibility review, decision on v3 scope.

---

## 15. Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | A substituted value breaks a site in a way stripping would not have | Medium | **High** | Broad never-touch list; whole-URL bail-out when any C5 parameter is present; strip-only origins; one-click per-site pause offered before the user reaches the uninstall button |
| R2 | AMO rejects the `webRequest` permission or the substitution premise | Medium | **High** | Disclose in the first line of the listing; no remote code or data at all; documented fallback to in-page-only (§16.1) which needs no such permission |
| R3 | Fabricated records are obviously synthetic and get filtered in one query | Medium | **High** — it is the whole premise | Coherence engine; empirically derived grammars; shape and count preservation; a human plausibility gate before every release |
| R4 | Vendor grammars drift and generated tokens stop validating | High | Medium | Verification dates and sample counts in `grammars.json`; a stale grammar automatically degrades to C4 shape-preserving rather than emitting a wrong shape |
| R5 | Someone builds an affiliate-fraud path through the substitution engine | Low | **Severe** | §11.1 prohibition enforced in schema and code; commerce parameters in C5; no unwrapping of commercial wrappers; reviewed on every taxonomy change |
| R6 | Navigation interception introduces a redirect loop | Medium | High | Per-request-id single rewrite, per-tab rate limit, automatic self-disable with a visible notice (F1.6) |
| R7 | Users perceive the extension as lying *to them* | Medium | Medium | Popup states exactly what each site was told, in plain language; the fabrication is never concealed |
| R8 | Handler-rebuilt URLs defeat in-page rewriting | High | Low in v2.0 | Navigation-time interception catches arrivals regardless of how the URL was built |
| R9 | Entry/interior boundary is wrong for SPAs and multi-domain properties | Medium | Medium | Registrable-domain scoping rather than origin; visit expiry tuned during M3; user-visible phase indicator in the popup makes misclassification reportable |

---

## 16. Open questions

**16.1 If `webRequest` is refused.** The fallback is in-page rewriting only: entries that
begin with a click on another web page still get a substituted record, and everything else
gets nothing. That is a materially smaller product, and it fails the newsletter case in
§U1. If AMO pushes back, the choice is between that reduction and a self-hosted signed XPI
outside the store. *Decide at M6, with a preference for reduction over leaving the store.*

**16.2 Visit lifetime.** 30 minutes is a guess borrowed from analytics session conventions.
Too short and a single reading session produces two contradictory entry records — the exact
tell §9.4.5 exists to prevent. Too long and stale visits suppress substitution on genuinely
new arrivals. *Instrument locally during M3 and pick from observation, not from convention.*

**16.3 Scope of the visit key.** Registrable domain is the right default, but large
properties span domains (`google.com` / `youtube.com`) and CDNs share them. A property map
would be more accurate and is more maintenance. *Ship eTLD+1; revisit if breakage reports
point at it.*

*Resolved for M2:* there is no WebExtension API for eTLD+1, and the full Public Suffix List
is ~230 KB and changes monthly. `src/engine/domain.js` carries a compact table of the
multi-part suffixes that occur in ordinary browsing (`co.uk`, `com.au`, …) plus the
private-section platforms where sibling subdomains are unrelated sites (`github.io`,
`netlify.app`, …), and falls back to the last two labels. The failure mode of a missing
entry is a visit scoped one label too wide — two unrelated sites sharing a persona — which
is a plausibility cost, not a safety one; nothing in never-touch or strip-only depends on
it. Bundling the real PSL remains the eventual answer.

**16.4 Should interior stripping ever fabricate?** Currently no — interior is strip-only by
design (§3.2). Sites with internal `?ref=` tracking arguably deserve the same treatment as
entry. *Deferred; the one-lie-per-visit principle argues against it and nothing yet argues
for it.*

**16.5 Grammar verification without collecting data.** Grammars must be derived from real
observed values, but this product collects nothing. Samples therefore come from the
maintainers' own browsing and from public documentation, recorded by hand in the repo.
*This bounds how fast grammars can be verified and is accepted.*

---

## 17. Decisions of record

| Decision | Choice | Rationale |
|---|---|---|
| Core behavior | Substitute at entry, strip thereafter | Attribution is captured on arrival; one coherent lie beats continuous noise |
| Substitution quality bar | Format-conforming and semantically coherent | A forgery that is filtered out in one query has no value |
| Opaque tokens | Vendor-grammar generation, empirically verified, C4 fallback when unverified | "Looks logical and could be correct, but is not the real one" |
| Unrecognized parameters | Shape-preserving substitution of the observed value | The "different keyword" fallback, without guessing at meaning |
| Rules storage | Bundled in this repository | No external database, no update channel, no network requests |
| Redirectors | Unwrap, then substitute the destination | Skips the logging hop and poisons the arrival |
| Entry mechanism | Navigation interception — **reverses v1.0 non-goal N1** | Entries arrive from mail clients, native apps and the address bar, not only from web pages |
| Breakage posture | Conservative; broader never-touch list than v1.0 | A wrong value is acted on; a missing one often falls back to a default |
| Hard limits | Never move money, never touch auth, never impersonate, never fabricate silently to the user | §11.1 |
| Platform | Firefox MV3, AMO listed | Firefox retains the needed capabilities |
| Telemetry | None; zero outbound requests | The premise forbids it |
