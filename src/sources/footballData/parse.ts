// Pure: football-data.co.uk's season CSVs (free downloads, credited) -> match rows with the match stats. One file per
// league and season at https://football-data.co.uk/mmz4281/<yyzz>/<code>.csv, e.g. 2425/E0.csv for the 2024-25
// Premier League. Columns we read (the rest are betting odds, never stored):
//   Div, Date (dd/mm/yy or dd/mm/yyyy), Time (from 2019, UK time), HomeTeam, AwayTeam, FTHG, FTAG, HTHG, HTAG, Referee,
//   HS, AS (shots), HST, AST (on target), HF, AF (fouls), HC, AC (corners), HY, AY (yellow), HR, AR (red).

export const FD_BASE = 'https://football-data.co.uk/mmz4281';

export interface FdLeague { league: number; code: string; name: string; country: string; first: number }

/** API-Football league id for each football-data division code (men's top divisions with match stats). */
export const FD_LEAGUES: FdLeague[] = [
  { league: 39, code: 'E0', name: 'Premier League', country: 'eng', first: 2000 },
  { league: 40, code: 'E1', name: 'Championship', country: 'eng', first: 2000 },
  { league: 41, code: 'E2', name: 'League One', country: 'eng', first: 2000 },
  { league: 42, code: 'E3', name: 'League Two', country: 'eng', first: 2000 },
  { league: 43, code: 'EC', name: 'National League', country: 'eng', first: 2005 },
  { league: 179, code: 'SC0', name: 'Scottish Premiership', country: 'sco', first: 2000 },
  { league: 180, code: 'SC1', name: 'Scottish Championship', country: 'sco', first: 2000 },
  { league: 78, code: 'D1', name: 'Bundesliga', country: 'ger', first: 2000 },
  { league: 79, code: 'D2', name: '2. Bundesliga', country: 'ger', first: 2000 },
  { league: 135, code: 'I1', name: 'Serie A', country: 'ita', first: 2000 },
  { league: 136, code: 'I2', name: 'Serie B', country: 'ita', first: 2000 },
  { league: 140, code: 'SP1', name: 'La Liga', country: 'esp', first: 2000 },
  { league: 141, code: 'SP2', name: 'Segunda División', country: 'esp', first: 2000 },
  { league: 61, code: 'F1', name: 'Ligue 1', country: 'fra', first: 2000 },
  { league: 62, code: 'F2', name: 'Ligue 2', country: 'fra', first: 2000 },
  { league: 88, code: 'N1', name: 'Eredivisie', country: 'ned', first: 2000 },
  { league: 144, code: 'B1', name: 'Belgian Pro League', country: 'bel', first: 2000 },
  { league: 94, code: 'P1', name: 'Primeira Liga', country: 'por', first: 2000 },
  { league: 203, code: 'T1', name: 'Süper Lig', country: 'tur', first: 2000 },
  { league: 197, code: 'G1', name: 'Greek Super League', country: 'gre', first: 2000 },
];
export const fdLeagueFor = (league: number): FdLeague | undefined => FD_LEAGUES.find((l) => l.league === league);

/** "2425" for the season starting in 2024. */
export const fdSeasonDir = (season: number): string => `${String(season % 100).padStart(2, '0')}${String((season + 1) % 100).padStart(2, '0')}`;
export const fdUrl = (l: Pick<FdLeague, 'code'>, season: number): string => `${FD_BASE}/${fdSeasonDir(season)}/${l.code}.csv`;

export interface FdMatch {
  date: string; time: string | null; home: string; away: string;
  hg: number | null; ag: number | null; hthg: number | null; htag: number | null; referee: string | null;
  stats: { home: FdSide; away: FdSide } | null;
}
export interface FdSide { shots: number | null; shots_on: number | null; fouls: number | null; corners: number | null; yellow: number | null; red: number | null }

/** One CSV line into fields (quoted fields allowed, though the files rarely use them). */
export function csvFields(line: string): string[] {
  const out: string[] = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i]!;
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i += 1; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const num = (v: string | undefined): number | null => { if (v == null || v.trim() === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

/** "16/08/2024" or "16/08/24" -> "2024-08-16" (two-digit years are 19xx above 50). */
export function fdDate(v: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(v.trim());
  if (!m) return null;
  const y = m[3]!.length === 2 ? (Number(m[3]) > 50 ? 1900 : 2000) + Number(m[3]) : Number(m[3]);
  return `${y}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
}

export function parseFdCsv(text: string): FdMatch[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() && !/^,+$/.test(l));
  if (!lines.length) return [];
  const head = csvFields(lines[0]!).map((h) => h.trim());
  const at = (name: string) => head.indexOf(name);
  const col = Object.fromEntries(['Date', 'Time', 'HomeTeam', 'AwayTeam', 'FTHG', 'FTAG', 'HTHG', 'HTAG', 'Referee', 'HS', 'AS', 'HST', 'AST', 'HF', 'AF', 'HC', 'AC', 'HY', 'AY', 'HR', 'AR'].map((k) => [k, at(k)]));
  // Older files call the clubs HT / AT.
  if (col.HomeTeam! < 0) col.HomeTeam = at('HT');
  if (col.AwayTeam! < 0) col.AwayTeam = at('AT');
  const out: FdMatch[] = [];
  for (const line of lines.slice(1)) {
    const f = csvFields(line);
    const get = (k: string) => (col[k]! >= 0 ? f[col[k]!] : undefined);
    const date = fdDate(get('Date') ?? '');
    const home = (get('HomeTeam') ?? '').trim(), away = (get('AwayTeam') ?? '').trim();
    if (!date || !home || !away) continue;
    const side = (h: boolean): FdSide => ({ shots: num(get(h ? 'HS' : 'AS')), shots_on: num(get(h ? 'HST' : 'AST')), fouls: num(get(h ? 'HF' : 'AF')), corners: num(get(h ? 'HC' : 'AC')), yellow: num(get(h ? 'HY' : 'AY')), red: num(get(h ? 'HR' : 'AR')) });
    const hs = side(true), as = side(false);
    const any = Object.values(hs).some((v) => v != null) || Object.values(as).some((v) => v != null);
    const t = (get('Time') ?? '').trim();
    out.push({
      date, time: /^\d{1,2}:\d{2}$/.test(t) ? t.padStart(5, '0') : null, home, away,
      hg: num(get('FTHG')), ag: num(get('FTAG')), hthg: num(get('HTHG')), htag: num(get('HTAG')), referee: (get('Referee') ?? '').trim() || null,
      stats: any ? { home: hs, away: as } : null,
    });
  }
  return out;
}
