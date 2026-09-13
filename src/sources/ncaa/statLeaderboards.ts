// https://www.ncaa.com/stats/soccer-men/d1/2024/individual/573 — server-rendered leaderboards.
// Category ids are enumerated by the two <select> lists (#select-container-individual / -team);
// pagination is `.../573/p2`; the pager `ul.stats-pager` lists every page.
import * as cheerio from 'cheerio';
import type { Division, Gender } from '../../model.js';
import { sportPath } from './scoreboard.js';

export type StatKind = 'individual' | 'team';

export interface StatCategory { id: number; name: string; path: string; kind: StatKind }
export interface StatCategories { individual: StatCategory[]; team: StatCategory[] }

export function statUrl(gender: Gender, division: Division, season: number | 'current', kind: StatKind, catId: number | string, page = 1): string {
  const base = `https://www.ncaa.com/stats/${sportPath(gender)}/${division}/${season}/${kind}/${catId}`;
  return page > 1 ? `${base}/p${page}` : base;
}

const PATH_RE = /^\/stats\/(soccer-(?:men|women))\/(d[123])\/(\d{4}|current)\/(individual|team)\/(\d+)(?:\/p(\d+))?$/;

export function parseStatCategories(html: string): StatCategories {
  const $ = cheerio.load(html);
  const out: StatCategories = { individual: [], team: [] };
  const seen = new Set<string>();
  $('select option[value]').each((_, o) => {
    const value = ($(o).attr('value') ?? '').trim();
    const m = value.match(PATH_RE);
    if (!m) return;
    const kind = m[4] as StatKind;
    const key = `${kind}/${m[5]}`;
    if (seen.has(key)) return;
    seen.add(key);
    out[kind].push({ id: Number(m[5]), name: $(o).text().replace(/\s+/g, ' ').trim(), path: value, kind });
  });
  return out;
}

export interface StatTable {
  title: string | null;
  updated: string | null;
  columns: string[];
  /** One record per row keyed by column header; `teamSeo` is added when the Team cell links a school. */
  rows: Record<string, string>[];
  page: number;
  pages: number;
}

export function parseStatTable(html: string): StatTable {
  const $ = cheerio.load(html);
  const table = $('table').filter((_, t) => $(t).find('thead th').length > 0).first();
  const columns = table.find('thead th').map((_, th) => $(th).text().replace(/\s+/g, ' ').trim()).get();
  const rows: Record<string, string>[] = [];
  table.find('tbody tr').each((_, tr) => {
    const cells = $(tr).find('td');
    if (cells.length === 0) return;
    const row: Record<string, string> = {};
    cells.each((i, td) => {
      const col = columns[i] ?? `col${i}`;
      row[col] = $(td).text().replace(/\s+/g, ' ').trim();
      const link = $(td).find('a[href^="/schools/"]').attr('href');
      if (link) row.teamSeo = link.replace(/^\/schools\//, '').split(/[/?#]/)[0]!;
    });
    rows.push(row);
  });
  const pageLis = $('ul.stats-pager li').filter((_, li) => !/stats-pager__li--(prev|next)/.test($(li).attr('class') ?? ''));
  let page = 1, pages = 1;
  if (pageLis.length > 0) {
    pages = pageLis.length;
    const activeIdx = pageLis.toArray().findIndex((li) => /\bactive\b/.test($(li).attr('class') ?? ''));
    page = activeIdx >= 0 ? activeIdx + 1 : 1;
    // Trust explicit /pN links when they go beyond the li count.
    $('ul.stats-pager a[href]').each((_, a) => {
      const m = ($(a).attr('href') ?? '').match(/\/p(\d+)$/);
      if (m) pages = Math.max(pages, Number(m[1]));
    });
  }
  const title = $('.stats-header__lower__title').first().text().replace(/\s+/g, ' ').trim() || null;
  const updated = $('.stats-header__lower__desc').first().text().replace(/\s+/g, ' ').trim() || null;
  return { title, updated, columns, rows, page, pages };
}
