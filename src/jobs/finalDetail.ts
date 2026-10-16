// A game that just went final, done right away: its NCAA.com box score (the same fetch as fetch-games-ncaa), then its
// two programs reconciled and their season totals recomputed, then Plaibook told so the coaches' copy follows within
// minutes. Runs on the aux lane, so it never waits behind the hourly / nightly / weekly crawl (which used to hold a
// Tuesday-evening final for hours). The live job queues it at full time and again every few minutes while a final
// from today or yesterday still has no NCAA box score.
import { registerJob, getJob, type JobContext } from './runner.js';
import { fetchGamesNcaa } from './fetchGamesNcaa.js';
import { currentSeason } from './seasons.js';
import { log } from '../log.js';

import { createHmac } from 'node:crypto';
import type { Db } from '../db/client.js';
import { kvGet, kvSet } from '../db/client.js';

interface FinalGame { id: string; home_program_id: string | null; away_program_id: string | null; ncaa_fetched_at: string | null; final_at?: string | null }
interface Notice { game_id: string; home_program_id: string | null; away_program_id: string | null; final_at: string | null }
interface Outbox { games: Array<Notice & { tries: number; first: string }> }

/** Notices Plaibook has not taken yet (it was down, or answered 5xx), sent again on the next run. */
export const OUTBOX_KEY = 'plaibook:final_outbox';
/** Kept at most this long and this many times; Plaibook's 6-hourly sync is the backstop beyond it. */
const OUTBOX_MAX_AGE_MS = 2 * 86400_000, OUTBOX_MAX_TRIES = 30, OUTBOX_MAX = 500;
const WAITS_MS = [1_000, 4_000];

/** `x-college-signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">` with the shared secret: Plaibook
 *  checks it and refuses one older than five minutes, so a captured request cannot be replayed later. */
export function signBody(secret: string, body: string, t = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
}

const noticeOf = (g: FinalGame): Notice => ({ game_id: g.id, home_program_id: g.home_program_id, away_program_id: g.away_program_id, final_at: g.final_at ?? null });

