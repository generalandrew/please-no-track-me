// M2 assertions: the visit registry, the loop guard and the navigation handler.
// PRODUCT.md §7, §8.1, §8.2, §11.2. Clock and seeds are injected, so every check is
// exact — nothing here waits or sleeps.

import { loadData } from '../../tools/load-data.mjs';
import { registrableDomain, sameSite } from '../../src/engine/domain.js';
import { createRegistry } from '../../src/visits.js';
import { createGuard } from '../../src/guard.js';
import { handleNavigation, DEFAULT_SETTINGS } from '../../src/navigation.js';
import { ga4Channel } from '../ga4-channels.mjs';

const data = loadData();
let failures = 0, checks = 0;
const fail = (name, detail) => { failures++; console.log(`  FAIL  ${name}\n        ${detail}`); };
const check = (cond, name, detail = '') => (cond ? checks++ : fail(name, detail));
const section = (n) => console.log(`\n${n}`);
const q = (u, k) => new URL(u).searchParams.get(k);
const names = (u) => [...new URL(u).searchParams.keys()];

// A world: fake clock, counting seeds, fresh registry and guard.
function world() {
  let t = 1_700_000_000_000;         // 2023-11-14, a real date so campaigns are sane
  let n = 0;
  const now = () => t;
  const registry = createRegistry({ data, now, seedFn: () => `seed-${++n}` });
  const guard = createGuard({ now });
  const ctx = (settings = DEFAULT_SETTINGS) => ({ registry, guard, data, settings });
  return { registry, guard, ctx, tick: (ms) => { t += ms; }, now };
}
const MIN = 60_000;
const ENTRY = 'https://www.example.com/story?utm_source=nytimes&utm_medium=referral&utm_campaign=old-2019&fbclid=IwAR9xQlmBz3kKpQ7vN2&topic=cities';

// ------------------------------------------------------------ registrable domain
section('registrable domain (§7.1, §16.3)');
for (const [host, want] of [
  ['www.example.com', 'example.com'], ['shop.example.co.uk', 'example.co.uk'],
  ['a.b.c.example.com', 'example.com'], ['alice.github.io', 'alice.github.io'],
  ['github.io', 'github.io'], ['localhost', 'localhost'], ['127.0.0.1', '127.0.0.1'],
  ['[::1]', '[::1]'], ['news.bbc.co.uk.', 'bbc.co.uk'], ['WWW.Example.COM', 'example.com'],
]) check(registrableDomain(host) === want, `domain:${host}`, `got ${registrableDomain(host)}, want ${want}`);
check(sameSite('www.example.com', 'shop.example.com'), 'same-site:subdomains');
check(!sameSite('example.com', 'example.org'), 'same-site:different-tld');
check(!sameSite('alice.github.io', 'bob.github.io'), 'same-site:private-suffix');

