import { describe, it, expect } from 'vitest';
import { resolveRoster, matchStatLine, findTransfer, type KnownPlayerSeason } from '../src/identity/resolver.js';
import { findGame } from '../src/identity/gameMatch.js';
import { EMPTY_PLAYER_LINE, type RosterPlayer } from '../src/model.js';

const rp = (o: Partial<RosterPlayer>): RosterPlayer => ({
  sourceKey: 'x', sitePlayerId: null, firstName: 'Kenan', lastName: 'Hot', jersey: 23, positionRaw: 'M', classRaw: 'Jr.', heightRaw: null,
  weightLb: null, hometownRaw: null, highSchool: null, previousSchool: null, major: null, isCaptain: false, headshotUrl: null, bioUrl: null, ...o,
});
const kp = (o: Partial<KnownPlayerSeason>): KnownPlayerSeason => ({
  playerSeasonId: 'ps1', playerId: 'p1', programId: 'prog', season: 2024, nameKey: 'hot|kenan', firstName: 'Kenan', lastName: 'Hot', jersey: 23,
  classYear: 2, isRedshirt: false, isGrad: false, sitePlayerId: null, hometownRaw: null, highSchool: null, previousSchool: null, ...o,
});

describe('resolveRoster', () => {
  it('links by site player id', () => {
    const r = resolveRoster([rp({ sitePlayerId: '8833', classRaw: 'Fr.' })], [kp({ sitePlayerId: '8833', classYear: 4 })], 2025);
    expect(r[0]).toMatchObject({ playerId: 'p1', confidence: 0.98, rule: 'site_player_id' });
  });
  it('links by name + class progression', () => {
    const r = resolveRoster([rp({ classRaw: 'Jr.' })], [kp({ classYear: 2 })], 2025);
    expect(r[0]).toMatchObject({ playerId: 'p1', confidence: 0.92 });
  });
  it('creates a new player when the class year conflicts and jersey differs', () => {
    const r = resolveRoster([rp({ classRaw: 'Fr.', jersey: 9 })], [kp({ classYear: 4, jersey: 23 })], 2025);
    expect(r[0]!.playerId).toBeNull();
  });
  it('never links the same prior player twice', () => {
    const r = resolveRoster([rp({ classRaw: 'Jr.', jersey: 23 }), rp({ classRaw: 'Jr.', jersey: 24 })], [kp({ classYear: 2 })], 2025);
    expect(r.filter((x) => x.playerId === 'p1')).toHaveLength(1);
  });
  it('keeps identity on re-runs of the same season', () => {
    const r = resolveRoster([rp({})], [], 2025, new Map(), [kp({ season: 2025, playerId: 'p9', playerSeasonId: 'ps9' })]);
    expect(r[0]).toMatchObject({ playerId: 'p9', rule: 'existing_row' });
  });
});

describe('matchStatLine', () => {
  const cands = [
    { playerSeasonId: 'a', nameKey: 'hot|kenan', firstName: 'Kenan', lastName: 'Hot', jersey: 23 },
    { playerSeasonId: 'b', nameKey: 'hot|ben', firstName: 'Ben', lastName: 'Hot', jersey: 7 },
    { playerSeasonId: 'c', nameKey: 'gallagher|colin', firstName: 'Colin', lastName: 'Gallagher', jersey: 0 },
  ];
  it('prefers name + jersey', () => {
    expect(matchStatLine({ ...EMPTY_PLAYER_LINE('k', 'Kenan', 'Hot'), jersey: 23 }, cands)).toMatchObject({ playerSeasonId: 'a', confidence: 0.95 });
  });
  it('falls back to unique last name with an initial', () => {
    expect(matchStatLine({ ...EMPTY_PLAYER_LINE('k', 'C.', 'Gallagher'), jersey: null }, cands)).toMatchObject({ playerSeasonId: 'c' });
  });
  it('matches NCAA-style full legal names by jersey + first name or surname token', () => {
    const roster = [
      { playerSeasonId: 'h', nameKey: 'toftevag|herman', firstName: 'Herman', lastName: 'Toftevåg', jersey: 2 },
      { playerSeasonId: 'j', nameKey: 'klevberg|jaran', firstName: 'Jaran', lastName: 'Klevberg', jersey: 5 },
      { playerSeasonId: 'b', nameKey: 'mohl|brian', firstName: 'Brian', lastName: 'Mohl', jersey: 12 },
    ];
    expect(matchStatLine({ ...EMPTY_PLAYER_LINE('k', 'HERMAN', 'TOFTEVAAG'), jersey: 2 }, roster)?.playerSeasonId).toBe('h');
    expect(matchStatLine({ ...EMPTY_PLAYER_LINE('k', 'JARAN', 'LILLEHOLT KLEVBERG'), jersey: 5 }, roster)?.playerSeasonId).toBe('j');
    expect(matchStatLine({ ...EMPTY_PLAYER_LINE('k', 'BRIAN', 'MOHL II'), jersey: 12 }, roster)?.playerSeasonId).toBe('b');
    expect(matchStatLine({ ...EMPTY_PLAYER_LINE('k', 'OTHER', 'PERSON'), jersey: 12 }, roster)).toBeNull();
  });
  it('returns null on ambiguity', () => {
    expect(matchStatLine({ ...EMPTY_PLAYER_LINE('k', '', 'Hot'), jersey: null }, cands)).toBeNull();
  });
});

describe('findTransfer', () => {
  it('uses previous_school evidence', () => {
    const m = findTransfer(rp({ previousSchool: 'Virginia', firstName: 'Colin', lastName: 'Gallagher' }), 2025,
      [{ playerId: 'v1', programId: 'uva', season: 2024, nameKey: 'gallagher|colin', hometownRaw: null, highSchool: null, schoolNames: ['Virginia', 'UVA'] }]);
    expect(m).toMatchObject({ playerId: 'v1', confidence: 0.9 });
  });
  it('ignores stale seasons', () => {
    const m = findTransfer(rp({ previousSchool: 'Virginia' }), 2025,
      [{ playerId: 'v1', programId: 'uva', season: 2021, nameKey: 'hot|kenan', hometownRaw: null, highSchool: null, schoolNames: ['Virginia'] }]);
    expect(m).toBeNull();
  });
});

describe('findGame', () => {
  it('matches across a one-day skew and swapped sides', () => {
    const games = [{ id: 'g', game_date: '2025-11-30', home_program_id: 'akron', away_program_id: 'duke', home_score: 2, away_score: 0, ncaa_contest_id: null }];
    expect(findGame(games, '2025-12-01', 'duke', 'akron')?.id).toBe('g');
    expect(findGame(games, '2025-11-20', 'duke', 'akron')).toBeNull();
  });
});
