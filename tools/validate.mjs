#!/usr/bin/env node
// Validates the taxonomy in data/ — structure, cross-file referential integrity, and the
// safety invariants from PRODUCT.md §9 and §11. Dependency-free on purpose: this must run
// with nothing installed, in CI and on a fresh clone.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const warnings = [];
const err = (file, msg) => errors.push(`${file}: ${msg}`);
const warn = (file, msg) => warnings.push(`${file}: ${msg}`);

const load = (name) => {
  try {
    return JSON.parse(readFileSync(join(ROOT, 'data', name), 'utf8'));
  } catch (e) {
    err(name, `does not parse: ${e.message}`);
    return null;
  }
};

const vocab      = load('vocabularies.json');
const campaigns  = load('campaigns.json');
const grammars   = load('grammars.json');
const registry   = load('tracking-params.json');
const neverTouch = load('never-touch.json');
const redirects  = load('redirectors.json');
const stripOnly  = load('strip-only.json');

if (errors.length) { report(); process.exit(1); }

const CLASSES = new Set(['C1', 'C2', 'C3', 'C4']);
const channels = Object.keys(vocab.channels ?? {});
const channelSet = new Set(channels);

// ---------------------------------------------------------------- channels

for (const [name, ch] of Object.entries(vocab.channels ?? {})) {
  if (!Array.isArray(ch.mediums) || ch.mediums.length === 0)
    err('vocabularies.json', `channel "${name}" has no mediums; §9.4 draws the medium from the channel`);
}
const URL_SAFE_EARLY = /^[A-Za-z0-9._~-]+$/;
for (const [name, ch] of Object.entries(vocab.channels ?? {})) {
  if (!ch.ga4) err('vocabularies.json', `channel "${name}" names no GA4 channel group; §9.4 plausibility depends on landing in a named one`);
  if (!ch.$rule) err('vocabularies.json', `channel "${name}" records no GA4 rule, so nobody can check it against the source`);
  if (!Number.isFinite(ch.weight) || ch.weight <= 0)
    err('vocabularies.json', `channel "${name}" has no positive weight; an unweighted draw makes the channel mix itself implausible`);
  if (!Array.isArray(ch.sources) || ch.sources.length < 2)
    err('vocabularies.json', `channel "${name}" needs at least two sources, or substitution cannot pick a different one`);
  for (const list of ['sources', 'mediums']) {
    const seen = new Set();
    for (const v of ch[list] ?? []) {
      if (!URL_SAFE_EARLY.test(v)) err('vocabularies.json', `channel "${name}" ${list} value "${v}" needs percent-encoding`);
      if (seen.has(v)) err('vocabularies.json', `channel "${name}" has duplicate ${list} value "${v}"`);
      seen.add(v);
    }
  }
}

// PRODUCT.md §11.1: no commercial channel may exist.
for (const c of channels) {
  if (/affil|partner|commission|referral_program/i.test(c))
    err('vocabularies.json', `channel "${c}" looks commercial; §11.1 forbids fabricating affiliate attribution`);
}

// ------------------------------------------------------- vocabulary values

const URL_SAFE = /^[A-Za-z0-9._~-]+$/;
const FROM_TARGETS = new Set(['channel.sources', 'channel.mediums']);
for (const [param, spec] of Object.entries(vocab.params ?? {})) {
  if (spec.from) {
    if (!FROM_TARGETS.has(spec.from))
      err('vocabularies.json', `"${param}" draws from unknown target "${spec.from}"`);
    continue;
  }
  if (!Array.isArray(spec.values) || spec.values.length < 2) {
    err('vocabularies.json', `"${param}" needs at least two values, or substitution cannot pick a different one`);
    continue;
  }
  const seen = new Set();
  for (const { v, channel } of spec.values) {
    if (!URL_SAFE.test(v))
      err('vocabularies.json', `"${param}" value "${v}" needs percent-encoding; keep vocabulary values URL-safe`);
    if (seen.has(v)) err('vocabularies.json', `"${param}" has duplicate value "${v}"`);
    seen.add(v);
    if (spec.channelAgnostic) {
      if (channel) warn('vocabularies.json', `"${param}" is channelAgnostic but "${v}" carries a channel`);
    } else if (spec.channels?.length) {
      // Param-level channel restriction: the whole vocabulary is valid within those
      // channels, so individual values do not carry one.
      if (channel) warn('vocabularies.json', `"${param}" is channel-restricted but "${v}" also carries a channel`);
    } else if (!channel) {
      err('vocabularies.json', `"${param}" value "${v}" has no channel; §9.4 constraint 1 cannot be enforced without one`);
    } else if (!channelSet.has(channel)) {
      err('vocabularies.json', `"${param}" value "${v}" references undefined channel "${channel}"`);
    }
  }
  for (const c of spec.channels ?? []) {
    if (!channelSet.has(c)) err('vocabularies.json', `"${param}" restricted to undefined channel "${c}"`);
  }
}