// --------------------------------------------------------------------- registry
section('visit registry (§7.1)');
{
  const w = world();
  check(!w.registry.isActive('example.com'), 'starts-empty');
  const v = w.registry.begin('example.com', { incomingNames: ['fbclid'] });
  check(w.registry.isActive('example.com'), 'begin-activates');
  check(w.registry.begin('example.com') === v, 'begin-is-idempotent');
  check(['organic_social', 'paid_social'].includes(v.persona.channel), 'persona-honours-token', v.persona.channel);
  check(w.registry.get('example.com').persona === v.persona, 'persona-stable-across-get');

  w.registry.attachTab('example.com', 7);
  w.tick(31 * MIN);
  check(w.registry.isActive('example.com'), 'tab-open-keeps-alive-past-ttl');
  w.registry.detachTab(7);
  w.tick(29 * MIN);
  check(w.registry.isActive('example.com'), 'alive-29min-after-last-tab');
  w.tick(2 * MIN);
  check(!w.registry.isActive('example.com'), 'expired-31min-after-last-tab');
  check(w.registry.begin('example.com').seed !== v.seed, 'new-visit-new-seed');

  // Tab moves between visits.
  w.registry.begin('other.org');
  w.registry.attachTab('example.com', 9);
  w.registry.attachTab('other.org', 9);
  check(w.registry.get('example.com').tabs.size === 0 && w.registry.get('other.org').tabs.size === 1,
    'tab-belongs-to-one-visit');

  // Emitted-URL bookkeeping is one-shot.
  w.registry.markEmitted('example.com', 'https://example.com/?x=1');
  check(w.registry.takeEmitted('https://example.com/?x=1') === true, 'emitted-taken-once');
  check(w.registry.takeEmitted('https://example.com/?x=1') === false, 'emitted-not-taken-twice');

  // personaFor reserves the seed the eventual visit will use (M3 hook).
  const early = w.registry.personaFor('later.net', ['gclid']);
  const later = w.registry.begin('later.net', { incomingNames: ['gclid'] });
  check(early.seed === later.seed && early.source === later.persona.source, 'personaFor-reserves-seed');

  const snap = w.registry.snapshot();
  check(snap.length > 0 && snap.every((s) => !('seed' in s)), 'snapshot-has-no-seeds');
  w.tick(60 * MIN);
  check(w.registry.sweep() >= 1, 'sweep-drops-expired');
}

// ------------------------------------------------------------------------ guard
section('loop guard (§8.1 F1.6)');
{
  const w = world();
  check(w.guard.allow(1, 'r1').ok, 'first-allowed');
  check(w.guard.allow(1, 'r1').reason === 'seen-request', 'same-request-refused');
  check(w.guard.allow(1, 'r2').ok && w.guard.allow(1, 'r3').ok, 'three-in-window-allowed');
  check(w.guard.allow(1, 'r4').reason === 'rate-limited', 'fourth-trips');
  check(w.guard.isDisabled(1) && w.guard.allow(1, 'r5').reason === 'disabled', 'tab-stays-disabled');
  check(w.guard.allow(2, 'r6').ok, 'other-tab-unaffected');
  w.guard.reset(1);
  check(w.guard.allow(1, 'r7').ok, 'reset-re-enables');
  const w2 = world();
  w2.guard.allow(1, 'a'); w2.guard.allow(1, 'b'); w2.guard.allow(1, 'c');
  w2.tick(11_000);
  check(w2.guard.allow(1, 'd').ok, 'window-slides');
}

// --------------------------------------------------------------- navigation: entry
section('navigation — entry substitutes, once (§7.3, §8.1)');
{
  const w = world();
  const r = handleNavigation({ url: ENTRY, tabId: 1, requestId: 'a' }, w.ctx());
  check(r.action === 'substitute' && r.reason === 'entry', 'entry-substitutes', `${r.action}/${r.reason}`);
  check(typeof r.redirectUrl === 'string' && r.redirectUrl !== ENTRY, 'entry-redirects');
  check(JSON.stringify(names(r.redirectUrl)) === JSON.stringify(names(ENTRY)), 'names-order-count-preserved');
  check(q(r.redirectUrl, 'topic') === 'cities', 'untracked-param-untouched');
  check(q(r.redirectUrl, 'utm_source') !== 'nytimes' && q(r.redirectUrl, 'fbclid') !== q(ENTRY, 'fbclid'), 'values-changed');
  check(q(r.redirectUrl, 'fbclid').length === q(ENTRY, 'fbclid').length, 'fbclid-shape-preserved');
  const ga4 = ga4Channel({ source: q(r.redirectUrl, 'utm_source'), medium: q(r.redirectUrl, 'utm_medium') });
  check(ga4 !== 'Unassigned' && ga4 === r.persona.ga4Channel, 'record-lands-in-named-channel', ga4);
  check(['Organic Social', 'Paid Social'].includes(ga4), 'fbclid-means-social', ga4);
  check(!/2019/.test(q(r.redirectUrl, 'utm_campaign')), 'stale-campaign-year-gone', q(r.redirectUrl, 'utm_campaign'));

  const v = w.registry.get('example.com');
  check(v && v.persona.source === q(r.redirectUrl, 'utm_source'), 'visit-persona-matches-record');
  check(v.entry && v.entry.to === r.redirectUrl, 'visit-remembers-entry');
  check(v.tabs.has(1), 'tab-attached');

  // The browser now requests the redirect target: recognised, not rewritten again.
  const r2 = handleNavigation({ url: r.redirectUrl, tabId: 1, requestId: 'b' }, w.ctx());
  check(r2.action === 'passthrough' && r2.reason === 'emitted', 'follow-up-passes-through', `${r2.action}/${r2.reason}`);
  check(!r2.redirectUrl, 'follow-up-no-redirect');
}

