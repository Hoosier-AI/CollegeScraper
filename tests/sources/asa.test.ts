import { describe, it, expect } from 'vitest';
import { fixture } from '../helpers/fakeFetcher.js';
import { mergePlayerSeasons, mergeTeamSeasons, parseGames, parseOfficials, parsePlayers, parseShots, parseStadia, parseTeams } from '../../src/sources/asa/parse.js';
import { asaCovers, nameOfSeason, seasonOfName } from '../../src/sources/asa/leagues.js';
import { clubScore, personScore } from '../../src/sources/match.js';
import { mapGames, mapPlayer, mapTeams, type ApiPerson } from '../../src/jobs/sources/mapping.js';
import { agreementRate, checkGame, checkPlayerSeason } from '../../src/jobs/sources/checks.js';

const load = (f: string) => JSON.parse(fixture(`asa/${f}`));

describe('American Soccer Analysis parsers (recorded MLS 2025 answers)', () => {
  it('games: score, kickoff, xG, attendance (0 is none), officials, knockout', () => {
    const rows = parseGames(load('games.json'), 253, 2025, load('games-xgoals.json'));
    expect(rows).toHaveLength(60);
    expect(rows[0]).toMatchObject({ ext_id: 'Vj589JGmq8', league_id: 253, season: 2025, kickoff: '2025-12-06T19:30:00.000Z', home_score: 3, away_score: 1, home_xg: 0.9458, away_xg: 1.693, attendance: null, knockout: true, status: 'final', matchday: 43 });
    expect(rows.every((r) => r.home_ext && r.away_ext)).toBe(true);
  });
  it('season names: calendar years, and the Super League\'s August-to-June seasons', () => {
    expect(nameOfSeason('mls', 2025)).toBe('2025');
    expect(nameOfSeason('usls', 2025)).toBe('2025-26');
    expect(seasonOfName('2025-26')).toBe(2025);
    expect(parseGames(load('usls-games.json'), 1130, 2025)[0]).toMatchObject({ league_id: 1130, season: 2025, attendance: 5682 });
    expect(asaCovers(253, 2013)).toBe(true);
    expect(asaCovers(253, 2012)).toBe(false);
    expect(asaCovers(256, 2025)).toBe(false);
  });
  it('people, clubs, grounds and officials', () => {
    const messi = parsePlayers(load('players.json')).find((p) => p.name === 'Lionel Messi')!;
    expect(messi).toMatchObject({ birth_date: '1987-06-24', height_cm: 170, weight_kg: 72, nationality: 'Argentina', position: 'ST', seasons: [2023, 2024, 2025, 2026] });
    expect(parseTeams(load('teams.json'), 253).find((t) => t.ext_id === '0KPqjA456v')).toMatchObject({ name: 'San Jose Earthquakes', short_name: 'San Jose', abbr: 'SJE' });
    expect(parseStadia(load('stadia.json'))[0]).toMatchObject({ name: 'Shell Energy Stadium', capacity: 22039, year_built: 2012, turf: false, city: 'Houston' });
    const managers = parseOfficials(load('managers.json'), 'manager');
    expect(managers.some((m) => m.name === 'Robin Fraser' && m.nationality === 'USA')).toBe(true);
    expect(parseOfficials(load('referees.json'), 'referee')[0]).toMatchObject({ role: 'referee', name: 'Alan Kelly', birth_date: '1975-04-09' });
  });
  it('one row per player and club: shooting, passing, goals added, keeping', () => {
    const rows = mergePlayerSeasons({ xgoals: load('players-xgoals.json'), xpass: load('players-xpass.json'), gplus: load('players-goals-added.json'), keepers: load('goalkeepers-xgoals.json'), keeperGplus: load('goalkeepers-goals-added.json') }, 253, 2025);
    const fb = rows.find((r) => r.player_ext === '0Oq624oPq6' && r.team_ext === 'jYQJ19EqGR')!;
    expect(fb).toMatchObject({ position: 'FB', minutes: 1634, shots: 12, shots_on: 5, goals: 3, xg: 1.1918, key_passes: 8, assists: 2, xa: 1.8869, passes: 793, pass_pct: 0.8235, xpass_pct: 0.8099, passes_over_expected: 10.73 });
    expect(Object.keys(fb.g_plus!)).toEqual(['Dribbling', 'Fouling', 'Interrupting', 'Passing', 'Receiving', 'Shooting']);
    expect(fb.g_plus_total).toBeCloseTo(Object.values(fb.g_plus!).reduce((n, x) => n + (x.above_avg ?? 0), 0), 3);
    const gk = rows.find((r) => r.player_ext === '0Oq6woOxQ6')!;
    expect(gk).toMatchObject({ minutes: 2251, gk_shots_faced: 107, gk_goals_conceded: 43, gk_saves: 62, gk_xg_faced: 40.5192 });
    expect(gk.g_plus).not.toBeNull();
  });
  it('clubs: xG and passing for and against, goals added by action', () => {
    const rows = mergeTeamSeasons({ xgoals: load('teams-xgoals.json'), xpass: load('teams-xpass.json'), gplus: load('teams-goals-added.json') }, 253, 2025);
    expect(rows).toHaveLength(30);
    const sj = rows.find((r) => r.team_ext === '0KPqjA456v')!;
    expect(sj).toMatchObject({ games: 34, goals_for: 58, goals_against: 61, xg_for: 64.7256, points: 41, passes_for: 16150 });
    expect(Object.keys(sj.g_plus!)).toHaveLength(7);
  });
  it('shots: where, xG, outcome, numbered in order', () => {
    const shots = parseShots(load('shots.json'));
    expect(shots).toHaveLength(18);
    expect(shots[0]).toMatchObject({ seq: 1, minute: 3, shooter_name: 'Tadeo Allende', assist_ext: null, x: 84.8, y: 33.8, xg: 0.0515, goal: false, pattern: 'Regular' });
    expect(new Set(shots.map((s) => s.seq)).size).toBe(18);
  });
});