// ------------------------------------------------------------ never-touch

const protectedNames = new Set();
for (const [group, g] of Object.entries(neverTouch.groups ?? {})) {
  if (!g.$why) err('never-touch.json', `group "${group}" has no $why`);
  for (const p of g.params ?? []) {
    if (p !== p.toLowerCase())
      err('never-touch.json', `"${p}" must be lowercase; matching is case-insensitive after normalisation`);
    if (protectedNames.has(p))
      warn('never-touch.json', `"${p}" appears in more than one group`);
    protectedNames.add(p);
  }
}
for (const required of ['tag', 'affid', 'irclickid', 'cjevent', 'sscid', 'awc', 'code', 'state', 'redirect_uri', 'sig', 'token'])
  if (!protectedNames.has(required))
    err('never-touch.json', `missing "${required}" — required by §11.1 / §9.5`);

// -------------------------------------------------------------- registry

const globToRegex = (pattern) => {
  const wildcards = (pattern.match(/[*?]/g) ?? []).length;
  if (pattern.length > 64) err('tracking-params.json', `shape "${pattern}" exceeds the 64-char limit`);
  if (wildcards > 4) err('tracking-params.json', `shape "${pattern}" has ${wildcards} wildcards; limit is 4`);
  return new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
};

const registered = new Set();
for (const p of registry.params ?? []) {
  if (registered.has(p.name)) err('tracking-params.json', `duplicate param "${p.name}"`);
  registered.add(p.name);

  if (!CLASSES.has(p.class)) err('tracking-params.json', `"${p.name}" has unknown class "${p.class}"`);
  if (protectedNames.has(p.name.toLowerCase()))
    err('tracking-params.json', `"${p.name}" is also in never-touch.json — a parameter cannot be both rewritten and exempt`);

  if (p.scope === 'domains') {
    if (!Array.isArray(p.domains) || p.domains.length === 0)
      err('tracking-params.json', `"${p.name}" is domain-scoped but lists no domains`);
  } else if (p.scope !== 'global') {
    err('tracking-params.json', `"${p.name}" has unknown scope "${p.scope}"`);
  }

  const target = p.alias ?? p.name;
  if (p.class === 'C1' && !vocab.params?.[target])
    err('tracking-params.json', `C1 "${p.name}" resolves to "${target}", which has no vocabulary`);
  if (p.class === 'C2' && !(campaigns.appliesTo ?? []).includes(target))
    err('tracking-params.json', `C2 "${p.name}" resolves to "${target}", which campaigns.json does not claim`);
  if (p.class === 'C3') {
    if (!p.grammar) err('tracking-params.json', `C3 "${p.name}" names no grammar`);
    else if (!grammars.grammars?.[p.grammar])
      err('tracking-params.json', `C3 "${p.name}" references missing grammar "${p.grammar}"`);
  }
}

for (const s of registry.shapes ?? []) {
  const re = globToRegex(s.pattern);
  for (const p of protectedNames)
    if (re.test(p))
      err('tracking-params.json', `shape "${s.pattern}" matches protected name "${p}" — it would swallow a never-touch parameter`);
  for (const rejected of registry.$shapesPolicy?.rejected ?? [])
    if (s.pattern === rejected)
      err('tracking-params.json', `shape "${s.pattern}" is listed as rejected in $shapesPolicy but is still active`);
}

