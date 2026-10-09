import { describe, it, expect } from 'vitest';
import { planTasks, tierOf } from '../../src/jobs/pro/plan.js';
import { Pace } from '../../src/jobs/pro/tasks.js';
import type { LeagueInfo } from '../../src/db/proRepo.js';

const L = (id: number, priority: number, type: 'league' | 'cup' = 'league', enabled = true, current = 2026, country: string | null = 'England', kind: LeagueInfo['kind'] = 'pro'): [number, LeagueInfo] =>
  [id, { id, gender: 'm', enabled, priority, type, current_season: current, country, kind }];
const cov = (...years: number[]) => years.map((s) => ({ season: s, standings: true, players: true, injuries: true }));

describe('crawl plan', () => {
  const leagues = new Map([
    L(253, 1, 'league', true, 2026, 'USA'), L(256, 13, 'league', true, 2026, 'USA', 'amateur'), L(772, 8, 'cup', true, 2026, 'World'),
    L(39, 20), L(183, 500), L(9001, 600, 'cup'), L(262, 45, 'league', true, 2026, 'Mexico'), L(999, 900, 'league', false),
  ]);
  const seasons = new Map([
    [253, cov(2026, 2025, 2024, 2023, 2022, 2021, 2012)], [256, [...cov(2026), { season: 2025, standings: false, players: false, injuries: false }]],
    [39, cov(2026, 2025, 2024, 2023, 2022, 2021, 2014)], [183, cov(2026, 2025, 2024, 2023)],
  ]);
  const leagueTeams = [
    { league_id: 253, season: 2026, team_id: 1 }, { league_id: 253, season: 2012, team_id: 11 }, { league_id: 256, season: 2026, team_id: 12 },
    { league_id: 772, season: 2026, team_id: 1 }, { league_id: 772, season: 2026, team_id: 20 }, { league_id: 262, season: 2026, team_id: 20 },
    { league_id: 39, season: 2026, team_id: 30 }, { league_id: 183, season: 2026, team_id: 30 }, { league_id: 183, season: 2026, team_id: 2 }, { league_id: 183, season: 2025, team_id: 3 },
  ];
  const tasks = planTasks({ leagues, seasons, leagueTeams, topPlayers: [7], usPlayers: [70], usCoaches: [80], countries: ['USA', 'England'], newPlayers: [8] });
  const get = (kind: string, key: string) => tasks.find((t) => t.kind === kind && t.key === key);

  it('tiers: the US scene, then top competitions, other leagues, cups', () => {
    expect(tierOf({ id: 253, country: 'USA', priority: 1, type: 'league' })).toBe(1);
    expect(tierOf({ id: 256, country: 'USA', priority: 900, type: 'league' })).toBe(1);
    expect(tierOf({ id: 772, country: 'World', priority: 8, type: 'cup' })).toBe(1);
    expect(tierOf({ id: 39, country: 'England', priority: 20, type: 'league' })).toBe(2);
    expect(tierOf({ id: 183, country: 'England', priority: 500, type: 'league' })).toBe(3);
    expect(tierOf({ id: 9001, country: 'England', priority: 600, type: 'cup' })).toBe(4);
  });
  it('the whole US scene sits ahead of every other competition', () => {
    const us = tasks.filter((t) => t.tier === 1);
    const rest = tasks.filter((t) => t.tier! >= 2);
    expect(Math.max(...us.map((t) => t.priority))).toBeLessThan(Math.min(...rest.map((t) => t.priority)));
    expect(us.every((t) => t.priority >= 11 && t.priority <= 19)).toBe(true);
  });
  it('US current seasons: fixtures every 3 days, injuries daily, totals and squads every 3 days, club stats weekly', () => {
    expect(get('season_fixtures', '253|2026')).toMatchObject({ priority: 11, every_days: 3, tier: 1 });
    expect(get('injuries', '253|2026')).toMatchObject({ priority: 11, every_days: 1 });
    expect(get('league_players', '253|2026')).toMatchObject({ priority: 12, every_days: 3 });
    expect(get('squad', '1')).toMatchObject({ priority: 12, every_days: 3, tier: 1 });
    expect(get('detail', '253|2026')).toMatchObject({ priority: 13, every_days: 1 });
    expect(get('team_stats', '253|2026|1')).toMatchObject({ priority: 13, every_days: 7 });
    expect(get('venues', 'USA')).toMatchObject({ priority: 11, tier: 1 });
  });
  it('US history: every season the provider has, as deep as it goes', () => {
    for (const s of [2025, 2021, 2012]) {
      expect(get('season_fixtures', `253|${s}`)).toMatchObject({ priority: 14, every_days: null });
      expect(get('standings', `253|${s}`)!.priority).toBe(14);
      expect(get('league_players', `253|${s}`)!.priority).toBe(15);
      expect(get('detail', `253|${s}`)!.priority).toBe(15);
    }
    expect(get('team_stats', '253|2012|11')).toMatchObject({ priority: 16, every_days: null });
  });
  it('amateur US leagues are crawled too, skipping what the provider does not cover', () => {
    expect(get('season_fixtures', '256|2026')).toMatchObject({ priority: 11, tier: 1 });
    expect(get('league_players', '256|2026')).toMatchObject({ every_days: 7 });
    expect(get('league_players', '256|2025')).toBeUndefined();
    expect(get('standings', '256|2025')).toBeUndefined();
    expect(get('season_fixtures', '256|2025')).toBeDefined();
    expect(get('squad', '12')).toMatchObject({ priority: 12, every_days: 30 });
  });
  it('every club that ever played in the US gets squad, transfers and coach; a former one less often', () => {
    expect(get('squad', '11')).toMatchObject({ priority: 17, every_days: 90, tier: 1 });
    expect(get('transfers', '1')).toMatchObject({ priority: 17, every_days: 7 });
    expect(get('coach', '11')).toMatchObject({ priority: 17, every_days: 90 });
  });
  it('an international competition does not make a foreign club American', () => {
    expect(get('squad', '20')).toMatchObject({ priority: 35, tier: 2 });
    expect(get('team_stats', '772|2026|1')).toBeDefined();
    expect(get('team_stats', '772|2026|20')).toBeUndefined();
  });
  it('US people: injury history and trophies for players, trophies for coaches', () => {
    expect(get('sidelined', '70')).toMatchObject({ priority: 18, every_days: 60, tier: 1 });
    expect(get('trophies', '70')).toMatchObject({ priority: 18, tier: 1 });
    expect(get('coach_trophies', '80')).toMatchObject({ priority: 19, every_days: 180, tier: 1 });
  });
  it('everyone else keeps the old order, one tier down', () => {
    expect(get('countries', 'all')!.priority).toBe(1);
    expect(get('profiles_page', '1')).toMatchObject({ priority: 10, every_days: 30, tier: 0 });
    expect(get('profile', '8')).toMatchObject({ priority: 19, every_days: null, tier: 0 });
    expect(get('season_fixtures', '39|2026')).toMatchObject({ priority: 20, every_days: 7, tier: 2 });
    expect(get('season_fixtures', '183|2026')).toMatchObject({ priority: 40, tier: 3 });
    expect(get('season_fixtures', '9001|2026')).toMatchObject({ priority: 60, every_days: 14, tier: 4 });
    expect(tasks.some((t) => t.key.startsWith('999|'))).toBe(false);
    expect(get('injuries', '39|2026')).toMatchObject({ priority: 25, every_days: 1 });
    expect(get('injuries', '183|2026')).toBeUndefined();
    expect(get('detail', '39|2022')).toBeDefined();
    expect(get('detail', '39|2021')).toBeUndefined();
    expect(get('detail', '183|2024')).toBeDefined();
    expect(get('detail', '183|2023')).toBeUndefined();
    expect(get('league_players', '39|2021')).toMatchObject({ priority: 300, every_days: null });
    expect(get('league_players', '39|2014')).toBeUndefined();
    expect(get('league_players', '183|2023')).toBeUndefined();
  });
  it('other clubs: the best tier of their current competitions; last season\'s clubs are not re-read', () => {
    expect(get('squad', '30')).toMatchObject({ priority: 35, every_days: 7, tier: 2 });
    expect(get('squad', '2')).toMatchObject({ priority: 80, every_days: 30, tier: 3 });
    expect(get('squad', '3')).toBeUndefined();
    expect(get('trophies', '7')).toMatchObject({ priority: 400, every_days: 90, tier: 2 });
    expect(get('sidelined', '7')).toMatchObject({ priority: 410, tier: 2 });
  });
  it('new stats beyond the US: top clubs\' season stats, grounds everywhere', () => {
    expect(get('team_stats', '39|2026|30')).toMatchObject({ priority: 90, every_days: 14, tier: 2 });
    expect(get('team_stats', '183|2026|2')).toBeUndefined();
    expect(get('venues', 'England')).toMatchObject({ priority: 100, every_days: 180, tier: 0 });
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
