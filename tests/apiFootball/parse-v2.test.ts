import { describe, it, expect } from 'vitest';
import { fixture } from '../helpers/fakeFetcher.js';
import { parseCoaches, parseCountries, parseCountryTeams, parseInjuries, parseLeaguePlayers, parseProfilesPage, parseSquad, parseTransfers, parseTrophies } from '../../src/sources/apiFootball/parse.js';

const load = (f: string) => JSON.parse(fixture(`apiFootball/${f}`));

describe('v2 parsers (recorded answers)', () => {
  it('countries', () => {
    const rows = parseCountries(load('countries.json').response);
    expect(rows.length).toBe(171);
    expect(rows.find((r) => r.name === 'USA')).toMatchObject({ code: 'US' });
  });
  it('every club in a country, women\'s sides by their trailing W', () => {
    const rows = parseCountryTeams(load('teams-country.json').response);
    expect(rows.length).toBe(30);
    expect(rows.find((r) => r.id === 1595)).toMatchObject({ display_name: 'Seattle Sounders', gender: 'm', venue_name: 'Lumen Field', venue_capacity: 72000, founded: 2007 });
    expect(parseCountryTeams([{ team: { id: 1, name: 'Seattle Reign W' } }])[0]).toMatchObject({ display_name: 'Seattle Reign', gender: 'w' });
  });
  it('a page of 250 profiles', () => {
    const rows = parseProfilesPage(load('profiles-page.json').response);
    expect(rows.length).toBe(30);
    expect(rows[0]).toMatchObject({ id: 1, display_name: 'Roman Bürki', birth_date: '1990-11-14', nationality: 'Switzerland', height_cm: 187 });
  });
  it('season totals for a league page: profiles plus one row per club, played seasons only', () => {
    const { profiles, stats } = parseLeaguePlayers(load('league-players.json').response, 254, 2026);
    expect(profiles.length).toBe(20);
    const risa = stats.find((s) => s.player_id === 68551)!;
    expect(risa).toMatchObject({ team_id: 2999, source: 'provider', apps: 11, starts: 4, minutes: 319, goals: 0, sub_in: 7, sub_out: 4, bench: 8, position: 'Midfielder', number: 26, key_passes: 5, pass_accuracy: 86, interceptions: 4, yellow: 1, rating: 5.54 });
    expect(stats.every((s) => s.apps > 0 || s.minutes > 0)).toBe(true);
    // Another competition in the same answer is not this league's season.
    const other = parseLeaguePlayers([{ player: { id: 9, name: 'X' }, statistics: [{ team: { id: 1 }, league: { id: 39, season: 2026 }, games: { appearences: 3, minutes: 200 } }] }], 254, 2026);
    expect(other.stats).toHaveLength(0);
  });
  it('a squad skips the provider\'s id-0 players', () => {
    const { squad, stubs } = parseSquad(load('squad.json').response);
    expect(squad.every((s) => s.player_id > 0 && s.team_id === 3001)).toBe(true);
    expect(squad.find((s) => s.player_id === 68776)).toMatchObject({ number: 18, position: 'Goalkeeper' });
    expect(stubs.some((s) => s.name === 'Carolyn Calzada')).toBe(false);
  });
  it('transfers: one row per dated move, N/A types dropped, clubs inline', () => {
    const rows = parseTransfers(load('transfers-team.json').response);
    const loan = rows.find((r) => r.player_id === 76242 && r.date === '2018-10-17')!;
    expect(loan).toMatchObject({ type: 'Loan', from_team_id: 3001, to_team_id: 1975, to_name: 'Newcastle Jets FC W' });
    expect(rows.find((r) => r.player_id === 76242 && r.date === '2019-03-01')!.type).toBeNull();
    expect(new Set(rows.map((r) => `${r.player_id}|${r.date}|${r.from_team_id}|${r.to_team_id}`)).size).toBe(rows.length);
  });
  it('coaches and their careers', () => {
    const { coaches, career } = parseCoaches(load('coachs.json').response);
    expect(coaches[0]).toMatchObject({ id: 12239, display_name: 'Robert Gale', nationality: 'England', birth_date: '1977-08-03', team_id: 3001 });
    expect(career.filter((c) => c.coach_id === 12239).map((c) => [c.team_id, c.start, c.end])).toContainEqual([3001, '2024-04-01', null]);
  });
  it('trophies and injuries', () => {
    const t = parseTrophies(load('trophies.json').response, 'player', 276);
    expect(t[0]).toMatchObject({ subject: 'player', subject_id: 276, league: 'Saudi League', season: '2023/2024', place: 'Winner' });
    const inj = parseInjuries([{ player: { id: 5, name: 'A', type: 'Missing Fixture', reason: 'Knee Injury' }, team: { id: 42 }, fixture: { id: 99, timestamp: 1791072000 }, league: { id: 39, season: 2026 } },
      { player: { id: 5, name: 'A', type: 'Missing Fixture', reason: 'Knee Injury' }, team: { id: 42 }, fixture: { id: 99, timestamp: 1791072000 }, league: { id: 39, season: 2026 } }]);
    expect(inj).toEqual([{ league_id: 39, season: 2026, player_id: 5, fixture_id: 99, team_id: 42, type: 'Missing Fixture', reason: 'Knee Injury', date: '2026-10-04' }]);
  });
});
