import { describe, it, expect } from 'vitest';
import { fixture } from '../helpers/fakeFetcher.js';
import { csvFields, fdDate, fdLeagueFor, fdSeasonDir, fdUrl, parseFdCsv } from '../../src/sources/footballData/parse.js';
import { fdGameId, toFdRows } from '../../src/jobs/sources/footballData.js';

describe('football-data.co.uk', () => {
  it('builds the season file address', () => {
    expect(fdSeasonDir(2024)).toBe('2425');
    expect(fdSeasonDir(1999)).toBe('9900');
    expect(fdUrl(fdLeagueFor(39)!, 2024)).toBe('https://football-data.co.uk/mmz4281/2425/E0.csv');
  });

  it('reads dates in both forms and quoted fields', () => {
    expect(fdDate('16/08/2024')).toBe('2024-08-16');
    expect(fdDate('13/08/05')).toBe('2005-08-13');
    expect(fdDate('nonsense')).toBeNull();
    expect(csvFields('a,"b, c",d')).toEqual(['a', 'b, c', 'd']);
  });

  it('parses a current file: results, referee and both sides\' stats (no odds kept)', () => {
    const rows = parseFdCsv(fixture('footballData/E0-2425-head.csv'));
    expect(rows[0]).toMatchObject({ date: '2024-08-16', time: '20:00', home: 'Man United', away: 'Fulham', hg: 1, ag: 0, hthg: 0, htag: 0, referee: 'R Jones' });
    expect(rows[0]!.stats).toEqual({ home: { shots: 14, shots_on: 5, fouls: 12, corners: 7, yellow: 2, red: 0 }, away: { shots: 10, shots_on: 2, fouls: 10, corners: 8, yellow: 3, red: 0 } });
    expect(rows[1]).toMatchObject({ home: 'Ipswich', away: 'Liverpool', hg: 0, ag: 2 });
  });

  it('parses an older file without a time column', () => {
    const rows = parseFdCsv(fixture('footballData/E0-0506-head.csv'));
    expect(rows.length).toBe(2);
    expect(rows[0]!.time).toBeNull();
    expect(rows[0]!.date.startsWith('2005-08')).toBe(true);
    expect(rows[0]!.stats?.home.shots).not.toBeNull();
  });

  it('turns matches into source games and stats with country-prefixed clubs', () => {
    const l = fdLeagueFor(39)!;
    const rows = parseFdCsv(fixture('footballData/E0-2425-head.csv'));
    const { games, stats } = toFdRows(l, 2024, rows, '2026-10-10T00:00:00Z');
    expect(games[0]).toMatchObject({ source: 'football-data', league_id: 39, season: 2024, home_ext: 'eng:Man United', away_ext: 'eng:Fulham', home_score: 1, away_score: 0, status: 'final', referee_ext: 'R Jones' });
    expect(games[0]!.ext_id).toBe(fdGameId(l, 2024, rows[0]!));
    expect(stats[0]).toMatchObject({ ext_id: games[0]!.ext_id, home_shots: 14, away_shots: 10, home_corners: 7, away_corners: 8 });
  });
});
