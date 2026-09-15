// The §8.3 F3.5 budget, measured. Two numbers: the engine's cost per 1,000 links
// (decideLinks, which runs in the background), and the rewriter's own DOM-side cost per
// 1,000 elements on the fake DOM with a free `send` — the latter isolates our logic from
// the browser's, so it measures what the extension adds, not what layout costs.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { loadData } from '../../tools/load-data.mjs';
import { createRegistry } from '../../src/visits.js';
import { decideLinks } from '../../src/links.js';
import { FakeRoot, link } from './fakedom.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const data = loadData();
const sandbox = { globalThis: null, Date, URL, WeakSet, WeakMap, Set, Map, console };
sandbox.globalThis = sandbox;
vm.runInNewContext(readFileSync(join(ROOT, 'src/content/rewriter.js'), 'utf8'), sandbox);

const N = 1000;
const PAGE = 'https://news.example.com/today';
const mix = (i) => (i % 3 === 0
  ? `https://news.example.com/a${i}?utm_source=sidebar&utm_medium=link&x=${i}`
  : i % 3 === 1
    ? `https://site${i % 40}.org/b?utm_source=news&utm_medium=referral&fbclid=IwAR9xQlmBz3kKpQ7vN${i}`
    : `https://site${i % 40}.org/plain${i}`);

function bestOf(runs, fn) {
  let best = Infinity;
  for (let r = 0; r < runs; r++) { const t = performance.now(); fn(); best = Math.min(best, performance.now() - t); }
  return best;
}

// Engine: fresh registry each run so cross-domain links take the substitute path.
const hrefs = Array.from({ length: N }, (_, i) => mix(i));
decideLinks(PAGE, hrefs, { registry: createRegistry({ data }), data });          // warm
const engineMs = bestOf(7, () => decideLinks(PAGE, hrefs, { registry: createRegistry({ data }), data }));

// Rewriter: DOM-side only. `send` returns a precomputed answer instantly.
const answer = decideLinks(PAGE, hrefs, { registry: createRegistry({ data }), data });
async function domPass() {
  const root = new FakeRoot();
  root.append(...hrefs.map((h) => link(h)));
  const rw = sandbox.createLinkRewriter({ root, pageUrl: PAGE, send: async () => answer,
    schedule: (fn) => fn({ timeRemaining: () => 1e9 }), observe: () => {} });
  const t = performance.now();
  rw.start();
  await rw.flush({ timeRemaining: () => 1e9 });
  return performance.now() - t;
}
let domMs = Infinity;
for (let r = 0; r < 7; r++) domMs = Math.min(domMs, await domPass());

const ENGINE_BUDGET = 25;   // ms per 1,000 links in the background, best-of-7; measured 5.6 on 2026-09-16
const DOM_BUDGET = 5;       // ms per 1,000 elements of rewriter logic, §8.3 F3.5
console.log(`engine   ${engineMs.toFixed(2)} ms / ${N} links   (budget ${ENGINE_BUDGET})`);
console.log(`rewriter ${domMs.toFixed(2)} ms / ${N} elements (budget ${DOM_BUDGET}, fake DOM, send free)`);
const ok = engineMs <= ENGINE_BUDGET && domMs <= DOM_BUDGET;
console.log(ok ? '\nwithin budget' : '\nOVER BUDGET');
process.exit(ok ? 0 : 1);
