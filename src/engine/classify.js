// URL → what should happen to it. PRODUCT.md §9.1, §9.5, §10.3.
//
// Pure: takes the taxonomy as an argument, touches no browser API, and every failure path
// returns 'passthrough'. There is no state in which a malformed decision is preferred to
// leaving the URL alone.

export function splitUrl(raw) {
  const hashIdx = raw.indexOf('#');
  const base = hashIdx === -1 ? raw : raw.slice(0, hashIdx);
  const hash = hashIdx === -1 ? '' : raw.slice(hashIdx);
  const qIdx = base.indexOf('?');
  return {
    head: qIdx === -1 ? base : base.slice(0, qIdx),
    query: qIdx === -1 ? '' : base.slice(qIdx + 1),
    hash,
  };
}

export function joinUrl({ head, query, hash }) {
  return head + (query ? '?' + query : '') + hash;
}

/**
 * Split a query string without decoding it. PRODUCT.md §8.3: round-tripping through
 * URLSearchParams normalises '+', '%20' and repeated keys in ways that break signed URLs,
 * so survivors are re-emitted with their original raw bytes.
 */
export function parseQuery(query) {
  if (!query) return [];
  return query.split('&').map((pair) => {
    if (pair === '') return { rawKey: '', rawValue: null, name: '' };
    const eq = pair.indexOf('=');
    const rawKey = eq === -1 ? pair : pair.slice(0, eq);
    const rawValue = eq === -1 ? null : pair.slice(eq + 1);
    let name = rawKey;
    try { name = decodeURIComponent(rawKey.replace(/\+/g, ' ')); } catch { /* keep raw */ }
    return { rawKey, rawValue, name };
  });
}

export function serializeQuery(parts) {
  return parts.map((p) => (p.rawValue === null ? p.rawKey : `${p.rawKey}=${p.rawValue}`)).join('&');
}

export function hostMatches(host, domain) {
  const h = host.toLowerCase();
  const d = domain.toLowerCase();
  return h === d || h.endsWith('.' + d);
}

let protectedCache = null;
export function protectedNames(data) {
  if (protectedCache?.for === data) return protectedCache.set;
  const set = new Set();
  for (const group of Object.values(data.neverTouch.groups)) {
    for (const p of group.params) set.add(p.toLowerCase());
  }
  protectedCache = { for: data, set };
  return set;
}

function globToRegex(pattern) {
  return new RegExp(
    '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
  );
}

let shapeCache = null;
function shapes(data) {
  if (shapeCache?.for === data) return shapeCache.list;
  const list = data.trackingParams.shapes.map((s) => ({ ...s, re: globToRegex(s.pattern) }));
  shapeCache = { for: data, list };
  return list;
}

/** @returns {null | {class, grammar?, target, via}} */
export function classifyParam(name, host, data) {
  const lower = name.toLowerCase();
  if (protectedNames(data).has(lower)) return null;

  for (const p of data.trackingParams.params) {
    if (p.name.toLowerCase() !== lower) continue;
    if (p.scope === 'domains' && !p.domains.some((d) => hostMatches(host, d))) return null;
    return { class: p.class, grammar: p.grammar, target: p.alias ?? p.name, via: 'registry', risk: p.risk };
  }

  for (const s of shapes(data)) {
    if (s.re.test(lower)) return { class: 'C4', target: lower, via: 'shape' };
  }
  return null;
}

export function isStripOnly(host, data) {
  const h = host.toLowerCase();
  if (data.stripOnly.suffixRules.some((s) => h === s.suffix.slice(1) || h.endsWith(s.suffix))) return true;
  return data.stripOnly.domains.some((d) => hostMatches(h, d.domain));
}

/**
 * @param {string} rawUrl
 * @param {object} data
 * @param {{visitActive?: boolean, allowlisted?: boolean}} ctx
 */
export function classifyUrl(rawUrl, data, { visitActive = false, allowlisted = false } = {}) {
  const none = (reason) => ({ action: 'passthrough', reason, tracked: [] });
  if (allowlisted) return none('allowlisted');

  let parsed;
  try { parsed = new URL(rawUrl); } catch { return none('unparseable'); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return none('non-http-scheme');

  const host = parsed.hostname.toLowerCase();
  const { query } = splitUrl(rawUrl);
  const parts = parseQuery(query);
  if (!parts.length) return none('no-query');

  // C5 wins unconditionally, and exempts the WHOLE url — a URL carrying a signature or an
  // OAuth handshake is one whose exact shape is likely to matter. §9.5.
  const guarded = protectedNames(data);
  const hit = parts.find((p) => guarded.has(p.name.toLowerCase()));
  if (hit) return { action: 'passthrough', reason: 'never-touch', guardedBy: hit.name, tracked: [] };

  const tracked = [];
  for (const part of parts) {
    const c = classifyParam(part.name, host, data);
    if (c) tracked.push({ ...part, ...c });
  }
  if (!tracked.length) return none('no-tracking-params');

  if (isStripOnly(host, data)) return { action: 'strip', reason: 'strip-only-origin', tracked };
  return { action: visitActive ? 'strip' : 'substitute', reason: visitActive ? 'interior' : 'entry', tracked };
}
