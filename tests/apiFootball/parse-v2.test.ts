import { describe, it, expect } from 'vitest';
import { fixture } from '../helpers/fakeFetcher.js';
import { parseCoaches, parseCountries, parseCountryTeams, parseFixtureDetail, parseInjuries, parseLeaguePlayers, parseProfilesPage, parseSidelined, parseSquad, parseTeamStatistics, parseTransfers, parseTrophies, parseVenues } from '../../src/sources/apiFootball/parse.js';

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
    expect(rows.find((r) => r.id === 1595)).toMatchObject({ display_name: 'Seattle Sounders', gender: 'm', venue_id: 11534, venue_name: 'Lumen Field', venue_capacity: 72000, founded: 2007 });
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

describe('v3 parsers: every stat the provider has (recorded answers)', () => {
  it('a club season: record, goals by window, biggest, clean sheets, penalties, formations, cards', () => {
    const r = parseTeamStatistics(load('teamstats.json').response, 1595, 253, 2025, '2026-10-09T00:00:00Z')!;
    expect(r).toMatchObject({ team_id: 1595, league_id: 253, season: 2025 });
    expect(r.form).toHaveLength(37);
    expect(r.fixtures!.wins).toEqual({ home: 11, away: 5, total: 16 });
    expect(r.goals!.for.total).toEqual({ home: 42, away: 23, total: 65 });
    expect(r.goals!.for.average.total).toBe(1.8);
    expect(r.goals!.for.minute['46-60']).toBe(16);
    expect(r.goals!.for.minute['91-105']).toBeNull();
    expect(r.goals!.against.under_over['2.5']).toEqual({ over: 7, under: 30 });
    expect(r.biggest).toMatchObject({ streak: { wins: 3, draws: 2, loses: 2 }, wins: { home: '5-2', away: '0-4' } });
    expect(r.clean_sheet).toEqual({ home: 7, away: 2, total: 9 });
    expect(r.failed_to_score!.away).toBe(7);
    expect(r.penalty).toEqual({ scored: 4, missed: 0, total: 4 });
    expect(r.lineups[0]).toEqual({ formation: '4-2-3-1', played: 25 });
    expect(r.lineups).toHaveLength(6);
    expect(r.cards!.red!['91-105']).toBe(3);
  });
  it('a club season with nothing in it is no row', () => {
    expect(parseTeamStatistics(undefined, 1, 2, 3)).toBeNull();
    expect(parseTeamStatistics({ fixtures: { played: { home: 0, away: 0, total: 0 } } }, 1, 2, 3)).toBeNull();
  });
  it('grounds, from venues?country= and from a club answer', () => {
    const rows = parseVenues(load('venues.json').response);
    expect(rows).toHaveLength(25);
    expect(rows[0]).toMatchObject({ id: 11534, name: 'Lumen Field', city: 'Seattle, Washington', country: 'USA', capacity: 72000, surface: 'artificial turf' });
    expect(parseVenues([{ id: 0, name: 'Nowhere' }, { id: 5, name: null }, { id: 6, name: 'Field', capacity: 0 }])).toEqual([expect.objectContaining({ id: 6, capacity: null })]);
  });
  it('injury history: one row per spell, the current one open', () => {
    const rows = parseSidelined(load('sidelined.json').response, 276);
    expect(rows.length).toBeGreaterThan(20);
    expect(rows[0]).toMatchObject({ player_id: 276, type: 'Thigh Injury', start: '2025-09-19', end: null });
    expect(rows[1]).toMatchObject({ start: '2025-04-18', end: '2025-05-22' });
    expect(parseSidelined([{ type: 'X', start: null }, { type: 'Y', start: '2024-01-01' }, { type: 'Y', start: '2024-01-01' }], 1)).toHaveLength(1);
  });
  it('match lines keep dribbled past and penalties won and committed; team stats keep every other type', () => {
    const it0 = load('fixtures-ids.json').response.find((i: { fixture: { id: number } }) => i.fixture.id === 1508568);
    const line = it0.players[0].players[0];
    line.statistics[0].dribbles.past = 3; line.statistics[0].penalty.won = 1; line.statistics[0].penalty.commited = 0;
    const d = parseFixtureDetail(it0, 'w');
    expect(d.players.find((p) => p.player_id === line.player.id)).toMatchObject({ dribbled_past: 3, pen_won: 1, pen_committed: 0 });
    const t = d.teamStats[0]!;
    expect(t.extra).toHaveProperty('free_kicks');
    expect(t.extra).not.toHaveProperty('ball_possession');
  });
});

import { commonName } from '../../src/sources/apiFootball/parse.js';
describe('names people use', () => {
  it('the surname from the short name, the short name when it is one, else the full name', () => {
    expect(commonName('L. Messi', 'Lionel Andrés', 'Messi Cuccittini', 'Lionel Messi Cuccittini')).toBe('Lionel Messi');
    expect(commonName('V. van Dijk', 'Virgil', 'van Dijk', 'Virgil van Dijk')).toBe('Virgil van Dijk');
    expect(commonName('J. Sancho', 'Jadon Malik', 'Sancho', 'Jadon Sancho')).toBe('Jadon Sancho');
    expect(commonName('Neymar', 'Neymar', 'da Silva Santos Júnior', 'Neymar da Silva Santos Júnior')).toBe('Neymar');
    expect(commonName('Virgilio Nazareth Piñero Delgado', 'Virgilio Nazareth', 'Piñero Delgado', 'Virgilio Piñero Delgado')).toBe('Virgilio Piñero Delgado');
    expect(commonName('X. Nobody', 'Lionel', 'Messi', 'Lionel Messi')).toBe('Lionel Messi'); // a surname that is not theirs
  });
});
