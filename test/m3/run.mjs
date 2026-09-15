// M3 assertions: link decisions against the registry, and the rewriter executed against
// a fake DOM. PRODUCT.md §7.3B, §8.3, §10.5.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { loadData } from '../../tools/load-data.mjs';
import { createRegistry } from '../../src/visits.js';
import { createGuard } from '../../src/guard.js';
import { decideLinks, BATCH_CAP } from '../../src/links.js';
import { handleNavigation, DEFAULT_SETTINGS } from '../../src/navigation.js';
import { ga4Channel } from '../ga4-channels.mjs';
import { FakeRoot, FakeElement, link, fakeObserver, fakeScheduler } from './fakedom.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const data = loadData();
let failures = 0, checks = 0;
const fail = (name, detail) => { failures++; console.log(`  FAIL  ${name}\n        ${detail}`); };
const check = (cond, name, detail = '') => (cond ? checks++ : fail(name, detail));
const section = (n) => console.log(`\n${n}`);
const q = (u, k) => new URL(u).searchParams.get(k);

// Execute the plain-script rewriter and take its factory. This is the file that ships.
const sandbox = { globalThis: null, Date, URL, WeakSet, WeakMap, Set, Map, console };
sandbox.globalThis = sandbox;
vm.runInNewContext(readFileSync(join(ROOT, 'src/content/rewriter.js'), 'utf8'), sandbox);
const createLinkRewriter = sandbox.createLinkRewriter;
check(typeof createLinkRewriter === 'function', 'rewriter-loads-as-plain-script');

function world() {
  let t = 1_700_000_000_000, n = 0;
  const now = () => t;
  const registry = createRegistry({ data, now, seedFn: () => `seed-${++n}` });
  return { registry, guard: createGuard({ now }), ctx: (settings = DEFAULT_SETTINGS) => ({ registry, data, settings }), tick: (ms) => { t += ms; } };
}
const PAGE = 'https://news.example.com/today';

// --------------------------------------------------------------- link decisions
section('decideLinks — interior strips, cross-domain substitutes (§7.3B)');
{
  const w = world();
  const same = 'https://news.example.com/a?utm_source=sidebar&utm_medium=link&x=1';
  const sub = 'https://www.example.com/b?utm_source=sidebar&utm_medium=link';
  const cross = 'https://other.org/c?utm_source=news&utm_medium=referral&fbclid=IwAR9xQlmBz3kKpQ7vN2&t=5';
  const r = decideLinks(PAGE, [same, sub, cross], w.ctx());
  check(r.rewrites[same] === 'https://news.example.com/a?x=1', 'same-domain-stripped', r.rewrites[same]);
  check(r.rewrites[sub] === 'https://www.example.com/b', 'sibling-subdomain-is-interior', r.rewrites[sub]);
  check(r.rewrites[cross] === undefined, 'never-touch-t-exempts-cross-link');
  const cross2 = 'https://other.org/c?utm_source=news&utm_medium=referral&fbclid=IwAR9xQlmBz3kKpQ7vN2';
  const r2 = decideLinks(PAGE, [cross2], w.ctx());
  const out = r2.rewrites[cross2];
  check(typeof out === 'string' && q(out, 'utm_source') !== 'news', 'cross-domain-substituted', out);
  check(['Organic Social', 'Paid Social'].includes(ga4Channel({ source: q(out, 'utm_source'), medium: q(out, 'utm_medium') })), 'link-record-coherent');
  check(r2.counts.substituted === 1 && r.counts.stripped === 2 && r.counts.skipped === 1, 'counts', JSON.stringify([r.counts, r2.counts]));

  // The story the link tells is the story the visit tells when it is clicked.
  const nav = handleNavigation({ url: out, tabId: 1, requestId: 'a' }, { ...w.ctx(), guard: w.guard });
  check(nav.action === 'passthrough' && nav.reason === 'emitted', 'clicked-link-recognised', `${nav.action}/${nav.reason}`);
  const v = w.registry.get('other.org');
  check(v && v.persona.source === q(out, 'utm_source') && v.persona.medium === q(out, 'utm_medium'), 'visit-persona-matches-link');
  // ...and every later link to that domain on any page agrees with it.
  const again = decideLinks(PAGE, ['https://other.org/d?utm_source=x&utm_medium=y'], w.ctx());
  check(again.rewrites['https://other.org/d?utm_source=x&utm_medium=y'] === 'https://other.org/d', 'active-visit-links-are-stripped');
}

