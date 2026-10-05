// A game that just went final, done right away: its NCAA.com box score (the same fetch as fetch-games-ncaa), then its
// two programs reconciled and their season totals recomputed, then Plaibook told so the coaches' copy follows within
// minutes. Runs on the aux lane, so it never waits behind the hourly / nightly / weekly crawl (which used to hold a
// Tuesday-evening final for hours). The live job queues it at full time and again every few minutes while a final
// from today or yesterday still has no NCAA box score.
import { registerJob, getJob, type JobContext } from './runner.js';
import { fetchGamesNcaa } from './fetchGamesNcaa.js';
import { currentSeason } from './seasons.js';
import { log } from '../log.js';

interface FinalGame { id: string; home_program_id: string | null; away_program_id: string | null; ncaa_fetched_at: string | null }

/** Tell Plaibook which games just got their final box score. Best effort: Plaibook also syncs game days on a timer. */
export async function notifyPlaibook(games: FinalGame[], env = process.env, doFetch: typeof fetch = fetch): Promise<'sent' | 'skipped' | 'failed'> {
  const url = env.PLAIBOOK_FINAL_WEBHOOK_URL; const secret = env.PLAIBOOK_FINAL_WEBHOOK_SECRET;
  const ready = games.filter((g) => g.ncaa_fetched_at);
  if (!url || !secret || !ready.length) return 'skipped';
  try {
    const r = await doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-college-secret': secret },
      body: JSON.stringify({ games: ready.map((g) => ({ game_id: g.id, home_program_id: g.home_program_id, away_program_id: g.away_program_id })) }),
      signal: AbortSignal.timeout(15_000),
    });
    return r.ok ? 'sent' : 'failed';
  } catch { return 'failed'; }
}

/** params: { season?, contest_ids: string[] } */
export async function finalDetail(ctx: JobContext): Promise<void> {
  const season = Number(ctx.params.season ?? currentSeason());
  const ids = Array.isArray(ctx.params.contest_ids) ? (ctx.params.contest_ids as unknown[]).map(String) : [];
  if (!ids.length) return;
  await fetchGamesNcaa({ ...ctx, params: { season, contest_ids: ids, refetch: true } });

  const { data, error } = await ctx.db.from('college_games').select('id, home_program_id, away_program_id, ncaa_fetched_at').in('ncaa_contest_id', ids.map(Number));
  if (error) throw new Error(error.message);
  const games = (data ?? []) as FinalGame[];
  const programIds = [...new Set(games.flatMap((g) => [g.home_program_id, g.away_program_id]).filter((p): p is string => !!p))];
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
  const told = await notifyPlaibook(games);
  ctx.inc(`plaibook_${told}`);
}

registerJob('final-detail', finalDetail);
