// Persona → values, and URL → rewritten URL. PRODUCT.md §9.2, §9.3, §9.6, §10.3.

import { splitUrl, joinUrl, parseQuery, serializeQuery, classifyUrl } from './classify.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function matchCase(original, replacement) {
  if (original === original.toUpperCase() && original !== original.toLowerCase()) return replacement.toUpperCase();
  if (/^[A-Z][^A-Z]*$/.test(original)) return replacement[0].toUpperCase() + replacement.slice(1);
  return replacement;
}

let poolCache = null;
function wordPool(data) {
  if (poolCache?.for === data) return poolCache.pool;
  const pool = [];
  for (const slot of Object.values(data.campaigns.slots)) {
    if (slot.kind === 'list') pool.push(...slot.values);
  }
  poolCache = { for: data, pool: [...new Set(pool)] };
  return poolCache.pool;
}

let vocabCache = null;
function channelWords(data) {
  if (vocabCache?.for === data) return vocabCache.v;
  const sources = new Set(), mediums = new Set();
  for (const c of Object.values(data.vocabularies.channels)) {
    c.sources.forEach((s) => sources.add(s));
    c.mediums.forEach((m) => mediums.add(m));
  }
  vocabCache = { for: data, v: { sources, mediums } };
  return vocabCache.v;
}

/**
 * C4 — shape-preserving substitution. PRODUCT.md §9.6: the engine does not know what this
 * parameter means, so it derives the substitute from the value it was given. Returns null
 * when the shape is not recognized, and null means "leave it alone".
 */
export function shapePreserve(value, rng, data, persona) {
  if (!value) return null;
  let decoded = value;
  try { decoded = decodeURIComponent(value.replace(/\+/g, ' ')); } catch { /* keep raw */ }
  const lower = decoded.toLowerCase();

  // A known source or medium has a "logical other": the persona's own.
  const { sources, mediums } = channelWords(data);
  if (sources.has(lower) && persona?.source) return matchCase(decoded, persona.source);
  if (mediums.has(lower) && persona?.medium) return matchCase(decoded, persona.medium);

  const different = (gen) => {
    for (let i = 0; i < 8; i++) {
      const candidate = gen();
      if (candidate && candidate.toLowerCase() !== lower) return candidate;
    }
    return null;
  };

  if (/^\d+$/.test(decoded)) {
    return different(() => rng.chars('0123456789', decoded.length));
  }
  if (UUID_RE.test(decoded)) {
    const hex = '0123456789abcdef';
    return different(() => {
      const s = `${rng.chars(hex, 8)}-${rng.chars(hex, 4)}-4${rng.chars(hex, 3)}-${rng.pick(['8', '9', 'a', 'b'])}${rng.chars(hex, 3)}-${rng.chars(hex, 12)}`;
      return matchCase(decoded, s);
    });
  }
  if (/^[0-9a-f]+$/i.test(decoded) && decoded.length >= 8) {
    const upper = decoded === decoded.toUpperCase();
    return different(() => rng.chars(upper ? '0123456789ABCDEF' : '0123456789abcdef', decoded.length));
  }
  if (/^[A-Za-z0-9_-]+$/.test(decoded) && decoded.length >= 12) {
    const alphabet = data.grammars.alphabets.base64url;
    return different(() => rng.chars(alphabet, decoded.length));
  }
  // A dictionary word or hyphenated phrase: a different word of comparable length.
  if (/^[a-z0-9]+([-_][a-z0-9]+)*$/i.test(decoded) && decoded.length <= 40) {
    const pool = wordPool(data);
    const near = pool.filter((w) => Math.abs(w.length - decoded.length) <= 4);
    return different(() => matchCase(decoded, rng.pick(near.length >= 2 ? near : pool)));
  }
  return null;
}

