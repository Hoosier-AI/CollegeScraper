import { describe, it, expect } from 'vitest';
import { fixture, FakeFetcher } from '../helpers/fakeFetcher.js';
import { extractEmbeddedRoster, parseRosterEmbedded } from '../../src/sources/sites/sidearm/rosterEmbedded.js';
import { sidearmAdapter } from '../../src/sources/sites/sidearm/index.js';
import type { SiteContext } from '../../src/model.js';

const ctx: SiteContext = { host: 'gomason.com', baseUrl: 'https://gomason.com', gender: 'm', season: 2026, sportSlug: 'mens-soccer', sportId: null, teamSlug: null };

describe('legacy Sidearm embedded roster', () => {
  const html = fixture('sidearm/gomason-m-roster-legacy.html');
  it('extracts and maps the roster object', () => {
    const obj = extractEmbeddedRoster(html)!;
    expect(obj).toBeTruthy();
    const r = parseRosterEmbedded(obj, ctx, 'https://gomason.com/sports/mens-soccer/roster/2026');
    expect(r.players.length).toBeGreaterThanOrEqual(25);
    const p = r.players.find((x) => x.lastName === 'Aguirre Ortega')!;
    expect(p).toMatchObject({ firstName: 'Jonathan', jersey: 2, positionRaw: 'D', classRaw: 'Rs.', heightRaw: '6-0', hometownRaw: 'Herndon, Va.', highSchool: 'James Madison High School', sitePlayerId: '3165' });
    expect(p.bioUrl).toBe('https://gomason.com/sports/mens-soccer/roster/jonathan-aguirre-ortega/10172');
    expect(r.coaches.find((c) => c.isHead)?.name).toBe('Rich Costanzo');
  });
  it('is used by the adapter when the JSON API is unavailable', async () => {
    const f = new FakeFetcher([
      { match: 'https://gomason.com/api/v2/Rosters/bySport/mens-soccer', status: 404 },
      { match: 'https://gomason.com/sports/mens-soccer/roster/2026', file: 'sidearm/gomason-m-roster-legacy.html' },
    ]);
    const r = await sidearmAdapter.roster(f, ctx);
    expect(r.players.length).toBeGreaterThanOrEqual(25);
  });
});
