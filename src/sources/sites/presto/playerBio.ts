// Best-effort Presto player bio parser: plain bio text plus honor-looking phrases.
import * as cheerio from 'cheerio';
import type { PlayerBio } from '../../../model.js';
import { ws } from './util.js';

const HONOR_RE = /\bAll-[A-Z]|\b(First|Second|Third|1st|2nd|3rd)[- ]Team\b|Player of the (Week|Year|Month)|Rookie of the (Week|Year)|Freshman of the (Week|Year)|Goalkeeper of the (Week|Year)|(Defensive|Offensive|Defender|Midfielder|Forward) of the (Week|Year)|Honor Roll|Honorable Mention|All-American|All-Conference|All-Region|All-Rookie|All-Academic|Academic All|Team of the Week|Scholar[- ]Athlete|Golden Boot|MVP\b|Most Valuable|Captain\b/i;

const MAX_BIO = 20000;

function candidateRoot($: cheerio.CheerioAPI) {
  const selectors = ['.bio-text', '.player-bio', '.bio-body', '#bio', '.bio', '.biography', 'article .content', 'article', 'main', 'body'];
  for (const sel of selectors) {
    const el = $(sel).first();
    if (el.length && ws(el.text()).length > 40) return el;
  }
  return $('body');
}

/** Split running text into sentence-ish chunks (also breaking on bullets and line-ish separators). */
function chunks(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9•\-–])|\s*[•|]\s*|\s{2,}/)
    .map((c) => ws(c))
    .filter(Boolean);
}

export function parsePlayerBio(html: string, sourceUrl: string): PlayerBio {
  const $ = cheerio.load(html);
  $('script, style, noscript, nav, header, footer, iframe, form, .navbar, .breadcrumb, .site-header, .site-footer').remove();
  const root = candidateRoot($);
  const honors: string[] = [];
  const seen = new Set<string>();
  const add = (s: string) => {
    const t = ws(s).replace(/^[•\-–*]\s*/, '');
    if (!t || t.length > 240) return;
    const k = t.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    honors.push(t);
  };
  // Structured honors lists: a heading mentioning honors/awards followed by a list.
  root.find('h2, h3, h4, h5, strong, b').each((_, h) => {
    if (!/honou?rs|awards|accolades/i.test($(h).text())) return;
    $(h)
      .nextAll('ul, ol')
      .first()
      .find('li')
      .each((__, li) => add($(li).text()));
  });
  root.find('li').each((_, li) => {
    const t = ws($(li).text());
    if (HONOR_RE.test(t)) add(t);
  });
  // Paragraph-level: keep sentences carrying an honor keyword.
  const paragraphs: string[] = [];
  root.find('p, div.bio-paragraph, li, h3, h4').each((_, p) => {
    if ($(p).find('p').length) return;
    const t = ws($(p).text());
    if (t) paragraphs.push(t);
  });
  const text = ws(paragraphs.length ? paragraphs.join('\n') : root.text());
  for (const c of chunks(text)) if (HONOR_RE.test(c)) add(c);
  const bioText = text ? text.slice(0, MAX_BIO) : null;
  return { honors, bioText, sourceUrl };
}