/** One POST of these notices, retried on a network error, 429 or 5xx (a 4xx is Plaibook refusing it: not retried). */
export async function postNotices(notices: Notice[], env = process.env, doFetch: typeof fetch = fetch, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<'sent' | 'skipped' | 'failed' | 'refused'> {
  const url = env.PLAIBOOK_FINAL_WEBHOOK_URL; const secret = env.PLAIBOOK_FINAL_WEBHOOK_SECRET;
  if (!url || !secret || !notices.length) return 'skipped';
  const body = JSON.stringify({ games: notices });
  for (let attempt = 0; ; attempt++) {
    let status = 0;
    try {
      const r = await doFetch(url, {
        method: 'POST',
        // The static secret rides along until Plaibook checks only the signature.
        headers: { 'Content-Type': 'application/json', 'x-college-secret': secret, 'x-college-signature': signBody(secret, body) },
        body, signal: AbortSignal.timeout(15_000),
      });
      if (r.ok) return 'sent';
      status = r.status;
    } catch { status = 0; }
    if (status >= 400 && status < 500 && status !== 429) return 'refused';
    if (attempt >= WAITS_MS.length) return 'failed';
    await sleep(WAITS_MS[attempt]!);
  }
}

/** Tell Plaibook which games just got their final box score, with any notices still waiting from earlier runs. What
 *  does not go through waits in the outbox (college_kv) for the next run; final_at lets Plaibook log the lag. */
export async function notifyPlaibook(games: FinalGame[], env = process.env, doFetch: typeof fetch = fetch, db?: Db, sleep?: (ms: number) => Promise<void>): Promise<'sent' | 'skipped' | 'failed' | 'refused'> {
  const fresh = games.filter((g) => g.ncaa_fetched_at).map(noticeOf);
  if (!env.PLAIBOOK_FINAL_WEBHOOK_URL || !env.PLAIBOOK_FINAL_WEBHOOK_SECRET) return 'skipped';
  const box: Outbox = (db ? await kvGet<Outbox>(db, OUTBOX_KEY).catch(() => null) : null) ?? { games: [] };
  const now = Date.now();
  const waiting = box.games.filter((g) => g.tries < OUTBOX_MAX_TRIES && now - Date.parse(g.first) < OUTBOX_MAX_AGE_MS && !fresh.some((f) => f.game_id === g.game_id));
  const all = [...fresh, ...waiting.map(({ tries: _t, first: _f, ...n }) => n)];
  if (!all.length) { if (db && box.games.length) await kvSet(db, OUTBOX_KEY, { games: [] }).catch(() => {}); return 'skipped'; }
  const out = await postNotices(all, env, doFetch, sleep);
  if (db) {
    const keep: Outbox['games'] = out === 'failed'
      ? [...fresh.map((n) => ({ ...n, tries: 1, first: new Date(now).toISOString() })), ...waiting.map((g) => ({ ...g, tries: g.tries + 1 }))].slice(0, OUTBOX_MAX)
      : [];
    if (keep.length || box.games.length) await kvSet(db, OUTBOX_KEY, { games: keep }).catch(() => {});
  }
  return out;
}

/** params: { season?, contest_ids: string[], outbox?: true } */
export async function finalDetail(ctx: JobContext): Promise<void> {
  const season = Number(ctx.params.season ?? currentSeason());
  const ids = Array.isArray(ctx.params.contest_ids) ? (ctx.params.contest_ids as unknown[]).map(String) : [];
  // { outbox: true } with no games (queued by the live job): only send what is waiting for Plaibook.
  if (!ids.length) { if (ctx.params.outbox) ctx.inc(`plaibook_${await notifyPlaibook([], process.env, fetch, ctx.db)}`); return; }
  await fetchGamesNcaa({ ...ctx, params: { season, contest_ids: ids, refetch: true } });

  const { data, error } = await ctx.db.from('college_games').select('id, home_program_id, away_program_id, ncaa_fetched_at, final_at').in('ncaa_contest_id', ids.map(Number));
  if (error) throw new Error(error.message);
  const games = (data ?? []) as FinalGame[];
  // Only games whose final box score landed change anything downstream; the rest are asked again by the live job.
  const landed = games.filter((g) => g.ncaa_fetched_at);
  ctx.inc('box_scores_pending', games.length - landed.length);
  const programIds = [...new Set(landed.flatMap((g) => [g.home_program_id, g.away_program_id]).filter((p): p is string => !!p))];
  const { data: progs } = programIds.length ? await ctx.db.from('college_programs').select('id, school_seo').in('id', programIds) : { data: [] };
  const reconcile = getJob('reconcile-games'); const aggregate = getJob('compute-aggregates');
  for (const p of (progs ?? []) as { id: string; school_seo: string }[]) {
    if (await ctx.cancelled()) return;
    try {
      if (reconcile) await reconcile({ ...ctx, params: { season, program: p.school_seo } });
      if (aggregate) await aggregate({ ...ctx, params: { season, program_id: p.id } });
      ctx.inc('programs_updated');
    } catch (err) {
      ctx.inc('program_errors');
      log.warn({ program: p.school_seo, err: err instanceof Error ? err.message : String(err) }, 'final-detail program update failed');
    }
    await ctx.heartbeat();
  }
  // Match ratings for the games whose box score just landed (Player of the match, Team of the week).
  if (landed.length) {
    const { data: rated, error: re } = await ctx.db.rpc('college_rate_games', { p_ids: landed.map((g) => g.id) });
    if (re) log.warn({ err: re.message }, 'final-detail ratings failed'); else ctx.inc('lines_rated', Number(rated) || 0);
  }
  const told = await notifyPlaibook(games, process.env, fetch, ctx.db);
  ctx.inc(`plaibook_${told}`);
}

registerJob('final-detail', finalDetail);
