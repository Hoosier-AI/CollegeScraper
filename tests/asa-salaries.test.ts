import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseSalaries } from '../src/sources/asa/parse.js';

describe('ASA MLS salaries', () => {
  it('keeps one row per player, club, season and release', () => {
    const rows = parseSalaries(JSON.parse(readFileSync('fixtures/asa/salaries.json', 'utf8')), 253, '2026-10-14T00:00:00Z');
    expect(rows.length).toBeGreaterThan(3);
    expect(rows[0]).toMatchObject({ source: 'asa', player_ext: '0Oq624oPq6', team_ext: 'jYQJ19EqGR', season: 2025, release_date: '2025-05-23', league_id: 253, position: 'D', base_salary: 80622, guaranteed_comp: 80622 });
    expect(new Set(rows.map((r) => `${r.player_ext}|${r.release_date}`)).size).toBe(rows.length);
  });
  it('drops rows without a player, season or release date', () => {
    expect(parseSalaries([{ player_id: 'x', season_name: 2025 }, { season_name: 2025, mlspa_release: '2025-05-23' }, { player_id: 'y', season_name: 'bad', mlspa_release: '2025-05-23' }], 253)).toHaveLength(0);
  });
});
