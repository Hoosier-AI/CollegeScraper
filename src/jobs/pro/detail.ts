// pro-final-detail: events, lineups, player lines and team stats for finished matches, twenty fixtures per request
// (fixtures?ids=). Without ids it takes the finals still missing detail, most important competitions first, newest
// first. Then each touched league season's totals are recomputed.
import { registerJob, type JobContext } from '../runner.js';
import { selectAll } from '../../db/client.js';
import type { ApiFootball, Lane } from '../../sources/apiFootball/client.js';
import { hasDetail, parseFixture, parseFixtureDetail, teamsOf, type AfFixtureItem } from '../../sources/apiFootball/parse.js';
import { leagueIndex, noteEmptyDetail, refreshAggregates, upsertFixtures, upsertTeamStubs, writeFixtureDetails, type LeagueInfo } from '../../db/proRepo.js';
import { chunk, numList, withApi } from './shared.js';
import { log } from '../../log.js';

export const IDS_PER_CALL = 20;

/**
 * Fetch and store detail for these fixtures. Returns the (league, season) pairs that changed so the caller can
 * refresh their totals. Fixtures whose answer has no detail count an attempt instead (the provider fills some late).
 */
export async function fetchDetails(ctx: JobContext, api: ApiFootball, ids: number[], leagues: Map<number, LeagueInfo>, lane: Lane = 'everyday', opts: { provisional?: boolean } = {}): Promise<Set<string>> {
  const touched = new Set<string>();
  for (const batch of chunk(ids, IDS_PER_CALL)) {
    if (await ctx.cancelled()) break;
    const res = await api.get<AfFixtureItem>('fixtures', { ids: batch.join('-') }, lane);
    const items = res.response.filter((it) => leagues.has(it.league.id));
    await upsertTeamStubs(ctx.db, teamsOf(items, (id) => leagues.get(id)?.gender ?? null));
    await upsertFixtures(ctx.db, items.map(parseFixture));
    const withDetail: { fixtureId: number; detail: ReturnType<typeof parseFixtureDetail> }[] = [];
    const empty: number[] = [];
    for (const it of items) {
      const header = parseFixture(it);
      if (header.status !== 'final') continue; // still live or moved: the scoreboard will bring it back
      const detail = parseFixtureDetail(it, leagues.get(it.league.id)?.gender ?? null);
      if (hasDetail(detail)) withDetail.push({ fixtureId: it.fixture.id, detail });
      else empty.push(it.fixture.id);
      touched.add(`${it.league.id}|${it.league.season}`);
    }
    await writeFixtureDetails(ctx.db, withDetail, opts.provisional ? null : new Date().toISOString());
    // Answers that never came back (an id the provider dropped) count as empty too, so they cannot loop forever.
    const returned = new Set(items.map((it) => it.fixture.id));
    if (!opts.provisional) await noteEmptyDetail(ctx.db, [...empty, ...batch.filter((id) => !returned.has(id))]);
    ctx.inc('fixtures_detailed', withDetail.length);
    ctx.inc('fixtures_empty', empty.length);
    ctx.inc('players_lines', withDetail.reduce((n, d) => n + d.detail.players.length, 0));
    await ctx.heartbeat();
  }
  return touched;
}

export async function refreshTouched(ctx: JobContext, touched: Set<string>): Promise<void> {
  for (const k of touched) {
    const [league, season] = k.split('|').map(Number);
    try { await refreshAggregates(ctx.db, league!, season!); ctx.inc('aggregates_refreshed'); }
    catch (err) { ctx.inc('aggregate_errors'); log.warn({ league, season, err: String(err) }, 'pro aggregates failed'); }
  }
}

interface Pending { id: number; league_id: number; kickoff: string }

/** Finals missing detail, by competition priority then newest first. */
export async function pendingDetail(ctx: JobContext, leagues: Map<number, LeagueInfo>, opts: { limit: number; sinceDays?: number; league?: number; season?: number }): Promise<number[]> {
  const rows = await selectAll<Pending>(ctx.db, 'pro_fixtures', 'id,league_id,kickoff', (q) => {
    q = q.eq('status', 'final').is('detail_fetched_at', null).lt('detail_attempts', 4);
    if (opts.sinceDays) q = q.gte('kickoff', new Date(Date.now() - opts.sinceDays * 86400_000).toISOString());
    if (opts.league) q = q.eq('league_id', opts.league);
    if (opts.season) q = q.eq('season', opts.season);
    return q.order('kickoff', { ascending: false });
  });
  // Two hours after kickoff (about half an hour after full time): player ratings land a little after the whistle.
  const readyBefore = Date.now() - 120 * 60_000;
  return rows
    .filter((r) => leagues.get(r.league_id)?.enabled && Date.parse(r.kickoff) < readyBefore)
    .sort((a, b) => (leagues.get(a.league_id)!.priority - leagues.get(b.league_id)!.priority) || b.kickoff.localeCompare(a.kickoff))
    .slice(0, opts.limit)
    .map((r) => r.id);
}

/** params: { ids?: number[], limit?: number (default 400), since_days?: number (default 7) } */
export async function proFinalDetail(ctx: JobContext): Promise<void> {
  await withApi(ctx, async (api) => {
    const leagues = await leagueIndex(ctx.db);
    const explicit = numList(ctx.params.ids);
    const ids = explicit.length ? explicit : await pendingDetail(ctx, leagues, { limit: Number(ctx.params.limit ?? 400), sinceDays: Number(ctx.params.since_days ?? 7) });
    ctx.inc('pending', ids.length);
    const touched = await fetchDetails(ctx, api, ids, leagues);
    await refreshTouched(ctx, touched);
  });
}

registerJob('pro-final-detail', proFinalDetail);