// ------------------------------------------------------------ navigation: interior
section('navigation — interior strips (§8.2)');
{
  const w = world();
  handleNavigation({ url: ENTRY, tabId: 1, requestId: 'a' }, w.ctx());
  const inner = 'https://shop.example.com/list?utm_source=sidebar&utm_medium=link&topic=cities';
  const r = handleNavigation({ url: inner, tabId: 1, requestId: 'c' }, w.ctx());
  check(r.action === 'strip' && r.reason === 'interior', 'interior-strips', `${r.action}/${r.reason}`);
  check(r.redirectUrl === 'https://shop.example.com/list?topic=cities', 'interior-result', r.redirectUrl);
  check(handleNavigation({ url: r.redirectUrl, tabId: 1, requestId: 'd' }, w.ctx()).reason === 'emitted', 'interior-follow-up-recognised');

  const clean = handleNavigation({ url: 'https://www.example.com/about', tabId: 1, requestId: 'e' }, w.ctx());
  check(clean.action === 'passthrough' && clean.reason === 'no-query', 'clean-interior-passthrough');

  // A visit that began with a clean URL still counts: the next tracked navigation is interior.
  const w2 = world();
  handleNavigation({ url: 'https://news.site/', tabId: 3, requestId: 'x' }, w2.ctx());
  check(w2.registry.isActive('news.site'), 'clean-entry-opens-visit');
  const r3 = handleNavigation({ url: 'https://news.site/a?utm_source=x&utm_medium=y', tabId: 3, requestId: 'y' }, w2.ctx());
  check(r3.action === 'strip', 'tracked-nav-after-clean-entry-is-interior', `${r3.action}/${r3.reason}`);

  // After expiry the same domain is an entry again, with a different persona.
  const w3 = world();
  const first = handleNavigation({ url: ENTRY, tabId: 1, requestId: 'a' }, w3.ctx());
  w3.registry.detachTab(1);
  w3.tick(31 * MIN);
  const second = handleNavigation({ url: ENTRY, tabId: 2, requestId: 'b' }, w3.ctx());
  check(second.action === 'substitute', 'expired-visit-is-entry-again', second.reason);
  check(first.redirectUrl !== second.redirectUrl, 'new-visit-new-story');
}

