import { describe, it, expect } from 'vitest';
import { planTasks, tierOf } from '../../src/jobs/pro/plan.js';
import { Pace } from '../../src/jobs/pro/tasks.js';
import type { LeagueInfo } from '../../src/db/proRepo.js';

const L = (id: number, priority: number, type: 'league' | 'cup' = 'league', enabled = true, current = 2026): [number, LeagueInfo] => [id, { id, gender: 'm', enabled, priority, type, current_season: current }];

describe('crawl plan', () => {
  const leagues = new Map([L(253, 1), L(183, 500), L(9001, 600, 'cup'), L(256, 900, 'league', false)]);
  const seasons = new Map([[253, [2026, 2025, 2024, 2023, 2022, 2021, 2014].map((s) => ({ season: s, standings: true }))], [183, [2026, 2025, 2024, 2023].map((s) => ({ season: s, standings: true }))]]);
  const tasks = planTasks({ leagues, seasons, leagueTeams: [{ league_id: 253, season: 2026, team_id: 1 }, { league_id: 183, season: 2026, team_id: 1 }, { league_id: 183, season: 2026, team_id: 2 }, { league_id: 183, season: 2025, team_id: 3 }], topPlayers: [7], newPlayers: [8] });
  const get = (kind: string, key: string) => tasks.find((t) => t.kind === kind && t.key === key);

  it('tiers from priority and type', () => {
    expect(tierOf({ priority: 2, type: 'league' })).toBe(1);
    expect(tierOf({ priority: 500, type: 'league' })).toBe(2);
    expect(tierOf({ priority: 600, type: 'cup' })).toBe(3);
  });
  it('every club and every player come first', () => {
    expect(get('countries', 'all')!.priority).toBe(1);
    expect(get('profiles_page', '1')).toMatchObject({ priority: 10, every_days: 30 });
    expect(get('profile', '8')).toMatchObject({ priority: 15, every_days: null });
  });
  it('current seasons for every enabled league; disabled ones never', () => {
    expect(get('season_fixtures', '253|2026')).toMatchObject({ priority: 20, every_days: 7 });
    expect(get('season_fixtures', '183|2026')!.priority).toBe(40);
    expect(get('season_fixtures', '9001|2026')).toMatchObject({ priority: 60, every_days: 14 });
    expect(tasks.some((t) => t.key.startsWith('256|'))).toBe(false);
    expect(get('injuries', '253|2026')).toMatchObject({ every_days: 1 });
    expect(get('injuries', '183|2026')).toBeUndefined();
  });
  it('detail 5 seasons for T1, 3 for the rest; season totals back to 2015 for T1 only', () => {
    expect(get('detail', '253|2022')).toBeDefined();
    expect(get('detail', '253|2021')).toBeUndefined();
    expect(get('detail', '183|2024')).toBeDefined();
    expect(get('detail', '183|2023')).toBeUndefined();
    expect(get('league_players', '253|2021')).toMatchObject({ priority: 300, every_days: null });
    expect(get('league_players', '253|2014')).toBeUndefined();
    expect(get('league_players', '183|2023')).toBeUndefined();
    expect(get('standings', '253|2025')!.every_days).toBeNull();
  });
  it('a club gets the best tier of its current competitions; last season\'s clubs are not re-read', () => {
    expect(get('squad', '1')).toMatchObject({ priority: 35, every_days: 7 });
    expect(get('squad', '2')).toMatchObject({ priority: 80, every_days: 30 });
    expect(get('squad', '3')).toBeUndefined();
    expect(get('transfers', '1')!.priority).toBeLessThan(get('transfers', '2')!.priority);
    expect(get('trophies', '7')).toMatchObject({ priority: 400, every_days: 90 });
  });
  it('one task per kind and key', () => {
    expect(new Set(tasks.map((t) => `${t.kind}|${t.key}`)).size).toBe(tasks.length);
  });
});

describe('database pace', () => {
  it('halves the batch and asks for a pause when a batch is slow or fails, grows back when calm', async () => {
    const p = new Pace({ slowMs: 5 });
    await p.write(10, async () => { await new Promise((r) => setTimeout(r, 15)); });
    expect(p.chunk).toBe(125);
    expect(p.pauseMs).toBe(60_000);
    await expect(p.write(10, async () => { throw new Error('timeout'); })).rejects.toThrow('timeout');
    expect(p.chunk).toBe(62);
    p.calm(); expect(p.chunk).toBe(124);
    for (let i = 0; i < 5; i++) p.calm();
    expect(p.chunk).toBe(250);
  });
});
