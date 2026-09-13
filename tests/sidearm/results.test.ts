import { describe, expect, it } from 'vitest';
import type { SiteContext } from '../../src/model.js';
import { mapGameState, parseResults } from '../../src/sources/sites/sidearm/results.js';
import { fixture } from '../helpers/fakeFetcher.js';

const ctx: SiteContext = { host: 'goduke.com', baseUrl: 'https://goduke.com', gender: 'm', season: 2025, sportSlug: 'mens-soccer', sportId: 10, teamSlug: null };
const results = () => JSON.parse(fixture('sidearm/duke-results.json'));
const upcoming = () => JSON.parse(fixture('sidearm/duke-upcoming.json'));

describe('parseResults (EventsResults JSON)', () => {
  const entries = parseResults([results(), upcoming()], ctx);

  it('keeps only the 2025 season (Aug 1 2025 – Jan 31 2026), sorted by date', () => {
    // The results feed holds 50 games spanning 2024, 2025 and 2026; 23 fall in the 2025 window.
    expect(entries).toHaveLength(23);
    expect(entries[0]!.date).toBe('2025-08-08');
    expect(entries[entries.length - 1]!.date).toBe('2025-11-30');
    expect(entries.every((e) => e.date >= '2025-08-01' && e.date <= '2026-01-31')).toBe(true);
    expect(entries.map((e) => e.date)).toEqual([...entries.map((e) => e.date)].sort());
  });

  it('maps the GAMECOMPLETE home loss to California on 2025-11-05', () => {
    const cal = entries.find((e) => e.date === '2025-11-05')!;
    expect(cal).toMatchObject({
      opponentName: 'California', opponentSiteId: '398', homeAway: 'H', state: 'final',
      result: { status: 'L', teamScore: 0, opponentScore: 2 }, isConference: false, isExhibition: false,
      tournament: 'ACC Championship', siteGameId: '24562', location: 'Durham, N.C.', startTimeLocal: '19:00', attendance: null,
    });
    expect(cal.boxScoreUrl).toBe('https://goduke.com/boxscore.aspx?id=24562');
    expect(cal.boxScoreUrl).toContain('24562');
  });

  it('treats a populated result as final even when gameStateDisplay is still SCHEDULED (Akron, 2025-11-30)', () => {
    const akron = entries.find((e) => e.siteGameId === '24759')!;
    expect(akron).toMatchObject({ opponentName: 'Akron', homeAway: 'A', state: 'final', result: { status: 'L', teamScore: 0, opponentScore: 2 }, tournament: 'NCAA Tournament', startTimeLocal: '16:00' });
    expect(akron.boxScoreUrl).toBe('https://goduke.com/boxscore.aspx?id=24759');
  });

  it('prefers pretty box score links when supplied', () => {
    const pretty = new Map([['24759', 'https://goduke.com/sports/mens-soccer/stats/2025/akron/boxscore/24759']]);
    const akron = parseResults(results(), ctx, pretty).find((e) => e.siteGameId === '24759')!;
    expect(akron.boxScoreUrl).toBe('https://goduke.com/sports/mens-soccer/stats/2025/akron/boxscore/24759');
  });

  it('marks exhibitions (no box score) and conference games', () => {
    const exhibitions = entries.filter((e) => e.isExhibition);
    expect(exhibitions.map((e) => e.opponentName)).toEqual(['Coastal Carolina', 'UNC Asheville', 'James Madison']);
    expect(exhibitions.every((e) => e.boxScoreUrl === null && e.tournament === null)).toBe(true);
    expect(entries.filter((e) => e.isConference)).toHaveLength(8);
    expect(entries.find((e) => e.opponentName === 'NC State')!.homeAway).toBe('H');
    // "#3 NC State" rank prefix stripped
    expect(entries.some((e) => /^#/.test(e.opponentName))).toBe(false);
  });

  it('merges the upcoming feed for the 2026 season and dedupes by game id', () => {
    const next = parseResults([results(), upcoming(), upcoming()], { ...ctx, season: 2026 });
    expect(next).toHaveLength(18); // 6 played 2026 games in results + 12 upcoming
    const queens = next.find((e) => e.date === '2026-09-15')!;
    expect(queens).toMatchObject({ opponentName: 'Queens', state: 'scheduled', result: null, boxScoreUrl: null, siteGameId: '25347', homeAway: 'H', startTimeLocal: '19:00' });
    const acc = next.find((e) => e.date === '2026-11-04')!;
    expect(acc.homeAway).toBe('N');
    expect(acc.startTimeLocal).toBeNull(); // allDay/tbd placeholder
    const played = next.find((e) => e.date === '2026-08-23')!;
    expect(played).toMatchObject({ state: 'final', result: { status: 'W', teamScore: 3, opponentScore: 1 } });
  });

  it('maps game state strings', () => {
    expect(mapGameState('SCHEDULED', false)).toBe('scheduled');
    expect(mapGameState('GAMECOMPLETE', false)).toBe('final');
    expect(mapGameState('SCHEDULED', true)).toBe('final');
    expect(mapGameState('LIVE', false)).toBe('live');
    expect(mapGameState('INPROGRESS', false)).toBe('live');
    expect(mapGameState('POSTPONED', false)).toBe('postponed');
    expect(mapGameState('CANCELLED', true)).toBe('cancelled');
    expect(mapGameState(null, false)).toBe('scheduled');
  });

  it('accepts a single payload and ignores junk', () => {
    expect(parseResults(results(), ctx)).toHaveLength(23);
    expect(parseResults({ items: ['junk', null, { date: 'nope' }] }, ctx)).toEqual([]);
    expect(parseResults(null, ctx)).toEqual([]);
  });
});
