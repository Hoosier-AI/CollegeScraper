import { describe, expect, it } from 'vitest';
import { pctHex, proMatchStatCard, proPlayerStatCard, ratingHex } from '../src/seo/statcard.js';

const line = (o: Record<string, unknown>) => ({ slot: 1, player_id: 1, name: 'X', display: 'X', slug: null, photo: null, number: null, pos: null, grid: null, starter: true, captain: false, minutes: 90, rating: null, goals: null, assists: null, yellow: null, red: null, ...o });
const team = (name: string, score: number) => ({ id: name.length, name, slug: name.toLowerCase(), logo: null, score });

describe('stat cards', () => {
  it('uses the site rating scale and percentile bands', () => {
    expect(ratingHex(9.1)).toBe('#38BDF8');
    expect(ratingHex(6.76)).toBe('#FBBF24');
    expect(ratingHex(5.2)).toBe('#F87171');
    expect(pctHex(0.99)).toBe('#2DD4BF');
    expect(pctHex(0.23)).toBe('#F87171');
  });

  it('credits an own goal to the other side and leaves shootout kicks out', () => {
    const page: any = {
      match: { status: 'final', status_short: 'FT', league: { name: 'Serie A' }, round: 'Regular Season - 11', kickoff: '2026-11-08T14:00:00Z', home: team('Genoa', 1), away: team('Milan', 2), pen: [null, null], elapsed: 90 },
      events: [
        { seq: 1, minute: 13, extra: null, side: 'away', player_name: 'Alphadjo Cissè', type: 'goal', detail: 'Normal Goal', comments: null },
        { seq: 2, minute: 40, extra: null, side: 'home', player_name: 'Some Defender', type: 'goal', detail: 'Own Goal', comments: null },
        { seq: 3, minute: 88, extra: null, side: 'home', player_name: 'Mikael Ellertsson', type: 'goal', detail: 'Normal Goal', comments: null },
        { seq: 4, minute: 120, extra: null, side: 'home', player_name: 'Kicker', type: 'goal', detail: 'Penalty', comments: 'Penalty Shootout' },
      ],
      home: { starters: [line({ display: 'A', rating: 7.1 })], bench: [], stats: { possession: 38, shots: 17 } },
      away: { starters: [line({ display: 'Pulisic', rating: 8.1, goals: 1 })], bench: [], stats: { possession: 62, shots: 6 } },
    };
    const c = proMatchStatCard(page, [null, null], null);
    expect(c.home.scorers).toEqual(["Ellertsson 88'"]);
    expect(c.away.scorers).toEqual(["Cissè 13'", "Defender (OG) 40'"]);
    expect(c.context).toBe('Serie A · Round 11');
    expect(c.potm?.name).toBe('Pulisic');
    expect(c.stats[0]!.text).toEqual(['38%', '62%']);
  });

  it('adds up the current club season and drops national-team rows', () => {
    const row = (o: Record<string, unknown>) => ({ season: 2026, league: { name: 'Serie A' }, team: { id: 1, name: 'Milan' }, apps: 0, starts: 0, minutes: 0, goals: 0, assists: 0, shots: null, key_passes: null, passes: null, pass_accuracy: null, dribbles_won: null, rating: null, ...o });
    const page: any = {
      player: { name: 'Christian Pulišić', position: 'Midfielder', nationality: 'USA' }, team: { name: 'AC Milan' },
      seasons: [
        row({ apps: 8, minutes: 550, goals: 4, assists: 1, rating: 7.43, passes: 300, pass_accuracy: 90 }),
        row({ apps: 3, minutes: 120, league: { name: 'Europa League' }, rating: 4.97, passes: 48, pass_accuracy: 80 }),
        row({ apps: 5, minutes: 400, goals: 2, team: { id: 9, name: 'USA', national: true } }),
      ],
      percentiles: { league: { name: 'Serie A' }, season: 2026, rows: [{ stat: 'goals', value: 0.65, pct: 0.99, peers: 75 }, { stat: 'saves', value: 0, pct: 0, peers: 75 }] },
    };
    const c = proPlayerStatCard(page, null, null, 'Nov 13, 2026');
    expect(c.stats.slice(0, 4).map((s) => s.value)).toEqual(['11', '670', '4', '1']);
    expect(c.rating).toBeCloseTo((7.43 * 8 + 4.97 * 3) / 11, 5);
    expect(c.stats.find((s) => s.label === 'Pass accuracy')?.value).toBe('89%');
    // An outfield player's card has no Saves bar.
    expect(c.bars.map((b) => b.label)).toEqual(['Goals']);
    expect(c.barsCaption).toBe('Percentiles per 90 against 75 midfielders, Serie A 2026');
  });
});
