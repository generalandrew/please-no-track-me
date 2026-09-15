// A fake DOM just big enough to execute src/content/rewriter.js honestly: elements with
// attributes, absolute `href` resolution against a base URL, querySelectorAll for the two
// selectors the rewriter uses, open shadow roots, and a MutationObserver-shaped observer
// whose records the test hands over by hand. Nothing here is a general DOM.

export class FakeElement {
  constructor(tagName, attrs = {}, { base = 'https://page.example.com/dir/index.html' } = {}) {
    this.tagName = tagName.toUpperCase();
    this.attrs = new Map(Object.entries(attrs));
    this.children = [];
    this.shadowRoot = null;
    this.base = base;
    this.writes = [];                       // every setAttribute, for assertions
  }
  get href() {
    const a = this.attrs.get('href');
    if (a === undefined) return '';
    try { return new URL(a, this.base).href; } catch { return a; }
  }
  hasAttribute(n) { return this.attrs.has(n); }
  getAttribute(n) { return this.attrs.has(n) ? this.attrs.get(n) : null; }
  setAttribute(n, v) { this.attrs.set(n, String(v)); this.writes.push([n, String(v)]); }
  removeAttribute(n) { this.attrs.delete(n); }
  append(...els) { this.children.push(...els); return this; }
  attachShadow() { this.shadowRoot = new FakeRoot(this.base); return this.shadowRoot; }
  *descendants() { for (const c of this.children) { yield c; yield* c.descendants(); } }
  querySelectorAll(sel) {
    const all = [...this.descendants()];
    if (sel === '*') return all;
    if (sel === 'a[href], area[href]') return all.filter((e) => (e.tagName === 'A' || e.tagName === 'AREA') && e.attrs.has('href'));
    throw new Error(`fake DOM does not understand selector ${sel}`);
  }
}

export class FakeRoot extends FakeElement {
  constructor(base) { super('#root', {}, { base }); }
}

export function link(href, extra = {}, opts) { return new FakeElement('a', { href, ...extra }, opts); }

/** Fake observe(): captures the callback so a test can feed it records. */
export function fakeObserver() {
  const o = { cb: null };
  o.observe = (root, cb) => { o.cb = cb; };
  o.emit = (records) => o.cb && o.cb(records);
  return o;
}

/** Fake requestIdleCallback: runs callbacks when the test says so, with a deadline. */
export function fakeScheduler({ timeRemaining = 50 } = {}) {
  const queue = [];
  return {
    schedule: (fn) => queue.push(fn),
    async run() { while (queue.length) await queue.shift()({ timeRemaining: () => timeRemaining }); },
    pending: () => queue.length,
  };
}
