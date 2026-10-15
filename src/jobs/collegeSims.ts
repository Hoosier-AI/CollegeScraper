// college-sims: the rest of the season played thousands of times (src/college/sim.ts) for every division and gender,
// written to college_sim_odds (migration 190): conference title, automatic bid, NCAA tournament bid and seed (D1),
// and the clinched / eliminated / magic-number lines. Pure computation from games and Elo we hold: no requests.
import { registerJob, type JobContext } from './runner.js';
import { kvGet, kvSet, selectAll, upsertChunked } from '../db/client.js';
import { COLLEGE_DRAW_KEY, type DrawModel } from '../sources/intl/elo.js';
import { simulate, type PlayedGame, type SimGame, type SimTeam } from '../college/sim.js';
import { currentSeason } from './seasons.js';

export const SIMS_LAST_KEY = 'college:sims:last';
const DEFAULT_DRAW: DrawModel = [0.27, 0.26, 0.24, 0.22, 0.2, 0.17, 0.14, 0.11, 0.08, 0.05];
/** NCAA Division I tournament fields (2026): men 48, women 64; 16 seeds each. D2 and D3 select by region (NPI),
 *  which we do not model: conference odds only there. */
const FIELD: Record<string, { field: number; seeds: number } | null> = { 'd1:m': { field: 48, seeds: 16 }, 'd1:w': { field: 64, seeds: 16 } };
const HOME_EDGE = 60;

export async function collegeSims(ctx: JobContext): Promise<void> {
  const season = Number(ctx.params.season ?? currentSeason());
  const sims = Math.min(10_000, Math.max(200, Number(ctx.params.sims) || 3000));
  const t0 = Date.now(), at = new Date().toISOString();
  const [members, programs, elo, confs, finals, upcoming] = await Promise.all([
    selectAll<any>(ctx.db, 'college_program_seasons', 'program_id,division,conference_id', (q) => q.eq('season', season).eq('ncaa_member', true).order('program_id')),
    selectAll<any>(ctx.db, 'college_programs', 'id,gender', (q) => q.order('id')),
    selectAll<any>(ctx.db, 'college_elo', 'program_id,rating', (q) => q.order('program_id')),
    selectAll<any>(ctx.db, 'college_conferences', 'id,name', (q) => q.order('id')),
    selectAll<any>(ctx.db, 'college_games', 'home_program_id,away_program_id,home_score,away_score,neutral_site,conference_game',
      (q) => q.eq('season', season).eq('status', 'final').or('forfeit.is.null,forfeit.eq.false').not('home_score', 'is', null).not('home_program_id', 'is', null).not('away_program_id', 'is', null).order('id')),
    selectAll<any>(ctx.db, 'college_games', 'home_program_id,away_program_id,neutral_site,conference_game,postseason',
      (q) => q.eq('season', season).eq('status', 'scheduled').not('home_program_id', 'is', null).not('away_program_id', 'is', null).order('id')),
  ]);
  const gender = new Map(programs.map((p) => [p.id, p.gender as 'm' | 'w']));
  const rating = new Map(elo.map((e) => [e.program_id, Number(e.rating)]));
  const indep = new Set(confs.filter((c) => /independent/i.test(c.name)).map((c) => c.id));
  const rows: any[] = [];
  for (const g of ['m', 'w'] as const) {
    const draw = (await kvGet<DrawModel>(ctx.db, COLLEGE_DRAW_KEY(g))) ?? DEFAULT_DRAW;
    for (const d of ['d1', 'd2', 'd3'] as const) {
      const mine = members.filter((m) => m.division === d && gender.get(m.program_id) === g);
      if (mine.length < 8) continue;
      const pool = new Set(mine.map((m) => m.program_id));
      // A team with no rating yet starts a little below the division's middle.
      const ratings = mine.map((m) => rating.get(m.program_id)).filter((r): r is number => r != null).sort((a, b) => a - b);
      const fallback = ratings.length ? ratings[Math.floor(ratings.length * 0.4)]! : 1400;
      const teams: SimTeam[] = mine.map((m) => ({ id: m.program_id, rating: rating.get(m.program_id) ?? fallback, conf: m.conference_id && !indep.has(m.conference_id) ? m.conference_id : null }));
      const played: PlayedGame[] = finals.filter((x) => pool.has(x.home_program_id) && pool.has(x.away_program_id))
        .map((x) => ({ home: x.home_program_id, away: x.away_program_id, hs: x.home_score, as: x.away_score, neutral: !!x.neutral_site, conf: !!x.conference_game }));
      // Regular-season games still to play (postseason games already on the schedule are left to the knockout).
      const remaining: SimGame[] = upcoming.filter((x) => !x.postseason && pool.has(x.home_program_id) && pool.has(x.away_program_id))
        .map((x) => ({ home: x.home_program_id, away: x.away_program_id, neutral: !!x.neutral_site, conf: !!x.conference_game }));
      const size = new Map<string, number>();
      for (const t of teams) if (t.conf) size.set(t.conf, (size.get(t.conf) ?? 0) + 1);
      // Conferences of six or more take an automatic bid (the NCAA's requirement).
      const autoConfs = new Set([...size].filter(([, n]) => n >= 6).map(([c]) => c));
      const f = FIELD[`${d}:${g}`] ?? null;
      const odds = simulate({ teams, played, remaining, autoConfs, field: f?.field ?? null, seeds: f?.seeds ?? 0, sims: f ? sims : Math.round(sims / 3), draw, homeEdge: HOME_EDGE });
      for (const o of odds) rows.push({
        season, program_id: o.team, gender: g, division: d, conference_id: o.conf, reg_title: o.reg_title, auto_bid: o.auto_bid, bid: o.bid, seed: o.seed, avg_rank: o.avg_rank,
        avg_points: o.avg_points, points_now: o.points_now, max_points: o.max_points, conf_left: o.left, clinched: o.clinched, eliminated: o.eliminated, magic: o.magic,
        sims: f ? sims : Math.round(sims / 3), run_at: at,
      });
      ctx.inc(`${d}_${g}_teams`, teams.length);
      await ctx.heartbeat();
    }
  }
  ctx.inc('rows', await upsertChunked(ctx.db, 'college_sim_odds', rows, { onConflict: 'season,program_id' }));
  await ctx.db.from('college_sim_odds').delete().eq('season', season).lt('run_at', at);
  await kvSet(ctx.db, SIMS_LAST_KEY, { at, sims, ms: Date.now() - t0 });
}

registerJob('college-sims', collegeSims);