/** C3 — only ever reached by a grammar that has been verified. §9.3. */
function fromGrammar(grammar, rng, data) {
  if (!grammar || grammar.status !== 'verified' || !grammar.emit) return null;
  const alphabet = data.grammars.alphabets[grammar.emit.alphabet];
  if (!alphabet) return null;
  const { length, lengthRange, prefix = '' } = grammar.emit;
  const n = length ?? (lengthRange ? lengthRange[0] + rng.int(lengthRange[1] - lengthRange[0] + 1) : 0);
  if (!n) return null;
  return prefix + rng.chars(alphabet, Math.max(0, n - prefix.length));
}

function c1Value(target, persona, data, rng, original) {
  const spec = data.vocabularies.params[target];
  if (!spec) return null;
  const channel = data.vocabularies.channels[persona.channel];

  if (spec.from === 'channel.sources') {
    return persona.source.toLowerCase() === String(original).toLowerCase()
      ? rng.pickExcept(channel.sources, original)
      : persona.source;
  }
  if (spec.from === 'channel.mediums') {
    return persona.medium.toLowerCase() === String(original).toLowerCase()
      ? rng.pickExcept(channel.mediums, original)
      : persona.medium;
  }
  // A channel-restricted vocabulary is not emitted outside its channels — §9.4.
  if (spec.channels && !spec.channels.includes(persona.channel)) return null;
  if (!spec.values) return null;
  return rng.pickExcept(spec.values.map((v) => v.v), original);
}

function newValueFor(entry, persona, data, rng) {
  const original = entry.rawValue ?? '';
  switch (entry.class) {
    case 'C1': return c1Value(entry.target, persona, data, rng, original);
    case 'C2': return persona.campaign;
    case 'C3': {
      const grammar = data.grammars.grammars[entry.grammar];
      return fromGrammar(grammar, rng, data) ?? shapePreserve(original, rng, data, persona);
    }
    case 'C4': return shapePreserve(original, rng, data, persona);
    default: return null;
  }
}

/**
 * Entry substitution. Parameter names, order and count are preserved (§8.1 F1.3) —
 * only values change. A parameter whose substitute cannot be produced keeps its original
 * value rather than being dropped, because dropping would change the count.
 */
export function substituteEntry(rawUrl, { persona, data, decision }) {
  const d = decision ?? classifyUrl(rawUrl, data, { visitActive: false });
  if (d.action !== 'substitute') return { url: rawUrl, changed: [], decision: d };

  const rng = persona.rng ?? { pick: (a) => a[0], pickExcept: (a) => a[0], chars: () => '', int: () => 0 };
  const byKey = new Map(d.tracked.map((t) => [t.rawKey, t]));
  const { head, query, hash } = splitUrl(rawUrl);
  const parts = parseQuery(query);
  const changed = [];

  for (const part of parts) {
    const entry = byKey.get(part.rawKey);
    if (!entry || part.rawValue === null) continue;
    const next = newValueFor(entry, persona, data, rng);
    if (next === null || next === undefined) continue;
    const encoded = /^[A-Za-z0-9._~-]+$/.test(String(next)) ? String(next) : encodeURIComponent(String(next));
    if (encoded === part.rawValue) continue;
    changed.push({ name: part.name, from: part.rawValue, to: encoded, class: entry.class });
    part.rawValue = encoded;
  }

  return { url: joinUrl({ head, query: serializeQuery(parts), hash }), changed, decision: d };
}

/** Interior stripping. §8.2 — recognized tracking parameters are removed, not fabricated. */
export function stripInterior(rawUrl, { data, decision }) {
  const d = decision ?? classifyUrl(rawUrl, data, { visitActive: true });
  if (d.action !== 'strip') return { url: rawUrl, removed: [], decision: d };

  const drop = new Set(d.tracked.map((t) => t.rawKey));
  const { head, query, hash } = splitUrl(rawUrl);
  const kept = [];
  const removed = [];
  for (const part of parseQuery(query)) {
    if (drop.has(part.rawKey)) removed.push(part.name);
    else kept.push(part);
  }
  return { url: joinUrl({ head, query: serializeQuery(kept), hash }), removed, decision: d };
}
