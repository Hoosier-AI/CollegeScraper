// Pure: a source's numbers against API-Football's, one row per field (pro_source_checks). Scores must be equal. Goals
// and assists must be equal for a finished season; in the current one they may be one apart (the two sources update
// their totals at different times). Minutes: American Soccer Analysis counts stoppage time and API-Football stops at
// 90 a match, so ASA's may run up to 20% (plus 15) above API-Football's and 10 below. Club totals are not compared:
// ASA's leave own goals out, and every club result is already checked game by game.
import type { AdvPlayerSeasonRow, SrcGameRow } from '../../sources/asa/parse.js';

export type CheckStatus = 'agree' | 'differ' | 'unmatched';
export interface CheckRow { source: string; kind: 'game' | 'player_season'; key: string; field: string; league_id: number; season: number; pro_key: string | null; ours: number | null; api: number | null; status: CheckStatus; checked_at: string }

export const minutesAgree = (ours: number, api: number) => ours >= api - 10 && ours <= api * 1.2 + 15;
const countsAgree = (ours: number, api: number, current: boolean) => (current ? Math.abs(ours - api) <= 1 : ours === api);

export function checkGame(g: SrcGameRow, f: { id: number; home_goals: number | null; away_goals: number | null; status: string; swapped?: boolean } | null, at = new Date().toISOString()): CheckRow[] {
  const base = { source: g.source, kind: 'game' as const, key: g.ext_id, league_id: g.league_id, season: g.season, checked_at: at };
  if (g.status !== 'final') return [];
  if (!f) return [{ ...base, field: 'game', pro_key: null, ours: null, api: null, status: 'unmatched' }];
  // API-Football has not got the final yet: nothing to compare.
  if (f.status !== 'final' || f.home_goals == null || f.away_goals == null) return [];
  const [h, a] = f.swapped ? [f.away_goals, f.home_goals] : [f.home_goals, f.away_goals];
  return [
    { ...base, field: 'home_goals', pro_key: String(f.id), ours: g.home_score, api: h, status: g.home_score === h ? 'agree' : 'differ' },
    { ...base, field: 'away_goals', pro_key: String(f.id), ours: g.away_score, api: a, status: g.away_score === a ? 'agree' : 'differ' },
  ];
}

export function checkPlayerSeason(r: AdvPlayerSeasonRow, api: { key: string; minutes: number | null; goals: number | null; assists: number | null } | null, at = new Date().toISOString(), current = false): CheckRow[] {
  const base = { source: r.source, kind: 'player_season' as const, key: `${r.player_ext}|${r.team_ext}`, league_id: r.league_id, season: r.season, checked_at: at };
  if (!r.minutes) return [];
  if (!api) return [{ ...base, field: 'player', pro_key: null, ours: null, api: null, status: 'unmatched' }];
  const out: CheckRow[] = [];
  if (api.minutes != null) out.push({ ...base, field: 'minutes', pro_key: api.key, ours: r.minutes, api: api.minutes, status: minutesAgree(r.minutes, api.minutes) ? 'agree' : 'differ' });
  if (r.goals != null && api.goals != null) out.push({ ...base, field: 'goals', pro_key: api.key, ours: r.goals, api: api.goals, status: countsAgree(r.goals, api.goals, current) ? 'agree' : 'differ' });
  if (r.assists != null && api.assists != null) out.push({ ...base, field: 'assists', pro_key: api.key, ours: r.assists, api: api.assists, status: countsAgree(r.assists, api.assists, current) ? 'agree' : 'differ' });
  return out;
}

/** Agreement of a league season's compared fields (unmatched rows count against it). Null with nothing compared. */
export function agreementRate(rows: { status: CheckStatus }[]): number | null {
  if (!rows.length) return null;
  return rows.filter((r) => r.status === 'agree').length / rows.length;
}
