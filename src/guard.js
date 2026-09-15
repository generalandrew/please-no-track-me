// Loop guard. PRODUCT.md §8.1 F1.6.
//
// A redirect loop in a blocking webRequest listener is a dead tab. Three rules, all
// cheap: a request id is rewritten at most once; a tab is rewritten at most N times in a
// window; and a tab that trips the limit is left alone until reset, with the popup told.

export function createGuard({ now = () => Date.now(), maxPerWindow = 3, windowMs = 10_000 } = {}) {
  const seen = new Set();         // request ids already rewritten
  const seenOrder = [];           // for pruning
  const perTab = new Map();       // tabId → [timestamps of rewrites]
  const disabled = new Map();     // tabId → { at, count }

  return {
    /** May this request be rewritten? Records it as rewritten if so. */
    allow(tabId, requestId) {
      if (requestId !== undefined && seen.has(requestId)) return { ok: false, reason: 'seen-request' };
      if (disabled.has(tabId)) return { ok: false, reason: 'disabled' };

      const t = now();
      const times = (perTab.get(tabId) ?? []).filter((x) => t - x < windowMs);
      if (times.length >= maxPerWindow) {
        disabled.set(tabId, { at: t, count: times.length + 1 });
        perTab.delete(tabId);
        return { ok: false, reason: 'rate-limited' };
      }
      times.push(t);
      perTab.set(tabId, times);

      if (requestId !== undefined) {
        seen.add(requestId);
        seenOrder.push(requestId);
        if (seenOrder.length > 2000) seen.delete(seenOrder.shift());
      }
      return { ok: true };
    },

    isDisabled: (tabId) => disabled.has(tabId),
    disabledTabs: () => [...disabled.entries()].map(([tabId, v]) => ({ tabId, ...v })),
    reset(tabId) { disabled.delete(tabId); perTab.delete(tabId); },
    forgetTab(tabId) { disabled.delete(tabId); perTab.delete(tabId); },
  };
}