describe('matching onto API-Football', () => {
  const api = (id: number, first: string, last: string, birth: string | null, display = `${first.split(' ')[0]} ${last.split(' ')[0]}`): ApiPerson => ({ id, first_name: first, last_name: last, display_name: display, birth_date: birth });
  it('people: full legal names, double surnames, initials; a different surname never', () => {
    expect(personScore('Cristian Arango', api(1, 'Cristian Camilo', 'Arango Duque', null))).toBe(1);
    expect(personScore('Lionel Messi', api(2, 'Lionel Andrés', 'Messi Cuccittini', null))).toBe(1);
    expect(personScore('Hany Mukhtar', api(3, 'Hany', 'Mukhtar', null))).toBe(1);
    expect(personScore('Mike Smith', api(4, 'Michael', 'Smith', null))).toBe(0.9);
    expect(personScore('Mike Smith', api(5, 'Mike', 'Jones', null))).toBe(0);
    expect(personScore('Hulk', { first_name: 'Givanildo', last_name: 'Vieira de Sousa', display_name: 'Hulk' })).toBe(0.9);
  });
  it('clubs: same words count, FC / SC / a trailing W do not', () => {
    expect(clubScore('Seattle Sounders FC', 'Seattle Sounders')).toBe(1);
    expect(clubScore('Portland Thorns FC', 'Portland Thorns W')).toBe(1);
    expect(clubScore('LA Galaxy', 'Los Angeles FC')).toBeLessThan(0.85);
  });
  it('a player by name and birth date, else among the club\'s players that season; ties stay unmatched', () => {
    const messi = api(154, 'Lionel Andrés', 'Messi Cuccittini', '1987-06-24');
    expect(mapPlayer({ ext_id: 'x', name: 'Lionel Messi', birth_date: '1987-06-24' }, [messi, api(9, 'Other', 'Player', '1987-06-24')], [])).toMatchObject({ pro_id: 154, method: 'name+birth' });
    expect(mapPlayer({ ext_id: 'x', name: 'Lionel Messi', birth_date: null }, [], [messi, messi])).toMatchObject({ pro_id: 154, method: 'name+club' });
    expect(mapPlayer({ ext_id: 'x', name: 'Lionel Messi', birth_date: '1990-01-01' }, [], [messi])).toMatchObject({ pro_id: null });
    expect(mapPlayer({ ext_id: 'x', name: 'John Smith', birth_date: '1995-05-05' }, [api(1, 'John', 'Smith', '1995-05-05'), api(2, 'John', 'Smith', '1995-05-05')], [])).toMatchObject({ pro_id: null });
  });
  it('clubs by name, the rest by the games they share with mapped opponents; games by clubs and date', () => {
    const src = [{ ext_id: 'A', name: 'Seattle Sounders FC' }, { ext_id: 'B', name: 'Some Renamed Club' }, { ext_id: 'C', name: 'Portland Timbers' }];
    const apiTeams = [{ id: 1595, name: 'Seattle Sounders', display_name: 'Seattle Sounders' }, { id: 1617, name: 'Portland Timbers', display_name: 'Portland Timbers' }, { id: 9999, name: 'Rebranded FC', display_name: 'Rebranded FC' }];
    const days = ['2025-03-01T20:00:00Z', '2025-04-01T20:00:00Z', '2025-05-01T20:00:00Z'];
    const games = days.map((d, i) => ({ ext_id: `g${i}`, kickoff: d, home_ext: i % 2 ? 'B' : 'A', away_ext: i % 2 ? 'A' : 'B' }));
    const fixtures = days.map((d, i) => ({ id: 100 + i, kickoff: d, home_team_id: i % 2 ? 9999 : 1595, away_team_id: i % 2 ? 1595 : 9999 }));
    const teams = mapTeams(src, apiTeams, games, fixtures);
    expect(teams.get('A')).toMatchObject({ pro_id: 1595, method: 'name' });
    expect(teams.get('B')).toMatchObject({ pro_id: 9999, method: 'games' });
    expect(teams.get('C')).toMatchObject({ pro_id: 1617 });
    const g = mapGames(games, fixtures, teams);
    expect(g.get('g0')).toMatchObject({ pro_id: 100, method: 'teams+date' });
    expect(g.get('g1')).toMatchObject({ pro_id: 101 });
  });
});

