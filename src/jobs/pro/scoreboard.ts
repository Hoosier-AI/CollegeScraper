// pro-scoreboard: every match worldwide on a day is one request (fixtures?date=, UTC days). Fixtures of enabled
// competitions are stored with their clubs; a final that still lacks detail queues pro-final-detail.
// pro-live: one request for every match in play (fixtures?live=all) while any is live, for minute-by-minute scores;
// a match that drops off the live list is asked for by id, which brings its final score and its detail at once.
import { registerJob, enqueue, type JobContext } from '../runner.js';
import { selectAll } from '../../db/client.js';
import { parseFixture, teamsOf, type AfFixtureItem } from '../../sources/apiFootball/parse.js';
import { leagueIndex, upsertFixtures, upsertTeamStubs, type LeagueInfo } from '../../db/proRepo.js';
import { addDays, utcDate, withApi } from './shared.js';
import { fetchDetails, refreshTouched } from './detail.js';
import type { Db } from '../../db/client.js';

/** Store the fixtures of enabled competitions; returns how many finals still need detail. */
export async function storeFixtures(db: Db, items: AfFixtureItem[], leagues: Map<number, LeagueInfo>): Promise<{ stored: number; finals: number; skipped: number }> {
  const kept = items.filter((it) => leagues.get(it.league.id)?.enabled);
  await upsertTeamStubs(db, teamsOf(kept, (id) => leagues.get(id)?.gender ?? null));
  const rows = kept.map(parseFixture);
  await upsertFixtures(db, rows);
  return { stored: rows.length, finals: rows.filter((r) => r.status === 'final').length, skipped: items.length - kept.length };
}

/**
 * Which UTC days to read. 'today' every run; 'recent' adds yesterday (late finals, overnight results) and tomorrow
 * (kickoff times). 'auto' (the scheduled default) is 'recent' in the first ten minutes of each hour, else 'today'.
 */
export function scoreboardDays(mode: string, now = Date.now()): string[] {
  const today = utcDate(now);
  const recent = mode === 'recent' || (mode === 'auto' && new Date(now).getUTCMinutes() < 10);
  return recent ? [addDays(today, -1), today, addDays(today, 1)] : [today];
}

/** params: { dates?: string[] (YYYY-MM-DD, UTC), days?: 'auto' | 'today' | 'recent' } */
export async function proScoreboard(ctx: JobContext): Promise<void> {
  await withApi(ctx, async (api) => {
    const leagues = await leagueIndex(ctx.db);
    if (!leagues.size) { ctx.note('skipped', 'no catalog yet: run pro-catalog'); return; }
    const given = Array.isArray(ctx.params.dates) ? (ctx.params.dates as unknown[]).map(String).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)) : [];
    const days = given.length ? given : scoreboardDays(String(ctx.params.days ?? 'auto'));
    let finals = 0;
    for (const date of days) {
      const res = await api.get<AfFixtureItem>('fixtures', { date });
      const r = await storeFixtures(ctx.db, res.response, leagues);
      ctx.inc('fixtures', r.stored); ctx.inc('skipped_disabled', r.skipped); finals += r.finals;
      await ctx.heartbeat();
    }
    ctx.inc('finals', finals);
    if (finals) await enqueue(ctx.db, 'pro-final-detail', {});
  });
}

/** True when the scheduler should run pro-live: something is in play, or kicks off within the next few minutes. */
export async function proLiveDue(db: Db, now = Date.now()): Promise<boolean> {
  const { count: live } = await db.from('pro_fixtures').select('id', { count: 'exact', head: true }).eq('status', 'live');
  if ((live ?? 0) > 0) return true;
  const { count: soon } = await db.from('pro_fixtures').select('id', { count: 'exact', head: true }).eq('status', 'scheduled')
    .gte('kickoff', new Date(now - 30 * 60_000).toISOString()).lte('kickoff', new Date(now + 5 * 60_000).toISOString());
  return (soon ?? 0) > 0;
}

export async function proLive(ctx: JobContext): Promise<void> {
  await withApi(ctx, async (api) => {
    const leagues = await leagueIndex(ctx.db);
    const before = await selectAll<{ id: number }>(ctx.db, 'pro_fixtures', 'id', (q) => q.eq('status', 'live'));
    const res = await api.get<AfFixtureItem>('fixtures', { live: 'all' });
    const r = await storeFixtures(ctx.db, res.response, leagues);
    ctx.inc('live', r.stored);
    // Live a minute ago, not on the list now: finished (or suspended). Ask by id: the final score and a first copy of
    // the detail together, so the match page is complete at full time. Provisional: player ratings settle later, and
    // pro-final-detail reads it again once they have.
    const nowLive = new Set(res.response.map((it) => it.fixture.id));
    const ended = before.map((b) => b.id).filter((id) => !nowLive.has(id));
    if (ended.length) {
      ctx.inc('ended', ended.length);
      const touched = await fetchDetails(ctx, api, ended, leagues, 'everyday', { provisional: true });
      await refreshTouched(ctx, touched);
    }
  });
}

registerJob('pro-scoreboard', proScoreboard);
registerJob('pro-live', proLive);
