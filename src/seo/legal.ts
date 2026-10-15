// Server-rendered policy pages (/about, /terms, /privacy, /sources ...): the same text as the app's (src/legal/content.ts),
// escaped, for search engines and no-JavaScript readers.
import { inlineParts, LEGAL, UPDATED, type Block, type LegalSlug } from '../legal/content.js';
import { abs, breadcrumbs, ogImage, SUFFIX, type HeadContext, type HeadMeta } from './head.js';
import { wrapBody } from './body.js';
import { clip, esc, SITE_NAME } from './util.js';

const inline = (s: string) => inlineParts(s).map((p) => ('href' in p ? `<a href="${esc(p.href)}">${esc(p.text)}</a>` : esc(p.text))).join('');
const block = (b: Block) => (typeof b === 'string' ? `<p>${inline(b)}</p>`
  : 'bullets' in b ? `<ul>${b.bullets.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>`
  : `<table><thead><tr>${b.table.head.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${b.table.rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);

export function legalHead(slug: LegalSlug, ctx: HeadContext): HeadMeta {
  const p = LEGAL[slug];
  return { title: `${p.title}${SUFFIX}`, description: clip(p.description), canonical: abs(ctx, p.path), robots: null, ogType: 'website', image: ogImage(ctx),
    jsonLd: [breadcrumbs(ctx, [{ name: SITE_NAME, path: '/' }, { name: p.title, path: p.path }])] };
}

export function legalBody(slug: LegalSlug): string {
  const p = LEGAL[slug];
  const sections = p.sections.map((s) => `<section id="${esc(s.id)}"><h2>${esc(s.heading)}</h2>${s.blocks.map(block).join('')}</section>`).join('');
  return wrapBody('home', [{ name: SITE_NAME, path: '/' }, { name: p.title, path: p.path }], `<h1>${esc(p.title)}</h1><p>Last updated ${esc(UPDATED)}</p><p>${inline(p.intro)}</p>${sections}`);
}
