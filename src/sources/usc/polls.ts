// unitedsoccercoaches.org publishes every poll of the season on one page per list:
// https://unitedsoccercoaches.org/rankings/college-rankings/ncaa-di-men/ (also ncaa-di-women, ncaa-dii-men, …).
// Markup: <div class="poll_table" poll_id="…"><h2>National - Poll 3 - September 8, 2026</h2>
//   <table class="rankingsTable"> Rank | School | Prev | 1st Votes | Total Points | W-L-T </table>
//   <p class="pollNotes">Records shown are through games of …</p><p class="otherTeams">Also receiving votes: A (7), B (4)</p></div>
import * as cheerio from 'cheerio';
import type { Division, Gender } from '../../model.js';
import { int } from '../../normalize/num.js';

export function uscSiteUrl(gender: Gender, division: Division): string {
  const div = division === 'd1' ? 'di' : division === 'd2' ? 'dii' : 'diii';
  return `https://unitedsoccercoaches.org/rankings/college-rankings/ncaa-${div}-${gender === 'w' ? 'women' : 'men'}/`;
}

export interface UscSiteRow { rank: number; school: string; previous: number | null; firstPlaceVotes: number | null; points: number | null; record: string | null }
export interface UscSitePoll {
  /** "Pre-season Poll", "Poll 3" */
  label: string;
  /** ISO date parsed from the heading. */
  publishedOn: string | null;
  headingRaw: string;
  notes: string | null;
  rows: UscSiteRow[];
  alsoReceiving: { school: string; points: number | null }[];
}
export interface UscSite { title: string | null; polls: UscSitePoll[] }

const MONTHS: Record<string, number> = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
export function parseUscDate(s: string): string | null {
  const m = s.match(/([A-Za-z]+)\.?\s+(\d{1,2}),\s*(\d{4})/);
  if (!m) return null;
  const mo = MONTHS[m[1]!.toLowerCase()] ?? MONTHS[Object.keys(MONTHS).find((k) => k.startsWith(m[1]!.toLowerCase().slice(0, 3))) ?? ''];
  if (!mo) return null;
  return `${m[3]}-${String(mo).padStart(2, '0')}-${m[2]!.padStart(2, '0')}`;
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

export function parseOthers(text: string): { school: string; points: number | null }[] {
  const body = text.replace(/^.*?receiving votes:\s*/i, '').replace(/\.\s*$/, '');
  const out: { school: string; points: number | null }[] = [];
  for (const part of body.split(/,\s*(?=[^()]*(?:\(|$))/)) {
    const m = part.trim().match(/^(.+?)\s*\((\d+)\)\s*$/);
    if (m) out.push({ school: m[1]!.trim(), points: int(m[2]) });
    else if (part.trim()) out.push({ school: part.trim(), points: null });
  }
  return out;
}

export function parseUscSite(html: string): UscSite {
  const $ = cheerio.load(html);
  const title = clean($('h1.entry-title').first().text()) || null;
  const polls: UscSitePoll[] = [];
  const containers = $('.poll_table');
  const blocks = containers.length ? containers.toArray() : $('table').toArray().map((t) => $(t).parent().get(0)!);
  for (const el of blocks) {
    const $b = $(el);
    const table = $b.find('table').first();
    if (!table.length) continue;
    let heading = clean($b.find('h2, h3').first().text());
    if (!heading) heading = clean(table.prevAll('h2, h3').first().text());
    const hm = heading.match(/(?:National\s*[-–]\s*)?((?:Pre-?\s?season|Preseason) Poll|Poll\s*\d+|Final Poll)\s*[-–]\s*(.+)$/i);
    const label = hm ? clean(hm[1]!).replace(/^Preseason/i, 'Pre-season') : heading;
    const publishedOn = parseUscDate(hm ? hm[2]! : heading);
    const columns = table.find('thead th').map((_, th) => clean($(th).text()).toLowerCase()).get();
    const col = (...needles: string[]) => columns.findIndex((c) => needles.some((n) => c.includes(n)));
    const iRank = col('rank'), iSchool = col('school', 'team'), iPrev = col('prev'), iFpv = col('1st', 'first'), iPts = col('total', 'points'), iRec = col('w-l', 'record');
    const rows: UscSiteRow[] = [];
    table.find('tbody tr').each((_, tr) => {
      const cells = $(tr).find('td').map((_, td) => clean($(td).text())).get();
      if (!cells.length) return;
      const rank = int(cells[iRank >= 0 ? iRank : 0]);
      const school = cells[iSchool >= 0 ? iSchool : 1] ?? '';
      if (rank == null || !school) return;
      rows.push({ rank, school: school.replace(/\s*\(\d+\)\s*$/, ''), previous: iPrev >= 0 ? int(cells[iPrev]) : null, firstPlaceVotes: iFpv >= 0 ? int(cells[iFpv]) : null, points: iPts >= 0 ? int(cells[iPts]) : null, record: iRec >= 0 ? (cells[iRec] || null) : null });
    });
    const notes = clean($b.find('.pollNotes').first().text()) || null;
    const othersText = clean($b.find('.otherTeams').first().text());
    polls.push({ label, publishedOn, headingRaw: heading, notes, rows, alsoReceiving: othersText ? parseOthers(othersText) : [] });
  }
  // Chronological: pre-season first, then poll 1..N (the page lists the active poll first).
  polls.sort((a, b) => (a.publishedOn ?? '').localeCompare(b.publishedOn ?? '') || pollOrder(a.label) - pollOrder(b.label));
  return { title, polls };
}

function pollOrder(label: string): number {
  if (/pre-?season/i.test(label)) return 0;
  const m = label.match(/(\d+)/);
  return m ? Number(m[1]) : 99;
}
