// The visit registry. PRODUCT.md §7.1, §10.4.
//
// One question — is this domain already being visited? — and one seed per visit. The
// answer picks the phase (entry → substitute, interior → strip); the seed is what makes
// every URL touched during the visit tell the same story, because there is only one
// seed to derive from.
//
// Memory-only by design. Nothing here is ever written to disk: closing the browser
// erases every visit, which is why tomorrow's arrival gets an unrelated story. The
// clock and the seed source are injected so the tests are exact rather than timing-
// dependent.

import { derivePersona } from './engine/persona.js';

const DEFAULT_TTL_MS = 30 * 60 * 1000;

function randomSeed() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * @param {object} opts
 * @param {object}   opts.data     the bundled taxonomy
 * @param {() => number} [opts.now]
 * @param {number}   [opts.ttlMs]  how long a visit outlives its last navigation with no tab open
 * @param {() => string} [opts.seedFn]
 */
export function createRegistry({ data, now = () => Date.now(), ttlMs = DEFAULT_TTL_MS, seedFn = randomSeed }) {
  const visits = new Map();     // domain → visit
  const tabToDomain = new Map(); // tabId → domain
  const emitted = new Map();     // exact url string → domain (URLs we produced ourselves)
  const pending = new Map();     // domain → seed reserved before the visit exists (M3 hook)

  function expired(v, t) {
    return v.tabs.size === 0 && t - v.lastSeen > ttlMs;
  }

  function get(domain) {
    const v = visits.get(domain);
    if (!v) return null;
    if (expired(v, now())) { visits.delete(domain); return null; }
    return v;
  }

  return {
    isActive: (domain) => get(domain) !== null,
    get,

    /**
     * Open a visit. The persona is derived once, here, from the entry URL's parameter
     * names (§9.4 constraint 2) and reused for the visit's lifetime.
     */
    begin(domain, { incomingNames = [], entryUrl = null } = {}) {
      const existing = get(domain);
      if (existing) return existing;
      const seed = pending.get(domain) ?? seedFn();
      pending.delete(domain);
      const t = now();
      const persona = derivePersona({ seed, data, incomingNames, now: new Date(t) });
      const v = { domain, seed, persona, startedAt: t, lastSeen: t, tabs: new Set(), entryUrl, entry: null };
      visits.set(domain, v);
      return v;
    },

    /** A top-level navigation inside the visit. */
    touch(domain) {
      const v = get(domain);
      if (v) v.lastSeen = now();
      return v;
    },

    /** Tab bookkeeping: a tab belongs to at most one visit at a time. */
    attachTab(domain, tabId) {
      if (tabId === undefined || tabId === null || tabId < 0) return;
      const prev = tabToDomain.get(tabId);
      if (prev && prev !== domain) visits.get(prev)?.tabs.delete(tabId);
      tabToDomain.set(tabId, domain);
      const v = get(domain);
      if (v) v.tabs.add(tabId);
    },
    detachTab(tabId) {
      const domain = tabToDomain.get(tabId);
      if (!domain) return;
      tabToDomain.delete(tabId);
      const v = visits.get(domain);
      if (v) { v.tabs.delete(tabId); v.lastSeen = now(); }
    },

    /**
     * Idempotence by bookkeeping (§7.3). A URL we emitted — a redirect target, or a link
     * the content script rewrote — is recorded here so the navigation that follows is
     * recognised and passed through rather than rewritten a second time.
     */
    markEmitted(domain, url) { emitted.set(url, domain); },
    takeEmitted(url) {
      const d = emitted.get(url);
      if (d !== undefined) emitted.delete(url);
      return d !== undefined;
    },

    /**
     * The persona a link to `domain` should carry before any visit exists (M3). Reserves
     * a seed so that when the navigation arrives the visit derives the same persona.
     */
    personaFor(domain, incomingNames = []) {
      const v = get(domain);
      if (v) return v.persona;
      if (!pending.has(domain)) pending.set(domain, seedFn());
      return derivePersona({ seed: pending.get(domain), data, incomingNames, now: new Date(now()) });
    },

    /** Drop expired visits. Returns how many went. */
    sweep() {
      const t = now();
      let n = 0;
      for (const [d, v] of visits) if (expired(v, t)) { visits.delete(d); n++; }
      if (emitted.size > 500) emitted.clear(); // a bounded scratchpad, not a history
      return n;
    },

    clear() { visits.clear(); tabToDomain.clear(); emitted.clear(); pending.clear(); },

    /** For the popup. Never includes seeds. */
    snapshot() {
      const t = now();
      return [...visits.values()].filter((v) => !expired(v, t)).map((v) => ({
        domain: v.domain, channel: v.persona.channel, ga4Channel: v.persona.ga4Channel,
        source: v.persona.source, medium: v.persona.medium, campaign: v.persona.campaign,
        startedAt: v.startedAt, lastSeen: v.lastSeen, tabs: v.tabs.size, entry: v.entry,
      }));
    },
  };
}
