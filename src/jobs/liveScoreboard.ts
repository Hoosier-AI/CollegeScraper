// Live scores. Every three minutes during game hours the scoreboard is re-read for the days that still have
// unfinished games, and only college_games.status / scores / period / clock are written. Nothing is inserted,
// re-oriented or fetched beyond the scoreboard: the half-hourly sweep still owns fixtures and box scores.
// Games the site sync created without an NCAA contest id are not followed live until the sweep links them.
import type { Db } from '../db/client.js';
import { selectAll } from '../db/client.js';
import { registerJob, type JobContext } from './runner.js';
import { makeFetcher } from './fetcher.js';
import { makeTransport } from './fetchGamesNcaa.js';
import { scoreboardDay } from '../sources/ncaa/scoreboardGql.js';
import type { ScoreboardGame } from '../sources/ncaa/scoreboard.js';
import { updateGame } from '../db/repos.js';
import { currentSeason, eastern, liveDates } from './seasons.js';
import type { Division, Gender } from '../model.js';
import { log } from '../log.js';

export interface PendingGame {
  id: string; season: number; game_date: string; gender: Gender; division: Division | null; status: string;
  start_epoch: number | null; ncaa_contest_id: number | null; home_program_id: string | null; away_program_id: string | null;
  home_score: number | null; away_score: number | null; source_of_truth: string | null; live_period: string | null; live_clock: string | null;
  home_seo?: string | null; away_seo?: string | null;
}

/** Unfinished NCAA-listed games that could change now: live, or scheduled with kickoff between 4 h ago and 15 min ahead. */
export function pendingFilter(q: any, season: number, dates: string[], nowEpoch: number) {
  return q.eq('season', season).in('game_date', dates).not('ncaa_contest_id', 'is', null)
    .or(`status.eq.live,and(status.eq.scheduled,start_epoch.gte.${nowEpoch - 4 * 3600},start_epoch.lte.${nowEpoch + 15 * 60})`);
}

export async function pendingLiveCount(db: Db, season: number, dates: string[], nowEpoch: number): Promise<number> {
  const { count, error } = await pendingFilter(db.from('college_games').select('id', { count: 'exact', head: true }), season, dates, nowEpoch);
  if (error) throw new Error(`pending count: ${error.message}`);
  return count ?? 0;
}

const PENDING_COLS = 'id,season,game_date,gender,division,status,start_epoch,ncaa_contest_id,home_program_id,away_program_id,home_score,away_score,source_of_truth,live_period,live_clock,home:college_programs!college_games_home_program_id_fkey(school_seo),away:college_programs!college_games_away_program_id_fkey(school_seo)';

export async function pendingLiveGames(db: Db, season: number, dates: string[], nowEpoch: number): Promise<PendingGame[]> {
  const rows = await selectAll<any>(db, 'college_games', PENDING_COLS, (q) => pendingFilter(q, season, dates, nowEpoch));
  return rows.map((r) => ({ ...r, home_seo: r.home?.school_seo ?? null, away_seo: r.away?.school_seo ?? null, home: undefined, away: undefined }));
}

export interface LivePatch {
  status?: 'live' | 'final' | 'scheduled'; home_score?: number | null; away_score?: number | null;
  live_period?: string | null; live_clock?: string | null; live_updated_at?: string; start_epoch?: number; overtime?: boolean; shootout?: boolean;
}

/** NCAA.com's own rule for a finished game, judged against the Eastern date (scoreboard dates are Eastern). */
export function playedEastern(s: ScoreboardGame, etToday: string): boolean {
  return s.state === 'final' || (s.home.score != null && s.away.score != null && s.date < etToday);
}

/**
 * What the feed changes on one stored game, or null when nothing differs. `swapped` means NCAA's home is our away:
 * scores are mapped onto our orientation, the row itself is never flipped here.
 */
