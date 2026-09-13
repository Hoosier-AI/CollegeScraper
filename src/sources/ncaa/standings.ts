// https://www.ncaa.com/standings/soccer-men/d1
//
// The standings ARE server-rendered — but only once the NCAA publishes them for the season. Both
// the recorded fixture (2026-09-11) and the live page that day contain an empty
// `<article class="overflowable-table-region">` and "Last Updated  EDT" with no tables, so
// `parseStandings` returns zero conferences for them. A populated page (verified live against
// /standings/football/fbs the same day; henrygd/ncaa-api parses the identical markup) looks like:
//
//   <figure class="standings-last-updated">Last Updated Sep 11, 2026 03:38 AM EDT</figure>
//   <figure class="standings-conference"><img …>ACC</figure>
//   <div class="table-wrap"><table>
//     <tr class="standings-table-header"><th class="school-col">School</th><th colspan="3">Conference</th><th colspan="…">Overall</th></tr>
//     <tr class="standings-table-subheader"><th></th><th class="wl">W</th><th class="wl">L</th><th class="wl">T</th>…</tr>
//     <tbody><tr><td class="standings-team"><img src="…/logos/schools/bgl/duke.svg">Duke</td><td>1</td>…</tr></tbody>
//   </table></div>
//
// `parseHenrygdStandings` accepts the same data via a self-hosted henrygd instance
// (`/standings/soccer-men/d1` → {updated, data:[{conference, standings:[{"School","Conference W",…}]}]}).
import * as cheerio from 'cheerio';
import type { Division, Gender } from '../../model.js';
import { int } from '../../normalize/num.js';
import { sportPath } from './scoreboard.js';

export function standingsUrl(gender: Gender, division: Division): string {
  return `https://www.ncaa.com/standings/${sportPath(gender)}/${division}`;
}

export interface WLT { w: number | null; l: number | null; t: number | null }

export interface StandingsRow {
  school: string;
  /** seo slug derived from the logo image, when present. */
  seo: string | null;
  conference: WLT;
  overall: WLT;
  /** Every cell keyed by merged header ("Conference W", "Overall PCT", …). */
  raw: Record<string, string>;
}

export interface ConferenceStandings { conference: string; rows: StandingsRow[] }

export interface Standings {
  updated: string | null;
  conferences: ConferenceStandings[];
}

function wlt(raw: Record<string, string>, group: string): WLT {
  const g = (k: string) => int(raw[`${group} ${k}`] ?? raw[`${group} ${k}`.toUpperCase()] ?? null);
  return { w: g('W'), l: g('L'), t: g('T') };
}

function rowFromRaw(school: string, seo: string | null, raw: Record<string, string>): StandingsRow {
  return { school, seo, conference: wlt(raw, 'Conference'), overall: wlt(raw, 'Overall'), raw };
}

/** Merge the two header rows ("Conference" colspan=3 + "W L T" → "Conference W", …). */
function mergedHeaders($: cheerio.CheerioAPI, table: cheerio.Cheerio<import('domhandler').Element>): string[] {
  const top: string[] = [];
  const rowOne = table.find('tr.standings-table-header').first();
  const rowTwo = table.find('tr.standings-table-subheader').first();
  if (rowOne.length === 0) {
    return table.find('thead th, tr:first-child th').map((_, th) => $(th).text().replace(/\s+/g, ' ').trim()).get();
  }
  rowOne.find('th').each((_, th) => {
    const span = Number($(th).attr('colspan')) || 1;
    const text = $(th).text().replace(/\s+/g, ' ').trim();
    for (let i = 0; i < span; i++) top.push(text);
  });
  if (rowTwo.length === 0) return top;
  const out: string[] = [];
  rowTwo.find('th').each((i, th) => {
    const sub = $(th).text().replace(/\s+/g, ' ').trim();
    const head = top[i] ?? '';
    out.push(sub ? `${head} ${sub}`.trim() : head);
  });
  return out;
}

export function parseStandings(html: string): Standings {
  const $ = cheerio.load(html);
  const updated = $('.standings-last-updated').first().text().replace(/\s+/g, ' ').replace(/^Last Updated\s*/i, '').trim() || null;
  const conferences: ConferenceStandings[] = [];
  $('.standings-conference').each((_, fig) => {
    const conference = $(fig).text().replace(/\s+/g, ' ').trim();
    let table = $(fig).next();
    if (!table.is('table')) table = table.find('table').first();
    if (table.length === 0) table = $(fig).nextAll().find('table').first();
    if (table.length === 0) return;
    const headers = mergedHeaders($, table);
    const rows: StandingsRow[] = [];
    table.find('tbody tr, tr').each((_, tr) => {
      if (/subdiv-header|standings-table-(sub)?header/.test($(tr).attr('class') ?? '')) return;
      const cells = $(tr).find('td');
      if (cells.length === 0) return;
      const raw: Record<string, string> = {};
      cells.each((i, td) => { raw[headers[i] ?? `col${i}`] = $(td).text().replace(/\s+/g, ' ').trim(); });
      const schoolCell = cells.first();
      const school = raw[headers[0] ?? 'col0'] ?? schoolCell.text().trim();
      const img = schoolCell.find('img[src]').attr('src') ?? '';
      const seo = img.match(/\/logos\/schools\/bg[ld]\/([a-z0-9-]+)\.svg/)?.[1] ?? null;
      if (!school) return;
      rows.push(rowFromRaw(school, seo, raw));
    });
    conferences.push({ conference, rows });
  });
  return { updated, conferences };
}

/** Same result from a henrygd/ncaa-api `/standings/{sport}/{division}` response. */
export function parseHenrygdStandings(json: unknown): Standings {
  const doc = (typeof json === 'string' ? JSON.parse(json) : json) as { updated?: string; data?: { conference?: string; standings?: Record<string, string>[] }[] };
  const conferences: ConferenceStandings[] = [];
  for (const c of doc.data ?? []) {
    const rows = (c.standings ?? []).map((raw) => rowFromRaw(raw.School ?? raw.school ?? '', null, raw)).filter((r) => r.school);
    conferences.push({ conference: c.conference ?? '', rows });
  }
  return { updated: doc.updated?.trim() || null, conferences };
}
