// Pure: martj42/international_results (github.com/martj42/international_results, CC0) -> rows. Four CSV files:
//   results.csv      date,home_team,away_team,home_score,away_score,tournament,city,country,neutral
//   goalscorers.csv  date,home_team,away_team,team,scorer,minute,own_goal,penalty,assist   (assist: World Cups, else NA)
//   shootouts.csv    date,home_team,away_team,winner,first_shooter
//   former_names.csv current,former,start_date,end_date
// Every men's senior international since 1872 (about 50k), updated within days. Scores include extra time and leave
// penalty shoot-outs out, like API-Football's. Names are the reference spellings (see nations.ts).
import { csvFields } from '../footballData/parse.js';
import { nationKey } from './nations.js';

export const RESULTS_BASE = 'https://raw.githubusercontent.com/martj42/international_results/master';
export const RESULTS_SOURCE = 'intl-results';

export interface IntlMatchRow {
  source: string; gender: 'm' | 'w'; level: 'senior' | 'youth'; date: string; home: string; away: string; home_name: string; away_name: string;
  home_score: number | null; away_score: number | null; pen_home: number | null; pen_away: number | null; aet: boolean | null; shootout_winner: string | null;
  tournament: string; league_id: number | null; stage: string | null; city: string | null; country: string | null; neutral: boolean | null; ext_id: string | null;
}
export interface IntlGoalRow {
  source: string; gender: 'm' | 'w'; date: string; home: string; away: string; seq: number; team: string; scorer: string;
  minute: number | null; stoppage: number | null; own_goal: boolean; penalty: boolean; assist: string | null; ext_player: string | null;
}
export interface IntlShootoutRow { source: string; gender: 'm' | 'w'; date: string; home: string; away: string; winner: string; first_shooter: string | null }

/** martj42's tournament names -> our competition (pro_leagues id). Qualifiers for the World Cup span six competitions,
 *  one per confederation, so they are matched by fixture instead. */
export const TOURNAMENT_LEAGUE: Record<string, number> = {
  'FIFA World Cup': 1, 'UEFA Euro': 4, 'UEFA Nations League': 5, 'African Cup of Nations': 6, 'AFC Asian Cup': 7, 'Copa América': 9, Friendly: 10,
  'African Nations Championship': 19, 'Confederations Cup': 21, 'Gold Cup': 22, 'EAFF Championship': 23, 'AFF Championship': 24, 'Gulf Cup': 25, 'SAFF Cup': 28,
  'AFC Asian Cup qualification': 35, 'African Cup of Nations qualification': 36, 'CECAFA Cup': 535, 'CONCACAF Nations League': 536, 'Pacific Games': 770,
  'CFU Caribbean Cup': 804, 'UNCAF Cup': 805, 'Oceania Nations Cup': 806, 'AFC Challenge Cup': 807, 'CONCACAF Nations League qualification': 808, 'Baltic Cup': 849,
  'Gold Cup qualification': 858, 'COSAFA Cup': 859, 'Arab Cup': 860, 'Kirin Cup': 916, 'UEFA Euro qualification': 960, "King's Cup": 1038, 'FIFA Series': 1222,
};

/** Tournaments of teams outside FIFA (CONIFA, the Island Games, regional sides): kept as results, left out of rankings. */
export const NON_FIFA_TOURNAMENT = /\bCONIFA\b|island games|viva world cup|muratti vase|\bELF Cup\b|\bWild Cup\b|\bInter Games\b|Niamh Challenge|Corsica|Padania|Occitania|Tynwald|Euro(peada)?\b.*\bminorit|UNIFFAC|Atlantic Heritage/i;

const val = (v: string | undefined) => (v == null || v === '' || v === 'NA' ? null : v);
const int = (v: string | undefined) => { const s = val(v); if (s == null) return null; const n = Number(s); return Number.isFinite(n) ? n : null; };
const bool = (v: string | undefined) => (val(v) == null ? null : /^true$/i.test(v!));

function rows(text: string): Record<string, string>[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const head = csvFields(lines[0] ?? '');
  return lines.slice(1).map((l) => { const f = csvFields(l); return Object.fromEntries(head.map((h, i) => [h, f[i] ?? ''])); });
}

const matchKey = (date: string, home: string, away: string) => `${date}|${home}|${away}`;

export function parseResults(text: string): IntlMatchRow[] {
  const seen = new Set<string>();
  const out: IntlMatchRow[] = [];
  for (const r of rows(text)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date ?? '') || !r.home_team || !r.away_team) continue;
    const home = nationKey(r.home_team), away = nationKey(r.away_team);
    // A replay on the same day between the same sides would collide; the first is kept (none in the file today).
    const k = matchKey(r.date!, home, away);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({
      source: RESULTS_SOURCE, gender: 'm', level: 'senior', date: r.date!, home, away, home_name: r.home_team, away_name: r.away_team,
      home_score: int(r.home_score), away_score: int(r.away_score), pen_home: null, pen_away: null, aet: null, shootout_winner: null,
      tournament: r.tournament || 'Unknown', league_id: TOURNAMENT_LEAGUE[r.tournament ?? ''] ?? null, stage: null,
      city: val(r.city), country: val(r.country), neutral: bool(r.neutral), ext_id: null,
    });
  }
  return out;
}

/** Goals in file order per match (seq 1, 2, ...). "90+3" style minutes keep their stoppage time when present. */
export function parseGoals(text: string): IntlGoalRow[] {
  const seq = new Map<string, number>();
  const out: IntlGoalRow[] = [];
  for (const r of rows(text)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date ?? '') || !r.home_team || !r.away_team || !r.scorer || r.scorer === 'NA') continue;
    const home = nationKey(r.home_team), away = nationKey(r.away_team);
    const k = matchKey(r.date!, home, away);
    const n = (seq.get(k) ?? 0) + 1; seq.set(k, n);
    const m = /^(\d+)(?:\+(\d+))?/.exec(r.minute ?? '');
    out.push({
      source: RESULTS_SOURCE, gender: 'm', date: r.date!, home, away, seq: n, team: nationKey(r.team ?? ''), scorer: r.scorer.trim(),
      minute: m ? Number(m[1]) : null, stoppage: m?.[2] ? Number(m[2]) : null, own_goal: bool(r.own_goal) ?? false, penalty: bool(r.penalty) ?? false,
      assist: val(r.assist)?.trim() ?? null, ext_player: null,
    });
  }
  return out;
}

export function parseShootouts(text: string): IntlShootoutRow[] {
  return rows(text).filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date ?? '') && r.home_team && r.away_team && r.winner)
    .map((r) => ({ source: RESULTS_SOURCE, gender: 'm' as const, date: r.date!, home: nationKey(r.home_team!), away: nationKey(r.away_team!), winner: nationKey(r.winner!), first_shooter: val(r.first_shooter) ? nationKey(r.first_shooter!) : null }));
}

export interface FormerName { current: string; former: string; from: string | null; to: string | null }
export function parseFormerNames(text: string): FormerName[] {
  return rows(text).filter((r) => r.current && r.former).map((r) => ({ current: nationKey(r.current!), former: r.former!, from: val(r.start_date), to: val(r.end_date) }));
}

/** The shoot-out result onto its match (the winner took it; the score of a shoot-out is not in the file). */
export function applyShootouts(matches: IntlMatchRow[], shootouts: IntlShootoutRow[]): void {
  const by = new Map(shootouts.map((s) => [matchKey(s.date, s.home, s.away), s]));
  for (const m of matches) { const s = by.get(matchKey(m.date, m.home, m.away)); if (s) m.shootout_winner = s.winner; }
}
