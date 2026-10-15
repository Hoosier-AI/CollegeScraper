// Referee stats for the site (migration 187): lists, a referee's page and the referee card on a match page, for pro
// (API-Football's referee on each match, with its card, penalty and VAR events and fouls) and college (the box
// score's referee, with the team stats' cards, fouls and penalty kicks). Rebuilt daily by the referees job.
import type { Db } from './db/client.js';
import { selectAll } from './db/client.js';
import { FIXTURE_SELECT, leaguesById, teamsById, toMatchRow } from './pro/queries.js';
import { toMatchRow as collegeMatchRow } from './ui/queries.js';
import { memo, memoKey } from './pro/memo.js';

/** The per-match columns a list can sort by (the SQL whitelists the same). */
export const PRO_REF_SORTS = ['matches', 'cards_pg', 'yellow_pg', 'red_pg', 'pens_pg', 'var_pg', 'fouls_pg', 'home_pct', 'goals_pg', 'name'] as const;
export const COLLEGE_REF_SORTS = ['games', 'cards_pg', 'yellow_pg', 'red_pg', 'pens_pg', 'fouls_pg', 'home_pct', 'goals_pg', 'name'] as const;

async function rpc<T>(db: Db, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

export interface ProRefFilter { gender: 'm' | 'w' | null; league: number | null; season: number | null; current: boolean; q: string | null; min: number; sort: string; limit: number; offset: number }

export async function proRefereeList(db: Db, f: ProRefFilter) {
  return memo(memoKey('pro-refs', f), async () => {
    const r = await rpc<{ total: number; average: any; rows: any[] }>(db, 'pro_referee_list', {
      p_gender: f.gender, p_league: f.league, p_season: f.season, p_current: f.current, p_q: f.q, p_min: f.min, p_sort: f.sort, p_limit: f.limit, p_offset: f.offset,
    });
    const lg = await leaguesById(db, [...new Set(r.rows.map((x) => x.main_league).filter(Boolean))]);
    return { ...r, rows: r.rows.map(({ main_league, ...x }) => ({ ...x, league: lg.get(main_league) ?? null })) };
  }, { fresh: 30 * 60_000 });
}

/** The competitions with referee data this season, for the list's filter (most matches first). */
export async function proRefereeLeagues(db: Db, gender: 'm' | 'w' | null) {
  return memo(memoKey('pro-ref-leagues', { gender }), async () => {
    const { data, error } = await db.rpc('pro_referee_leagues', { p_gender: gender });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as { league_id: number; matches: number }[];
    const lg = await leaguesById(db, rows.map((r) => r.league_id));
    return rows.map((r) => ({ league: lg.get(r.league_id) ?? null, matches: r.matches })).filter((r) => r.league);
  }, { fresh: 60 * 60_000 });
}

export async function proReferee(db: Db, slug: string) {
  return memo(`pro-ref:${slug}`, async () => {
    const r = await rpc<any>(db, 'pro_referee', { p_slug: slug });
    if (!r) return null;
    const recentIds: number[] = (r.recent ?? []).map((x: any) => x.fixture_id);
    const [fixtures, leagues, clubs] = await Promise.all([
      recentIds.length ? selectAll<any>(db, 'pro_fixtures', FIXTURE_SELECT, (q) => q.in('id', recentIds)) : Promise.resolve([]),
      leaguesById(db, [...new Set([...(r.seasons ?? []).map((s: any) => s.league_id)])]),
      teamsById(db, (r.clubs ?? []).map((c: any) => c.team_id)),
    ]);
    const byId = new Map(fixtures.map((f) => [f.id, toMatchRow(f)]));
    return {
      referee: r.referee, career: r.career, peer: r.peer,
      seasons: (r.seasons ?? []).map(({ league_id, ...s }: any) => ({ ...s, league: leagues.get(league_id) ?? null })),
      recent: (r.recent ?? []).map((x: any) => ({ match: byId.get(x.fixture_id) ?? null, yellow: x.yellow, red: x.red, pens: x.pens, fouls: x.fouls })).filter((x: any) => x.match),
      clubs: (r.clubs ?? []).map(({ team_id, ...c }: any) => ({ ...c, team: clubs.get(team_id) ?? null })).filter((c: any) => c.team),
    };
  }, { fresh: 30 * 60_000 });
}

/** The referee card on a pro match page; null when the match has no referee or none we have numbers for. */
export async function proMatchReferee(db: Db, fixtureId: number) {
  return memo(`pro-ref-card:${fixtureId}`, () => rpc<any>(db, 'pro_match_referee', { p_fixture: fixtureId }), { fresh: 60 * 60_000 });
}

export interface CollegeRefFilter { season: number | null; gender: 'm' | 'w' | null; division: string | null; q: string | null; min: number; sort: string; limit: number; offset: number }

export async function collegeRefereeList(db: Db, f: CollegeRefFilter) {
  return memo(memoKey('college-refs', f), () => rpc<any>(db, 'college_referee_list', {
    p_season: f.season, p_gender: f.gender, p_division: f.division, p_q: f.q, p_min: f.min, p_sort: f.sort, p_limit: f.limit, p_offset: f.offset,
  }), { fresh: 30 * 60_000 });
}

export async function collegeReferee(db: Db, slug: string) {
  return memo(`college-ref:${slug}`, async () => {
    const r = await rpc<any>(db, 'college_referee', { p_slug: slug });
    if (!r) return null;
    const ids: string[] = (r.recent ?? []).map((x: any) => x.game_id);
    const progIds: string[] = (r.teams ?? []).map((t: any) => t.program_id);
    const [games, progs] = await Promise.all([
      ids.length ? selectAll<any>(db, 'college_v_schedule', '*', (q) => q.in('id', ids)) : Promise.resolve([]),
      progIds.length ? selectAll<any>(db, 'college_programs', 'id,name,short_name,school_seo,gender', (q) => q.in('id', progIds)) : Promise.resolve([]),
    ]);
    const byId = new Map(games.map((g) => [g.id, collegeMatchRow(g)]));
    const prog = new Map(progs.map((p) => [p.id, p]));
    return {
      referee: r.referee, career: r.career, peer: r.peer, seasons: r.seasons ?? [],
      recent: (r.recent ?? []).map((x: any) => ({ match: byId.get(x.game_id) ?? null, yellow: x.yellow, red: x.red, fouls: x.fouls, pens: x.pens })).filter((x: any) => x.match),
      teams: (r.teams ?? []).map(({ program_id, ...t }: any) => {
        const p = prog.get(program_id);
        return p ? { ...t, program: { id: p.id, name: p.name, short_name: p.short_name ?? null, seo: p.school_seo ?? null, gender: p.gender } } : null;
      }).filter(Boolean),
    };
  }, { fresh: 30 * 60_000 });
}

export async function collegeGameReferee(db: Db, gameId: string) {
  return memo(`college-ref-card:${gameId}`, () => rpc<any>(db, 'college_game_referee', { p_game: gameId }), { fresh: 60 * 60_000 });
}
