// Reads of the real tournaments (migration 208): the NCAA bracket, one conference tournament's bracket and every D1
// conference tournament of a season (champion or where it stands). Games are marked by sweep-scoreboard (NCAA) and
// classify-postseason (conferences); src/college/bracket.ts lays them out.
import type { Db } from '../db/client.js';
import { selectAll } from '../db/client.js';
import { memo } from '../pro/memo.js';
import { conferenceBracket, ncaaBracket, type Bracket, type BracketRow, type BracketTeam } from './bracket.js';

const COLS = 'id,game_date,status,gender,division,bracket_slot,round_number,tournament_round,tournament,tournament_conference_id,home_program_id,away_program_id,home_name,away_name,home_short_name,away_short_name,home_seo,away_seo,home_logo,away_logo,home_score,away_score,home_seed,away_seed,overtime,shootout,neutral_site,shootout_winner';
const FRESH = { fresh: 5 * 60_000 };

export interface NcaaBracketView { season: number; gender: 'm' | 'w'; bracket: Bracket; first: string | null; last: string | null }

/** The NCAA tournament bracket (Division I), or null before the field is announced. */
export async function ncaaBracketFor(db: Db, season: number, gender: 'm' | 'w'): Promise<NcaaBracketView | null> {
  return memo(`ncaa-bracket:${season}:${gender}`, async () => {
    const rows = await selectAll<BracketRow & { game_date: string }>(db, 'college_v_schedule', COLS,
      (q) => q.eq('season', season).eq('gender', gender).eq('division', 'd1').eq('postseason', true).not('bracket_slot', 'is', null).order('id'));
    const bracket = ncaaBracket(rows);
    if (!bracket) return null;
    const dates = rows.map((r) => r.game_date).sort();
    return { season, gender, bracket, first: dates[0] ?? null, last: dates.at(-1) ?? null };
  }, FRESH);
}

export interface ConferenceTournamentView {
  season: number; gender: 'm' | 'w';
  conference: { id: string; name: string; short: string | null };
  name: string; bracket: Bracket; first: string; last: string;
  status: 'done' | 'live' | 'upcoming';
}

function view(season: number, gender: 'm' | 'w', conf: { id: string; name: string; short_name: string | null }, rows: (BracketRow & { tournament: string | null })[]): ConferenceTournamentView | null {
  const bracket = conferenceBracket(rows);
  if (!bracket) return null;
  const dates = rows.map((r) => r.game_date).sort();
  const anyPlayed = rows.some((r) => r.status === 'final');
  // Finished once the final is played (a final won on penalties we have no shootout for has no champion, but is over).
  const final = bracket.rounds.at(-1)?.games[0];
  return {
    season, gender, conference: { id: conf.id, name: conf.name, short: conf.short_name ?? null },
    name: rows[0]?.tournament ?? `${conf.short_name ?? conf.name} Tournament`, bracket, first: dates[0]!, last: dates.at(-1)!,
    status: final?.status === 'final' ? 'done' : anyPlayed ? 'live' : 'upcoming',
  };
}

/** One conference's tournament (by gender), or null when none has been found for that season. */
export async function conferenceTournament(db: Db, season: number, conference: string, gender: 'm' | 'w'): Promise<ConferenceTournamentView | null> {
  return memo(`conf-tourney:${season}:${conference}:${gender}`, async () => {
    const [rows, confs] = await Promise.all([
      selectAll<any>(db, 'college_v_schedule', COLS, (q) => q.eq('season', season).eq('gender', gender).eq('tournament_conference_id', conference).order('id')),
      selectAll<{ id: string; name: string; short_name: string | null }>(db, 'college_conferences', 'id,name,short_name', (q) => q.eq('id', conference)),
    ]);
    if (!rows.length || !confs[0]) return null;
    return view(season, gender, confs[0], rows);
  }, FRESH);
}

export interface ConferenceTournamentSummary {
  conference: { id: string; name: string; short: string | null };
  name: string; status: 'done' | 'live' | 'upcoming'; first: string; last: string; teams: number;
  champion: BracketTeam | null;
  /** The final (or the latest round played), for a one-line result. */
  final: { home: BracketTeam | null; away: BracketTeam | null; shootout: boolean; date: string | null } | null;
}

/** Every D1 conference tournament of a season for one gender: champion, or where it stands. */
export async function conferenceTournaments(db: Db, season: number, gender: 'm' | 'w'): Promise<{ season: number; gender: 'm' | 'w'; tournaments: ConferenceTournamentSummary[] }> {
  return memo(`conf-tourneys:${season}:${gender}`, async () => {
    const [rows, confs] = await Promise.all([
      selectAll<any>(db, 'college_v_schedule', COLS, (q) => q.eq('season', season).eq('gender', gender).eq('postseason', true).not('tournament_conference_id', 'is', null).order('id')),
      selectAll<{ id: string; name: string; short_name: string | null }>(db, 'college_conferences', 'id,name,short_name', (q) => q.order('id')),
    ]);
    const conf = new Map(confs.map((c) => [c.id, c]));
    const groups = new Map<string, any[]>();
    for (const r of rows) groups.set(r.tournament_conference_id, [...(groups.get(r.tournament_conference_id) ?? []), r]);
    const out: ConferenceTournamentSummary[] = [];
    for (const [id, list] of groups) {
      const c = conf.get(id);
      if (!c) continue;
      const v = view(season, gender, c, list);
      if (!v) continue;
      const top = [...v.bracket.rounds].reverse().find((r) => r.games.some(Boolean));
      const f = top?.games.find(Boolean) ?? null;
      out.push({ conference: v.conference, name: v.name, status: v.status, first: v.first, last: v.last, teams: v.bracket.teams, champion: v.bracket.champion,
        final: f ? { home: f.home, away: f.away, shootout: f.shootout, date: f.date } : null });
    }
    out.sort((a, b) => a.conference.name.localeCompare(b.conference.name));
    return { season, gender, tournaments: out };
  }, FRESH);
}
