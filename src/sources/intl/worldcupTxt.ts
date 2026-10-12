// Pure: openfootball's World Cup files (github.com/openfootball/worldcup, public domain, CC0) -> rows. One folder per
// tournament ("2022--qatar") with cup.txt (groups) and cup_finals.txt (knockouts), hand-kept Football.TXT:
//   = World Cup 2022       # in Qatar, November 20 - December 18
//   ▪ Group A
//   Sun Nov 20                                      (or "July 13" in the older files)
//     19:00   Qatar   0-2 (0-2)   Ecuador    @ Al Bayt Stadium, Al Khor
//             (Enner Valencia 16' (pen.), 31')                 scorers: read by the results source, not here
//     18:00   Japan   1-1 a.e.t (1-1, 1-0), 1-3 pen.  Croatia  @ Al Janoub Stadium, Al Wakrah
// A match not played yet has no score ("Mexico v South Africa"); it is skipped. Used to check the other sources'
// World Cup results, and for a tournament the others have not caught up with.
import { canonicalNation, nationKey } from './nations.js';
import type { IntlMatchRow } from './results.js';

export const WC_TXT_BASE = 'https://raw.githubusercontent.com/openfootball/worldcup/master';
export const WC_TXT_SOURCE = 'openfootball-wc';
/** The tournament folders (the repository's layout; a new one is added by hand when openfootball adds it). */
export const WC_FOLDERS = ['1930--uruguay', '1934--italy', '1938--france', '1950--brazil', '1954--switzerland', '1958--sweden', '1962--chile', '1966--england', '1970--mexico',
  '1974--west_germany', '1978--argentina', '1982--spain', '1986--mexico', '1990--italy', '1994--usa', '1998--france', '2002--south_korea-n-japan', '2006--germany',
  '2010--south_africa', '2014--brazil', '2018--russia', '2022--qatar', '2026--canada-usa-mexico'];

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const DATE = /^\s*(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\w*\.?\s+)?([A-Z][a-z]{2,8})\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?\s*(?:#.*)?$/;
const MONTH_WORD = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\.?';
const LEAD_DATE = new RegExp(`^\\s*(?:(\\d{1,2})\\s+(${MONTH_WORD})|(${MONTH_WORD})\\s+(\\d{1,2}))\\s+(\\S.*)$`);
// [time] home score [a.e.t] [(ft, ht)] [, p-q pen.] away [@ ground]
const MATCH = /^\s*(?:(\d{1,2}[:.]\d{2})(?:\s*(?:UTC|GMT)\s*[+-]?\d{1,2})?\s+)?([^\s(#▪=|].*?)\s+(\d+)-(\d+)(\s*a\.e\.t\.?)?(?:\s*\(([^)]*)\))?(?:,?\s*(\d+)-(\d+)\s*pen\.?)?\s+(\S.*?)(?:\s+@\s+(.*))?\s*$/;

export function parseWorldCupTxt(text: string): IntlMatchRow[] {
  const year = Number(/^=\s*World Cup\s+(\d{4})/m.exec(text)?.[1] ?? NaN);
  if (!Number.isFinite(year)) return [];
  const out: IntlMatchRow[] = [];
  let stage: string | null = null, date: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*#/.test(line) || !line.trim()) continue;
    if (line.startsWith('▪')) { stage = line.replace(/^▪\s*/, '').split('|')[0]!.trim() || null; continue; }
    const d = DATE.exec(line);
    if (d) {
      const month = MONTHS[d[1]!.slice(0, 3).toLowerCase()];
      if (month) { date = `${d[3] ?? year}-${String(month).padStart(2, '0')}-${String(Number(d[2])).padStart(2, '0')}`; continue; }
    }
    // The older files open each match line with its date instead: "8 June   West Germany  3-1  Argentina".
    let rest = line;
    const lead = LEAD_DATE.exec(line);
    if (lead) {
      const [dd, mon] = lead[1] ? [lead[1], lead[2]!] : [lead[4]!, lead[3]!];
      const month = MONTHS[mon.slice(0, 3).toLowerCase()];
      if (month) { date = `${year}-${String(month).padStart(2, '0')}-${String(Number(dd)).padStart(2, '0')}`; rest = ` ${lead[5]}`; }
    }
    const m = MATCH.exec(rest);
    if (!m || !date || /\bv\b/.test(m[2]!)) continue;
    const [, , homeRaw, h, a, aetFlag, , ph, pa, awayRaw, ground] = m;
    const home = canonicalNation(homeRaw!.trim()), away = canonicalNation(awayRaw!.trim());
    const pens = ph != null && pa != null;
    out.push({
      source: WC_TXT_SOURCE, gender: 'm', level: 'senior', date, home: nationKey(home), away: nationKey(away), home_name: home, away_name: away,
      home_score: Number(h), away_score: Number(a), pen_home: pens ? Number(ph) : null, pen_away: pens ? Number(pa) : null, aet: !!aetFlag || pens,
      shootout_winner: pens ? (Number(ph) > Number(pa) ? nationKey(home) : nationKey(away)) : null,
      tournament: 'FIFA World Cup', league_id: 1, stage, city: ground ? ground.split(',').pop()!.trim() || null : null, country: null, neutral: null, ext_id: null,
    });
  }
  return out;
}
