import { describe, it, expect } from 'vitest';
import { sourceOfUrl, recordRequest, pendingRequests, flushRequests } from '../../src/ops/sourceRequests.js';
import { expectedSeasons, siteOfJob, CRAWL_SITES } from '../../src/pro/crawlSites.js';

describe('requests per site', () => {
  it('knows the pro sources and ignores college traffic', () => {
    expect(sourceOfUrl('https://v3.football.api-sports.io/fixtures?ids=1')?.source).toBe('api-football');
    expect(sourceOfUrl('https://app.americansocceranalysis.com/api/v1/mls/games')?.source).toBe('asa');
    expect(sourceOfUrl('https://en.wikipedia.org/wiki/2024_Major_League_Soccer_season')?.source).toBe('wikipedia');
    expect(sourceOfUrl('https://www.wikidata.org/wiki/Special:EntityData/Q42.json')?.source).toBe('wikidata');
    expect(sourceOfUrl('https://raw.githubusercontent.com/openfootball/england/master/2024-25/1-premierleague.txt')?.source).toBe('openfootball');
    expect(sourceOfUrl('https://www.football-data.co.uk/mmz4281/2425/E0.csv')?.source).toBe('football-data');
    expect(sourceOfUrl('https://raw.githubusercontent.com/someone/else/main/x.txt')).toBeNull();
    expect(sourceOfUrl('https://sdataprod.ncaa.com/?x=1')).toBeNull();
    expect(sourceOfUrl('not a url')).toBeNull();
  });

  it('tallies requests, errors and 304s by day and host, and keeps them when a save fails', async () => {
    const at = new Date('2026-10-10T12:00:00Z');
    recordRequest({ url: 'https://en.wikipedia.org/wiki/A', ok: true, status: 200, bytes: 100 }, at);
    recordRequest({ url: 'https://en.wikipedia.org/wiki/B', ok: false, status: 503, error: 'HTTP 503' }, at);
    recordRequest({ url: 'https://en.wikipedia.org/wiki/C', ok: true, status: 304, notModified: true }, at);
    recordRequest({ url: 'https://example.edu/roster', ok: true, status: 200 }, at);
    const row = pendingRequests().find((r) => r.source === 'wikipedia' && r.day === '2026-10-10')!;
    expect(row).toMatchObject({ host: 'en.wikipedia.org', requests: 3, errors: 1, not_modified: 1, bytes: 100, last_error: 'HTTP 503' });
    const failing = { rpc: async () => ({ error: { message: 'down' } }) } as any;
    expect(await flushRequests(failing)).toBe(0);
    expect(pendingRequests().find((r) => r.source === 'wikipedia')?.requests).toBe(3);
    let sent: any[] = [];
    const ok = { rpc: async (_f: string, a: { p_rows: any[] }) => { sent = a.p_rows; return { error: null }; } } as any;
    expect(await flushRequests(ok)).toBeGreaterThan(0);
    expect(sent.find((r) => r.source === 'wikipedia')?.requests).toBe(3);
    expect(pendingRequests()).toHaveLength(0);
  });
});

describe('crawl sites', () => {
  it('maps jobs to their site', () => {
    expect(siteOfJob('pro-crawl')).toBe('api-football');
    expect(siteOfJob('asa-shots')).toBe('asa');
    expect(siteOfJob('wikipedia-sync')).toBe('wikipedia');
    expect(siteOfJob('source-check')).toBeNull();
    expect(CRAWL_SITES.filter((s) => s.scraped).length).toBeGreaterThan(0);
  });

  it('lists the seasons each source should have: ASA and openfootball to the season in play, worldwide', () => {
    const seasons = expectedSeasons(() => 2026);
    const of = (src: string, league: number) => seasons.filter((s) => s.source === src && s.league_id === league).map((s) => s.season);
    expect(of('asa', 253)).toEqual(Array.from({ length: 14 }, (_, i) => 2013 + i));
    expect(of('openfootball', 253).at(-1)).toBe(2026);
    expect(of('openfootball', 39)[0]).toBe(2010);
    expect(of('wikipedia', 39).at(-1)).toBe(2026);
    expect(of('wikipedia', 253).at(-1)).toBe(2025);
    expect(of('wikipedia', 256).at(-1)).toBe(2026);
  });
});

import { notOverYet } from '../../src/jobs/fetchGamesNcaa.js';
describe('NCAA box scores only for games that can be over', () => {
  const now = Date.parse('2026-10-10T17:00:00Z');
  it('skips games that have not kicked off (plus 100 minutes), keeps finals, TBA and unknown times', () => {
    expect(notOverYet({ status: 'scheduled', start_epoch: Date.parse('2026-10-10T20:00:00Z') / 1000 }, now)).toBe(true);
    expect(notOverYet({ status: 'scheduled', start_epoch: Date.parse('2026-10-10T16:00:00Z') / 1000 }, now)).toBe(true);
    expect(notOverYet({ status: 'scheduled', start_epoch: Date.parse('2026-10-10T15:00:00Z') / 1000 }, now)).toBe(false);
    expect(notOverYet({ status: 'final', start_epoch: Date.parse('2026-10-10T20:00:00Z') / 1000 }, now)).toBe(false);
    expect(notOverYet({ status: 'scheduled', start_epoch: Date.parse('2026-10-10T04:00:00Z') / 1000 }, now)).toBe(false);
    expect(notOverYet({ status: 'scheduled', start_epoch: null }, now)).toBe(false);
  });
});
