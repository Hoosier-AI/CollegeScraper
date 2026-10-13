// Server-rendered News pages (/news, /pro/news, /intl/news): the headlines as links to the outlets, each with
// the teams and players it is about (links to our pages). An ItemList, not articles: the stories are the outlets'.
import { abs, breadcrumbs, NOINDEX, ogImage, SUFFIX, type HeadContext, type HeadMeta } from './head.js';
import { a, wrapBody } from './body.js';
import { esc, longDate, SITE_NAME } from './util.js';
import type { Story } from '../news/queries.js';
import { KIND_LABEL } from '../news/classify.js';

export type NewsArea = 'college' | 'pro' | 'international';
const AREA: Record<NewsArea, { path: string; title: string; h1: string; description: string; crumbs: { name: string; path: string }[] }> = {
  college: { path: '/news', title: 'College Soccer News: Every NCAA Team', h1: 'College soccer news', description: 'The latest college soccer news from every NCAA program: results, previews, injuries, commitments, coaching changes and awards, linked to team and player stats.', crumbs: [{ name: SITE_NAME, path: '/' }, { name: 'News', path: '/news' }] },
  pro: { path: '/pro/news', title: 'Pro Soccer News: MLS, NWSL and the World', h1: 'Pro soccer news', description: 'Pro soccer news, US first: MLS, NWSL, USL and Americans abroad, then the top leagues. Injuries, transfers, coaching changes and results, linked to club and player stats.', crumbs: [{ name: `${SITE_NAME} Pro`, path: '/pro' }, { name: 'News', path: '/pro/news' }] },
  international: { path: '/intl/news', title: 'International Soccer News: USMNT, USWNT and National Teams', h1: 'International soccer news', description: 'National team news, the USMNT and USWNT first: call-ups, injuries, results and qualifying, linked to player and team stats.', crumbs: [{ name: `${SITE_NAME} International`, path: '/intl' }, { name: 'News', path: '/intl/news' }] },
};

export function newsHead(area: NewsArea, stories: Story[], ctx: HeadContext): HeadMeta {
  const x = AREA[area];
  return {
    title: `${x.title}${SUFFIX}`, description: x.description, canonical: abs(ctx, x.path), robots: stories.length ? null : NOINDEX, ogType: 'website', image: ogImage(ctx),
    jsonLd: [
      breadcrumbs(ctx, x.crumbs),
      { '@context': 'https://schema.org', '@type': 'ItemList', name: x.h1, itemListElement: stories.slice(0, 20).map((s, i) => ({ '@type': 'ListItem', position: i + 1, url: s.url, name: s.title })) },
    ],
  };
}

export function newsBody(area: NewsArea, stories: Story[]): string {
  const x = AREA[area];
  const li = (s: Story) => {
    const about = s.links.filter((l) => l.href).slice(0, 4).map((l) => a(l.href!, l.label)).join(', ');
    const kind = s.kinds[0] ? ` (${esc(KIND_LABEL[s.kinds[0]] ?? s.kinds[0])})` : '';
    return `<li><a href="${esc(s.url)}" rel="nofollow noopener">${esc(s.title)}</a>, ${esc(s.publisher)}, ${esc(longDate(s.published_at.slice(0, 10)))}${kind}${about ? `. About ${about}` : ''}</li>`;
  };
  return wrapBody(area === 'college' ? 'home' : 'pro', x.crumbs, `<h1>${esc(x.h1)}</h1><p>${esc(x.description)}</p><ul>${stories.slice(0, 40).map(li).join('')}</ul>`);
}
