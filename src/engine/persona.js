// Derives a visit persona from a seed. PRODUCT.md §9.4.
//
// The persona is the coherent story a site is told on entry: one channel, and a source,
// medium and campaign that all agree with it. Every URL substituted during the visit uses
// this same persona — a site that receives two different arrival stories in one session
// learns that something is fabricating them.

import { makeRng } from './rng.js';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const SEASONS = ['winter', 'spring', 'summer', 'fall'];

function runGenerator(name, now) {
  switch (name) {
    case 'current-year': return String(now.getFullYear());
    case 'current-quarter': return 'q' + (Math.floor(now.getMonth() / 3) + 1);
    case 'current-month-abbrev': return MONTHS[now.getMonth()];
    default: return null;
  }
}

/** Seasons are northern-hemisphere meteorological; §9.4 constraint 4 only needs "not stale". */
function currentSeason(now) {
  return SEASONS[Math.floor(((now.getMonth() + 1) % 12) / 3)];
}

/**
 * Which channels are still possible given the tokens already present in the URL?
 *
 * §9.4 constraint 2: the incoming parameter set is the stronger constraint. A URL carrying
 * fbclid must not produce a paid-search persona, because the token's own shape is preserved
 * and would contradict the story around it.
 */
export function constrainChannels(incomingNames, data) {
  const all = Object.keys(data.vocabularies.channels);
  let candidates = all;
  const conflicts = [];

  for (const name of incomingNames) {
    const entry = data.trackingParams.params.find((p) => p.name.toLowerCase() === name);
    if (!entry || entry.class !== 'C3' || !entry.grammar) continue;
    const grammar = data.grammars.grammars[entry.grammar];
    if (!grammar?.channels?.length) continue;

    const next = candidates.filter((c) => grammar.channels.includes(c));
    if (next.length === 0) {
      // Two tokens from contradictory vendors — it happens in the wild (a link shared out
      // of an ad click, say). The first constraint keeps precedence and we record it.
      conflicts.push(name);
    } else {
      candidates = next;
    }
  }

  // utm_term is the paid-keyword field. Emitting it outside a paid channel is a tell.
  if (incomingNames.includes('utm_term')) {
    const paid = data.vocabularies.params.utm_term?.channels ?? [];
    const narrowed = candidates.filter((c) => paid.includes(c));
    if (narrowed.length) candidates = narrowed;
  }

  return { candidates, conflicts };
}

function buildCampaign(rng, channel, data, now) {
  const { templates, slots, separators } = data.campaigns;
  const usable = templates.filter((t) => t.channels.includes(channel));
  if (!usable.length) return null;

  const template = rng.pick(usable);
  const sep = rng.pick(separators.candidates);

  return template.pattern.replace(/\{(\w+)\}/g, (_, slot) => {
    if (slot === 'sep') return sep;
    const spec = slots[slot];
    if (!spec) return '';
    if (spec.kind === 'generator') return runGenerator(spec.generator, now) ?? '';
    if (slot === 'season' && spec.coherentWith === 'current-date') return currentSeason(now);
    return rng.pick(spec.values);
  });
}

/**
 * @param {object}   opts
 * @param {string}   opts.seed          random per visit, from crypto.getRandomValues
 * @param {object}   opts.data          the bundled taxonomy
 * @param {string[]} opts.incomingNames lowercased parameter names present in the URL
 * @param {Date}     [opts.now]
 */
export function derivePersona({ seed, data, incomingNames = [], now = new Date() }) {
  const rng = makeRng(seed);
  const { candidates, conflicts } = constrainChannels(incomingNames, data);
  const channel = rng.pickWeighted(candidates, (c) => data.vocabularies.channels[c].weight ?? 1);
  const spec = data.vocabularies.channels[channel];

  return {
    seed,
    channel,
    ga4Channel: spec.ga4,
    source: rng.pick(spec.sources),
    medium: rng.pick(spec.mediums),
    campaign: buildCampaign(rng, channel, data, now),
    separator: rng.pick(data.campaigns.separators.candidates),
    conflicts,
    rng, // handed onward so C4 substitution keeps drawing from the same stream
  };
}
