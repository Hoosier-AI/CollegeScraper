import { describe, expect, it } from 'vitest';
import { leagueConfederation, leagueLevel, leagueScope } from '../../src/sources/apiFootball/leagues.js';
import { parseLeagues } from '../../src/sources/apiFootball/parse.js';

describe('leagueScope: International is national teams, Pro is clubs', () => {
  it.each([
    [1, 'World Cup', 'World', 'intl'],
    [32, 'World Cup - Qualification Europe', 'World', 'intl'],
    [10, 'Friendlies', 'World', 'intl'],
    [666, 'Friendlies Women', 'World', 'intl'],
    [490, 'World Cup - U20', 'World', 'intl'],
    [766, 'China Cup', 'World', 'intl'],
    [2, 'UEFA Champions League', 'World', 'club'],
    [15, 'FIFA Club World Cup', 'World', 'club'],
    [1186, 'FIFA Club World Cup - Play-In', 'World', 'club'],
    [772, 'Leagues Cup', 'World', 'club'],
    [667, 'Friendlies Clubs', 'World', 'club'],
    [14, 'UEFA Youth League', 'World', 'club'],
    [940, 'COTIF Tournament', 'World', 'club'],
    [257, 'US Open Cup', 'USA', 'club'],
    [39, 'Premier League', 'England', 'club'],
  ] as const)('%i %s', (id, name, country, scope) => expect(leagueScope(id, name, country)).toBe(scope));

  it('reads a competition the provider adds later by its name', () => {
    expect(leagueScope(99001, 'AFC U23 Asian Cup - Qualification', 'World')).toBe('intl');
    expect(leagueScope(99002, 'CONCACAF Nations League - Women', 'World')).toBe('intl');
    expect(leagueScope(99003, 'Africa Cup of Nations - Qualification - Women', 'World')).toBe('intl');
    expect(leagueScope(99004, 'CONMEBOL Libertadores Femenina', 'World')).toBe('club');
    expect(leagueScope(99005, 'FIFA Club World Cup - Women', 'World')).toBe('club');
    expect(leagueScope(99006, 'World Cup Qualification', 'Spain')).toBe('club');
  });
});

describe('leagueLevel and leagueConfederation', () => {
  it('youth national teams sit behind the Youth switch', () => {
    expect(leagueLevel(587, 'World Cup - U17')).toBe('youth');
    expect(leagueLevel(1, 'World Cup')).toBe('senior');
    expect(leagueLevel(480, 'Olympics Men')).toBe('senior');
    expect(leagueLevel(99001, 'CAF U20 Cup of Nations - Qualification')).toBe('youth');
  });
  it.each([
    [32, 'World Cup - Qualification Europe', 'UEFA'],
    [34, 'World Cup - Qualification South America', 'CONMEBOL'],
    [31, 'World Cup - Qualification CONCACAF', 'CONCACAF'],
    [22, 'CONCACAF Gold Cup', 'CONCACAF'],
    [6, 'Africa Cup of Nations', 'CAF'],
    [7, 'Asian Cup', 'AFC'],
    [806, 'OFC Nations Cup', 'OFC'],
    [1, 'World Cup', 'FIFA'],
    [10, 'Friendlies', 'FIFA'],
    [913, 'CONMEBOL - UEFA Finalissima', 'FIFA'],
  ] as const)('%i %s', (id, name, conf) => expect(leagueConfederation(id, name, 'intl')).toBe(conf));
  it('clubs have none', () => expect(leagueConfederation(2, 'UEFA Champions League', 'club')).toBeNull());
});

describe('the catalog crawls national teams\' friendlies', () => {
  it('Friendlies (national) on, Friendlies Clubs off', () => {
    const item = (id: number, name: string) => ({ league: { id, name, type: 'Cup', logo: null }, country: { name: 'World', code: null, flag: null }, seasons: [{ year: 2026, start: '2026-01-01', end: '2026-12-31', current: true, coverage: {} }] });
    const { leagues } = parseLeagues([item(10, 'Friendlies'), item(667, 'Friendlies Clubs')] as any);
    expect(leagues.map((l) => [l.id, l.scope, l.enabled])).toEqual([[10, 'intl', true], [667, 'club', false]]);
  });
});
