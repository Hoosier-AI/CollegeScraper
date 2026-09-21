import { describe, it, expect } from 'vitest';
import { boxScoreHeaderPatch } from '../../src/db/repos.js';
import type { BoxScore } from '../../src/model.js';

const box = (status: BoxScore['status']): BoxScore => ({ status, home: { score: 2 }, away: { score: 1 }, overtime: false, shootout: false, attendance: 100, venueName: 'V', venueCity: 'C', durationMin: 110, officials: [], neutral: false, postseason: false, tournament: null } as unknown as BoxScore);
const NOW = '2026-09-21T23:00:00.000Z';

describe('boxScoreHeaderPatch', () => {
  it('a provisional live snapshot only stamps live_stats_at', () => {
    expect(boxScoreHeaderPatch(box('live'), 'ncaa', { provisional: true }, NOW)).toEqual({ live_stats_at: NOW });
  });
  it('a final ncaa write stamps ncaa_fetched_at, clears live_stats_at and sets the score', () => {
    expect(boxScoreHeaderPatch(box('final'), 'ncaa', {}, NOW)).toEqual({ ncaa_fetched_at: NOW, live_stats_at: null, status: 'final', home_score: 2, away_score: 1, overtime: false, shootout: false });
  });
  it('a site write carries the venue fields and never touches live_stats_at', () => {
    const p = boxScoreHeaderPatch(box('final'), 'site', {}, NOW);
    expect(p).toMatchObject({ site_fetched_at: NOW, status: 'final', attendance: 100, venue_name: 'V' });
    expect('live_stats_at' in p).toBe(false);
  });
});
