import { describe, expect, it } from 'vitest';
import type { SiteContext } from '../../src/model.js';
import { parseCumulativeStats } from '../../src/sources/sites/sidearm/cumulativeStats.js';
import { fixture } from '../helpers/fakeFetcher.js';

const ctx: SiteContext = { host: 'goduke.com', baseUrl: 'https://goduke.com', gender: 'm', season: 2025, sportSlug: 'mens-soccer', sportId: 10, teamSlug: null };

describe('parseCumulativeStats (goduke.com /sports/mens-soccer/stats/2025)', () => {
  const stats = parseCumulativeStats(fixture('sidearm/duke-stats-2025.html'), ctx);

  it('parses the 28 individual lines with rosterPlayerId keys', () => {
    expect(stats.players).toHaveLength(28);
    expect(stats.sourceUrl).toBe('https://goduke.com/sports/mens-soccer/stats/2025');
    expect(new Set(stats.players.map((p) => p.sourceKey)).size).toBe(28);
    expect(stats.players.some((p) => /^(total|opponents)$/i.test(p.name))).toBe(false);
  });

  it('parses Kenan Hot #23 exactly as printed', () => {
    const hot = stats.players.find((p) => p.name === 'Hot, Kenan')!;
    expect(hot).toEqual({
      sourceKey: '23199', name: 'Hot, Kenan', jersey: 23, gp: 19, gs: 19, minutes: 1624, goals: 8, assists: 4, points: 20,
      shots: 48, sog: 19, yellow: 5, red: 0, gwg: 2, pkGoals: 0, pkAttempts: 1,
      goalsAllowed: null, saves: null, shutouts: null, gkMinutes: null, gaa: null, savePct: null,
    });
    const vukovic = stats.players.find((p) => p.name === 'Vukovic, Aleksandar')!;
    expect([vukovic.yellow, vukovic.red, vukovic.gp, vukovic.minutes]).toEqual([4, 1, 14, 1032]);
  });

  it('parses the team and opponents lines from the Team Statistics table', () => {
    expect(stats.team).toEqual({ goals: 38, assists: 43, shots: 360, sog: 135, saves: 44, fouls: 268, corners: 149, offsides: null, yellow: 37, red: 2, pkGoals: 4, pkAttempts: 6, gamesPlayed: 20 });
    expect(stats.opponents).toEqual({ goals: 16, assists: 10, shots: 178, sog: 60, saves: 97, fouls: 265, corners: 78, offsides: null, yellow: 44, red: 5, pkGoals: 1, pkAttempts: 1, gamesPlayed: 20 });
  });

  it('merges a goalkeeping table when one is rendered', () => {
    const html = `
      <table><thead><tr><th>#</th><th>Player</th><th>gp</th><th>gs</th><th>min</th><th>g</th><th>a</th><th>pts</th><th>sh</th><th>sog</th><th>yc-rc</th><th>gw</th><th>pg-pa</th></tr></thead>
      <tbody><tr><td>1</td><td><a href="/sports/mens-soccer/roster/eryk-dymora/23224">Dymora, Eryk</a></td><td>20</td><td>20</td><td>1800</td><td>0</td><td>0</td><td>0</td><td>0</td><td>0</td><td>1-0</td><td>0</td><td>0-0</td></tr></tbody></table>
      <table><thead><tr><th>#</th><th>Player</th><th>gp</th><th>gs</th><th>min</th><th>ga</th><th>gaa</th><th>sv</th><th>sv%</th><th>sho</th></tr></thead>
      <tbody><tr><td>1</td><td>Dymora, Eryk</td><td>20</td><td>20</td><td>1800:00</td><td>16</td><td>0.80</td><td>44</td><td>.733</td><td>9</td></tr>
      <tr><td></td><td>Total</td><td>20</td><td></td><td>1800</td><td>16</td><td>0.80</td><td>44</td><td>.733</td><td>9</td></tr></tbody></table>`;
    const s = parseCumulativeStats(html, ctx);
    expect(s.players).toHaveLength(1);
    expect(s.players[0]).toMatchObject({ sourceKey: '23224', gp: 20, minutes: 1800, yellow: 1, goalsAllowed: 16, gaa: 0.8, saves: 44, savePct: 0.733, shutouts: 9 });
  });

  it('returns empty players and null team lines when no tables exist', () => {
    const s = parseCumulativeStats('<html><body>no stats yet</body></html>', ctx);
    expect(s.players).toEqual([]);
    expect(s.team).toBeNull();
    expect(s.opponents).toBeNull();
  });
});
