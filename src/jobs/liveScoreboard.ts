// Live scores and live stats. Every minute during game hours (cadence in settings:live) the scoreboard is re-read
// for the days that still have unfinished games and college_games.status / scores / period / clock are written;
// then, in the time left, each live game's NCAA.com box score and play-by-play are stored as a provisional
// source='ncaa' snapshot (stats, lineups, events — never the header) so the match page has live stats. Nothing
// is inserted or re-oriented here; a game that just ended gets fetch-games-ncaa queued for its final box score.
// Games the site sync created without an NCAA contest id are not followed live until the sweep links them.
import type { Db } from '../db/client.js';
import { selectAll } from '../db/client.js';
import { registerJob, enqueue, type JobContext } from './runner.js';
import { makeFetcher, withPriority } from './fetcher.js';
import { makeTransport } from './fetchGamesNcaa.js';
import { scoreboardDay } from '../sources/ncaa/scoreboardGql.js';
import type { ScoreboardGame } from '../sources/ncaa/scoreboard.js';
import { fetchGameDocs, parseNcaaBoxScore } from '../sources/ncaa/index.js';
import { statLineCandidates, updateGame, writeBoxScore } from '../db/repos.js';
import { currentSeason, eastern, liveDates } from './seasons.js';
import { liveSettings } from '../ops/settings.js';
import type { Division, Gender } from '../model.js';
import { log } from '../log.js';

export interface PendingGame {
  id: string; season: number; game_date: string; gender: Gender; division: Division | null; status: string;
  start_epoch: number | null; ncaa_contest_id: number | null; home_program_id: string | null; away_program_id: string | null;
  home_score: number | null; away_score: number | null; source_of_truth: string | null; live_period: string | null; live_clock: string | null;
  live_stats_at?: string | null; home_seo?: string | null; away_seo?: string | null;
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

const PENDING_COLS = 'id,season,game_date,gender,division,status,start_epoch,ncaa_contest_id,home_program_id,away_program_id,home_score,away_score,source_of_truth,live_period,live_clock,live_stats_at,home:college_programs!college_games_home_program_id_fkey(school_seo),away:college_programs!college_games_away_program_id_fkey(school_seo)';

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

/**
 * Which live games get a stats snapshot this run: never refreshed first, then the stalest, skipping any refreshed
 * within `everyMs`, at most `budget` (each costs two requests on the same host, so the budget is the 1 rps share).
 */
export function pickDetailCandidates<T extends { status: string; live_stats_at?: string | null }>(games: T[], nowMs: number, opts: { everyMs: number; budget: number }): T[] {
  const age = (g: T) => (g.live_stats_at ? nowMs - Date.parse(g.live_stats_at) : Infinity);
  return games.filter((g) => g.status === 'live' && age(g) >= opts.everyMs).sort((a, b) => age(b) - age(a)).slice(0, Math.max(0, opts.budget));
}

/** params: { season?, dates?: string[] (Eastern), force?: boolean, detail?: boolean } */
export async function liveScoreboard(ctx: JobContext): Promise<void> {
  const db = ctx.db;
  const season = Number(ctx.params.season ?? currentSeason());
  const settings = await liveSettings(db);
  const startedMs = Date.now();
  const et = eastern();
  const dates = Array.isArray(ctx.params.dates) && ctx.params.dates.length ? (ctx.params.dates as string[]) : liveDates(et);
  const nowEpoch = Math.floor(Date.now() / 1000);
  const pending = await pendingLiveGames(db, season, dates, nowEpoch);
  if (!pending.length && !ctx.params.force) { ctx.note('skipped', 'no pending games'); return; }
  const lists = new Map<string, { gender: Gender; division: Division; date: string }>();
  for (const g of pending) if (g.division) lists.set(`${g.gender}|${g.division}|${g.game_date}`, { gender: g.gender, division: g.division, date: g.game_date });
  if (ctx.params.force && !lists.size) for (const gender of ['m', 'w'] as Gender[]) for (const division of ['d1', 'd2', 'd3'] as Division[]) for (const date of dates) lists.set(`${gender}|${division}|${date}`, { gender, division, date });
  const fetcher = withPriority(makeFetcher(db), 10);
  const { transport, store } = makeTransport(db, fetcher);
  await store.init();
  const wentFinal: string[] = [];
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
      if (patch.status) g.status = patch.status;
      if (patch.status === 'final' && g.ncaa_contest_id != null) wentFinal.push(String(g.ncaa_contest_id));
      ctx.inc(patch.status === 'final' ? 'went_final' : patch.status === 'scheduled' ? 'reverted' : g.status === 'live' ? 'ticked' : 'went_live');
    }
    await ctx.heartbeat();
  }
  ctx.inc('absent_from_feed', pending.filter((g) => !seen.has(g.id)).length);
  ctx.inc('live_games', pending.filter((g) => g.status === 'live').length);
  // The final box score should land minutes after full time, not at the next half-hourly sweep.
  if (wentFinal.length) await enqueue(db, 'fetch-games-ncaa', { season, contest_ids: wentFinal, refetch: true });

  // Phase 2: live stats. Time-boxed so the next scoreboard tick is never late; the stalest games go first.
  if (settings.detail_enabled && ctx.params.detail !== false) {
    const deadline = startedMs + settings.tick_budget_ms;
    const candidates = pickDetailCandidates(pending, Date.now(), { everyMs: settings.detail_every_min * 60_000, budget: settings.detail_budget });
    const candCache = new Map<string, Awaited<ReturnType<typeof statLineCandidates>>>();
    let handled = 0;
    for (const g of candidates) {
      if (Date.now() > deadline) { ctx.inc('detail_deadline', candidates.length - handled); break; }
      handled += 1;
      if (await ctx.cancelled()) return;
      try {
        const docs = await fetchGameDocs(transport, String(g.ncaa_contest_id), { docs: ['boxscore', 'pbp'] });
        let box;
        try { box = parseNcaaBoxScore(docs, String(g.ncaa_contest_id), g.gender, (g.division ?? 'd1') as Division, g.game_date); }
        catch { await updateGame(db, g.id, { live_stats_at: new Date().toISOString() }); ctx.inc('detail_empty'); continue; }
        if (box.status === 'final') { ctx.inc('detail_final'); continue; } // the final fetch owns it
        for (const pid of [g.home_program_id, g.away_program_id]) if (pid && !candCache.has(pid)) candCache.set(pid, await statLineCandidates(db, pid, season));
        const r = await writeBoxScore(db, { gameId: g.id, source: 'ncaa', homeProgramId: g.home_program_id, awayProgramId: g.away_program_id, box, candidates: candCache, season, createMissing: false, provisional: true });
        ctx.inc('detail_fetched'); ctx.inc('detail_player_rows', r.playerRows); ctx.inc('detail_events', r.events);
      } catch (err) {
        ctx.inc('detail_errors');
        await updateGame(db, g.id, { live_stats_at: new Date().toISOString() }).catch(() => {});
        log.warn({ contest: g.ncaa_contest_id, err: err instanceof Error ? err.message : String(err) }, 'live detail failed');
      }
      await ctx.heartbeat();
    }
  }
  // A run every three minutes would fill the runs table; keep a day of live history.
  await db.from('college_crawl_runs').delete().eq('job', 'live').eq('status', 'done').lt('created_at', new Date(Date.now() - 86400_000).toISOString());
}

registerJob('live', liveScoreboard);
