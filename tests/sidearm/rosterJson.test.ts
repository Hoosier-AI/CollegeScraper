import { describe, expect, it } from 'vitest';
import type { SiteContext } from '../../src/model.js';
import { parseClassYear } from '../../src/normalize/classYear.js';
import { heightToCm } from '../../src/normalize/height.js';
import { parseRosterJson, sidearmBioUrl } from '../../src/sources/sites/sidearm/rosterJson.js';
import { fixture } from '../helpers/fakeFetcher.js';

const ctx: SiteContext = { host: 'goduke.com', baseUrl: 'https://goduke.com', gender: 'm', season: 2025, sportSlug: 'mens-soccer', sportId: 10, teamSlug: null };

describe('parseRosterJson (goduke.com men\'s soccer 2025)', () => {
  const roster = parseRosterJson(JSON.parse(fixture('sidearm/duke-roster-2025.json')), ctx);

  it('parses all 30 players and 4 coaches', () => {
    expect(roster.players).toHaveLength(30);
    expect(roster.coaches).toHaveLength(4);
    expect(roster.sourceUrl).toBe('https://goduke.com/api/v2/Rosters/bySport/mens-soccer?season=2025');
    expect(new Set(roster.players.map((p) => p.sourceKey)).size).toBe(30);
  });

  it('maps Ryan Gallagher: GK, 6-1 (185 cm), Gr. (grad), previous school Wisconsin', () => {
    // Note: the fixture has no "Colin Gallagher"; the 2025 roster GK is Ryan Gallagher (playerId 7119).
    const g = roster.players.find((p) => p.lastName === 'Gallagher');
    expect(g).toBeTruthy();
    expect(g!.firstName).toBe('Ryan');
    expect(g!.sourceKey).toBe('7119');
    expect(g!.sitePlayerId).toBe('7119');
    expect(g!.positionRaw).toBe('GK');
    expect(g!.heightRaw).toBe('6-1');
    expect(heightToCm(g!.heightRaw)).toBe(185);
    expect(g!.classRaw).toBe('Gr.');
    expect(parseClassYear(g!.classRaw).grad).toBe(true);
    expect(g!.previousSchool).toBe('Wisconsin');
    expect(g!.hometownRaw).toBe('Tampa, Fla.');
    expect(g!.highSchool).toBe('Jesuit High School');
    expect(g!.jersey).toBe(0);
    expect(g!.weightLb).toBeNull();
    expect(g!.isCaptain).toBe(false);
    expect(g!.headshotUrl).toBe('https://goduke.com/images/2025/8/18/Gallagher_Ryan.png');
    // Sidearm bio URLs use the rosterPlayerId (as the site's own stats-page links do), not playerId.
    expect(g!.bioUrl).toBe('https://goduke.com/sports/mens-soccer/roster/ryan-gallagher/23223');
  });

  it('trims the "Gr. " class quirk and slugs apostrophes out of bio URLs', () => {
    const d = roster.players.find((p) => p.lastName === "D'Ambrosio")!;
    expect(d.classRaw).toBe('Gr.');
    expect(d.jersey).toBe(11);
    expect(d.weightLb).toBe(165);
    expect(d.previousSchool).toBe('College of Charleston');
    expect(d.bioUrl).toBe('https://goduke.com/sports/mens-soccer/roster/leonardo-dambrosio/23227');
    const hot = roster.players.find((p) => p.lastName === 'Hot')!;
    expect(hot.jersey).toBe(23);
    expect(hot.classRaw).toBe('Sr.');
    expect(hot.positionRaw).toBe('M');
  });

  it('flags only the actual head coach', () => {
    expect(roster.coaches.map((c) => [c.name, c.title, c.isHead])).toEqual([
      ['John Kerr', 'Head Coach', true],
      ['Michael Brady', 'Associate Head Coach', false],
      ['Kyle Johnston', 'Assistant Coach', false],
      ['Tristan Wierbonski', 'Assistant Coach', false],
    ]);
    expect(roster.coaches[0]!.headshotUrl).toBe('https://goduke.com/images/2025/9/29/Image__4_.jpg');
  });

  it('builds bio URLs in the /sports/{slug}/roster/{first-last}/{id} shape', () => {
    expect(sidearmBioUrl('https://goduke.com', 'mens-soccer', 'Colin', 'Gallagher', 8833)).toBe('https://goduke.com/sports/mens-soccer/roster/colin-gallagher/8833');
    expect(sidearmBioUrl('https://goduke.com/', 'mens-soccer', 'Nikolai Ronaldo', 'Bull Jorgensen', '6733')).toBe('https://goduke.com/sports/mens-soccer/roster/nikolai-ronaldo-bull-jorgensen/6733');
    expect(sidearmBioUrl('https://goduke.com', 'mens-soccer', 'A', 'B', null)).toBeNull();
  });

  it('falls back to last|first|jersey keys and tolerates garbage input', () => {
    const r = parseRosterJson({ players: [{ firstName: 'Jo', lastName: 'Bloggs', jerseyNumber: '9' }, { hide: true, firstName: 'X', lastName: 'Y' }, 'junk'] }, ctx);
    expect(r.players).toHaveLength(1);
    expect(r.players[0]!.sourceKey).toBe('bloggs|jo|9');
    expect(r.players[0]!.sitePlayerId).toBeNull();
    expect(r.players[0]!.bioUrl).toBeNull();
    expect(parseRosterJson(null, ctx).players).toEqual([]);
  });
});
