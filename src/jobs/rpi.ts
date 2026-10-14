// college-rpi: every program's RPI for the current season, by gender and division, from the results we hold
// (src/college/rpi.ts), written to college_rpi with each team's rank and yesterday's, and one history row a day. Queued
// by final-detail after each final (at most once every 10 minutes) and run in the hourly job, so it is live within
// minutes. NCAA.com's official D1 order is read every six hours and kept beside ours, with how closely the two agree.
import { registerJob, type JobContext } from './runner.js';
import { makeFetcher } from './fetcher.js';
import { kvGet, kvSet, selectAll, upsertChunked } from '../db/client.js';
import { computeRpi, spearman, RPI_DEFAULT, type RpiGame } from '../college/rpi.js';
import { parseRpi, rpiUrl } from '../sources/ncaa/rankings.js';
import { currentSeason, eastern } from './seasons.js';
import { log } from '../log.js';

export const RPI_LAST_KEY = 'college:rpi:last';
export const RPI_AGREEMENT_KEY = 'college:rpi:agreement';
const OFFICIAL_KEY = 'college:rpi:official';
const DIVISIONS = ['d1', 'd2', 'd3'] as const;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

type Official = { at: string; asOf: Record<string, string | null>; rows: Record<string, { school: string; rank: number; previous: number | null }[]> };

/** NCAA.com's D1 order for both games, at most every six hours (two pages). */
async function official(ctx: JobContext): Promise<Official | null> {
  const saved = await kvGet<Official>(ctx.db, OFFICIAL_KEY);
  if (saved && Date.now() - Date.parse(saved.at) < 6 * 3600_000 && !ctx.params.force) return saved;
  try {
    const f = makeFetcher(ctx.db);
    const out: Official = { at: new Date().toISOString(), asOf: {}, rows: {} };
    for (const g of ['m', 'w'] as const) {
      const page = parseRpi((await f.get(rpiUrl(g), { accept: 'text/html', skipCache: true })).text);
      out.asOf[g] = page.asOf; out.rows[g] = page.rows.map((r) => ({ school: r.school, rank: r.rank, previous: r.previous }));
    }
    await kvSet(ctx.db, OFFICIAL_KEY, out);
    return out;
  } catch (err) {
    log.warn({ err: String(err) }, 'official rpi failed');
    ctx.inc('official_errors');
    return saved;
  }
}

export async function collegeRpi(ctx: JobContext): Promise<void> {
  const season = Number(ctx.params.season ?? currentSeason());
  const at = new Date().toISOString(), today = eastern().date;
  const yesterday = new Date(Date.parse(`${today}T12:00:00Z`) - 86400_000).toISOString().slice(0, 10);
  const [games, seasons, programs, prev, off] = await Promise.all([
    selectAll<any>(ctx.db, 'college_games', 'gender,home_program_id,away_program_id,home_score,away_score,neutral_site',
      (q) => q.eq('season', season).eq('status', 'final').not('home_score', 'is', null).not('away_score', 'is', null).not('home_program_id', 'is', null).not('away_program_id', 'is', null).order('id')),
    selectAll<any>(ctx.db, 'college_program_seasons', 'program_id,division,conference_id,ncaa_member', (q) => q.eq('season', season).order('program_id')),
    selectAll<any>(ctx.db, 'college_programs', 'id,name,gender', (q) => q.order('id')),
    selectAll<any>(ctx.db, 'college_rpi_history', 'program_id,rank', (q) => q.eq('season', season).eq('day', yesterday).order('program_id')),
    official(ctx),
  ]);
  const gender = new Map(programs.map((p) => [p.id, p.gender]));
  const before = new Map(prev.map((r) => [r.program_id, r.rank]));
  const agreement: Record<string, { spearman: number; teams: number; top25_mean_diff: number; as_of: string | null }> = {};
  const rows: any[] = [];
  for (const g of ['m', 'w'] as const) {
    const mine: RpiGame[] = games.filter((x) => x.gender === g).map((x) => ({ home: x.home_program_id, away: x.away_program_id, hs: x.home_score, as: x.away_score, neutral: !!x.neutral_site }));
    // The NCAA's official order, mapped to our programs by name.
    const byName = new Map(programs.filter((p) => p.gender === g).map((p) => [norm(p.name), p.id]));
    const offRank = new Map<string, { rank: number; previous: number | null }>();
    for (const r of off?.rows[g] ?? []) { const id = byName.get(norm(r.school)); if (id) offRank.set(id, { rank: r.rank, previous: r.previous }); }
    for (const d of DIVISIONS) {
      const members = seasons.filter((s) => s.division === d && s.ncaa_member && gender.get(s.program_id) === g);
      const pool = new Set(members.map((s) => s.program_id));
      const res = [...computeRpi(mine, pool, RPI_DEFAULT).values()].filter((r) => r.w + r.l + r.t > 0).sort((a, b) => b.rpi - a.rpi);
      const info = new Map(members.map((s) => [s.program_id, s]));
      res.forEach((r, i) => {
        const o = d === 'd1' ? offRank.get(r.team) : undefined;
        rows.push({ program_id: r.team, gender: g, season, division: d, conference_id: info.get(r.team)?.conference_id ?? null, w: r.w, l: r.l, t: r.t,
          wp: round(r.wp), owp: round(r.owp), oowp: round(r.oowp), rpi: round(r.rpi), rank: i + 1, rank_yesterday: before.get(r.team) ?? null,
          official_rank: o?.rank ?? null, official_prev: o?.previous ?? null, official_as_of: d === 'd1' ? off?.asOf[g] ?? null : null, updated_at: at });
      });
      if (d === 'd1' && offRank.size) {
        const ours = res.map((r) => r.team).filter((t) => offRank.has(t));
        const theirs = [...offRank].sort((a, b) => a[1].rank - b[1].rank).map(([t]) => t);
        const top = theirs.slice(0, 25), dev = top.map((t) => Math.abs(ours.indexOf(t) - theirs.indexOf(t)));
        agreement[g] = { spearman: Math.round(spearman(ours, theirs) * 10000) / 10000, teams: ours.length, top25_mean_diff: Math.round((dev.reduce((a, b) => a + b, 0) / Math.max(1, dev.length)) * 100) / 100, as_of: off?.asOf[g] ?? null };
      }
    }
  }
  ctx.inc('teams', await upsertChunked(ctx.db, 'college_rpi', rows, { onConflict: 'program_id' }));
  await ctx.db.from('college_rpi').delete().lt('updated_at', at);
  // Today's history row (overwritten through the day; yesterday's stays as the movement baseline).
  await upsertChunked(ctx.db, 'college_rpi_history', rows.map((r) => ({ program_id: r.program_id, season, day: today, rpi: r.rpi, rank: r.rank })), { onConflict: 'program_id,season,day' });
  await kvSet(ctx.db, RPI_AGREEMENT_KEY, { at, agreement });
  await kvSet(ctx.db, RPI_LAST_KEY, at);
  for (const [g, a] of Object.entries(agreement)) ctx.note(`${g}_spearman`, String(a.spearman));
}
const round = (v: number) => Math.round(v * 1e6) / 1e6;

registerJob('college-rpi', collegeRpi);