// ------------------------------------------------------------- navigation: refusals
section('navigation — what is never touched (§9.5, §11.2, §8.5)');
{
  const w = world();
  const oauth = 'https://auth.example.com/cb?code=abc&state=xyz&utm_source=x';
  const r = handleNavigation({ url: oauth, tabId: 1, requestId: 'a' }, w.ctx());
  check(r.action === 'passthrough' && r.reason === 'never-touch' && r.guardedBy, 'never-touch-whole-url', `${r.reason}/${r.guardedBy}`);

  const aff = handleNavigation({ url: 'https://www.amazon.com/dp/B01?tag=pub-20&utm_source=email', tabId: 1, requestId: 'b' }, w.ctx());
  check(aff.action === 'passthrough' && aff.reason === 'never-touch', 'affiliate-tag-whole-url');

  const gov = handleNavigation({ url: 'https://www.irs.gov/refunds?utm_source=e&utm_medium=email', tabId: 2, requestId: 'c' }, w.ctx());
  check(gov.action === 'strip' && gov.reason === 'strip-only-origin', 'strip-only-origin-strips', `${gov.action}/${gov.reason}`);
  check(gov.redirectUrl === 'https://www.irs.gov/refunds', 'strip-only-nothing-fabricated', gov.redirectUrl);
  check(w.registry.isActive('irs.gov'), 'strip-only-opens-visit');

  for (const [url, why] of [['ftp://example.com/x?utm_source=a', 'non-http'], ['not a url', 'unparseable']]) {
    const x = handleNavigation({ url, tabId: 1, requestId: 'z' }, w.ctx());
    check(x.action === 'passthrough' && !x.redirectUrl, `refuse:${why}`, x.reason);
  }

  const off = handleNavigation({ url: ENTRY, tabId: 5, requestId: 'd' }, w.ctx({ ...DEFAULT_SETTINGS, allowlist: ['example.com'] }));
  check(off.action === 'passthrough' && off.reason === 'allowlisted', 'allowlist-passthrough');
  const mode = handleNavigation({ url: ENTRY, tabId: 5, requestId: 'e' }, w.ctx({ ...DEFAULT_SETTINGS, siteModes: { 'example.com': 'off' } }));
  check(mode.reason === 'allowlisted', 'site-mode-off');
  const so = handleNavigation({ url: ENTRY, tabId: 6, requestId: 'f' }, w.ctx({ ...DEFAULT_SETTINGS, siteModes: { 'example.com': 'strip-only' } }));
  check(so.action === 'strip' && so.reason === 'site-strip-only' && !q(so.redirectUrl, 'utm_source'), 'site-mode-strip-only', `${so.action}/${so.reason}`);
  const w2 = world();
  const nosub = handleNavigation({ url: ENTRY, tabId: 1, requestId: 'g' }, w2.ctx({ ...DEFAULT_SETTINGS, substitute: false }));
  check(nosub.action === 'strip' && !q(nosub.redirectUrl, 'fbclid'), 'global-substitute-off-strips');
  const dis = handleNavigation({ url: ENTRY, tabId: 1, requestId: 'h' }, w2.ctx({ ...DEFAULT_SETTINGS, enabled: false }));
  check(dis.reason === 'disabled', 'global-disabled');
}

// ----------------------------------------------------------------- guard in situ
section('navigation — the loop guard trips and self-disables (§8.1 F1.6)');
{
  const w = world();
  const results = [];
  for (let i = 1; i <= 5; i++) {
    results.push(handleNavigation({ url: `https://site${i}.com/?utm_source=a&utm_medium=email`, tabId: 1, requestId: `r${i}` }, w.ctx()));
  }
  check(results.slice(0, 3).every((r) => r.action === 'substitute'), 'first-three-rewritten');
  check(results[3].reason === 'guard:rate-limited', 'fourth-rate-limited', results[3].reason);
  check(results[4].reason === 'guard:disabled', 'fifth-tab-disabled', results[4].reason);
  check(w.guard.disabledTabs().some((d) => d.tabId === 1), 'popup-can-see-disabled-tab');
  const other = handleNavigation({ url: 'https://site9.com/?utm_source=a&utm_medium=email', tabId: 2, requestId: 'o' }, w.ctx());
  check(other.action === 'substitute', 'other-tab-still-works');
  check(!results[3].redirectUrl && !results[4].redirectUrl, 'refused-means-no-redirect');
}

// ----------------------------------------------------------- engine-error safety
section('any exception is passthrough (§10.3)');
{
  const w = world();
  const broken = { ...w.ctx(), registry: { takeEmitted() { throw new Error('boom'); } } };
  const r = handleNavigation({ url: ENTRY, tabId: 1, requestId: 'a' }, broken);
  check(r.action === 'passthrough' && r.reason === 'engine-error' && !r.redirectUrl, 'exception-is-passthrough', r.reason);
}

console.log(`\n${checks} checks passed${failures ? `, ${failures} FAILED` : ''}`);
process.exit(failures ? 1 : 0);
