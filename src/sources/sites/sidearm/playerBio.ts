// Sidearm player bio page: /sports/{sportSlug}/roster/{first-last}/{rosterPlayerId}
// Nextgen pages render the bio inside the first tab panel of `.c-rosterpage__tabs`
// (`.s-text-paragraph-longform`); legacy pages use `.sidearm-roster-player-bio` / `.c-rosterbio__player__bio`.
import { load, type CheerioAPI } from 'cheerio';
import type { PlayerBio } from '../../../model.js';
import { collapse } from './common.js';

const BIO_SELECTORS = [
  '.c-rosterbio__player__bio',
  '.s-person-details__bio',
  '.sidearm-roster-player-bio',
  '#sidearm-roster-player-bio',
  '.c-rosterpage__tabs .s-tab-item .s-text-paragraph-longform',
  '.c-rosterpage__tabs .s-tab-item--selected',
  '.c-rosterpage__tabs [role="tabpanel"]',
  '.legacy_to_next',
  '.sidearm-roster-player-bio-content',
  '.bio-content',
  '[class*="__bio"]',
  'article',
];

export const HONOR_KEYWORDS = /\bAll-[A-Z]|First[- ]Team|Second[- ]Team|Third[- ]Team|Honorable Mention|Player of the (?:Year|Week|Month)|Rookie of the (?:Year|Week)|Freshman of the (?:Year|Week)|Newcomer of the Year|Defender of the Year|Midfielder of the Year|Goalkeeper of the Year|Coach of the Year|Academic All-|Team Captain|\bMVP\b|Best XI|TopDrawerSoccer|United Soccer Coaches|Hermann|All-Tournament|All-Region|All-State|All-Conference|All-American|All-America\b|Scholar[- ]Athlete|Dean'?s List|Golden (?:Boot|Glove|Ball)|Preseason (?:Team|Watch)|Watch List/i;

/** Text of an element with block/line breaks turned into spaces so words don't run together. */
function blockText($: CheerioAPI, el: ReturnType<CheerioAPI>): string {
  const clone = el.clone();
  clone.find('script, style, noscript, svg, img, button').remove();
  clone.find('br').replaceWith(' ');
  clone.find('p, div, li, h1, h2, h3, h4, h5, h6, tr, section, article, blockquote').each((_, e) => { $(e).append(' ').prepend(' '); });
  return clone.text();
}

function pickContainer($: CheerioAPI): ReturnType<CheerioAPI> | null {
  for (const sel of BIO_SELECTORS) {
    const found = $(sel).filter((_, e) => (collapse($(e).text())?.length ?? 0) >= 40).first();
    if (found.length) return found;
  }
  return null;
}

/** Split bio prose into candidate phrases: sentences, "…"-separated clauses, bullets, semicolons. */
export function splitPhrases(text: string): string[] {
  return text
    .replace(/[…]|\.{3,}/g, ' | ')
    .replace(/\s*[•·▪]\s*/g, ' | ')
    .replace(/;\s+/g, ' | ')
    .replace(/(?<!\b(?:Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec|vs|No|St|Jr|Sr|Mr|Mrs|Dr|Ms|Univ|Inc))(?<=[A-Za-z]{3}|[0-9)\]"'”])\.\s+(?=[A-Za-z0-9(“"'])/g, '. | ')
    .split('|')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length >= 8);
}

export function extractHonors(text: string, maxLen = 200): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const phrase of splitPhrases(text)) {
    if (!HONOR_KEYWORDS.test(phrase)) continue;
    let p = phrase.replace(/^[^A-Za-z0-9#(]+/, '').replace(/[\s.]+$/, '');
    if (p.length > maxLen) p = `${p.slice(0, maxLen - 1).replace(/\s+\S*$/, '')}…`;
    const key = p.toLowerCase();
    if (!p || seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

/** Parse a Sidearm bio page into honors + plain bio text. */
export function parsePlayerBio(html: string, url: string): PlayerBio {
  const $ = load(html);
  const container = pickContainer($);
  const bioText = container ? collapse(blockText($, container)) : null;
  return { honors: bioText ? extractHonors(bioText) : [], bioText, sourceUrl: url };
}
