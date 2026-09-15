// Coherence and safety assertions for the substitution engine. PRODUCT.md §9.4, §9.7.
//
// The engine is deterministic from its seed, so these are exact assertions, not smoke
// tests: a vocabulary edit that starts pairing utm_medium=email with utm_source=google
// fails the build.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadData } from '../../tools/load-data.mjs';
import { derivePersona, substituteEntry, stripInterior, classifyUrl, parseQuery, splitUrl } from '../../src/engine/index.js';
import { ga4Channel } from '../ga4-channels.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const data = loadData();

let failures = 0, checks = 0;
const fail = (name, detail) => { failures++; console.log(`  FAIL  ${name}\n        ${detail}`); };
const ok = () => { checks++; };
const check = (cond, name, detail) => (cond ? ok() : fail(name, detail));
const section = (n) => console.log(`\n${n}`);

const SEEDS = Array.from({ length: 2000 }, (_, i) => `seed-${i}`);
const names = (u) => parseQuery(splitUrl(u).query).map((p) => p.name);

// ---------------------------------------------------------------- 1. GA4 coherence
section('persona lands in a named GA4 channel');
{
  const seen = new Map();
  for (const seed of SEEDS) {
    const p = derivePersona({ seed, data });
    const got = ga4Channel({ source: p.source, medium: p.medium });
    seen.set(got, (seen.get(got) ?? 0) + 1);
    if (got === 'Unassigned') {
      fail('ga4-named', `seed ${seed}: ${p.channel} → source=${p.source} medium=${p.medium} → Unassigned`);
      break;
    }
    if (got !== p.ga4Channel) {
      fail('ga4-agrees', `seed ${seed}: taxonomy says ${p.ga4Channel}, oracle says ${got} (source=${p.source} medium=${p.medium})`);
      break;
    }
    if (got === 'Affiliates') {
      fail('no-affiliate', `seed ${seed} produced an Affiliates persona — §11.1`);
      break;
    }
  }
  ok(); ok(); ok();
  console.log('  ' + [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${(100 * v / SEEDS.length).toFixed(1)}%`).join('  '));
}

// -------------------------------------------------------- 1b. channel mix realism
section('channel mix follows the declared weights, not a uniform draw');
{
  const channels = data.vocabularies.channels;
  const total = Object.values(channels).reduce((a, c) => a + c.weight, 0);
  const counts = {};
  for (const seed of SEEDS) {
    const p = derivePersona({ seed, data });
    counts[p.channel] = (counts[p.channel] ?? 0) + 1;
  }
  let worst = null;
  for (const [name, spec] of Object.entries(channels)) {
    const expected = spec.weight / total;
    const actual = (counts[name] ?? 0) / SEEDS.length;
    const drift = Math.abs(actual - expected);
    if (!worst || drift > worst.drift) worst = { name, expected, actual, drift };
  }
  // Coarse: the weights are a judgement, not a measurement. This catches an unweighted
  // draw (which would put ~9% in every channel, ~17 points off organic_search) and a
  // vocabulary edit that accidentally strands a channel, not small sampling noise.
  check(worst.drift < 0.05, 'channel-mix',
    `${worst.name}: expected ${(100 * worst.expected).toFixed(1)}%, got ${(100 * worst.actual).toFixed(1)}%`);
  const uniform = 1 / Object.keys(channels).length;
  const topShare = (counts.organic_search ?? 0) / SEEDS.length;
  check(topShare > uniform * 1.5, 'not-uniform',
    `organic_search at ${(100 * topShare).toFixed(1)}% is not meaningfully above a uniform ${(100 * uniform).toFixed(1)}%`);
}

// ------------------------------------------------------------- 2. token agreement
section('incoming token constrains the channel (§9.4 constraint 2)');
for (const [param, allowed] of [
  ['fbclid', ['organic_social', 'paid_social']],
  ['gclid', ['paid_search', 'display']],
  ['msclkid', ['paid_search']],
  ['mc_eid', ['email']],
  ['igshid', ['organic_social']],
]) {
  let bad = null;
  for (const seed of SEEDS.slice(0, 500)) {
    const p = derivePersona({ seed, data, incomingNames: [param] });
    if (!allowed.includes(p.channel)) { bad = `seed ${seed}: ${param} → ${p.channel}`; break; }
  }
  check(!bad, `token-channel:${param}`, bad ?? '');
}

// ------------------------------------------------------------------ 3. determinism
section('determinism and within-visit stability (§10.4, §9.4 constraint 5)');
{
  const url = 'https://example.com/a?utm_source=nytimes&utm_medium=referral&utm_campaign=old';
  const a = substituteEntry(url, { persona: derivePersona({ seed: 'fixed', data }), data }).url;
  const b = substituteEntry(url, { persona: derivePersona({ seed: 'fixed', data }), data }).url;
  check(a === b, 'deterministic', `${a}\n        ${b}`);

  const p = derivePersona({ seed: 'visit-1', data });
  const u1 = substituteEntry('https://example.com/one?utm_source=a&utm_medium=b', { persona: p, data }).url;
  const u2 = substituteEntry('https://example.com/two?utm_source=c&utm_medium=d', { persona: p, data }).url;
  const src = (u) => new URL(u).searchParams.get('utm_source');
  const med = (u) => new URL(u).searchParams.get('utm_medium');
  check(src(u1) === src(u2) && med(u1) === med(u2), 'visit-stable', `${u1}\n        ${u2}`);
}

// ------------------------------------------------------- 4. shape preservation
section('names, order and count are preserved (§8.1 F1.3)');
{
  const url = 'https://example.com/p?utm_source=x&fbclid=AbCdEfGhIjKlMnOp&utm_campaign=q&utm_content=z&foo=bar';
  const out = substituteEntry(url, { persona: derivePersona({ seed: 's', data }), data }).url;
  check(JSON.stringify(names(url)) === JSON.stringify(names(out)), 'names-preserved', `${names(url)} vs ${names(out)}`);
  check(new URL(out).searchParams.get('foo') === 'bar', 'untracked-untouched', out);
  for (const n of ['utm_source', 'fbclid', 'utm_campaign']) {
    const before = new URL(url).searchParams.get(n);
    const after = new URL(out).searchParams.get(n);
    check(before !== after, `value-changed:${n}`, `${n} unchanged: ${after}`);
    if (n === 'fbclid') check(after.length === before.length, 'fbclid-length', `${before.length} → ${after.length}`);
  }
}

// ------------------------------------------------------------- 5. invariant corpus
section('invariant corpus survives byte-identical (§9.5, §11.1)');
{
  const lines = readFileSync(join(ROOT, 'test/invariants/invariants.jsonl'), 'utf8').split('\n').filter((l) => l.trim());
  let bad = 0;
  for (const line of lines) {
    const { url, why } = JSON.parse(line);
    const p = derivePersona({ seed: 'inv', data });
    const sub = substituteEntry(url, { persona: p, data }).url;
    const host = new URL(url).hostname;
    const stripOnly = classifyUrl(url, data).reason === 'strip-only-origin';
    if (sub !== url) { bad++; fail('invariant-substitute', `${why}\n        ${url}\n        ${sub}`); }
    if (!stripOnly) {
      const str = stripInterior(url, { data }).url;
      if (str !== url) { bad++; fail('invariant-strip', `${why} (${host})\n        ${url}\n        ${str}`); }
    }
  }
  if (!bad) { ok(); console.log(`  ${lines.length} cases unchanged`); }
}

// --------------------------------------------------------------- 6. strip-only
section('strip-only origins are never fabricated on (§11.2)');
for (const url of ['https://www.irs.gov/x?utm_source=email&utm_medium=newsletter',
                   'https://www.paypal.com/y?utm_campaign=spring',
                   'https://foo.nhs.uk/z?utm_source=twitter&utm_medium=social']) {
  const d = classifyUrl(url, data, { visitActive: false });
  check(d.action === 'strip', 'strip-only', `${url} → ${d.action}/${d.reason}`);
  const out = substituteEntry(url, { persona: derivePersona({ seed: 'so', data }), data }).url;
  check(out === url, 'strip-only-no-substitute', `${url} → ${out}`);
}

// ---------------------------------------------------------- 7. commerce exemption
section('a commerce parameter exempts the whole URL (§11.1 constraint 1)');
for (const url of ['https://www.amazon.com/dp/B01?tag=pub-20&utm_source=email',
                   'https://shop.example.com/p?irclickid=abc&utm_campaign=x&utm_medium=cpc',
                   'https://shop.example.com/p?sscid=z9&fbclid=AbCdEfGhIjKlMnOp']) {
  const d = classifyUrl(url, data);
  check(d.action === 'passthrough' && d.reason === 'never-touch', 'commerce-exempt', `${url} → ${d.action}/${d.reason}`);
  check(substituteEntry(url, { persona: derivePersona({ seed: 'c', data }), data }).url === url, 'commerce-unchanged', url);
  check(stripInterior(url, { data }).url === url, 'commerce-unstripped', url);
}

// ------------------------------------------------------------------ 8. temporal
section('campaign names are dated to now (§9.4 constraint 4)');
{
  const year = String(new Date().getFullYear());
  let dated = 0, total = 0;
  for (const seed of SEEDS.slice(0, 300)) {
    const p = derivePersona({ seed, data });
    if (!p.campaign) continue;
    total++;
    if (/\d{4}/.test(p.campaign)) {
      dated++;
      if (!p.campaign.includes(year)) fail('temporal', `seed ${seed}: ${p.campaign} does not carry ${year}`);
    }
  }
  check(total > 0 && dated > 0, 'temporal-coverage', `${dated}/${total} campaigns carried a year`);
  console.log(`  ${dated}/${total} campaigns carry a four-digit year, all current`);
}

// ------------------------------------------------------------ 9. separator style
section('one separator per campaign (§9.4 constraint 5)');
{
  let bad = null;
  for (const seed of SEEDS.slice(0, 500)) {
    const c = derivePersona({ seed, data }).campaign;
    if (c && c.includes('-') && c.includes('_')) { bad = `seed ${seed}: ${c}`; break; }
  }
  check(!bad, 'separator-consistent', bad ?? '');
}

console.log(`\n${checks} checks passed${failures ? `, ${failures} FAILED` : ''}`);
process.exit(failures ? 1 : 0);
