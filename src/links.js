// What each link in a page becomes. PRODUCT.md §7.3B, §8.3, §10.5.
//
// The content script sends the absolute hrefs it found; this decides, against the one
// registry, what each should read as. Same registrable domain as the page, or a domain
// with an active visit → interior → strip. Cross-domain with no visit → the story that
// domain's visit-to-be will tell → substitute, and record the exact string so the
// navigation that follows is recognised (§7.3 idempotence by bookkeeping).
//
// Pure. background.js calls this from its message handler and nothing else does.

import { classifyUrl, isStripOnly } from './engine/classify.js';
import { substituteEntry, stripInterior } from './engine/substitute.js';
import { registrableDomain } from './engine/domain.js';
import { DEFAULT_SETTINGS } from './navigation.js';

export const BATCH_CAP = 2000;

/**
 * @param {string}   pageUrl  location.href of the frame the links are in
 * @param {string[]} hrefs    absolute URLs (the `href` property, not the attribute)
 * @param {{registry, data, settings?}} ctx
 * @returns {{rewrites: Record<string,string>, counts: {stripped:number, substituted:number, skipped:number}}}
 */
export function decideLinks(pageUrl, hrefs, { registry, data, settings = DEFAULT_SETTINGS }) {
  const rewrites = {};
  const counts = { stripped: 0, substituted: 0, skipped: 0 };
  if (!settings.enabled || !Array.isArray(hrefs)) return { rewrites, counts };

  let pageDomain = '';
  try { pageDomain = registrableDomain(new URL(pageUrl).hostname); } catch { /* unknown page */ }

  const seen = new Set();
  for (const href of hrefs.slice(0, BATCH_CAP)) {
    if (typeof href !== 'string' || seen.has(href)) continue;
    seen.add(href);
    try {
      const u = new URL(href);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') { counts.skipped++; continue; }
      const domain = registrableDomain(u.hostname);
      const mode = settings.siteModes?.[domain];
      if (mode === 'off' || settings.allowlist?.includes(domain)) { counts.skipped++; continue; }

      const interior = domain === pageDomain || registry.isActive(domain);
      const decision = classifyUrl(href, data, { visitActive: interior });
      if (decision.action === 'passthrough') { counts.skipped++; continue; }

      const mustStrip = decision.action === 'strip' || mode === 'strip-only'
        || !settings.substitute || isStripOnly(u.hostname, data);

      if (mustStrip) {
        const d = decision.action === 'strip' ? decision : { ...decision, action: 'strip' };
        const { url: out } = stripInterior(href, { data, decision: d });
        if (out !== href) { rewrites[href] = out; counts.stripped++; }
        else counts.skipped++;
        continue;
      }

      // Cross-domain, no visit yet: the persona its visit will use, reserved now.
      const names = decision.tracked.map((t) => t.name.toLowerCase());
      const persona = registry.personaFor(domain, names);
      const { url: out } = substituteEntry(href, { persona, data, decision });
      if (out !== href) {
        registry.markEmitted(domain, out);
        rewrites[href] = out;
        counts.substituted++;
      } else counts.skipped++;
    } catch {
      counts.skipped++;                // an odd href is left exactly as it was
    }
  }
  return { rewrites, counts };
}
