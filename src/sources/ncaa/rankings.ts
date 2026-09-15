// https://www.ncaa.com/rankings/soccer-men/d1/united-soccer-coaches — United Soccer Coaches poll.
// Table columns (2026-09): RANK, SCHOOL, FIRST-PLACE VOTES, RECORD, PREVIOUS, POINTS;
// `figure.rankings-last-updated` reads "Through Games SEP. 6, 2026".
import * as cheerio from 'cheerio';
import type { Division, Gender } from '../../model.js';
import { int } from '../../normalize/num.js';
import { sportPath } from './scoreboard.js';

export function uscPollUrl(gender: Gender, division: Division): string {
  return `https://www.ncaa.com/rankings/${sportPath(gender)}/${division}/united-soccer-coaches`;
}

export interface UscPollRow {
  rank: number;
  school: string;
  points: number | null;
  previous: number | null;
  record: string | null;
  firstPlaceVotes: number | null;
}

export interface UscPoll {
  /** Text of the "Through Games …" / "week of" figure, trimmed; null when absent. */
  weekOf: string | null;
  title: string | null;
  rows: UscPollRow[];
  /** "Utah Valley (7), Memphis (7), …" */
  othersReceivingVotes: { school: string; points: number | null }[];
}

function findCol(columns: string[], ...needles: string[]): number {
  return columns.findIndex((c) => needles.some((n) => c.includes(n)));
}

export function parseUscPoll(html: string): UscPoll {
  const $ = cheerio.load(html);
  const table = $('table').filter((_, t) => $(t).find('thead th').length > 0).first();
  const columns = table.find('thead th').map((_, th) => $(th).text().replace(/\s+/g, ' ').trim().toUpperCase()).get();
  const iRank = findCol(columns, 'RANK'), iSchool = findCol(columns, 'SCHOOL', 'TEAM');
  const iPoints = findCol(columns, 'POINTS'), iPrev = findCol(columns, 'PREVIOUS', 'PREV');
  const iRecord = findCol(columns, 'RECORD'), iFpv = findCol(columns, 'FIRST');
  const rows: UscPollRow[] = [];
  table.find('tbody tr').each((_, tr) => {
    const cells = $(tr).find('td').map((_, td) => $(td).text().replace(/\s+/g, ' ').trim()).get();
    if (cells.length === 0) return;
    // Tied ranks print as "T23".
    const rank = int(String(cells[iRank >= 0 ? iRank : 0] ?? '').replace(/^t-?/i, ''));
    const school = cells[iSchool >= 0 ? iSchool : 1] ?? '';
    if (rank == null || !school) return;
    rows.push({
      rank,
      school: school.replace(/\s*\(\d+\)\s*$/, ''),
      points: iPoints >= 0 ? int(cells[iPoints]) : null,
      previous: iPrev >= 0 ? int(cells[iPrev]) : null,
      record: iRecord >= 0 ? (cells[iRecord] || null) : null,
      firstPlaceVotes: iFpv >= 0 ? int(cells[iFpv]) : null,
    });
  });
  const weekOf = $('.rankings-last-updated').first().text().replace(/\s+/g, ' ').trim() || null;
  const title = $('title').first().text().split('|')[0]?.trim() || null;
  const blurb = $('.rankings-footer-blurb').text().replace(/\s+/g, ' ');
  const others: UscPoll['othersReceivingVotes'] = [];
  const om = blurb.match(/receiving votes:\s*(.+?)(?:\.|$)/i);
  if (om) {
    for (const part of om[1]!.split(/,\s*(?=[^()]*(?:\(|$))/)) {
      const m = part.trim().match(/^(.+?)\s*\((\d+)\)\s*$/);
      if (m) others.push({ school: m[1]!.trim(), points: int(m[2]) });
      else if (part.trim()) others.push({ school: part.trim(), points: null });
    }
  }
  return { weekOf, title, rows, othersReceivingVotes: others };
}
