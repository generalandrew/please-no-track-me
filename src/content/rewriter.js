// The in-page link rewriter. PRODUCT.md §8.3, §10.5.
//
// A plain script, not a module: Firefox content scripts share one sandbox scope, so
// content.js (listed after this in the manifest) sees `createLinkRewriter` as a global,
// and test/m3 loads this file with `vm` and executes it against a fake DOM.
//
// Owns the DOM and nothing else. It finds link elements, batches their absolute hrefs to
// the background (which decides against the one visit registry), and writes back what
// comes back. Idempotent and non-destructive: an element is processed once per href
// value, its original attribute is kept for restore, and the observer recognises the
// rewriter's own writes and ignores them.

function createLinkRewriter({
  root,                         // document (or a fake)
  pageUrl,                      // location.href
  send,                         // async ({type:'links', pageUrl, hrefs}) => {rewrites, counts}
  schedule,                     // (fn(deadline)) => void   — requestIdleCallback or a fallback
  observe,                      // (root, cb(records)) => void — wraps MutationObserver
  batchCap = 2000,
  sliceMs = 8,                  // stop a pass after this long and reschedule
}) {
  const done = new WeakSet();       // elements processed for their current href
  const original = new WeakMap();   // element → original href attribute
  const written = new WeakMap();    // element → the href attribute we last wrote
  const pending = new Set();        // elements awaiting a batch
  let scheduled = false;
  let paused = false;
  let started = false;
  const stats = { scanned: 0, stripped: 0, substituted: 0, pings: 0, batches: 0, restored: 0 };

  const isLink = (el) => el && (el.tagName === 'A' || el.tagName === 'AREA') && el.hasAttribute('href');

  // a[href], area[href] under `node`, including open shadow roots. §8.3 F3.3.
  function collect(node, out = []) {
    if (!node) return out;
    if (isLink(node)) out.push(node);
    if (typeof node.querySelectorAll === 'function') {
      for (const el of node.querySelectorAll('a[href], area[href]')) out.push(el);
      for (const host of node.querySelectorAll('*')) {
        if (host.shadowRoot) collect(host.shadowRoot, out);
      }
    }
    if (node.shadowRoot) collect(node.shadowRoot, out);
    return out;
  }

  function enqueue(els) {
    for (const el of els) if (!done.has(el)) pending.add(el);
    if (pending.size && !scheduled && !paused) {
      scheduled = true;
      schedule(pass);
    }
  }

  // The `ping` attribute exists to POST to a tracker on click. §8.3 F3.2.
  function dropPing(el) {
    if (el.tagName === 'A' && el.hasAttribute('ping')) { el.removeAttribute('ping'); stats.pings++; }
  }

  // Apply a rewritten absolute URL to the element's attribute while keeping the
  // attribute's form: a relative or query-only href stays that way, only the query and
  // fragment change. Falls back to the absolute URL if the attribute is unparseable.
  function attributeFor(el, newHref) {
    const attr = el.getAttribute('href') ?? '';
    try {
      const nu = new URL(newHref);
      const base = attr.split(/[?#]/)[0];
      if (base === '' && !attr.startsWith('?') && !attr.startsWith('#')) return newHref;
      return base + nu.search + nu.hash;
    } catch { return newHref; }
  }

  function apply(byHref, rewrites) {
    for (const [href, els] of byHref) {
      const next = rewrites[href];
      for (const el of els) {
        done.add(el);
        if (!next || next === href) continue;
        if (!original.has(el)) original.set(el, el.getAttribute('href'));
        const attr = attributeFor(el, next);
        written.set(el, attr);
        el.setAttribute('href', attr);
      }
    }
  }

  async function pass(deadline) {
    scheduled = false;
    if (paused) return;
    const byHref = new Map();
    const t0 = Date.now();
    let n = 0;
    for (const el of pending) {
      pending.delete(el);
      if (done.has(el)) continue;
      stats.scanned++;
      dropPing(el);
      const href = el.href;                       // absolute, resolved by the DOM
      if (typeof href !== 'string' || !/^https?:/i.test(href)) { done.add(el); continue; }
      if (!byHref.has(href)) byHref.set(href, []);
      byHref.get(href).push(el);
      n++;
      const out = deadline && typeof deadline.timeRemaining === 'function' ? deadline.timeRemaining() < 1 : Date.now() - t0 > sliceMs;
      if (n >= batchCap || out) break;
    }
    if (byHref.size) {
      stats.batches++;
      let reply = null;
      try { reply = await send({ type: 'links', pageUrl, hrefs: [...byHref.keys()] }); } catch { /* background asleep: leave links alone */ }
      if (reply && reply.rewrites) {
        apply(byHref, reply.rewrites);
        stats.stripped += reply.counts?.stripped ?? 0;
        stats.substituted += reply.counts?.substituted ?? 0;
      } else {
        for (const els of byHref.values()) for (const el of els) done.add(el);
      }
    }
    if (pending.size && !scheduled && !paused) { scheduled = true; schedule(pass); }
  }

  function onMutations(records) {
    const els = [];
    for (const r of records) {
      if (r.type === 'attributes') {
        const el = r.target;
        if (!isLink(el)) continue;
        // Our own write, arriving as a mutation record: ignore, do not un-mark.
        if (r.attributeName === 'href' && written.get(el) === el.getAttribute('href')) continue;
        if (r.attributeName === 'ping') { dropPing(el); continue; }
        done.delete(el);
        els.push(el);
      } else if (r.type === 'childList') {
        for (const node of r.addedNodes ?? []) collect(node, els);
      }
    }
    if (els.length) enqueue(els);
  }

  return {
    start() {
      if (started) return;
      started = true;
      enqueue(collect(root));
      observe(root, onMutations);
    },
    /** Put every rewritten link back and stop rewriting (per-site pause, §8.5). */
    restore() {
      paused = true;
      pending.clear();
      for (const el of collect(root)) {
        if (original.has(el)) {
          const attr = original.get(el);
          if (attr === null) el.removeAttribute('href'); else el.setAttribute('href', attr);
          written.set(el, attr);
          original.delete(el);
          done.delete(el);
          stats.restored++;
        }
      }
    },
    resume() { if (!paused) return; paused = false; enqueue(collect(root)); },
    flush: pass,
    stats,
    _internals: { done, original, written, pending, collect, attributeFor },
  };
}

globalThis.createLinkRewriter = createLinkRewriter;
