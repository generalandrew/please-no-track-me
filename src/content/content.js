// Wires the rewriter to the real page. Runs after rewriter.js in the same sandbox.
// PRODUCT.md §8.3 F3.6: some pages are never touched — the manifest's matches already
// exclude non-http schemes; AMO is excluded here.

(() => {
  if (/(^|\.)addons\.mozilla\.org$/i.test(location.hostname)) return;

  const idle = typeof requestIdleCallback === 'function'
    ? (fn) => requestIdleCallback(fn, { timeout: 1000 })
    : (fn) => setTimeout(() => fn({ timeRemaining: () => 8 }), 50);

  const rewriter = createLinkRewriter({
    root: document,
    pageUrl: location.href,
    send: (msg) => browser.runtime.sendMessage(msg),
    schedule: idle,
    observe: (root, cb) => {
      const mo = new MutationObserver(cb);
      mo.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['href', 'ping'] });
    },
  });

  browser.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'restore') { rewriter.restore(); return Promise.resolve({ ok: true, restored: rewriter.stats.restored }); }
    if (msg?.type === 'resume') { rewriter.resume(); return Promise.resolve({ ok: true }); }
    if (msg?.type === 'page-stats') return Promise.resolve({ ...rewriter.stats });
    return undefined;
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => rewriter.start(), { once: true });
  } else {
    rewriter.start();
  }
})();
