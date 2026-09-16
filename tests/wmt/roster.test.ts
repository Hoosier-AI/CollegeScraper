import { describe, it, expect } from 'vitest';
import { fixture } from '../helpers/fakeFetcher.js';
import { parseWmtRoster, looksLikeWmt, wmtSportSlugs } from '../../src/sources/sites/wmt/index.js';

const html = fixture('wmt/virginia-msoc-roster.html');

describe('wmt roster', () => {
  const roster = parseWmtRoster(html, 'https://virginiasports.com/sports/msoc/roster');
  it('detects the platform', () => {
    expect(looksLikeWmt(html)).toBe(true);
    expect(looksLikeWmt('<html><body>nothing</body></html>')).toBe(false);
    expect(wmtSportSlugs('w')).toEqual(['wsoc', 'womens-soccer']);
  });
  it('reads every player with bio fields', () => {
    expect(roster.players).toHaveLength(28);
    const gk = roster.players.find((p) => p.lastName === 'Tunks')!;
    expect(gk).toMatchObject({ firstName: 'Caleb', positionRaw: 'GK', classRaw: '4th Year', hometownRaw: 'Kailua-Kona, Hawaii', heightRaw: '6-0', weightLb: 170 });
    expect(gk.sitePlayerId).toBeTruthy();
    expect(gk.bioUrl).toBe('https://virginiasports.com/sports/msoc/roster/caleb-tunks');
    expect(roster.players.every((p) => p.firstName && p.lastName)).toBe(true);
    expect(roster.players.filter((p) => p.jersey != null).length).toBeGreaterThan(20);
  });
  it('reads the staff list', () => {
    expect(roster.coaches.length).toBeGreaterThanOrEqual(1);
    expect(roster.coaches.every((c) => c.name)).toBe(true);
  });
});
