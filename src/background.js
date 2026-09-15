// The event page. PRODUCT.md §7.3A, §10.1, §10.2.
//
// Deliberately thin: everything that decides anything lives in navigation.js, visits.js
// and guard.js, which are pure and tested in Node. This file owns the browser: it
// registers the blocking listener, keeps the registry's tab bookkeeping honest, sweeps
// expired visits, and answers the popup.
//
// Firefox MV3 runs this as a non-persistent EVENT PAGE, not a service worker. Listeners
// are registered synchronously at top level so Firefox can wake the page for them.
// Whether a blocking webRequest listener reliably survives an event-page suspension is
// the M2 exit check that has to be done in a real profile — see PRODUCT.md §10.2.

import { DATA } from './data.js';
import { createRegistry } from './visits.js';
import { createGuard } from './guard.js';
import { handleNavigation, DEFAULT_SETTINGS } from './navigation.js';

const registry = createRegistry({ data: DATA });
const guard = createGuard();
let settings = { ...DEFAULT_SETTINGS };

// Settings arrive asynchronously; until they do, the defaults apply. The defaults are
// the conservative ones, so the window in which they apply is safe.
browser.storage.sync.get('settings').then(({ settings: s }) => {
  settings = { ...DEFAULT_SETTINGS, ...(s ?? {}) };
}).catch(() => { /* defaults stand */ });

browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.settings) {
    settings = { ...DEFAULT_SETTINGS, ...(changes.settings.newValue ?? {}) };
  }
});

// Top-level document navigations only (§8.1 F1.4). Sub-resources, XHR, frames and
// WebSockets are never seen here, let alone touched.
browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    const result = handleNavigation(
      { url: details.url, tabId: details.tabId, requestId: details.requestId },
      { registry, guard, data: DATA, settings },
    );
    return result.redirectUrl ? { redirectUrl: result.redirectUrl } : {};
  },
  { urls: ['<all_urls>'], types: ['main_frame'] },
  ['blocking'],
);

// tabs.onRemoved needs no "tabs" permission — only tab URLs and titles do.
browser.tabs.onRemoved.addListener((tabId) => {
  registry.detachTab(tabId);
  guard.forgetTab(tabId);
});

browser.alarms.create('sweep-visits', { periodInMinutes: 5 });
browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'sweep-visits') registry.sweep();
});

// The popup (M5) asks for this. Never includes seeds.
browser.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'status') {
    return Promise.resolve({
      visits: registry.snapshot(),
      disabledTabs: guard.disabledTabs(),
      settings,
    });
  }
  if (msg?.type === 'reset-guard' && Number.isInteger(msg.tabId)) {
    guard.reset(msg.tabId);
    return Promise.resolve({ ok: true });
  }
  return undefined;
});
