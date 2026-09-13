import { describe, expect, it } from 'vitest';
import type { SiteContext } from '../../src/model.js';
import { looksLikeSidearm, sidearmAdapter, sidearmSportSlug } from '../../src/sources/sites/sidearm/index.js';
import { FakeFetcher, fixture, type Route } from '../helpers/fakeFetcher.js';

const base: SiteContext = { host: 'goduke.com', baseUrl: 'https://goduke.com', gender: 'm', season: 2025, sportSlug: null, sportId: null, teamSlug: null };
const ctx: SiteContext = { ...base, sportSlug: 'mens-soccer', sportId: 10 };

const ROSTER_JSON: Route = { match: /\/api\/v2\/Rosters\/bySport\/mens-soccer/, file: 'sidearm/duke-roster-2025.json' };
const RESULTS: Route = { match: /\/api\/v2\.1\/EventsResults\/results\?sportId=10/, file: 'sidearm/duke-results.json' };
const UPCOMING: Route = { match: /\/api\/v2\.1\/EventsResults\/upcoming\?sportId=10/, file: 'sidearm/duke-upcoming.json' };
const SCHEDULE_HTML: Route = { match: 'https://goduke.com/sports/mens-soccer/schedule/2025', file: 'sidearm/duke-schedule-2025.html' };
const STATS_HTML: Route = { match: 'https://goduke.com/sports/mens-soccer/stats/2025', file: 'sidearm/duke-stats-2025.html' };
const BOX: Route = { match: /boxscore\/24759/, file: 'sidearm/duke-boxscore-24759.html' };
const BIO: Route = { match: /\/roster\/colin-gallagher\/8833/, file: 'sidearm/duke-bio-8833.html' };

const LEGACY_ROSTER = `<ul><li class="sidearm-roster-player"><div class="sidearm-roster-player-name"><span class="sidearm-roster-player-jersey-number">9</span><h3><a href="/sports/mens-soccer/roster/ann-example/77">Ann Example</a></h3></div><div class="sidearm-roster-player-position"><span class="text-bold">F</span></div></li></ul>`;

