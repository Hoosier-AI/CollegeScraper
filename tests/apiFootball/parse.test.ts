import { describe, it, expect } from 'vitest';
import { fixture } from '../helpers/fakeFetcher.js';
import { hasDetail, parseFixture, parseFixtureDetail, parseLeagues, parseProfile, parseStandings, parseTeams, personDisplayName, statusOf, teamsOf } from '../../src/sources/apiFootball/parse.js';
import { leagueGender, leagueKind, leaguePriority, teamDisplayName } from '../../src/sources/apiFootball/leagues.js';

const load = (f: string) => JSON.parse(fixture(`apiFootball/${f}`));

describe('league classification', () => {
  it('reads gender from the name, with overrides for women\'s leagues the name does not give away', () => {
    expect(leagueGender(254, 'NWSL Women')).toBe('w');
    expect(leagueGender(1130, 'USL Super League')).toBe('w');
    expect(leagueGender(44, 'FA WSL')).toBe('w');
    expect(leagueGender(64, 'Feminine Division 1')).toBe('w');
    expect(leagueGender(82, 'Frauen Bundesliga')).toBe('w');
    expect(leagueGender(39, 'Premier League')).toBe('m');
    expect(leagueGender(253, 'Major League Soccer')).toBe('m');
  });
  it('keeps youth, friendlies and amateur leagues out of the default crawl', () => {
    expect(leagueKind(39, 'Premier League')).toBe('pro');
    expect(leagueKind(909, 'MLS Next Pro')).toBe('pro');
    expect(leagueKind(14, 'UEFA Youth League')).toBe('youth');
    expect(leagueKind(38, 'UEFA U21 Championship')).toBe('youth');
    expect(leagueKind(10, 'Friendlies')).toBe('friendly');
    expect(leagueKind(256, 'USL League Two')).toBe('amateur');
    expect(leagueKind(1116, 'WPSL')).toBe('amateur');
    expect(leagueKind(153, 'Provincial - Antwerpen')).toBe('amateur');
    expect(leagueKind(83, 'Regionalliga - Bayern')).toBe('amateur');
    expect(leagueKind(2, 'UEFA Champions League')).toBe('pro');
  });
  it('orders the US pyramid first, then the big leagues, then everything else', () => {
    expect(leaguePriority(253, 'league', 'pro')).toBeLessThan(leaguePriority(39, 'league', 'pro'));
    expect(leaguePriority(39, 'league', 'pro')).toBeLessThan(leaguePriority(183, 'league', 'pro'));
    expect(leaguePriority(183, 'league', 'pro')).toBe(500);
    expect(leaguePriority(9999, 'cup', 'pro')).toBe(600);
    expect(leaguePriority(9999, 'league', 'youth')).toBeGreaterThan(600);
  });
  it('drops the provider\'s trailing W from women\'s club names', () => {
    expect(teamDisplayName('Portland Thorns W')).toBe('Portland Thorns');
    expect(teamDisplayName('West Ham')).toBe('West Ham');
  });
});

describe('parseLeagues', () => {
  const { leagues, seasons } = parseLeagues(load('leagues.json').response);
  it('makes a row per competition and per season', () => {
    expect(leagues.length).toBe(14);
    expect(seasons.length).toBeGreaterThan(14);
    const mls = leagues.find((l) => l.id === 253)!;
    expect(mls).toMatchObject({ name: 'Major League Soccer', type: 'league', country: 'USA', gender: 'm', kind: 'pro', enabled: true, priority: 1 });
    expect(mls.current_season).toBe(2026);
  });
  it('enables professional competitions, and the whole US scene whatever its level', () => {
    const on = new Map(leagues.map((l) => [l.id, l.enabled]));
    expect(on.get(254)).toBe(true);
    expect(on.get(256)).toBe(true); // USL League Two: amateur, but American
    expect(leagues.find((l) => l.id === 256)).toMatchObject({ kind: 'amateur', priority: 13 });
    expect(on.get(10)).toBe(false); // friendlies
    expect(on.get(14)).toBe(false); // youth
  });
  it('one row per league season even when the provider repeats a year', () => {
    const r = parseLeagues([{ league: { id: 1, name: 'X', type: 'League' }, country: { name: 'USA' }, seasons: [{ year: 2026, current: false }, { year: 2026, current: true }, { year: 2025 }] }]);
    expect(r.seasons.map((s) => [s.season, s.is_current])).toEqual([[2026, true], [2025, false]]);
  });
  it('keeps the coverage flags per season', () => {
    const s = seasons.find((x) => x.league_id === 39 && x.is_current)!;
    expect(s.coverage.fixtures?.events).toBe(true);
  });
});