describe('checks against API-Football', () => {
  const g = parseGames(load('games.json'), 253, 2025)[0]!;
  it('a game: both scores compared (home and away swapped when the sources disagree on who hosted)', () => {
    expect(checkGame(g, { id: 1, home_goals: 3, away_goals: 1, status: 'final' }).map((r) => r.status)).toEqual(['agree', 'agree']);
    expect(checkGame(g, { id: 1, home_goals: 1, away_goals: 3, status: 'final', swapped: true }).map((r) => r.status)).toEqual(['agree', 'agree']);
    expect(checkGame(g, { id: 1, home_goals: 2, away_goals: 1, status: 'final' }).map((r) => r.status)).toEqual(['differ', 'agree']);
    expect(checkGame(g, null)[0]).toMatchObject({ field: 'game', status: 'unmatched' });
    expect(checkGame(g, { id: 1, home_goals: null, away_goals: null, status: 'scheduled' })).toEqual([]);
  });
  it('a player season: ASA minutes include stoppage time; goals and assists exact once a season is over', () => {
    const r = mergePlayerSeasons({ xgoals: load('players-xgoals.json') }, 253, 2025)[0]!; // 1634 minutes, 3 goals, 2 assists
    expect(checkPlayerSeason(r, { key: '1|2', minutes: 1640, goals: 3, assists: 2 }).map((x) => x.status)).toEqual(['agree', 'agree', 'agree']);
    expect(checkPlayerSeason(r, { key: '1|2', minutes: 1480, goals: 3, assists: 2 })[0]!.status).toBe('agree'); // ASA ~10% higher: stoppage time
    expect(checkPlayerSeason(r, { key: '1|2', minutes: 1300, goals: 4, assists: 2 }).map((x) => x.status)).toEqual(['differ', 'differ', 'agree']);
    expect(checkPlayerSeason(r, { key: '1|2', minutes: 1700, goals: 3, assists: 2 })[0]!.status).toBe('differ'); // under API-Football's
    // The current season: totals may be a match apart.
    expect(checkPlayerSeason(r, { key: '1|2', minutes: 1640, goals: 2, assists: 3 }, undefined, true).map((x) => x.status)).toEqual(['agree', 'agree', 'agree']);
    expect(agreementRate([{ status: 'agree' }, { status: 'agree' }, { status: 'differ' }, { status: 'unmatched' }])).toBe(0.5);
    expect(agreementRate([])).toBeNull();
  });
});

import { seasonRowFromAsa } from '../../src/jobs/sources/asaFill.js';
describe('ASA season totals where API-Football has none', () => {
  it('what ASA counts goes in; starts, cards and rating stay empty; keepers keep their saves', () => {
    const r = seasonRowFromAsa({ minutes: 1634, games: 23, goals: 3, assists: 2, shots: 12, shots_on: 5, key_passes: 8, passes: 793, pass_pct: 0.8235, position: 'FB', gk_saves: null, gk_goals_conceded: null }, 9, 1595, 489, 2026, 't');
    expect(r).toMatchObject({ player_id: 9, team_id: 1595, league_id: 489, season: 2026, apps: 23, starts: null, minutes: 1634, goals: 3, assists: 2, pass_accuracy: 82, yellow: null, red: null, position: 'Defender', source: 'asa', saves: null });
    expect(seasonRowFromAsa({ minutes: 900, games: 10, goals: 0, assists: 0, shots: 0, shots_on: 0, key_passes: 0, passes: 300, pass_pct: 0.7, position: 'GK', gk_saves: 31, gk_goals_conceded: 12 }, 1, 2, 489, 2026)).toMatchObject({ position: 'Goalkeeper', saves: 31, conceded: 12 });
  });
});
