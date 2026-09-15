// Registrable domain (eTLD+1) — the key a visit is scoped to. PRODUCT.md §7.1, §16.3.
//
// There is no WebExtension API for this. The full Public Suffix List is ~230 KB and
// changes monthly; bundling it is the correct answer eventually. Until then: a compact
// list of the multi-part suffixes that actually occur in ordinary browsing, plus the
// private-section entries where sibling subdomains are unrelated sites (alice.github.io
// is not bob.github.io). Everything else falls back to the last two labels.
//
// The failure mode of a missing entry is a visit scoped one label too wide — two
// unrelated sites sharing a persona — which is a plausibility cost, not a safety one.
// Nothing in never-touch or strip-only depends on this function.

const MULTI_PART = new Set([
  // ccTLD second levels
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'net.uk', 'nhs.uk', 'sch.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'id.au',
  'co.nz', 'org.nz', 'net.nz', 'govt.nz', 'ac.nz',
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp', 'ad.jp',
  'com.br', 'net.br', 'org.br', 'gov.br', 'edu.br',
  'co.in', 'net.in', 'org.in', 'gov.in', 'ac.in', 'firm.in',
  'co.za', 'org.za', 'gov.za', 'ac.za', 'net.za',
  'com.mx', 'org.mx', 'gob.mx', 'edu.mx',
  'com.ar', 'org.ar', 'gob.ar',
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn',
  'com.tw', 'org.tw', 'gov.tw', 'edu.tw',
  'com.hk', 'org.hk', 'gov.hk', 'edu.hk',
  'com.sg', 'org.sg', 'gov.sg', 'edu.sg',
  'com.my', 'org.my', 'gov.my', 'edu.my',
  'co.kr', 'or.kr', 'go.kr', 'ac.kr', 'ne.kr',
  'co.id', 'or.id', 'go.id', 'ac.id',
  'com.tr', 'org.tr', 'gov.tr', 'edu.tr',
  'com.ua', 'org.ua', 'gov.ua', 'edu.ua',
  'com.pl', 'org.pl', 'gov.pl', 'edu.pl',
  'co.il', 'org.il', 'ac.il', 'gov.il', 'muni.il',
  'com.eg', 'com.sa', 'com.ng', 'co.ke', 'com.ph', 'com.vn', 'com.pk', 'com.bd',
  'com.co', 'com.pe', 'com.ve', 'com.ec', 'com.uy', 'com.py', 'com.bo', 'cl',
  'co.th', 'or.th', 'go.th', 'ac.th', 'in.th',
  'com.es', 'org.es', 'gob.es', 'nom.es',
  'com.pt', 'edu.pt', 'gov.pt',
  'co.at', 'or.at', 'ac.at', 'gv.at',
  'com.gr', 'org.gr', 'gov.gr',
  'com.ru', 'org.ru', 'net.ru', 'msk.ru', 'spb.ru',
  // Private section: platforms whose subdomains are unrelated sites
  'github.io', 'gitlab.io', 'netlify.app', 'vercel.app', 'herokuapp.com', 'blogspot.com',
  'web.app', 'pages.dev', 'workers.dev', 'azurewebsites.net', 'cloudfront.net',
  'wixsite.com', 'squarespace.com', 'myshopify.com', 'substack.com', 'medium.com',
  'wordpress.com', 'tumblr.com', 'weebly.com', 'glitch.me', 'repl.co', 'fly.dev',
  'onrender.com', 'surge.sh', 'firebaseapp.com', 'appspot.com', 'ngrok.io', 'ngrok.app',
]);

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** @param {string} host — as from URL.hostname (already lowercase, may be bracketed IPv6) */
export function registrableDomain(host) {
  if (!host) return '';
  let h = host.toLowerCase();
  if (h.endsWith('.')) h = h.slice(0, -1);
  if (h.startsWith('[') || IPV4.test(h) || !h.includes('.')) return h;

  const labels = h.split('.');
  const lastTwo = labels.slice(-2).join('.');
  const lastThree = labels.slice(-3).join('.');

  // A three-part public suffix (rare; e.g. some *.ac.jp-style municipal ones) is not
  // handled — the two-part table covers the cases that occur in practice.
  if (MULTI_PART.has(lastTwo)) {
    // The host IS the suffix (e.g. someone visiting github.io itself) — keep it whole.
    return labels.length >= 3 ? lastThree : h;
  }
  return lastTwo;
}

/** True when two hosts belong to the same visit. */
export function sameSite(hostA, hostB) {
  return registrableDomain(hostA) === registrableDomain(hostB);
}