section('decideLinks — what is skipped (§8.3 F3.6, §9.5, §11.2)');
{
  const w = world();
  const cases = {
    'mailto:a@b.c': 'non-http', 'javascript:void(0)': 'non-http', 'not a url': 'unparseable',
    'https://auth.other.org/cb?code=1&state=2&utm_source=z': 'never-touch',
    'https://www.amazon.com/dp/B01?tag=pub-20&utm_source=email': 'affiliate',
    'https://other.org/plain': 'no-query',
  };
  const r = decideLinks(PAGE, Object.keys(cases), w.ctx());
  check(Object.keys(r.rewrites).length === 0 && r.counts.skipped === Object.keys(cases).length, 'all-skipped', JSON.stringify(r));
  const gov = decideLinks(PAGE, ['https://www.irs.gov/x?utm_source=q&utm_medium=email'], w.ctx());
  check(gov.rewrites['https://www.irs.gov/x?utm_source=q&utm_medium=email'] === 'https://www.irs.gov/x' && gov.counts.substituted === 0, 'strip-only-origin-stripped-not-fabricated');
  const off = decideLinks(PAGE, ['https://other.org/x?utm_source=a&utm_medium=email'], w.ctx({ ...DEFAULT_SETTINGS, allowlist: ['other.org'] }));
  check(Object.keys(off.rewrites).length === 0, 'allowlisted-domain-untouched');
  const so = decideLinks(PAGE, ['https://other.org/x?utm_source=a&utm_medium=email'], w.ctx({ ...DEFAULT_SETTINGS, siteModes: { 'other.org': 'strip-only' } }));
  check(so.rewrites['https://other.org/x?utm_source=a&utm_medium=email'] === 'https://other.org/x', 'site-strip-only-strips-links');
  const dis = decideLinks(PAGE, ['https://other.org/x?utm_source=a&utm_medium=email'], w.ctx({ ...DEFAULT_SETTINGS, enabled: false }));
  check(Object.keys(dis.rewrites).length === 0, 'disabled-touches-nothing');
  const dup = decideLinks(PAGE, Array(50).fill('https://other.org/x?utm_source=a&utm_medium=email'), w.ctx());
  check(dup.counts.substituted === 1, 'duplicates-decided-once');
  const big = decideLinks(PAGE, Array.from({ length: BATCH_CAP + 100 }, (_, i) => `https://s${i}.org/?utm_source=a&utm_medium=email`), w.ctx());
  check(Object.keys(big.rewrites).length === BATCH_CAP, 'batch-capped', `${Object.keys(big.rewrites).length}`);
}

// ------------------------------------------------------------------- rewriter
function page({ links: els, base } = {}) {
  const root = new FakeRoot(base);
  root.append(...els);
  return root;
}
function harness(root, ctx, { timeRemaining } = {}) {
  const sched = fakeScheduler({ timeRemaining });
  const obs = fakeObserver();
  const sent = [];
  const rw = createLinkRewriter({
    root, pageUrl: PAGE,
    send: async (msg) => { sent.push(msg); return decideLinks(msg.pageUrl, msg.hrefs, ctx); },
    schedule: sched.schedule, observe: obs.observe,
  });
  return { rw, sched, obs, sent };
}

section('rewriter — rewrites in place, keeps the attribute form (§8.3 F3.1, F3.4)');
{
  const w = world();
  const abs = link('https://other.org/c?utm_source=news&utm_medium=referral&fbclid=IwAR9xQlmBz3kKpQ7vN2');
  const rel = link('/a?utm_source=sidebar&utm_medium=link&x=1');
  const qonly = link('?utm_source=sidebar&utm_medium=link&x=2#frag');
  const clean = link('/about');
  const area = new FakeElement('area', { href: '/map?utm_source=img&utm_medium=link' });
  const mail = link('mailto:a@b.c');
  const root = page({ links: [abs, rel, qonly, clean, area, mail] });
  const h = harness(root, w.ctx());
  h.rw.start();
  await h.sched.run();

  check(h.sent.length === 1 && h.sent[0].type === 'links', 'one-batch-sent', String(h.sent.length));
  check(h.sent[0].hrefs.every((u) => /^https?:/.test(u)), 'only-http-hrefs-sent');
  check(q(abs.href, 'utm_source') !== 'news' && abs.getAttribute('href').startsWith('https://other.org/c?'), 'absolute-link-substituted', abs.getAttribute('href'));
  check(rel.getAttribute('href') === '/a?x=1', 'relative-link-stays-relative', rel.getAttribute('href'));
  check(qonly.getAttribute('href') === '?x=2#frag', 'query-only-href-keeps-form-and-fragment', qonly.getAttribute('href'));
  check(clean.writes.length === 0, 'clean-link-never-written');
  check(area.getAttribute('href') === '/map', 'area-rewritten', area.getAttribute('href'));
  check(mail.writes.length === 0, 'mailto-untouched');
  check(h.rw._internals.original.get(rel) === '/a?utm_source=sidebar&utm_medium=link&x=1', 'original-kept');
  check(h.rw.stats.stripped === 3 && h.rw.stats.substituted === 1, 'stats', JSON.stringify(h.rw.stats));

  // Idempotent: a second pass writes nothing.
  const before = rel.writes.length;
  h.rw._internals.pending.add(rel); h.rw._internals.pending.add(abs);
  await h.rw.flush({ timeRemaining: () => 50 });
  check(rel.writes.length === before && h.sent.length === 1, 'second-pass-no-writes-no-messages');
}

