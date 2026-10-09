// Pure: openfootball's Football.TXT (github.com/openfootball, public domain, CC0) -> match rows. A season file is
// date blocks ("Sat Apr 2 2005", the year only on the first) under round headers ("▪ Matchday 1", "▪ Playoffs, Final"),
// one match a line:
//   16:00  CD Chivas   v D.C. United   0-2 (0-1)                      full time (half time)
//          FC Dallas   v Colorado Rapids 4-5 pen. 2-2 a.e.t. (1-1, 0-1) penalties, after extra time (full, half)
//          Seattle     v Houston      5-4 pen. (0-0)                    penalties (full time)
//          LAFC        v Seattle      1-2 a.e.t. (1-1, 0-0)             after extra time (full, half)
//          Colorado    v LAFC         [cancelled]
// A line without a time keeps the one before it. Times carry no zone (local to the ground), so dates are what count.

export interface OfMatch {
  season: number; round: string; playoffs: boolean; date: string; time: string | null; home: string; away: string;
  status: 'final' | 'cancelled' | 'scheduled'; ft: [number, number] | null; ht: [number, number] | null; aet: [number, number] | null; pen: [number, number] | null;
}

const MONTHS: Record<string, number> = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
const DATE = /^\s*(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+([A-Z][a-z]{2})\s+(\d{1,2})(?:\s+(\d{4}))?\s*$/;
const MATCH = /^\s+(?:(\d{1,2}:\d{2})\s+)?(\S.*?)\s+v\s+(\S.*?)\s{2,}(\S.*)$/;
const pair = (a: string, b: string): [number, number] => [Number(a), Number(b)];

/** The score part of a match line. Null when it is not a result (cancelled, or not played yet). */
export function parseScore(s: string): Pick<OfMatch, 'ft' | 'ht' | 'aet' | 'pen'> | null {
  let rest = s.trim();
  const first = /^(\d+)-(\d+)/.exec(rest);
  if (!first) return null;
  rest = rest.slice(first[0].length);
  let ft: [number, number] | null = null, aet: [number, number] | null = null, pen: [number, number] | null = null, ht: [number, number] | null = null;
  const x = pair(first[1]!, first[2]!);
  if (/^\s+pen\./.test(rest)) {
    pen = x; rest = rest.replace(/^\s+pen\./, '');
    const e = /^\s+(\d+)-(\d+)\s+a\.e\.t\./.exec(rest);
    if (e) { aet = pair(e[1]!, e[2]!); rest = rest.slice(e[0].length); }
  } else if (/^\s+a\.e\.t\./.test(rest)) { aet = x; rest = rest.replace(/^\s+a\.e\.t\./, ''); }
  else ft = x;
  const paren = /\(([^)]*)\)/.exec(rest);
  const inner = paren ? [...paren[1]!.matchAll(/(\d+)-(\d+)/g)].map((m) => pair(m[1]!, m[2]!)) : [];
  if (ft) ht = inner[0] ?? null;
  else { ft = inner[0] ?? null; ht = inner[1] ?? null; }
  return { ft, ht, aet, pen };
}

export function parseSeasonFile(text: string, season: number): OfMatch[] {
  const out: OfMatch[] = [];
  let round = '', date: string | null = null, time: string | null = null, year = season;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('▪')) { round = line.replace(/^▪\s*/, '').trim(); continue; }
    const d = DATE.exec(line);
    if (d) {
      if (d[3]) year = Number(d[3]);
      const month = MONTHS[d[1]!];
      if (!month) continue;
      date = `${year}-${String(month).padStart(2, '0')}-${String(Number(d[2])).padStart(2, '0')}`;
      time = null;
      continue;
    }
    const m = MATCH.exec(line);
    if (!m || !date) continue;
    if (m[1]) time = m[1].padStart(5, '0');
    const scorePart = m[4]!;
    const score = parseScore(scorePart);
    const status: OfMatch['status'] = score ? 'final' : /cancel|abandon|annul/i.test(scorePart) ? 'cancelled' : 'scheduled';
    out.push({
      season, round, playoffs: /playoff|final|cup/i.test(round) && !/^matchday/i.test(round), date, time, home: m[2]!.trim(), away: m[3]!.trim(), status,
      ft: score?.ft ?? null, ht: score?.ht ?? null, aet: score?.aet ?? null, pen: score?.pen ?? null,
    });
  }
  return out;
}

/** The score a match ended with (after extra time when there was some; penalties are not goals). */
export const finalScore = (m: OfMatch): [number, number] | null => m.aet ?? m.ft;