// -------------------------------------------------------------- grammars

for (const [id, g] of Object.entries(grammars.grammars ?? {})) {
  if (!['hypothesis', 'verified'].includes(g.status))
    err('grammars.json', `"${id}" has unknown status "${g.status}"`);
  for (const c of g.channels ?? [])
    if (!channelSet.has(c)) err('grammars.json', `"${id}" references undefined channel "${c}"`);
  if (!g.channels?.length)
    err('grammars.json', `"${id}" declares no channels; §9.4 constraint 2 needs one to redraw the persona`);

  const min = grammars.policy?.minSamplesToVerify ?? 30;
  if (g.status === 'verified') {
    if ((g.samples ?? 0) < min) err('grammars.json', `"${id}" is verified with only ${g.samples ?? 0} samples; policy requires ${min}`);
    if (!g.verified) err('grammars.json', `"${id}" is verified but carries no verification date`);
    if (!g.emit) err('grammars.json', `"${id}" is verified but has no emit block, so it would generate nothing`);
    else {
      const days = (Date.now() - Date.parse(g.verified)) / 86400000;
      if (days > 180) err('grammars.json', `"${id}" was verified ${Math.round(days)} days ago; grammars expire at 180 and revert to hypothesis`);
      if (g.emit.alphabet && !grammars.alphabets?.[g.emit.alphabet])
        err('grammars.json', `"${id}" emits with undefined alphabet "${g.emit.alphabet}"`);
    }
  } else {
    if (g.emit) err('grammars.json', `"${id}" is a hypothesis but carries an emit block — it would generate unverified values`);
    if ((g.samples ?? 0) >= min) warn('grammars.json', `"${id}" has ${g.samples} samples and could be promoted to verified`);
    if (!g.needs) err('grammars.json', `"${id}" is a hypothesis with no "needs" field saying what evidence would promote it`);
  }
}

// ------------------------------------------------------------- campaigns

const slots = new Set(Object.keys(campaigns.slots ?? {}));
for (const t of campaigns.templates ?? []) {
  for (const m of t.pattern.matchAll(/\{(\w+)\}/g)) {
    const slot = m[1];
    if (slot === 'sep') continue;
    if (!slots.has(slot)) err('campaigns.json', `template "${t.id}" uses undefined slot "{${slot}}"`);
  }
  for (const c of t.channels ?? [])
    if (!channelSet.has(c)) err('campaigns.json', `template "${t.id}" references undefined channel "${c}"`);
  if (!t.channels?.length) err('campaigns.json', `template "${t.id}" declares no channels`);
}
for (const c of channels) {
  if (!(campaigns.templates ?? []).some((t) => t.channels?.includes(c)))
    err('campaigns.json', `channel "${c}" has no campaign template, so a persona in it cannot name a campaign`);
}
for (const [name, s] of Object.entries(campaigns.slots ?? {})) {
  if (s.kind === 'list') {
    if (!s.values?.length) err('campaigns.json', `slot "${name}" is an empty list`);
    for (const v of s.values ?? [])
      if (!URL_SAFE.test(v)) err('campaigns.json', `slot "${name}" value "${v}" needs percent-encoding`);
  } else if (s.kind === 'generator') {
    if (!campaigns.generators?.[s.generator])
      err('campaigns.json', `slot "${name}" names undefined generator "${s.generator}"`);
  } else {
    err('campaigns.json', `slot "${name}" has unknown kind "${s.kind}"`);
  }
}

// ------------------------------------------------------------ redirectors

