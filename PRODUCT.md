# please-no-track-me — Product Feature Document

**Version 1.0 · 2026-09-04 · Status: approved for build**

A Firefox extension that removes tracking parameters from links *in the page, before you
click them*, and unwraps redirector links so a click goes straight to the destination.

Its rule data lives in a separate open-source repository,
[`url-no-track-me`](https://github.com/generalandrew/url-no-track-me), so the catalog of
what-to-strip can be maintained, reviewed and released independently of the extension.

---

## 1. Summary

| | |
|---|---|
| **Product** | `please-no-track-me` — Firefox browser extension |
| **Data source** | `url-no-track-me` — open-source tracking-parameter catalog + pattern set |
| **Platform** | Firefox, Manifest V3, listed on addons.mozilla.org (AMO) |
| **Intervention points** | In-page link rewriting; redirector unwrapping |
| **Default posture** | Conservative — strip only what is confidently tracking-only; per-site allowlist as escape hatch |
| **Rule delivery** | Versioned snapshot bundled in the XPI, plus a periodic signed update fetched from the rules repo |
| **Telemetry** | None. No network calls other than the rule update fetch. |

---

## 2. Problem

Almost every link that reaches a person today has been decorated with identifiers that
have nothing to do with finding the content:

- **Campaign parameters** — `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`,
  `utm_content`, `utm_id`, and dozens of vendor variants (`mc_cid`, `mkt_tok`, `_hsenc`).
- **Click identifiers** — `fbclid`, `gclid`, `gbraid`, `wbraid`, `msclkid`, `ttclid`,
  `igshid`, `twclid`, `dclid`, `yclid`. These are per-click, per-user values; they
  identify *you*, not the page.
- **Referrer/attribution fields** — `?source=`, `?ref=`, `?referrer=`, `?share_id=`,
  `?si=` on YouTube, `/ref=` path segments on Amazon.
- **Redirector wrappers** — `l.facebook.com/l.php?u=…`, `t.co/…`, `out.reddit.com/…`,
  `googleadservices.com/pagead/aclk?…`, `linkedin.com/redir/redirect?url=…`. These add a
  logging hop between the click and the destination.

Three costs follow from this:

1. **Tracking.** The parameters exist so a click can be attributed to a person across
   sites, sessions and devices. The destination site receives them, logs them, and often
   passes them onward.
2. **Sharing pollution.** A copied link carries the sender's identifiers to the
   recipient. Sharing a `fbclid` link is sharing a token that was minted for you.
3. **URL rot.** Long, unreadable URLs are hostile in messages, documents, bookmarks and
   citations, and they defeat deduplication — the same article looks like fifty
   different pages.

Existing tools address parts of this. ClearURLs pioneered the catalog approach; uBlock
Origin can strip parameters with `removeparam` filters; Firefox itself strips a small
list in Private Browsing with Strict ETP. Each has a gap this product targets:

- **They act at request time, not at link time.** The dirty URL is still what you see,
  hover, copy, bookmark and share. Cleaning happens only if you click, and only in your
  browser — the copied link stays dirty.
- **The rule data is welded to the tool.** Updating the catalog means shipping a new
  build of the whole extension, and the catalog cannot be reused by anything else.

`please-no-track-me` inverts both: **clean the link where it sits in the page**, and
**publish the catalog as a standalone, independently versioned, reusable dataset**.

---

## 3. Users

**Primary — the privacy-conscious everyday user.** Wants fewer identifiers attached to
their browsing without configuring anything. Installs, and the product works. Will
uninstall immediately if a site breaks.

**Secondary — the sharer.** Copies links into chat, email, documents, issue trackers,
citations. Wants the link they copy to be short and free of their own click IDs. Served
directly by in-page rewriting: the href they copy is already clean.

**Tertiary — the rule contributor.** Notices a new tracking parameter and wants to add
it. Served by `url-no-track-me` being a plain, schema-validated, test-covered data repo
that accepts pull requests from people who are not extension developers.

**Quaternary — the downstream consumer.** Another tool (a link shortener, a CLI, a
bookmark manager, a Chrome extension someone else writes) wants the catalog. Served by
the rules repo being separately released, licensed and versioned.

### Use cases

| # | Situation | Expected behavior |
|---|---|---|
| U1 | Opens a newsletter in webmail; every link has `utm_*` and `mkt_tok` | Hovering shows the clean URL; clicking navigates to the clean URL |
| U2 | Right-clicks a Facebook link and picks "Copy Link" | Clipboard receives the unwrapped destination, not `l.facebook.com/l.php?u=…` |
| U3 | Copies a YouTube share link from a page | `?si=` is gone; `?v=` and `?t=` are preserved |
| U4 | Clicks a Google Ads result | Goes to the advertiser's real URL in one hop where the wrapper permits it; otherwise left alone rather than broken |
| U5 | A site's checkout stops working after install | Popup shows a one-click "pause on this site"; the site is remembered and never touched again |
| U6 | A new tracker appears in the wild | A rule lands in `url-no-track-me`, is released, and reaches installed extensions within a day — no AMO submission needed |

---

## 4. Goals and non-goals

### Goals

- **G1** Remove known tracking parameters from link URLs in the page, so that hover,
  copy, bookmark, drag and click all see the clean URL.
- **G2** Unwrap known redirector links to their destination, in one hop, safely.
- **G3** Never break a page. A false positive that removes a functional parameter is a
  worse failure than a false negative that leaves a tracker in place.
- **G4** Keep the rule catalog in a separate, open, reusable repository with a formal
  schema, CI validation and a regression corpus.
- **G5** Deliver rule updates to installed extensions without an AMO release, without
  executing any remote code, and without any way for the update channel to compromise
  the extension.
- **G6** Collect nothing. No analytics, no error reporting, no remote logging, no
  identifiers. Browsing history never leaves the machine.
- **G7** Impose no perceptible cost on page load or interaction.

### Non-goals for v1.0

Explicitly out of scope, each with the reason:

- **N1 Request interception / blocking.** No `declarativeNetRequest`, no blocking
  `webRequest`. Cleaning happens at the link, not at the request. This keeps permissions
  narrow and the AMO review simple. *Revisit in v2 for JS-driven navigations that never
  touch an `<a href>`.*
- **N2 Clipboard and share-sheet interception.** Not needed — because the href in the
  DOM is already clean, the browser's own "Copy Link" copies clean text. Intercepting
  the clipboard would add a permission for a benefit already obtained.
- **N3 Chrome / Edge / Safari.** Firefox-only. Cross-browser is a v2 conversation and a
  different engineering shape.
- **N4 Ad or content blocking.** This is not a blocker. It does not stop requests, hide
  elements, or interfere with advertising beyond removing identifiers from link URLs.
- **N5 Cookie, fingerprint, or referrer-header defenses.** Firefox's own ETP covers
  these; duplicating them is out of scope.
- **N6 Cleaning the address bar of the page you are already on.** Rewriting the current
  URL after navigation is a `history.replaceState` intervention with real breakage risk
  on single-page apps. *Deferred; evaluated in v2 behind an off-by-default setting.*

---

## 5. Product principles

1. **Conservative by default.** When a rule's safety is uncertain, it does not run.
   Under-cleaning is recoverable; breaking a user's bank site is not.
2. **The link in the page is the product surface.** Whatever the user does with a link —
   look at it, copy it, click it — should get the clean form. One intervention, every
   benefit.
3. **Data is not code.** Remote rules are declarative data interpreted by bundled,
   reviewed code. No remote regex is compiled unvetted; no remote string is ever
   evaluated.
4. **Silence is the success state.** No badges demanding attention, no upsells, no
   onboarding tour. A counter for the curious, and otherwise nothing.
5. **Escape hatches are one click away.** Every user must be able to turn it off for a
   site faster than they can uninstall it.

---

## 6. Architecture: the two-repo split

```
┌──────────────────────────────────────────────┐
│  url-no-track-me  (GitHub, open source)      │
│                                              │
│  rules/          catalog + generic patterns  │
│  schema/         JSON Schema for rules       │
│  tests/          dirty → clean URL corpus    │
│  CI              validate + regress + sign   │
│                          │                   │
│                          ▼                   │
│  GitHub Release:  rules.json + rules.json.sig│
└──────────────────────────┬───────────────────┘
                           │  HTTPS GET, every 24 h
                           │  Ed25519 signature verified
                           ▼
┌──────────────────────────────────────────────┐
│  please-no-track-me  (Firefox MV3 extension) │
│                                              │
│  rules/rules.json   ← snapshot vendored      │
│                       at build time          │
│  background.js      update, verify, swap     │
│  engine.js          the cleaning engine      │
│  content.js         DOM rewriting            │
│  popup / options    UI + allowlist           │
└──────────────────────────────────────────────┘
```

**Why split.** Three reasons, in order of weight:

1. **Release cadence.** Tracker discovery is continuous; extension review is not. A rule
   fix should ship in hours, an extension change in weeks.
2. **Reviewability.** A pull request that adds `"vero_id"` to a list is reviewable by
   anyone. A pull request against extension internals is not. The split lets the
   contributor pool for rules be much larger than the contributor pool for code.
3. **Reuse.** The catalog has value beyond this extension. Publishing it as a
   standalone, permissively licensed dataset lets other tools consume it.

**The contract between them** is one file — `rules.json` — with a versioned schema, a
signature, and a compatibility policy (§9.5). Neither repo depends on the other's
internals.

---

## 7. Feature specification

### 7.1 In-page link rewriting

**F1.1** On every page, in every frame, the extension scans for link-bearing elements
and rewrites their URLs to the cleaned form:

- `a[href]`
- `area[href]`

`form[action]`, `iframe[src]` and resource URLs are **not** touched in v1 — they are
functional URLs with a far higher breakage risk and no sharing benefit.

**F1.2** The `ping` attribute is removed from `<a>` elements. It exists solely to fire a
background POST to a tracking endpoint on click and has no user-facing function.

**F1.3** Rewriting is applied:
- on initial page parse, at `document_idle`;
- on DOM mutation (nodes added, `href` attributes changed), batched;
- inside open shadow roots discovered during traversal.

**F1.4** Rewriting is **idempotent and non-destructive**. A cleaned element is marked so
it is not reprocessed. The original URL is retained in memory (a `WeakMap`, not a DOM
attribute) for the session so that "pause on this site" can restore links without a
reload.

**F1.5** If cleaning would produce an invalid or empty URL, the original is left in
place. Any exception in the engine leaves the element untouched. Failure mode is always
"do nothing".

**F1.6 Performance budget.** Rewriting must cost less than **5 ms per 1,000 links** on a
mid-range laptop, must not force synchronous layout, and must not delay first paint.
Mutation handling is coalesced through `requestIdleCallback` with a `setTimeout`
fallback, and a per-batch time slice yields back to the browser if exceeded.

**F1.7** Pages the extension never touches: `about:*`, `moz-extension://*`,
`view-source:`, the AMO domains (`addons.mozilla.org`), and any origin on the user's
allowlist.

### 7.2 Redirector unwrapping

**F2.1** When a link's host matches a redirector rule, the extension extracts the
destination from the named parameter (or path position), decodes it, and replaces the
link with the destination — which is then itself cleaned by the parameter rules.

**F2.2 Safety constraints.** An unwrap is abandoned, leaving the original link, if any
of the following hold:
- the extracted value does not parse as an absolute URL;
- its scheme is not `http:` or `https:` (blocks `javascript:`, `data:`, `file:`);
- unwrapping recurses more than **3** levels;
- the redirector rule is not marked as safe to unwrap in the catalog.

**F2.3** Redirectors that are known to require the wrapper for the click to function
(signed exit links, paywalled proxies, affiliate links where removing the wrapper
changes the commercial outcome) are catalogued as **not unwrappable** and are left
alone. The catalog carries this distinction explicitly; the extension does not guess.

**F2.4** Unwrapping preserves the fragment (`#…`) of the destination URL, not of the
wrapper.

### 7.3 Conservative cleaning and the allowlist

**F3.1** A parameter is removed only if a rule matches it *and* that rule's confidence
tier is enabled. Two tiers ship:

- **`certain`** — the parameter has no function other than tracking, anywhere.
  Examples: `utm_*`, `fbclid`, `gclid`, `msclkid`, `mc_eid`. **Enabled by default.**
- **`contextual`** — tracking on the domains where it is catalogued, functional
  elsewhere. Examples: `ref` on Amazon, `si` on YouTube, `source` on many CMSes but a
  real query field on others. Applied **only** on the domains the rule names. **Enabled
  by default, scoped.**

A third tier exists in the schema for rules that are useful but riskier:

- **`aggressive`** — broad shape matching (`*_source`, `*_campaign`, `*clid`) applied to
  any domain. **Disabled by default**, exposed as a single opt-in switch in options.

**F3.2 Never-strip list.** The catalog carries an explicit list of parameters that must
never be removed regardless of shape match — `q`, `id`, `page`, `token`, `code`,
`state`, `redirect_uri`, `sig`, `t`, `v`, and the OAuth/OIDC parameter set. This list is
checked *after* pattern matching and wins.

**F3.3 Per-site allowlist.** The toolbar popup offers "Pause on this site". Adding a
site:
- stops all rewriting on that origin, immediately and for future visits;
- restores the original links on the current page without a reload;
- is stored locally and listed in options, where it can be removed.

**F3.4 Global pause.** A single switch in the popup disables everything until re-enabled.

**F3.5 Report breakage.** Alongside "Pause on this site", a "Report a problem" link
opens a pre-filled GitHub issue in `url-no-track-me` containing the site's hostname, the
rules that matched, and the extension and rules versions. Nothing is sent
automatically — the user sees the text and submits it themselves, or does not.

### 7.4 Toolbar popup

Shows, for the active tab only:

- links cleaned and parameters removed on this page (session-only, never persisted);
- which redirectors were unwrapped, if any;
- **Pause on this site** toggle;
- **Pause everywhere** toggle;
- rules version and last-updated timestamp;
- **Report a problem**.

The toolbar badge shows the per-tab count of cleaned links, and can be turned off.

### 7.5 Options page

- Confidence tiers: `contextual` on/off, `aggressive` on/off (default off).
- Redirector unwrapping: on/off.
- `ping` attribute removal: on/off.
- Badge counter: on/off.
- Allowlist: view, add, remove, export/import as plain text.
- Rule updates: on/off, update frequency, **Check now**, current version, source URL.
- **Reset to defaults.**

### 7.6 Rule updates

**F6.1** The extension ships with a `rules.json` snapshot vendored at build time. It is
fully functional offline and on first run with no network.

**F6.2** Every 24 hours (configurable; jittered to spread load), the background script
fetches the latest release asset from `url-no-track-me`.

**F6.3** A fetched bundle is adopted only if **all** of the following pass:
1. HTTPS, from the configured origin, with a size ceiling (1 MB);
2. valid JSON;
3. **Ed25519 signature verifies** against the public key compiled into the extension
   (via WebCrypto — see §8.6);
4. schema version is compatible with this extension build (§9.5);
5. it validates against the bundled JSON Schema;
6. its `version` is strictly newer than the currently active bundle;
7. it passes a built-in smoke corpus — a handful of URLs whose expected cleaned form is
   hard-coded in the extension. If a rule update would mangle `https://example.com/?q=1`,
   it is rejected.

**F6.4** A bundle failing any check is discarded and the previous bundle stays active.
Failures are counted locally and surfaced in options as "last update failed"; they are
never reported anywhere.

**F6.5** The user can roll back to the bundled snapshot from options at any time.

---

## 8. Technical design — the extension

### 8.1 Manifest and structure

Manifest V3 for Firefox. Firefox MV3 uses a **non-persistent event page**, not a service
worker, which is what this design assumes.

```
please-no-track-me/
  manifest.json
  src/
    background.js      event page: alarms, update fetch, verify, swap, message hub
    engine/
      clean.js         pure URL → URL cleaning; no DOM, no browser API
      match.js         host/param matching, glob compilation, never-strip check
      unwrap.js        redirector extraction with the §7.2 safety gates
    content/
      content.js       DOM traversal, MutationObserver, rewriting
    ui/
      popup.html/.js
      options.html/.js
  rules/
    rules.json         vendored snapshot from url-no-track-me
    rules.schema.json  vendored schema
    pubkey.json        Ed25519 public key (raw, in-source)
  test/
    engine.test.js     runs the url-no-track-me corpus against clean.js
```

`engine/clean.js` is deliberately pure and dependency-free: the same module runs in the
extension, in unit tests, and in the rules repo's CI as the reference implementation.

### 8.2 Permissions and their justification

| Permission | Why | AMO justification |
|---|---|---|
| `storage` | Settings, allowlist, cached rules | Local only |
| `alarms` | Daily rule update check | No other scheduler in an event page |
| `<all_urls>` host permission | The content script must run wherever links appear | Unavoidable for the core function; no data is read from pages beyond link URLs, and none leaves the browser |
| `https://github.com/generalandrew/url-no-track-me/*` (or the release CDN host) | Fetch rule updates | Single fixed origin, data only, signature-verified |

Not requested: `tabs` (the active tab's URL comes from the content script's own
message), `webRequest`, `declarativeNetRequest`, `clipboardWrite`, `cookies`, `history`,
`downloads`.

### 8.3 The cleaning engine

```
clean(url, ctx) → { url, removed[], unwrapped? }

  1. parse; bail out on non-http(s), on opaque origins, on javascript:/data:
  2. if host ∈ redirector catalog and unwrapping enabled:
         candidate ← extract per rule
         if passes §7.2 gates: url ← candidate; recurse (depth ≤ 3)
  3. path rules for this host (e.g. Amazon /ref=…) → rewrite path
  4. for each query parameter:
         if name ∈ never-strip           → keep
         else if certain-tier match      → drop
         else if contextual match ∧ host in scope → drop
         else if aggressive enabled ∧ shape match → drop
         else                            → keep
  5. fragment parameters: same treatment, only for hosts with a fragment rule
  6. reserialize preserving original parameter order and encoding of survivors;
     drop the '?' entirely if no parameters remain
  7. if the result fails to parse, return the input unchanged
```

**Encoding discipline.** Parameters are split on `&`/`=` without decoding, matched on
the decoded name, and re-emitted with their original raw value bytes. Round-tripping
through `URLSearchParams` is avoided because it normalises `+`, `%20` and repeated keys
in ways that break signed URLs.

**Glob compilation.** Remote patterns use a restricted glob (`*` and `?` only, max
length 64, max 4 wildcards) compiled internally to an anchored regex. Raw regular
expressions from the rules file are **not supported by the schema**, which removes both
the ReDoS surface and the "is this remote code?" review question.

### 8.4 Content script

```
document_idle
  ↓
initial sweep: querySelectorAll('a[href], area[href]') + open shadow roots
  ↓
MutationObserver { childList, subtree, attributes, attributeFilter: ['href','ping'] }
  ↓
batch queue → requestIdleCallback → process with a time slice
  ↓
per element: WeakSet check → engine.clean() → set href if changed → record original
```

- `all_frames: true`, `match_about_blank: true`.
- Cleaned elements go into a `WeakSet`; the observer's own writes are ignored by
  comparing against the value the script last wrote.
- The rules bundle and settings are pushed to content scripts by the background page on
  change, so no per-page message round-trip is on the hot path.
- Counts are reported to the background page throttled at 1 Hz, per tab, in memory only.

**Known limitation.** Sites that attach `mousedown`/`click` handlers to rebuild the URL
at click time (Google Search historically, some SPAs) can re-add parameters after the
rewrite. The `ping` removal and the rewritten href cover hover, copy and middle-click on
those sites; full coverage of handler-rebuilt navigations requires request interception
and is deferred to v2 (N1).

### 8.5 Storage

| Key | Area | Contents |
|---|---|---|
| `settings` | `storage.sync` | Tiers, toggles, badge, update interval |
| `allowlist` | `storage.sync` | Array of origins |
| `rules.active` | `storage.local` | The active bundle |
| `rules.meta` | `storage.local` | Version, fetched-at, source, last failure |

Nothing else is stored. Per-tab counters live in memory and die with the tab. No
browsing history is written to disk in any form.

### 8.6 Update integrity

`url-no-track-me` CI signs each released `rules.json` with an Ed25519 key held as a
repository secret. The corresponding public key is compiled into the extension and
therefore changes only through an AMO-reviewed release.

Verification uses `crypto.subtle.importKey('raw', …, {name:'Ed25519'}, …)` and
`crypto.subtle.verify` over the exact bytes fetched — canonicalisation is avoided by
signing the byte stream that is served, not a re-serialisation of it.

Consequences of this design:
- A compromise of the rules repo, the release, or the transport cannot inject rules — it
  can at most withhold updates.
- A compromise of the signing key can still ship bad *data*, but never *code*, and the
  smoke corpus (F6.3.7) and never-strip list (F3.2) bound the damage.

---

## 9. Data contract — `url-no-track-me`

The rules repository is a product in its own right, with its own README, license
(CC0-1.0 for the data, MIT for the tooling), issue templates and release notes.

### 9.1 Repository layout

```
url-no-track-me/
  rules/
    params.certain.json      globally tracking-only parameters
    params.contextual.json   per-domain parameter rules
    params.aggressive.json   shape patterns, opt-in
    redirectors.json         wrapper hosts and destination extraction
    paths.json               path-segment rules (Amazon /ref=, etc.)
    never-strip.json         the protected parameter list
  schema/
    rules.schema.json        JSON Schema (draft 2020-12)
  tests/
    corpus/*.jsonl           dirty → clean pairs, one per line
    invariants.jsonl         URLs that must come back byte-identical
  tools/
    build.mjs                merge + normalise → dist/rules.json
    validate.mjs             schema + lint + duplicate detection
    regress.mjs              run corpus through the reference engine
  dist/                      built artifacts (gitignored; attached to releases)
  CONTRIBUTING.md  GOVERNANCE.md  CHANGELOG.md  LICENSE
```

### 9.2 Rule schema (illustrative)

```jsonc
// params.contextual.json
{
  "schemaVersion": "1.0",
  "rules": [
    {
      "id": "youtube-si",
      "param": "si",
      "tier": "contextual",
      "domains": ["youtube.com", "youtu.be", "music.youtube.com"],
      "includeSubdomains": true,
      "evidence": "Share-sheet attribution token; playback unaffected when removed.",
      "added": "2026-09-04",
      "source": "https://github.com/generalandrew/url-no-track-me/issues/12"
    }
  ]
}
```

```jsonc
// redirectors.json
{
  "schemaVersion": "1.0",
  "rules": [
    {
      "id": "facebook-lphp",
      "hosts": ["l.facebook.com", "lm.facebook.com", "l.messenger.com"],
      "pathPrefix": "/l.php",
      "destination": { "kind": "param", "name": "u", "encoding": "uri" },
      "unwrappable": true,
      "evidence": "Wrapper is a logging hop; destination is reachable directly."
    },
    {
      "id": "example-signed-exit",
      "hosts": ["exit.example.com"],
      "destination": { "kind": "param", "name": "url", "encoding": "uri" },
      "unwrappable": false,
      "evidence": "Wrapper carries an HMAC the destination validates; unwrapping 403s."
    }
  ]
}
```

Every rule carries `id`, `tier` (or `unwrappable`), `evidence` and `added`. **A rule
without evidence does not merge** — the field is what makes the catalog reviewable by
people who did not write it.

### 9.3 Test corpus

`tests/corpus/*.jsonl` — one object per line:

```json
{"in":"https://ex.com/a?utm_source=x&id=7","out":"https://ex.com/a?id=7","why":"utm stripped, id kept"}
```

`tests/invariants.jsonl` is the more important file: URLs that must survive **unchanged**
— OAuth callbacks, signed S3 URLs, search queries, paginated listings, payment returns.
The invariant corpus is the concrete form of principle #1, and every contextual or
aggressive rule proposal must add to it.

### 9.4 CI gates

Every pull request must pass:

1. **Schema validation** of every rules file.
2. **Lint** — duplicate ids, duplicate params within a domain scope, missing `evidence`,
   malformed domains, glob patterns exceeding the complexity limits.
3. **Never-strip conflict check** — a rule that would strip a protected parameter fails.
4. **Regression** — the full corpus and the full invariant set, run through the reference
   engine vendored from the extension.
5. **Diff summary** — the CI comment states, in plain language, exactly which parameters
   this PR starts or stops removing.

### 9.5 Versioning, releases and compatibility

- The bundle carries **`schemaVersion` (major.minor)** and **`version` (date-based, e.g.
  `2026.09.04`)**.
- The extension accepts a bundle whose `schemaVersion` **major** equals its own and whose
  **minor** is less than or equal to its own **plus tolerance**: unknown optional fields
  are ignored, unknown rule kinds are skipped. A major bump means old extensions keep
  their last-known-good bundle and stop updating until they are themselves updated —
  fail-safe, never fail-open.
- Tagging a release runs `build → validate → regress → sign → publish`, attaching
  `rules.json` and `rules.json.sig` to a GitHub Release. The extension fetches the
  `latest` release asset.
- The extension repo has a scheduled job that vendors the newest released bundle into
  `rules/rules.json` and opens a PR, so each AMO release ships a fresh snapshot.

> **Note on scope.** Published, signed release artifacts were not among the rules-repo
> items selected during scoping, but the chosen delivery model (bundled snapshot +
> periodic fetch) requires a stable, verifiable artifact to fetch. They are therefore
> included as a dependency of that decision rather than as an independent one.

### 9.6 Governance

`GOVERNANCE.md` states the review policy:

- Two categories of change: **`certain` additions** (one maintainer approval) and
  **`contextual`/`aggressive`/redirector additions** (evidence required plus an invariant
  test, one maintainer approval).
- Removals of rules that break sites are **fast-tracked** — a breakage report with a
  reproduction can revert a rule immediately, and the discussion happens afterwards.
- Issue templates: *New tracker spotted*, *A site broke*, *Rule is too aggressive*.
- The data is CC0; contributors are asked to confirm their submission is their own
  observation and not copied from another project's licensed rule set.

---

## 10. Privacy and security

**What the extension collects: nothing.** No analytics, no crash reporting, no
identifiers, no remote logging, no "anonymous usage statistics".

**What it sends over the network:** one HTTPS GET per day to a fixed URL in the rules
repository, carrying no query parameters, no headers identifying the user, and no
information about what they browse. This is the only outbound request the extension ever
makes.

**What it reads from pages:** link URLs, from the DOM, in the content script. Page text,
form contents, cookies and storage are never accessed.

**What it stores:** settings, the allowlist, and the rules bundle. Per-tab counters live
in memory only.

**Threat model for the update channel** is covered in §8.6: signature verification means
the update channel can withhold rules but cannot introduce them, and can never introduce
code.

**Security review checklist for each release:** no `eval`, no `Function`, no
`innerHTML` with non-literal content, no remote script, no `RegExp` built from remote
strings, CSP left at the MV3 default, all rule input treated as untrusted.

---

## 11. Success metrics

No telemetry means success is measured from public and local signals only:

| Metric | Source | Target at 6 months |
|---|---|---|
| AMO installs (active daily users) | AMO stats | 2,000 |
| AMO rating | AMO | ≥ 4.5 with ≥ 25 reviews |
| Breakage reports open at any time | `url-no-track-me` issues | < 5, median time-to-revert < 24 h |
| Rules coverage | rule count + corpus size | ≥ 400 parameters, ≥ 1,000 corpus cases |
| External contributors to the rules repo | GitHub | ≥ 10 distinct |
| Downstream consumers of the catalog | GitHub dependents / issues | ≥ 1 outside this project |
| Update reachability | manual sample | a rule merged today is live in installs within 48 h |

The leading indicator for the whole product is the **ratio of breakage reports to
installs**. If it rises, the default tiers are too aggressive, regardless of what the
other numbers say.

---

## 12. Milestones

**M0 — Foundations (week 1).** Both repos initialised. This document. Rules schema
drafted. `clean.js` reference engine with a first corpus. No UI.

**M1 — Cleaning works (weeks 2–3).** Content script, MutationObserver, engine wired to
the bundled snapshot. `certain` tier only. Manual verification against a hand-built test
page. Loadable as a temporary add-on.

**M2 — Redirectors and safety (week 4).** Unwrapping with all §7.2 gates. Never-strip
list. Invariant corpus in CI. `contextual` tier enabled.

**M3 — UI and control (week 5).** Popup, badge, per-site allowlist, options page,
breakage reporting link.

**M4 — Update channel (week 6).** Release pipeline in `url-no-track-me` with signing.
Background fetch, verification, smoke corpus, rollback. End-to-end test: merge a rule,
see it live in a running profile.

**M5 — AMO submission (week 7).** Permission justifications, listing copy, screenshots,
privacy policy, source-availability statement. Submit.

**M6 — Post-launch (weeks 8–12).** Breakage triage cadence, corpus growth, contributor
onboarding, decision on v2 scope (N1 request interception, N6 address-bar cleaning,
N3 cross-browser).

---

## 13. Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | A rule breaks a high-traffic site; users uninstall before reporting | Medium | High | Conservative default tiers; invariant corpus; one-click site pause offered in the popup before the user reaches the uninstall button; fast-track reverts |
| R2 | AMO reviewer treats the remote rules fetch as remote code | Medium | High | Data-only schema with no regex or executable field; signature verification; explicit reviewer note; bundled snapshot means the extension is fully functional if the fetch is disallowed |
| R3 | Content script cost is visible on link-heavy pages | Low | Medium | Time-sliced batching, `requestIdleCallback`, `WeakSet` dedupe, explicit budget in F1.6 with a benchmark in CI |
| R4 | Sites rebuild URLs at click time, so cleaning appears not to work | High | Medium | Documented limitation; `ping` removal and clean hover/copy still deliver most of the value; v2 request interception is the real fix |
| R5 | Rules repo attracts no contributors and stagnates | Medium | Medium | Very low barrier to contribute (a JSON line + a test line); issue templates that turn a user complaint into a near-complete PR |
| R6 | Signing key compromise | Low | High | Key in CI secrets only, never on a developer machine; rotation requires an extension release, which is the intended cost; smoke corpus and never-strip list bound the blast radius |
| R7 | Overlap with ClearURLs makes the product look redundant | Medium | Low | The differentiators are in-page rewriting and the standalone catalog; the listing copy leads with both |
| R8 | Unwrapping a wrapper that carries required auth breaks the click | Medium | Medium | `unwrappable: false` in the catalog, absolute rejection of anything unparsable, depth limit, and evidence required on every redirector rule |

---

## 14. Open questions

1. **Release asset vs. CDN.** Fetching a GitHub Release asset is the simplest verifiable
   source; jsDelivr would be cheaper and faster but adds a third party to the chain.
   Signature verification makes the transport untrusted either way, so this is a
   performance and reliability question, not a security one. *Decide at M4.*
2. **Should `contextual` be on by default?** This document says yes, because most of the
   real-world benefit (YouTube `si`, Amazon `ref`) lives there. Revisit if the
   breakage-to-install ratio moves.
3. **Fragment-parameter cleaning** (`#utm_source=…`) is specified but rare. Ship in M2 or
   defer to post-launch based on corpus evidence.
4. **Extension name.** `please-no-track-me` is the repository and working name. The AMO
   listing name is decided at M5 and need not match.

---

## 15. Appendix — decisions of record

| Decision | Choice | Rationale |
|---|---|---|
| Intervention point | In-page link rewriting + redirector unwrapping | Cleans what you see, copy and click in one place; no request-blocking permissions |
| Rule source | Separate open-source repo `url-no-track-me` | Independent release cadence, wider contributor pool, reusable dataset |
| Rule delivery | Bundled snapshot + periodic signed fetch | Works offline and on day one; rules ship in hours, not weeks |
| Breakage posture | Conservative defaults + per-site allowlist | A false positive costs a user; a false negative costs a parameter |
| Platform | Firefox MV3, AMO listed | Firefox retains the capabilities this needs; AMO gives distribution and auto-update |
| Rules repo scope | Schema + CI validation, regression corpus, contribution governance | Makes the data trustworthy and the project contributable |
| Telemetry | None | The product's premise forbids it |