describe('fixtures', () => {
  it('maps the provider status codes', () => {
    expect(['NS', 'TBD'].map(statusOf)).toEqual(['scheduled', 'scheduled']);
    expect(['1H', 'HT', '2H', 'ET', 'P', 'BT', 'SUSP'].every((c) => statusOf(c) === 'live')).toBe(true);
    expect(['FT', 'AET', 'PEN', 'AWD', 'WO'].every((c) => statusOf(c) === 'final')).toBe(true);
    expect(statusOf('PST')).toBe('postponed');
    expect(statusOf('CANC')).toBe('cancelled');
    expect(statusOf('ABD')).toBe('abandoned');
  });
  it('parses a day\'s scoreboard into fixture rows', () => {
    const items = load('fixtures-date.json').response;
    const rows = items.map(parseFixture);
    const thorns = rows.find((r: { id: number }) => r.id === 1508568)!;
    expect(thorns).toMatchObject({ league_id: 254, season: 2026, status: 'final', status_short: 'FT', venue_name: 'Providence Park', venue_city: 'Portland' });
    expect(thorns.kickoff).toBe('2026-10-04T00:45:00.000Z');
    expect(thorns.winner).not.toBeNull();
    const postponed = rows.find((r: { status: string }) => r.status === 'postponed');
    expect(postponed).toBeTruthy();
    expect(postponed!.home_goals).toBeNull();
  });
  it('collects both clubs once, with the league\'s gender', () => {
    const items = load('fixtures-date.json').response;
    const teams = teamsOf(items, (id) => (id === 254 ? 'w' : 'm'));
    const thorns = teams.find((t) => t.id === 3001)!;
    expect(thorns).toMatchObject({ name: 'Portland Thorns W', display_name: 'Portland Thorns', gender: 'w' });
    expect(new Set(teams.map((t) => t.id)).size).toBe(teams.length);
  });
  it('a penalty shootout winner comes from the provider, not the level score', () => {
    const row = parseFixture({ fixture: { id: 1, date: '2026-05-01T18:00:00+00:00', status: { short: 'PEN' } }, league: { id: 2, season: 2025 }, teams: { home: { id: 10, name: 'A', winner: false }, away: { id: 11, name: 'B', winner: true } }, goals: { home: 1, away: 1 }, score: { penalty: { home: 3, away: 4 } } });
    expect(row).toMatchObject({ status: 'final', home_goals: 1, away_goals: 1, pen_home: 3, pen_away: 4, winner: 'away' });
  });
});

