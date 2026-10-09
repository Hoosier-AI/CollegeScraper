import { describe, it, expect } from 'vitest';
import { isBot } from '../../src/pro/playerRefresh.js';
import { parseLeaguePlayers } from '../../src/sources/apiFootball/parse.js';
import { fixture } from '../helpers/fakeFetcher.js';

describe('players fetched on view', () => {
  it('browsers do, bots and scripts never do', () => {
    expect(isBot('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/126 Safari/537.36')).toBe(false);
    expect(isBot('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe(true);
    expect(isBot('curl/8.4.0')).toBe(true);
    expect(isBot(undefined)).toBe(true);
  });
  it("one player's season answer keeps every competition", () => {
    const items = JSON.parse(fixture('apiFootball/league-players.json')).response;
    const all = parseLeaguePlayers(items, null, 2026).stats;
    const one = parseLeaguePlayers(items, 254, 2026).stats;
    expect(all.length).toBeGreaterThanOrEqual(one.length);
    expect(all.every((r) => Number.isInteger(r.league_id))).toBe(true);
    expect(new Set(all.map((r) => `${r.player_id}|${r.league_id}|${r.team_id}`)).size).toBe(all.length);
  });
});
