import { describe, it, expect } from 'vitest';
import { kickoffTbd, sortMatches, toMatchRow } from '../../src/ui/queries.js';

const NOW = Date.parse('2026-09-24T14:00:00Z'); // 10:00 ET
const row = (o: Record<string, unknown>) => ({ id: String(o.id ?? 'x'), season: 2026, game_date: '2026-09-24', gender: 'w', division: 'd3', status: 'scheduled', start_epoch: Date.parse('2026-09-24T23:00:00Z') / 1000, home_name: 'A', away_name: 'B', ...o });

describe('match rows', () => {
  it('midnight Eastern is a time TBA', () => {
    expect(kickoffTbd(Date.parse('2026-09-23T04:00:00Z') / 1000)).toBe(true);
    expect(kickoffTbd(Date.parse('2026-09-23T23:00:00Z') / 1000)).toBe(false);
    expect(kickoffTbd(null)).toBe(true);
  });
  it('a past day with no result is pending, not upcoming', () => {
    expect(toMatchRow(row({ game_date: '2026-09-23', start_epoch: Date.parse('2026-09-23T23:00:00Z') / 1000 }), undefined, NOW).result_pending).toBe(true);
    expect(toMatchRow(row({}), undefined, NOW).result_pending).toBe(false);
    // Kicked off five hours ago today and still nothing.
    expect(toMatchRow(row({ start_epoch: Date.parse('2026-09-24T09:00:00Z') / 1000 }), undefined, NOW).result_pending).toBe(true);
    expect(toMatchRow(row({ game_date: '2026-09-23', status: 'final', home_score: 1, away_score: 0 }), undefined, NOW).result_pending).toBe(false);
  });
  it('sorts upcoming by kickoff with TBA last, then finals, then pending', () => {
    const r = sortMatches([
      toMatchRow(row({ id: 'pending', game_date: '2026-09-23' }), undefined, NOW),
      toMatchRow(row({ id: 'tba', start_epoch: Date.parse('2026-09-24T04:00:00Z') / 1000 }), undefined, NOW),
      toMatchRow(row({ id: 'late', start_epoch: Date.parse('2026-09-24T23:30:00Z') / 1000 }), undefined, NOW),
      toMatchRow(row({ id: 'early' }), undefined, NOW),
      toMatchRow(row({ id: 'ft', status: 'final', home_score: 1, away_score: 1 }), undefined, NOW),
    ]);
    expect(r.map((m) => m.id)).toEqual(['early', 'late', 'tba', 'ft', 'pending']);
  });
});