describe('parseFixtureDetail', () => {
  const items = load('fixtures-ids.json').response;
  const nwsl = items.find((i: { fixture: { id: number } }) => i.fixture.id === 1508568);
  const usl = items.find((i: { fixture: { id: number } }) => i.fixture.id === 1493724);
  const d = parseFixtureDetail(nwsl, 'w');

  it('numbers the events in order with their types', () => {
    expect(d.events.length).toBe(21);
    expect(d.events.map((e) => e.seq)).toEqual(d.events.map((_, i) => i + 1));
    expect(d.events.filter((e) => e.type === 'goal').length).toBeGreaterThan(0);
    expect(d.events.some((e) => e.type === 'subst')).toBe(true);
    expect(d.events.some((e) => e.detail === 'Own Goal')).toBe(true);
  });
  it('merges lineup and player stats into one line per player, starters first', () => {
    expect(d.lineups.map((l) => l.formation)).toContain('4-1-4-1');
    const thorns = d.players.filter((p) => p.team_id === 3001);
    expect(thorns.slice(0, 11).every((p) => p.starter)).toBe(true);
    expect(thorns[0]).toMatchObject({ name: 'M. Arnold', pos: 'G', grid: '1:1', number: 18 });
    expect(thorns[0]!.minutes).toBe(90);
    expect(thorns.map((p) => p.slot)).toEqual(thorns.map((_, i) => i + 1));
    // The lineup lists one player with no id: kept by name, never as a player row.
    expect(thorns.some((p) => p.player_id == null && p.name === 'C. Calzada')).toBe(true);
    expect(d.playerStubs.every((s) => s.id != null)).toBe(true);
    expect(d.playerStubs.every((s) => s.gender === 'w')).toBe(true);
  });
  it('reads team stats, possession as a number', () => {
    const t = d.teamStats.find((s) => s.team_id === 3001)!;
    expect(t).toMatchObject({ possession: 42, shots: 14, shots_on: 8, corners: 5, red: 1, passes: 317, passes_accurate: 240 });
  });
  it('a provider id of 0 is no id (never a player row)', () => {
    const d0 = parseFixtureDetail({ ...nwsl, lineups: [{ team: { id: 3001 }, startXI: [{ player: { id: 0, name: 'Nobody', number: 4, pos: 'D', grid: '2:1' } }] }], players: [], events: [{ time: { elapsed: 5, extra: null }, team: { id: 3001 }, player: { id: 0, name: 'Nobody' }, assist: { id: 0, name: null }, type: 'Card', detail: 'Yellow Card', comments: null }] }, 'w');
    expect(d0.players[0]!.player_id).toBeNull();
    expect(d0.events[0]!.player_id).toBeNull();
    expect(d0.playerStubs).toHaveLength(0);
  });
  it('a competition with lineups and events but no player stats still has detail', () => {
    const u = parseFixtureDetail(usl, 'm');
    expect(u.teamStats.length).toBe(0);
    expect(u.events.length).toBe(16);
    expect(u.players.filter((p) => p.starter).length).toBe(22);
    expect(hasDetail(u)).toBe(true);
  });
  it('no detail at all is recognised', () => {
    expect(hasDetail(parseFixtureDetail({ ...usl, events: [], lineups: [], players: [], statistics: [] }, 'm'))).toBe(false);
  });
});

describe('standings, clubs, people', () => {
  it('keeps MLS\'s two conference tables apart', () => {
    const rows = parseStandings(load('standings.json').response);
    const groups = new Set(rows.map((r) => r.group_name));
    expect(groups.size).toBe(2);
    expect([...groups]).toContain('Western Conference');
    const top = rows.find((r) => r.group_name === 'Western Conference' && r.rank === 1)!;
    expect(top).toMatchObject({ team_id: 1603, points: 50, played: 27, win: 15, draw: 5, lose: 7, gf: 60, ga: 29, gd: 31 });
  });
  it('a single table has no group name', () => {
    const rows = parseStandings([{ league: { id: 39, season: 2026, standings: [[{ rank: 1, team: { id: 42, name: 'Arsenal' }, points: 3, goalsDiff: 2, group: 'Premier League', all: { played: 1, win: 1, draw: 0, lose: 0, goals: { for: 2, against: 0 } } }]] } }]);
    expect(rows[0]!.group_name).toBe('');
  });
  it('profiles: first given name and family name, a name key, numbers from strings', () => {
    const p = parseProfile(load('profile.json').response[0], '2026-10-08T00:00:00Z');
    expect(p).toMatchObject({ id: 68776, display_name: 'Mackenzie Arnold', first_name: 'Mackenzie Elizabeth', last_name: 'Arnold', name_key: 'arnold|mackenzie', birth_date: '1994-02-25', height_cm: 181, weight_kg: 76, nationality: 'Australia' });
    expect(personDisplayName(null, null, 'Ian')).toBe('Ian');
  });
  it('club profiles carry the ground', () => {
    const t = parseTeams(load('teams.json').response, 'w');
    const red = t.find((x) => x.id === 2997)!;
    expect(red).toMatchObject({ display_name: 'Chicago Red Stars', country: 'USA', founded: 2007, venue_name: 'SeatGeek Stadium', venue_capacity: 21915, gender: 'w' });
  });
});
