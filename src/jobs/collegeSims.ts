// college-sims: the rest of the season played thousands of times (src/college/sim.ts) for every division and gender,
// written to college_sim_odds (migration 190): conference title, automatic bid, NCAA tournament bid and seed (D1),
// and the clinched / eliminated / magic-number lines. Pure computation from games and Elo we hold: no requests.
import { registerJob, type JobContext } from './runner.js';
import { kvGet, kvSet, selectAll, upsertChunked } from '../db/client.js';
import { COLLEGE_DRAW_KEY, type DrawModel } from '../sources/intl/elo.js';
import { type BracketSlot, type ConfKnockout, type NcaaField, type PlayedGame, type SimGame, type SimTeam } from '../college/sim.js';
import { conferenceBracket, winnerId, type BracketRow } from '../college/bracket.js';
import { simRunner } from '../college/simThread.js';
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
  const [members, programs, elo, confs, finals, upcoming, post] = await Promise.all([
    selectAll<any>(ctx.db, 'college_program_seasons', 'program_id,division,conference_id', (q) => q.eq('season', season).eq('ncaa_member', true).order('program_id')),
    selectAll<any>(ctx.db, 'college_programs', 'id,gender', (q) => q.order('id')),
    selectAll<any>(ctx.db, 'college_elo', 'program_id,rating', (q) => q.order('program_id')),
    selectAll<any>(ctx.db, 'college_conferences', 'id,name', (q) => q.order('id')),
    selectAll<any>(ctx.db, 'college_games', 'home_program_id,away_program_id,home_score,away_score,neutral_site,conference_game',
      (q) => q.eq('season', season).eq('status', 'final').or('forfeit.is.null,forfeit.eq.false').not('home_score', 'is', null).not('home_program_id', 'is', null).not('away_program_id', 'is', null).order('id')),
    selectAll<any>(ctx.db, 'college_games', 'home_program_id,away_program_id,neutral_site,conference_game,postseason',
      (q) => q.eq('season', season).eq('status', 'scheduled').not('home_program_id', 'is', null).not('away_program_id', 'is', null).order('id')),
    selectAll<any>(ctx.db, 'college_games', 'id,gender,game_date,status,home_program_id,away_program_id,home_score,away_score,home_seed,away_seed,neutral_site,shootout_winner,postseason_source,tournament_conference_id,round_number,bracket_slot',
      (q) => q.eq('season', season).eq('postseason', true).order('id')),
  ]);
  const { conf: confKnockouts, ncaa: ncaaFields } = realTournaments(post);
  const gender = new Map(programs.map((p) => [p.id, p.gender as 'm' | 'w']));
  const rating = new Map(elo.map((e) => [e.program_id, Number(e.rating)]));
  const indep = new Set(confs.filter((c) => /independent/i.test(c.name)).map((c) => c.id));
  const rows: any[] = [];
  // On its own thread: inline it froze the site for up to 28 s per division.
  const sim = simRunner();
  try {
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
        const odds = await sim.run({ teams, played, remaining, autoConfs, field: f?.field ?? null, seeds: f?.seeds ?? 0, sims: f ? sims : Math.round(sims / 3), draw, homeEdge: HOME_EDGE,
          ...(d === 'd1' ? { confTournaments: confKnockouts.get(g), ncaa: ncaaFields.get(g) ?? null } : {}) });
        for (const o of odds) rows.push({
          season, program_id: o.team, gender: g, division: d, conference_id: o.conf, reg_title: o.reg_title, auto_bid: o.auto_bid, bid: o.bid, seed: o.seed, avg_rank: o.avg_rank,
          avg_points: o.avg_points, points_now: o.points_now, max_points: o.max_points, conf_left: o.left, clinched: o.clinched, eliminated: o.eliminated, magic: o.magic,
          sims: f ? sims : Math.round(sims / 3), run_at: at, rounds: o.rounds,
        });
        ctx.inc(`${d}_${g}_teams`, teams.length);
        await ctx.heartbeat();
      }
    }
  } finally {
    await sim.close();
  }
  ctx.inc('threaded', sim.threaded ? 1 : 0);
  ctx.inc('rows', await upsertChunked(ctx.db, 'college_sim_odds', rows, { onConflict: 'season,program_id' }));
  await ctx.db.from('college_sim_odds').delete().eq('season', season).lt('run_at', at);
  await kvSet(ctx.db, SIMS_LAST_KEY, { at, sims, ms: Date.now() - t0 });
}