section('rewriter — ping, shadow roots, mutations, own writes (§8.3 F3.2, F3.3)');
{
  const w = world();
  const pinged = link('/x?utm_source=a&utm_medium=email', { ping: 'https://t.example.com/p' });
  const host = new FakeElement('div');
  const inShadow = link('/s?utm_source=a&utm_medium=email');
  host.attachShadow().append(inShadow);
  const root = page({ links: [pinged, host] });
  const h = harness(root, w.ctx());
  h.rw.start();
  await h.sched.run();
  check(!pinged.hasAttribute('ping') && h.rw.stats.pings === 1, 'ping-removed');
  check(inShadow.getAttribute('href') === '/s', 'open-shadow-root-covered', inShadow.getAttribute('href'));

  // A node added later is picked up through the observer.
  const added = link('/later?utm_source=a&utm_medium=email');
  root.append(added);
  h.obs.emit([{ type: 'childList', addedNodes: [added] }]);
  await h.sched.run();
  check(added.getAttribute('href') === '/later', 'added-node-rewritten', added.getAttribute('href'));

  // The rewriter's own setAttribute arrives as a mutation record: ignored.
  const sentBefore = h.sent.length;
  h.obs.emit([{ type: 'attributes', attributeName: 'href', target: added }]);
  await h.sched.run();
  check(h.sent.length === sentBefore && added.writes.length === 1, 'own-write-ignored');

  // A site script changes an href afterwards: that is new, and gets rewritten again.
  added.attrs.set('href', '/changed?utm_source=b&utm_medium=email');   // not via setAttribute: a foreign write
  h.obs.emit([{ type: 'attributes', attributeName: 'href', target: added }]);
  await h.sched.run();
  check(added.getAttribute('href') === '/changed', 'foreign-change-rewritten', added.getAttribute('href'));

  // A site script re-adds ping: dropped again without a round trip.
  pinged.attrs.set('ping', 'https://t.example.com/p');
  const s2 = h.sent.length;
  h.obs.emit([{ type: 'attributes', attributeName: 'ping', target: pinged }]);
  check(!pinged.hasAttribute('ping') && h.sent.length === s2, 'ping-readded-dropped-locally');
}

section('rewriter — restore and resume (§8.4 F3.4, §8.5)');
{
  const w = world();
  const a = link('/a?utm_source=x&utm_medium=email');
  const b = link('https://other.org/b?utm_source=x&utm_medium=email');
  const root = page({ links: [a, b] });
  const h = harness(root, w.ctx());
  h.rw.start(); await h.sched.run();
  check(a.getAttribute('href') === '/a', 'pre-restore-rewritten');
  h.rw.restore();
  check(a.getAttribute('href') === '/a?utm_source=x&utm_medium=email' && b.getAttribute('href') === 'https://other.org/b?utm_source=x&utm_medium=email', 'restore-puts-originals-back');
  check(h.rw.stats.restored === 2, 'restore-count');
  const s = h.sent.length;
  h.obs.emit([{ type: 'childList', addedNodes: [link('/c?utm_source=x&utm_medium=email')] }]);
  await h.sched.run();
  check(h.sent.length === s, 'paused-sends-nothing');
  h.rw.resume(); await h.sched.run();
  check(a.getAttribute('href') === '/a' && h.sent.length === s + 1, 'resume-rewrites-again');
}

section('rewriter — time slicing and a sleeping background (§8.3 F3.5, F1.5)');
{
  const w = world();
  const many = Array.from({ length: 300 }, (_, i) => link(`/p${i}?utm_source=a&utm_medium=email`));
  const root = page({ links: many });
  const h = harness(root, w.ctx(), { timeRemaining: 0 });   // every deadline is already spent
  h.rw.start(); await h.sched.run();
  check(h.sent.length > 1 && many.every((l) => l.getAttribute('href').startsWith('/p') && !l.getAttribute('href').includes('utm')), 'slices-into-several-batches-and-finishes-all', `${h.sent.length} batches`);

  // The background is asleep or gone: the pass must not throw, must write nothing, and
  // must mark the element done so it is not retried on every mutation.
  const z = link('/z?utm_source=a&utm_medium=email');
  const dead = createLinkRewriter({ root: page({ links: [z] }), pageUrl: PAGE,
    send: async () => { throw new Error('Could not establish connection'); },
    schedule: (fn) => fn({ timeRemaining: () => 50 }), observe: () => {} });
  let threw = null;
  try { dead.start(); await dead.flush({ timeRemaining: () => 50 }); } catch (e) { threw = e; }
  check(threw === null, 'background-unreachable-does-not-throw', String(threw));
  check(z.writes.length === 0 && z.getAttribute('href') === '/z?utm_source=a&utm_medium=email', 'background-unreachable-writes-nothing');
  check(dead._internals.done.has(z), 'background-unreachable-marks-done-not-retried');
}

console.log(`\n${checks} checks passed${failures ? `, ${failures} FAILED` : ''}`);
process.exit(failures ? 1 : 0);
