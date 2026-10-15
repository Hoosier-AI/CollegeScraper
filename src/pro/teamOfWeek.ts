// Team of the week (migration 188): a competition round's best-rated XI in a 4-3-3 from API-Football's match ratings,
// with each player's club and match. Competitions without ratings return no rounds (the page shows no tab).
import type { Db } from '../db/client.js';
import { selectAll } from '../db/client.js';
import { teamsById } from './queries.js';
import { memo } from './memo.js';

export async function teamOfWeek(db: Db, league: number, season: number, round: string | null) {
  return memo(`totw:${league}:${season}:${round ?? ''}`, async () => {
    const { data, error } = await db.rpc('pro_team_of_week', { p_league: league, p_season: season, p_round: round });
    if (error) throw new Error(error.message);
    const r = data as { round: string | null; rounds: any[]; xi: any[] };
    const ids = r.xi.map((x) => x.player_id).filter((x) => x != null);
    const [people, teams] = await Promise.all([
      ids.length ? selectAll<any>(db, 'pro_players', 'id,slug,display_name,photo', (q) => q.in('id', ids)) : Promise.resolve([]),
      teamsById(db, [...new Set(r.xi.map((x) => x.team_id))]),
    ]);
    const who = new Map(people.map((p) => [p.id, p]));
    // Lines in a 4-3-3 for the pitch: row 1 the keeper, 2 defenders, 3 midfielders, 4 forwards.
    const row: Record<string, number> = { G: 1, D: 2, M: 3, F: 4 };
    const col = new Map<string, number>();
    return {
      round: r.round, rounds: r.rounds,
      xi: r.xi.map((x) => {
        const p = who.get(x.player_id);
        const c = (col.get(x.pos) ?? 0) + 1; col.set(x.pos, c);
        return { ...x, rating: Number(x.rating), display: p?.display_name ?? x.name, slug: p?.slug ?? null, photo: p?.photo ?? null, grid: `${row[x.pos]}:${c}`, team: teams.get(x.team_id) ?? null };
      }),
    };
  }, { fresh: 15 * 60_000 });
}
