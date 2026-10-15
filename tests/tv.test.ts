// Where college games are shown: the network schools list on their schedules, in one spelling.
import { describe, expect, it } from 'vitest';
import type { SiteContext } from '../src/model.js';
import { isKnownNetwork, networkInText, normalizeNetwork, watchUrl } from '../src/normalize/networks.js';
import { parseResults } from '../src/sources/sites/sidearm/results.js';
import { parseScheduleHtml, parseScheduleRss } from '../src/sources/sites/presto/schedule.js';
import { fixture } from './helpers/fakeFetcher.js';

describe('network names', () => {
  it('one spelling for the many a school writes', () => {
    expect(normalizeNetwork('ACCNX')).toBe('ACC Network Extra');
    expect(normalizeNetwork('ACC Network Extra')).toBe('ACC Network Extra');
    expect(normalizeNetwork('ACCN')).toBe('ACC Network');
    expect(normalizeNetwork('ESPN Plus')).toBe('ESPN+');
    expect(normalizeNetwork('TV: SECN+')).toBe('SEC Network+');
    expect(normalizeNetwork('ESPN+ / ACCNX')).toBe('ESPN+ / ACC Network Extra');
    expect(normalizeNetwork('Hokies All Access')).toBe('Hokies All Access');
  });
  it('labels and links are not networks', () => {
    for (const s of ['Watch', 'Live Stats', 'Tickets', 'TBA', '', 'https://x.com/watch']) expect(normalizeNetwork(s)).toBeNull();
    expect(watchUrl('https://www.espn.com/watch/player/_/id/1')).toBe('https://www.espn.com/watch/player/_/id/1');
    expect(watchUrl('/links/abc')).toBeNull();
  });
  it('free text only counts a known network', () => {
    expect(isKnownNetwork('ESPN+')).toBe(true);
    expect(isKnownNetwork('BIG EAST')).toBe(false);
    expect(networkInText('CCSU vs. UAlbany, ESPN+, Final, 0-1')).toBe('ESPN+');
    expect(networkInText('Home Opener presented by Acme')).toBeNull();
  });
});

describe('schedules keep the network', () => {
  it('Sidearm EventsResults: media.tv and the watch link', () => {
    const ctx: SiteContext = { host: 'goduke.com', baseUrl: 'https://goduke.com', gender: 'm', season: 2025, sportSlug: 'mens-soccer', sportId: 10, teamSlug: null };
    const games = parseResults(JSON.parse(fixture('sidearm/duke-results.json')), ctx);
    const tv = games.filter((g) => g.broadcast);
    expect(tv.length).toBeGreaterThan(games.length / 2);
    expect(new Set(tv.map((g) => g.broadcast))).toContain('ACC Network Extra');
    expect(tv.some((g) => g.watchUrl?.startsWith('https://www.espn.com/watch'))).toBe(true);
  });
  it('Presto RSS: the network in the description', () => {
    const games = parseScheduleRss(fixture('presto/ccsu-schedule-2025.rss'), 'https://ccsubluedevils.com', 2025);
    expect(games.some((g) => g.broadcast === 'ESPN+')).toBe(true);
  });
  it('Presto HTML: the event notes', () => {
    const games = parseScheduleHtml(fixture('presto/ccsu-schedule-2025.html'), 'https://ccsubluedevils.com', 2025);
    expect(games.some((g) => g.broadcast === 'ESPN+')).toBe(true);
  });
});
