// pro-standings: the provider's tables for each league season that had a final since its table was last read
// (one request each), or for one league season on demand.
import { registerJob, type JobContext } from '../runner.js';
import { selectAll } from '../../db/client.js';
import type { ApiFootball, Lane } from '../../sources/apiFootball/client.js';
import { parseStandings, type AfStandingsItem } from '../../sources/apiFootball/parse.js';
import { leagueIndex, patchSeason, upsertStandings, upsertTeamStubs, type LeagueInfo } from '../../db/proRepo.js';
import { teamDisplayName } from '../../sources/apiFootball/leagues.js';
import { withApi } from './shared.js';

export async function fetchStandings(ctx: JobContext, api: ApiFootball, league: number, season: number, leagues: Map<number, LeagueInfo>, lane: Lane = 'everyday'): Promise<number> {
  const res = await api.get<AfStandingsItem>('standings', { league, season }, lane);
  const rows = parseStandings(res.response);
  // Every team in a table needs a row first (foreign key); the table carries name and crest.
  const teams = new Map<number, { id: number; name: string; display_name: string; logo: string | null; gender: LeagueInfo['gender'] | null }>();
  for (const it of res.response) for (const g of it.league.standings ?? []) for (const r of g) {
    teams.set(r.team.id, { id: r.team.id, name: r.team.name, display_name: teamDisplayName(r.team.name), logo: r.team.logo ?? null, gender: leagues.get(league)?.gender ?? null });
  }
  await upsertTeamStubs(ctx.db, [...teams.values()]);
  const n = await upsertStandings(ctx.db, rows);
  await patchSeason(ctx.db, league, season, { standings_synced_at: new Date().toISOString() });
  return n;
}

interface SeasonRow { league_id: number; season: number; standings_synced_at: string | null; coverage: { standings?: boolean } | null }

/** params: { league?: number, season?: number } */
export async function proStandings(ctx: JobContext): Promise<void> {
  await withApi(ctx, async (api) => {
    const leagues = await leagueIndex(ctx.db);
    const league = Number(ctx.params.league) || null; const season = Number(ctx.params.season) || null;
    let pairs: { league: number; season: number }[];
    if (league && season) pairs = [{ league, season }];
    else {
      // League seasons with a final in the last two days, whose table is older than that final.
      const finals = await selectAll<{ league_id: number; season: number; final_at: string | null; kickoff: string }>(ctx.db, 'pro_fixtures', 'league_id,season,final_at,kickoff',
        (q) => q.eq('status', 'final').gte('kickoff', new Date(Date.now() - 2 * 86400_000).toISOString()));
      const latest = new Map<string, number>();
      for (const f of finals) {
        if (!leagues.get(f.league_id)?.enabled) continue;
        const k = `${f.league_id}|${f.season}`; const t = Date.parse(f.final_at ?? f.kickoff);
        if (t > (latest.get(k) ?? 0)) latest.set(k, t);
      }
      const seasons = latest.size ? await selectAll<SeasonRow>(ctx.db, 'pro_seasons', 'league_id,season,standings_synced_at,coverage', (q) => q.in('league_id', [...new Set([...latest.keys()].map((k) => Number(k.split('|')[0])))])) : [];
      const byKey = new Map(seasons.map((s) => [`${s.league_id}|${s.season}`, s]));
      pairs = [...latest.entries()].filter(([k, t]) => {
        const s = byKey.get(k);
        if (s?.coverage && s.coverage.standings === false) return false;
        return !s?.standings_synced_at || Date.parse(s.standings_synced_at) < t;
      }).map(([k]) => { const [l, s] = k.split('|').map(Number); return { league: l!, season: s! }; })
        .sort((a, b) => (leagues.get(a.league)?.priority ?? 999) - (leagues.get(b.league)?.priority ?? 999));
    }
    for (const p of pairs) {
      if (await ctx.cancelled()) return;
      ctx.inc('rows', await fetchStandings(ctx, api, p.league, p.season, leagues));
      ctx.inc('tables');
      await ctx.heartbeat();
    }
  });
}

registerJob('pro-standings', proStandings);