/** The real tournaments, per gender (D1): each conference tournament's champion or the teams still in it, and the
 *  NCAA field and bracket once out. */
export function realTournaments(post: any[]): { conf: Map<string, Map<string, ConfKnockout>>; ncaa: Map<string, NcaaField> } {
  const row = (g: any): BracketRow => ({ ...g, tournament_round: null, home_name: null, away_name: null, home_seo: null, away_seo: null, home_logo: null, away_logo: null, overtime: false, shootout: false });
  const conf = new Map<string, Map<string, ConfKnockout>>();
  const groups = new Map<string, any[]>();
  for (const g of post) if (g.postseason_source === 'inferred' && g.tournament_conference_id) { const k = `${g.gender}|${g.tournament_conference_id}`; groups.set(k, [...(groups.get(k) ?? []), g]); }
  for (const [k, list] of groups) {
    const [gender, id] = k.split('|') as [string, string];
    const b = conferenceBracket(list.map(row));
    if (!b) continue;
    let knock: ConfKnockout;
    if (b.champion?.id) knock = { champion: b.champion.id, alive: null };
    else {
      // Still in: every team that has not lost, placed by where its last game sits (neighbours meet next); a team
      // waiting on a bye goes last.
      const lost = new Set<string>(), where = new Map<string, number>();
      b.rounds.forEach((r, ri) => r.games.forEach((x) => {
        if (!x) return;
        for (const t of [x.home, x.away]) if (t?.id) { where.set(t.id, (x.position - 1) * 2 ** ri); if (x.status === 'final' && (x.home?.winner || x.away?.winner) && !t.winner) lost.add(t.id); }
      }));
      const alive = [...where.keys()].filter((t) => !lost.has(t)).sort((a, c) => where.get(a)! - where.get(c)!);
      knock = { champion: null, alive };
    }
    const m = conf.get(gender) ?? new Map<string, ConfKnockout>(); conf.set(gender, m); m.set(id, knock);
  }
  const ncaa = new Map<string, NcaaField>();
  for (const gender of ['m', 'w']) {
    const games = post.filter((g) => g.postseason_source === 'ncaa' && g.gender === gender && g.bracket_slot != null);
    if (!games.length) continue;
    const bySlot = new Map(games.map((g) => [g.bracket_slot, g]));
    const onward = (slot: number) => (t: string) => { const nx = bySlot.get((Math.floor(slot / 100) + 1) * 100 + Math.ceil((slot % 100) / 2)); return !!nx && (nx.home_program_id === t || nx.away_program_id === t); };
    const slots: BracketSlot[] = games.map((g) => ({ slot: g.bracket_slot, home: g.home_program_id, away: g.away_program_id, homeSeed: g.home_seed, awaySeed: g.away_seed,
      winner: winnerId(row(g), onward(g.bracket_slot)), neutral: g.neutral_site }));
    const seeds = new Map<string, number>();
    for (const g of games) { if (g.home_program_id && g.home_seed) seeds.set(g.home_program_id, g.home_seed); if (g.away_program_id && g.away_seed) seeds.set(g.away_program_id, g.away_seed); }
    // Men: national seeds 1-16. Women: seeds 1-8 in each quarter; the top 16 are the 1-4 seeds.
    const cut = Math.max(0, ...seeds.values()) <= 8 ? 4 : 16;
    const teams = [...new Set(games.flatMap((g) => [g.home_program_id, g.away_program_id]).filter(Boolean))] as string[];
    // Only a whole field (48 men, 64 women, less a few not yet linked): part of one would zero everyone else's bid.
    if (teams.length < (gender === 'w' ? 60 : 44)) continue;
    ncaa.set(gender, { teams, topSeeds: [...seeds].filter(([, v]) => v <= cut).map(([t]) => t), slots });
  }
  return { conf, ncaa };
}

registerJob('college-sims', collegeSims);
