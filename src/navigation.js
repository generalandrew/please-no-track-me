// The navigation handler. PRODUCT.md §7.3A, §8.1, §10.3.
//
// Pure: given a top-level navigation and the registry, guard, taxonomy and settings,
// decide what to do and return it. background.js is the only thing that touches
// browser.webRequest, and it does nothing but call this and hand back `redirectUrl`.
//
// Every failure path is passthrough. There is no state in which a malformed decision
// is preferred to leaving the URL alone.

import { classifyUrl, parseQuery, splitUrl } from './engine/classify.js';
import { substituteEntry, stripInterior } from './engine/substitute.js';
import { registrableDomain } from './engine/domain.js';

export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  substitute: true,          // off → strip everywhere, fabricate nowhere
  allowlist: [],             // registrable domains never touched
  siteModes: {},             // domain → 'off' | 'strip-only'
});

/**
 * @param {{url: string, tabId: number, requestId?: string}} nav
 * @param {{registry, guard, data, settings?}} ctx
 * @returns {{action: string, reason: string, domain?: string, redirectUrl?: string}}
 */
export function handleNavigation(nav, { registry, guard, data, settings = DEFAULT_SETTINGS }) {
  const { url, tabId, requestId } = nav;
  const pass = (reason, extra = {}) => ({ action: 'passthrough', reason, ...extra });

  try {
    if (!settings.enabled) return pass('disabled');

    let parsed;
    try { parsed = new URL(url); } catch { return pass('unparseable'); }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return pass('non-http-scheme');

    const domain = registrableDomain(parsed.hostname);
    const mode = settings.siteModes?.[domain];
    if (mode === 'off' || settings.allowlist?.includes(domain)) return pass('allowlisted', { domain });

    // A URL we produced ourselves — the target of our own redirect, or a link the
    // content script already rewrote. The navigation still counts as an entry; the
    // rewriting does not happen twice. §7.3.
    if (registry.takeEmitted(url)) {
      const names = parseQuery(splitUrl(url).query).map((p) => p.name.toLowerCase());
      registry.begin(domain, { incomingNames: names, entryUrl: url });
      registry.touch(domain);
      registry.attachTab(domain, tabId);
      return pass('emitted', { domain });
    }

    // M4 hook: redirector unwrapping sits here, before classification, so the
    // destination is what gets classified. Not yet implemented.

    const visitActive = registry.isActive(domain);
    const decision = classifyUrl(url, data, { visitActive });

    if (decision.action === 'passthrough') {
      // Still an arrival. A site entered with a clean URL has a visit too, so its
      // interior links are stripped and a later tracked navigation is not mistaken
      // for a fresh entry.
      if (!visitActive) registry.begin(domain, { entryUrl: url });
      registry.touch(domain);
      registry.attachTab(domain, tabId);
      return pass(decision.reason, { domain, guardedBy: decision.guardedBy });
    }

    const forceStrip = decision.action === 'strip' || mode === 'strip-only' || !settings.substitute;

    if (forceStrip) {
      if (!visitActive) registry.begin(domain, { entryUrl: url });
      registry.touch(domain);
      registry.attachTab(domain, tabId);
      const stripDecision = decision.action === 'strip' ? decision : { ...decision, action: 'strip' };
      const { url: out, removed } = stripInterior(url, { data, decision: stripDecision });
      if (out === url) return pass('strip-no-change', { domain });
      const verdict = guard.allow(tabId, requestId);
      if (!verdict.ok) return pass(`guard:${verdict.reason}`, { domain });
      registry.markEmitted(domain, out);
      return { action: 'strip', reason: mode === 'strip-only' ? 'site-strip-only' : decision.reason,
               domain, redirectUrl: out, removed };
    }

    // Entry: one coherent lie, told once, at the door.
    if (guard.isDisabled(tabId)) return pass('guard:disabled', { domain });
    const names = decision.tracked.map((t) => t.name.toLowerCase());
    const visit = registry.begin(domain, { incomingNames: names, entryUrl: url });
    const { url: out, changed } = substituteEntry(url, { persona: visit.persona, data, decision });
    registry.attachTab(domain, tabId);
    if (out === url) return pass('substitute-no-change', { domain });

    const verdict = guard.allow(tabId, requestId);
    if (!verdict.ok) return pass(`guard:${verdict.reason}`, { domain });

    registry.markEmitted(domain, out);
    visit.entry = { from: url, to: out, changed: changed.map((c) => c.name) };
    return { action: 'substitute', reason: 'entry', domain, redirectUrl: out, changed,
             persona: { channel: visit.persona.channel, ga4Channel: visit.persona.ga4Channel,
                        source: visit.persona.source, medium: visit.persona.medium } };
  } catch (err) {
    return pass('engine-error', { error: String(err?.message ?? err) });
  }
}