describe('sidearmAdapter', () => {
  it('exposes helpers', () => {
    expect(sidearmAdapter.platform).toBe('sidearm');
    expect(sidearmSportSlug('m')).toBe('mens-soccer');
    expect(sidearmSportSlug('w')).toBe('womens-soccer');
  });

  it('detects Sidearm pages', () => {
    expect(looksLikeSidearm(fixture('sidearm/duke-home.html'))).toBe(true);
    expect(looksLikeSidearm(fixture('sidearm/duke-schedule-2025.html'))).toBe(true);
    expect(looksLikeSidearm('<html><body><h1>Hello</h1></body></html>')).toBe(false);
    expect(looksLikeSidearm('')).toBe(false);
  });

  it('discover() fills sportSlug/sportId from the roster JSON', async () => {
    const f = new FakeFetcher([ROSTER_JSON]);
    const out = await sidearmAdapter.discover(f, base);
    expect(out).toMatchObject({ sportSlug: 'mens-soccer', sportId: 10 });
    expect(f.calls[0]).toBe('https://goduke.com/api/v2/Rosters/bySport/mens-soccer');
  });

  it('discover() falls back to the HTML roster on 404 and returns null when neither exists', async () => {
    const f = new FakeFetcher([{ match: /\/api\/v2\/Rosters/, status: 404 }, { match: 'https://goduke.com/sports/mens-soccer/roster', body: LEGACY_ROSTER }]);
    expect(await sidearmAdapter.discover(f, base)).toMatchObject({ sportSlug: 'mens-soccer', sportId: null });
    const none = new FakeFetcher([]);
    expect(await sidearmAdapter.discover(none, base)).toBeNull();
    expect(none.calls).toEqual(['https://goduke.com/api/v2/Rosters/bySport/mens-soccer', 'https://goduke.com/sports/mens-soccer/roster']);
  });

  it('discover() rethrows non-404 errors', async () => {
    const f = new FakeFetcher([{ match: /\/api\/v2\/Rosters/, status: 500 }]);
    await expect(sidearmAdapter.discover(f, base)).rejects.toThrow(/HTTP 500/);
  });

  it('roster() uses the JSON feed with ?season= and falls back to HTML on 404', async () => {
    const f = new FakeFetcher([ROSTER_JSON]);
    const r = await sidearmAdapter.roster(f, ctx);
    expect(r.players).toHaveLength(30);
    expect(f.calls[0]).toBe('https://goduke.com/api/v2/Rosters/bySport/mens-soccer?season=2025');

    const g = new FakeFetcher([{ match: /\/api\/v2\/Rosters/, status: 404 }, { match: 'https://goduke.com/sports/mens-soccer/roster/2025', body: LEGACY_ROSTER }]);
    const h = await sidearmAdapter.roster(g, ctx);
    expect(h.players).toHaveLength(1);
    expect(h.players[0]).toMatchObject({ firstName: 'Ann', lastName: 'Example', jersey: 9, sourceKey: '77' });
    expect(h.sourceUrl).toBe('https://goduke.com/sports/mens-soccer/roster/2025');
  });

  it('schedule() merges results + upcoming JSON and attaches pretty box score links from the schedule HTML', async () => {
    const f = new FakeFetcher([RESULTS, UPCOMING, SCHEDULE_HTML]);
    const entries = await sidearmAdapter.schedule(f, ctx);
    expect(entries).toHaveLength(23);
    const akron = entries.find((e) => e.siteGameId === '24759')!;
    expect(akron.boxScoreUrl).toBe('https://goduke.com/sports/mens-soccer/stats/2025/akron/boxscore/24759');
    expect(entries.find((e) => e.siteGameId === '24562')!.boxScoreUrl).toBe('https://goduke.com/sports/mens-soccer/stats/2025/california/boxscore/24562');
    expect(f.calls).toContain('https://goduke.com/api/v2.1/EventsResults/results?sportId=10&pageIndex=0&pageSize=100');
    expect(f.calls).toContain('https://goduke.com/api/v2.1/EventsResults/upcoming?sportId=10&pageIndex=0&pageSize=100');
  });

  it('schedule() keeps the boxscore.aspx URL when the schedule HTML is unavailable', async () => {
    const f = new FakeFetcher([RESULTS, UPCOMING]);
    const entries = await sidearmAdapter.schedule(f, ctx);
    expect(entries).toHaveLength(23);
    expect(entries.find((e) => e.siteGameId === '24759')!.boxScoreUrl).toBe('https://goduke.com/boxscore.aspx?id=24759');
  });

  it('schedule() falls back to the schedule HTML when the JSON endpoints 404 (or sportId is unknown)', async () => {
    const f = new FakeFetcher([{ match: /EventsResults/, status: 404 }, SCHEDULE_HTML]);
    const entries = await sidearmAdapter.schedule(f, ctx);
    expect(entries).toHaveLength(23);
    expect(entries.find((e) => e.siteGameId === '24759')).toMatchObject({ opponentName: 'Akron', homeAway: 'A', result: { status: 'L', teamScore: 0, opponentScore: 2 } });

    const g = new FakeFetcher([SCHEDULE_HTML]);
    expect(await sidearmAdapter.schedule(g, { ...ctx, sportId: null })).toHaveLength(23);
    expect(g.calls).toEqual(['https://goduke.com/sports/mens-soccer/schedule/2025']);

    await expect(sidearmAdapter.schedule(new FakeFetcher([]), ctx)).rejects.toThrow(/schedule not found/);
  });

  it('seasonStats() parses the stats page and returns null on 404', async () => {
    const f = new FakeFetcher([STATS_HTML]);
    const stats = await sidearmAdapter.seasonStats(f, ctx);
    expect(stats!.players).toHaveLength(28);
    expect(stats!.team!.goals).toBe(38);
    expect(await sidearmAdapter.seasonStats(new FakeFetcher([]), ctx)).toBeNull();
  });

  it('boxScore() and playerBio() fetch and parse a URL', async () => {
    const f = new FakeFetcher([BOX, BIO]);
    const bs = await sidearmAdapter.boxScore(f, ctx, 'https://goduke.com/sports/mens-soccer/stats/2025/akron/boxscore/24759');
    expect(bs.home.name).toBe('Akron');
    expect(bs.attendance).toBe(1344);
    const bio = await sidearmAdapter.playerBio(f, ctx, 'https://goduke.com/sports/mens-soccer/roster/colin-gallagher/8833');
    expect(bio.honors.length).toBeGreaterThan(0);
  });
});
