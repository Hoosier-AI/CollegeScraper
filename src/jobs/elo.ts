// Plaibook Elo for college programs (college-elo) and pro clubs (pro-elo), nightly, with the engine International
// uses (src/sources/intl/elo.ts). No requests: only results we already hold.
//
// College: every finished game from 2024 on. Conferences play the part confederations play for nations (regions that
// seldom meet): a result between two conferences moves both conferences' levels a little, so a strong D3 conference
// does not sit level with the ACC. K 30 (40 in the postseason), home edge 60 (college home sides win less often than
// national teams at home), five games before a side's results move established ones, and a third of the way back to
// 1500 after an off-season. Ranked: NCAA members with 3+ games this season, by gender and division.
//
// Pro: every club result since 2023 in every competition we follow. A club's main league plays the region part (tiers
// and countries seldom meet; cups and continental cups say how they compare), with a bigger share than nations get so
// three seasons are enough to separate them. K 30 (40 continental cups, 15 friendlies), home edge 70, ten matches
// before a side moves established ones, a fifth of the way back after 60 idle days.
// Ranked: professional clubs with 10+ matches and one in the last year, by gender (US amateur leagues are rated only).
import { registerJob, type JobContext } from './runner.js';
import { kvSet, selectAll, upsertChunked, type Db } from '../db/client.js';
import { COLLEGE_DRAW_KEY, PRO_DRAW_KEY, drawCounter, runElo, type EloMatch } from '../sources/intl/elo.js';
import { eastern } from './seasons.js';

const r1 = (v: number) => Math.round(v * 10) / 10;
/** Amateur US leagues: their clubs are rated (they meet pros in the Open Cup) but not ranked among professionals. */
const AMATEUR = /^(USL League Two|NPSL|UPSL|WPSL|Women's Premier Soccer League|USL W League)$/i;
const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);

async function collegeElo(ctx: JobContext): Promise<void> {
  const at = new Date().toISOString(), today = eastern().date, cut30 = daysAgo(30);
  const [games, seasons] = await Promise.all([
    selectAll<any>(ctx.db, 'college_games', 'id,season,game_date,gender,home_program_id,away_program_id,home_score,away_score,neutral_site,postseason',
      (q) => q.eq('status', 'final').gte('season', 2024).not('home_program_id', 'is', null).not('away_program_id', 'is', null).not('home_score', 'is', null).not('away_score', 'is', null).order('id')),
    selectAll<any>(ctx.db, 'college_program_seasons', 'program_id,season,division,conference_id,ncaa_member', (q) => q.gte('season', 2024).order('program_id').order('season')),
  ]);
  const current = Math.max(...games.map((g) => g.season));
  // A program's conference and division: this season's, else its latest.
  const latest = new Map<string, any>(); for (const s of seasons) { const p = latest.get(s.program_id); if (!p || s.season > p.season) latest.set(s.program_id, s); }
  const now = new Map(seasons.filter((s) => s.season === current).map((s) => [s.program_id, s]));
  const conf = new Map<string, string>(); for (const [pid, s] of latest) if (s.conference_id) conf.set(pid, s.conference_id);
  for (const gender of ['m', 'w'] as const) {
    const mine = games.filter((g) => g.gender === gender && g.game_date <= today);
    const post = new Set(mine.filter((g) => g.postseason).map((g) => g.id));
    const matches: (EloMatch & { id: string })[] = mine.map((g) => ({ id: g.id, date: g.game_date, home: g.home_program_id, away: g.away_program_id, home_score: g.home_score, away_score: g.away_score, tournament: post.has(g.id) ? 'postseason' : 'season', neutral: !!g.neutral_site }));
    const draws = drawCounter();
    const { ratings, played, snapshot } = runElo(matches, { ...eloCollege(), snapshotAt: cut30, onMatch: (_m, we, w) => draws.add(we, w) });
    const then = snapshot!;
    const thisSeason = new Map<string, number>(); for (const g of mine) if (g.season === current) for (const p of [g.home_program_id, g.away_program_id]) thisSeason.set(p, (thisSeason.get(p) ?? 0) + 1);
    const rows = [...ratings].map(([pid, rating]) => { const s = now.get(pid) ?? latest.get(pid); return { program_id: pid, gender, season: current, division: s?.division ?? null, conference_id: s?.conference_id ?? null, rating: r1(rating), games: played.get(pid)!.n, last_match: played.get(pid)!.last, change_30d: then.has(pid) ? r1(rating - then.get(pid)!) : null, rank: null as number | null, rank_all: null as number | null, updated_at: at, member: !!now.get(pid)?.ncaa_member && (thisSeason.get(pid) ?? 0) >= 3 }; });
    const ranked = rows.filter((r) => r.member).sort((a, b) => b.rating - a.rating);
    ranked.forEach((r, i) => { r.rank_all = i + 1; });
    for (const d of ['d1', 'd2', 'd3']) ranked.filter((r) => r.division === d).forEach((r, i) => { r.rank = i + 1; });
    ctx.inc(`${gender}_rated`, await upsertChunked(ctx.db, 'college_elo', rows.map(({ member: _m, ...r }) => r), { onConflict: 'program_id' }));
    ctx.inc(`${gender}_ranked`, ranked.length);
    await kvSet(ctx.db, COLLEGE_DRAW_KEY(gender), draws.model());
  }
  await ctx.db.from('college_elo').delete().lt('updated_at', at);
  ctx.note('as_of', today);
  function eloCollege() {
    return { confederations: conf, provisional: 5, homeEdge: 60, keepSteps: false, regressAfterDays: 120, regress: 1 / 3, k: (m: EloMatch) => (m.tournament === 'postseason' ? 40 : 30) };
  }
}

