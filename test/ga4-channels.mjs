// An independent re-implementation of GA4's default channel group rules, used as a test
// ORACLE — deliberately not shared with src/engine, so that a persona is checked against
// the rules rather than against the same code that produced it.
//
// Source: support.google.com/analytics/answer/9756891, read 2026-09-15.
// The site lists (which search/social/video sources Google recognises) are approximations
// of Google's published lists; every source this project emits is an unambiguous member of
// the list it is used with, so the approximation is not load-bearing.

const SEARCH = new Set(['google', 'bing', 'yahoo', 'duckduckgo', 'ecosia', 'baidu', 'yandex', 'ask', 'aol', 'brave']);
const SOCIAL = new Set(['facebook', 'instagram', 'twitter', 'x', 'linkedin', 'pinterest', 'tiktok', 'reddit', 'snapchat', 'threads', 'mastodon', 'bluesky']);
const VIDEO  = new Set(['youtube', 'vimeo', 'twitch', 'dailymotion']);

const PAID = /^(.*cp.*|ppc|retargeting|paid.*)$/;
const DISPLAY_MEDIUMS = new Set(['display', 'banner', 'expandable', 'interstitial', 'cpm']);
const SOCIAL_MEDIUMS = new Set(['social', 'social-network', 'social-media', 'sm']);
const REFERRAL_MEDIUMS = new Set(['referral', 'app', 'link']);
const EMAIL = /email|e-mail|e_mail|e mail/;

export function ga4Channel({ source = '', medium = '' }) {
  const s = String(source).toLowerCase();
  const m = String(medium).toLowerCase();

  if (s === '(direct)' && (m === '(none)' || m === '(not set)' || m === '')) return 'Direct';

  if (SEARCH.has(s) && PAID.test(m)) return 'Paid Search';
  if (SOCIAL.has(s) && PAID.test(m)) return 'Paid Social';
  if (VIDEO.has(s) && PAID.test(m)) return 'Paid Video';
  if (DISPLAY_MEDIUMS.has(m)) return 'Display';
  if (PAID.test(m)) return 'Paid Other';

  if (SOCIAL.has(s) || SOCIAL_MEDIUMS.has(m)) return 'Organic Social';
  if (VIDEO.has(s) || /video/.test(m)) return 'Organic Video';
  if (SEARCH.has(s) || m === 'organic') return 'Organic Search';

  if (m === 'ai-assistant') return 'AI Assistant';
  if (EMAIL.test(s) || EMAIL.test(m)) return 'Email';
  if (m === 'affiliate') return 'Affiliates';
  if (m === 'audio') return 'Audio';
  if (s === 'sms' || m === 'sms') return 'SMS';
  if (/push$/.test(m) || /notification|mobile/.test(m) || s === 'firebase') return 'Mobile Push Notifications';
  if (REFERRAL_MEDIUMS.has(m)) return 'Referral';

  return 'Unassigned';
}