const redirIds = new Set();
for (const r of redirects.rules ?? []) {
  if (redirIds.has(r.id)) err('redirectors.json', `duplicate rule id "${r.id}"`);
  redirIds.add(r.id);
  if (!r.hosts?.length) err('redirectors.json', `"${r.id}" lists no hosts`);
  if (typeof r.unwrappable !== 'boolean') err('redirectors.json', `"${r.id}" has no boolean unwrappable flag`);
  if (!r.evidence) err('redirectors.json', `"${r.id}" has no evidence — §9.2's rule applies to redirectors too`);
  if (r.unwrappable && r.destination?.kind === 'none')
    err('redirectors.json', `"${r.id}" is marked unwrappable but its destination is not present in the URL`);
  if (r.unwrappable && !r.destination?.kind)
    err('redirectors.json', `"${r.id}" is marked unwrappable but declares no destination`);
  for (const h of r.hosts ?? [])
    if (h !== h.toLowerCase()) err('redirectors.json', `"${r.id}" host "${h}" must be lowercase`);
}

// ------------------------------------------------------------- strip-only

for (const s of stripOnly.suffixRules ?? [])
  if (!s.suffix.startsWith('.')) err('strip-only.json', `suffix "${s.suffix}" must start with a dot`);
const seenDomains = new Set();
for (const d of stripOnly.domains ?? []) {
  if (d.domain !== d.domain.toLowerCase()) err('strip-only.json', `domain "${d.domain}" must be lowercase`);
  if (seenDomains.has(d.domain)) err('strip-only.json', `duplicate domain "${d.domain}"`);
  seenDomains.add(d.domain);
}

// ------------------------------------------------- invariant corpus cover
// No engine yet, so this asserts the weaker but still meaningful property: every URL we
// claim must survive untouched is actually covered by a rule that exists today.

const suffixes = (stripOnly.suffixRules ?? []).map((s) => s.suffix);
const stripDomains = (stripOnly.domains ?? []).map((d) => d.domain);
let corpusCount = 0;

for (const line of readFileSync(join(ROOT, 'test/invariants/invariants.jsonl'), 'utf8').split('\n')) {
  if (!line.trim()) continue;
  corpusCount++;
  let entry;
  try { entry = JSON.parse(line); } catch { err('invariants.jsonl', `line ${corpusCount} does not parse`); continue; }

  const u = new URL(entry.url);
  const host = u.hostname.toLowerCase();
  const names = [...u.searchParams.keys()].map((k) => k.toLowerCase());

  const byParam = names.some((n) => protectedNames.has(n));
  const bySuffix = suffixes.some((s) => host === s.slice(1) || host.endsWith(s));
  const byDomain = stripDomains.some((d) => host === d || host.endsWith('.' + d));

  if (!byParam && !bySuffix && !byDomain)
    err('invariants.jsonl', `"${entry.url}" is in the invariant corpus but no never-touch parameter or strip-only origin protects it — either the data is missing a rule or the case does not belong here (${entry.why})`);
}
if (corpusCount < 20) warn('invariants.jsonl', `only ${corpusCount} cases; PRODUCT.md §13 targets 500`);

// ------------------------------------------------------------------ report

function report() {
  for (const w of warnings) console.log(`  warn   ${w}`);
  for (const e of errors) console.log(`  ERROR  ${e}`);
}

report();
const counts = {
  params: registry.params?.length ?? 0,
  shapes: registry.shapes?.length ?? 0,
  protected: protectedNames.size,
  grammars: Object.keys(grammars.grammars ?? {}).length,
  verifiedGrammars: Object.values(grammars.grammars ?? {}).filter((g) => g.status === 'verified').length,
  channels: channels.length,
  redirectors: redirects.rules?.length ?? 0,
  unwrappable: (redirects.rules ?? []).filter((r) => r.unwrappable).length,
  invariants: corpusCount,
};
console.log(
  `\n${counts.params} params + ${counts.shapes} shapes · ${counts.protected} protected · ` +
  `${counts.grammars} grammars (${counts.verifiedGrammars} verified) · ${counts.channels} channels · ` +
  `${counts.redirectors} redirectors (${counts.unwrappable} unwrappable) · ${counts.invariants} invariants`
);
console.log(errors.length ? `\nFAILED with ${errors.length} error(s)` : `\nOK${warnings.length ? ` (${warnings.length} warning(s))` : ''}`);
process.exit(errors.length ? 1 : 0);