/** Club results since `since`, read in batches of compact rows (pro_elo_fixtures, migration 174). */
type FixtureRow = [id: number, date: string, home: number, away: number, hg: number, ag: number, league: number];
async function proResults(db: Db, since: string, each: (rows: FixtureRow[]) => void): Promise<void> {
  for (let after = 0; ;) {
    const { data, error } = await db.rpc('pro_elo_fixtures', { p_since: since, p_after: after, p_limit: 20000 });
    if (error) throw new Error(`pro_elo_fixtures: ${error.message}`);
    const rows = (data ?? []) as FixtureRow[];
    each(rows);
    if (rows.length < 20000) return;
    after = rows[rows.length - 1]![0];
  }
}

async function proElo(ctx: JobContext): Promise<void> {
  const at = new Date().toISOString(), today = eastern().date, cut30 = daysAgo(30), yearAgo = daysAgo(365);
  const leagues = new Map((await selectAll<any>(ctx.db, 'pro_leagues', 'id,name,country,gender,type', (q) => q.eq('scope', 'club'))).map((l) => [l.id, l]));
  // Matches by game, built straight from the batches (the raw rows are dropped as they are read).
  const byGender = { m: [] as EloMatch[], w: [] as EloMatch[] };
  // Each club's main league: the domestic league it played most in over the last year (its tier is its region).
  const leagueCount = new Map<string, Map<number, number>>();
  let total = 0;
  await proResults(ctx.db, '2023-01-01', (rows) => {
    for (const [, date, h, a, hg, ag, lid] of rows) {
      if (date > today) continue;
      const l = leagues.get(lid); if (!l) continue;
      total += 1;
      byGender[(l.gender ?? 'm') as 'm' | 'w'].push({ date, home: String(h), away: String(a), home_score: hg, away_score: ag, tournament: /friendl/i.test(l.name) ? 'friendly' : l.country === 'World' ? 'continental' : l.type === 'cup' ? 'cup' : 'domestic', neutral: false });
      if (l.type === 'league' && l.country !== 'World' && date >= yearAgo) for (const t of [String(h), String(a)]) { const c = leagueCount.get(t) ?? new Map<number, number>(); c.set(lid, (c.get(lid) ?? 0) + 1); leagueCount.set(t, c); }
    }
  });
  ctx.inc('results', total);
  const mainLeague = new Map<string, string>();
  for (const [t, c] of leagueCount) mainLeague.set(t, String([...c].sort((x, y) => y[1] - x[1])[0]![0]));
  const countries = new Map<string, string | null>();
  const ids = [...new Set([...byGender.m, ...byGender.w].flatMap((m) => [m.home, m.away]))].map(Number);
  for (let i = 0; i < ids.length; i += 1000) for (const t of await selectAll<any>(ctx.db, 'pro_teams', 'id,country', (q) => q.in('id', ids.slice(i, i + 1000)))) countries.set(String(t.id), t.country ?? null);
  for (const gender of ['m', 'w'] as const) {
    const mine = byGender[gender];
    // A club's region is its main league (else its country): tiers within a country seldom meet, and cup meetings
    // between them move the leagues' levels.
    const region = new Map<string, string>(); for (const id of new Set(mine.flatMap((m) => [m.home, m.away]))) { const r = mainLeague.get(id) ?? (countries.get(id) ? `c:${countries.get(id)}` : null); if (r) region.set(id, r); }
    const draws = drawCounter();
    const { ratings, played, snapshot } = runElo(mine, { confederations: region, share: 0.35, provisional: 10, homeEdge: 70, keepSteps: false, regressAfterDays: 60, regress: 0.2, snapshotAt: cut30,
      k: (m: EloMatch) => (m.tournament === 'continental' ? 40 : m.tournament === 'friendly' ? 15 : 30), onMatch: (_m, we, w) => draws.add(we, w) });
    const rows = [...ratings].map(([id, rating]) => ({ team_id: Number(id), gender, country: countries.get(id) ?? null, rating: r1(rating), games: played.get(id)!.n, last_match: played.get(id)!.last, change_30d: snapshot!.has(id) ? r1(rating - snapshot!.get(id)!) : null, rank: null as number | null, updated_at: at }));
    const amateur = (id: number) => { const l = leagues.get(Number(mainLeague.get(String(id)))); return !!l && AMATEUR.test(l.name); };
    rows.filter((r) => r.games >= 10 && r.last_match >= yearAgo && !amateur(r.team_id)).sort((a, b) => b.rating - a.rating).forEach((r, i) => { r.rank = i + 1; });
    byGender[gender] = [];
    ctx.inc(`${gender}_rated`, await upsertChunked(ctx.db, 'pro_elo', rows, { onConflict: 'team_id', chunk: 1000 }));
    await kvSet(ctx.db, PRO_DRAW_KEY(gender), draws.model());
  }
  await ctx.db.from('pro_elo').delete().lt('updated_at', at);
  ctx.note('as_of', today);
}

registerJob('college-elo', collegeElo);
registerJob('pro-elo', proElo);
