// API-Football's prediction for each upcoming match in the next three days (the chances of each result and its
// comparison of the two sides), for competitions whose season it covers, shown on the match preview. One request a
// match; top competitions first.
//
// It spends the crawl's share of the day's requests, never live scores' (2026-11-27). On the everyday share it took
// about 2,800 requests a day, most of them in the three hours after the daily reset at 7 PM Eastern, which is more
// than the whole everyday allowance: live scores, finals and tables then stopped at the floor at about 7:30 AM
// Eastern and stayed stopped until the next reset, every day. It also reads a match less often now: once when it
// comes into the three-day window, then again after 12 hours only in the last day before kickoff, when team news
// moves the numbers.
import { registerJob, type JobContext } from '../runner.js';
import { selectAll } from '../../db/client.js';
import { parsePrediction, type AfPrediction } from '../../sources/apiFootball/parse.js';
import { leagueIndex } from '../../db/proRepo.js';
import { withApi } from './shared.js';

const HOUR = 3600_000;
/** Whether a match's prediction is read now: never read yet, or 12 hours old with kickoff inside the next day. */
export function predictionDue(kickoff: string, fetchedAt: string | null | undefined, now: number): boolean {
  if (!fetchedAt) return true;
  const age = now - Date.parse(fetchedAt), ahead = Date.parse(kickoff) - now;
  return age >= 12 * HOUR && ahead <= 24 * HOUR;
}

/** params: { hours?: number (ahead, default 72), limit?: number (requests, default 800), ids?: fixture ids } */
export async function proPredictions(ctx: JobContext): Promise<void> {
  const hours = Math.min(168, Number(ctx.params.hours) || 72);
  const limit = Math.min(3000, Number(ctx.params.limit) || 800);
  const now = new Date();
  const until = new Date(now.getTime() + hours * 3600_000).toISOString();
  const fixtures = await selectAll<{ id: number; league_id: number; season: number; kickoff: string }>(ctx.db, 'pro_fixtures', 'id,league_id,season,kickoff',
    (q) => q.eq('status', 'scheduled').gte('kickoff', now.toISOString()).lte('kickoff', until));
  if (!fixtures.length) { ctx.note('none', 'no upcoming matches'); return; }
  const leagues = await leagueIndex(ctx.db);
  // Which of those competition seasons the provider predicts.
  const pairs = [...new Set(fixtures.map((f) => `${f.league_id}|${f.season}`))];
  const covered = new Set<string>();
  for (let i = 0; i < pairs.length; i += 200) {
    const ids = [...new Set(pairs.slice(i, i + 200).map((p) => Number(p.split('|')[0])))];
    const rows = await selectAll<{ league_id: number; season: number; coverage: { predictions?: boolean } | null }>(ctx.db, 'pro_seasons', 'league_id,season,coverage', (q) => q.in('league_id', ids));
    for (const r of rows) if (r.coverage?.predictions) covered.add(`${r.league_id}|${r.season}`);
  }
  const fetched = new Map<number, string>();
  const ids = fixtures.map((f) => f.id);
  for (let i = 0; i < ids.length; i += 500) {
    const rows = await selectAll<{ fixture_id: number; fetched_at: string }>(ctx.db, 'pro_fixture_predictions', 'fixture_id,fetched_at', (q) => q.in('fixture_id', ids.slice(i, i + 500)));
    for (const r of rows) fetched.set(Number(r.fixture_id), r.fetched_at);
  }
  const explicit = new Set(String(ctx.params.ids ?? '').split(/[\s,]+/).filter(Boolean).map(Number));
  const due = fixtures
    .filter((f) => (explicit.size ? explicit.has(f.id) : covered.has(`${f.league_id}|${f.season}`) && predictionDue(f.kickoff, fetched.get(f.id), now.getTime()) && leagues.get(f.league_id)?.enabled))
    .sort((a, b) => (leagues.get(a.league_id)?.priority ?? 999) - (leagues.get(b.league_id)?.priority ?? 999) || a.kickoff.localeCompare(b.kickoff))
    .slice(0, limit);
  ctx.inc('due', due.length);
  await withApi(ctx, async (api) => {
    let n = 0;
    for (const f of due) {
      if (await ctx.cancelled()) return;
      if (api.headroom('backfill') < 1) { ctx.note('stopped', 'quota floor'); return; }
      const res = await api.get<AfPrediction>('predictions', { fixture: f.id }, 'backfill');
      const row = parsePrediction(f.id, res.response[0], new Date().toISOString());
      if (!row) { ctx.inc('empty'); continue; }
      const { error } = await ctx.db.from('pro_fixture_predictions').upsert(row, { onConflict: 'fixture_id' });
      if (error) throw new Error(`predictions: ${error.message}`);
      ctx.inc('predictions');
      if (++n % 50 === 0) await ctx.heartbeat();
    }
  });
}

registerJob('pro-predictions', proPredictions);