export function liveTransition(g: PendingGame, s: ScoreboardGame, opts: { swapped: boolean; etToday: string; nowIso: string }): LivePatch | null {
  const home = opts.swapped ? s.away : s.home, away = opts.swapped ? s.home : s.away;
  const patch: LivePatch = {};
  if (s.startTimeEpoch != null && g.start_epoch !== s.startTimeEpoch) patch.start_epoch = s.startTimeEpoch;
  if (playedEastern(s, opts.etToday)) {
    if (g.status !== 'final') {
      Object.assign(patch, { status: 'final', home_score: home.score, away_score: away.score, live_period: 'FINAL', live_clock: null, live_updated_at: opts.nowIso });
      const msg = `${s.finalMessage ?? ''} ${s.currentPeriod ?? ''}`;
      if (!g.source_of_truth) { patch.overtime = /\bOT\b/i.test(msg); patch.shootout = /\b(PK|SO|shootout)\b/i.test(msg); }
    }
  } else if (s.state === 'live') {
    const changed = g.status !== 'live' || g.home_score !== home.score || g.away_score !== away.score || g.live_period !== (s.currentPeriod ?? null) || g.live_clock !== (s.contestClock ?? null);
    if (changed) Object.assign(patch, { status: 'live', home_score: home.score, away_score: away.score, live_period: s.currentPeriod ?? null, live_clock: s.contestClock ?? null, live_updated_at: opts.nowIso });
  } else if (s.state === 'scheduled' && g.status === 'live' && !g.source_of_truth) {
    Object.assign(patch, { status: 'scheduled', home_score: null, away_score: null, live_period: null, live_clock: null, live_updated_at: opts.nowIso });
  }
  return Object.keys(patch).length ? patch : null;
}

/** params: { season?, dates?: string[] (Eastern), force?: boolean } */
export async function liveScoreboard(ctx: JobContext): Promise<void> {
  const db = ctx.db;
  const season = Number(ctx.params.season ?? currentSeason());
  const et = eastern();
  const dates = Array.isArray(ctx.params.dates) && ctx.params.dates.length ? (ctx.params.dates as string[]) : liveDates(et);
  const nowEpoch = Math.floor(Date.now() / 1000);
  const pending = await pendingLiveGames(db, season, dates, nowEpoch);
  if (!pending.length && !ctx.params.force) { ctx.note('skipped', 'no pending games'); return; }
  const lists = new Map<string, { gender: Gender; division: Division; date: string }>();
  for (const g of pending) if (g.division) lists.set(`${g.gender}|${g.division}|${g.game_date}`, { gender: g.gender, division: g.division, date: g.game_date });
  if (ctx.params.force && !lists.size) for (const gender of ['m', 'w'] as Gender[]) for (const division of ['d1', 'd2', 'd3'] as Division[]) for (const date of dates) lists.set(`${gender}|${division}|${date}`, { gender, division, date });
  const fetcher = makeFetcher(db);
  const { store } = makeTransport(db, fetcher);
  await store.init();
  const byContest = new Map(pending.filter((g) => g.ncaa_contest_id != null).map((g) => [String(g.ncaa_contest_id), g]));
  const byFixture = new Map<string, PendingGame>();
  for (const g of pending) if (g.home_seo && g.away_seo) byFixture.set(`${g.game_date}|${g.home_seo}|${g.away_seo}`, g);
  const seen = new Set<string>();
  const nowIso = new Date().toISOString();
  for (const { gender, division, date } of lists.values()) {
    if (await ctx.cancelled()) return;
    let day: ScoreboardGame[];
    try { day = await scoreboardDay(fetcher, store, gender, division, date); }
    catch (err) { ctx.inc('days_failed'); log.warn({ gender, division, date, err: err instanceof Error ? err.message : String(err) }, 'live scoreboard day failed'); continue; }
    ctx.inc('days');
    for (const s of day) {
      let g = byContest.get(s.contestId); let swapped = false;
      if (!g && s.home.seo && s.away.seo) {
        g = byFixture.get(`${s.date}|${s.home.seo}|${s.away.seo}`);
        if (!g) { g = byFixture.get(`${s.date}|${s.away.seo}|${s.home.seo}`); swapped = !!g; }
      } else if (g && g.home_seo && s.home.seo && g.home_seo !== s.home.seo && g.away_seo === s.home.seo) swapped = true;
      if (!g) { ctx.inc('unmatched'); continue; }
      seen.add(g.id);
      const patch = liveTransition(g, s, { swapped, etToday: et.date, nowIso });
      if (!patch) { ctx.inc('unchanged'); continue; }
      await updateGame(db, g.id, patch as Record<string, unknown>);
      ctx.inc(patch.status === 'final' ? 'went_final' : patch.status === 'scheduled' ? 'reverted' : g.status === 'live' ? 'ticked' : 'went_live');
    }
    await ctx.heartbeat();
  }
  ctx.inc('absent_from_feed', pending.filter((g) => !seen.has(g.id)).length);
  ctx.inc('live_games', pending.filter((g) => g.status === 'live').length);
  // A run every three minutes would fill the runs table; keep a day of live history.
  await db.from('college_crawl_runs').delete().eq('job', 'live').eq('status', 'done').lt('created_at', new Date(Date.now() - 86400_000).toISOString());
}

registerJob('live', liveScoreboard);
