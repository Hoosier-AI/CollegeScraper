import { describe, it, expect } from 'vitest';
import { fixture } from '../helpers/fakeFetcher.js';
import { finalScore, parseScore, parseSeasonFile } from '../../src/sources/openfootball/parse.js';

describe('openfootball Football.TXT', () => {
  it('scores: full time, extra time, penalties, half time', () => {
    expect(parseScore('0-2 (0-1)')).toEqual({ ft: [0, 2], ht: [0, 1], aet: null, pen: null });
    expect(parseScore('4-5 pen. 2-2 a.e.t. (1-1, 0-1)')).toEqual({ ft: [1, 1], ht: [0, 1], aet: [2, 2], pen: [4, 5] });
    expect(parseScore('5-4 pen. (0-0)')).toEqual({ ft: [0, 0], ht: null, aet: null, pen: [5, 4] });
    expect(parseScore('1-2 a.e.t. (1-1, 0-0)')).toEqual({ ft: [1, 1], ht: [0, 0], aet: [1, 2], pen: null });
    expect(parseScore('0-0')).toEqual({ ft: [0, 0], ht: null, aet: null, pen: null });
    expect(parseScore('[cancelled]')).toBeNull();
  });
  it('a 2005 season: every match, dates carried, rounds, the final after extra time', () => {
    const rows = parseSeasonFile(fixture('openfootball/2005_mls.txt'), 2005);
    expect(rows).toHaveLength(203);
    expect(rows[0]).toMatchObject({ round: 'Matchday 1', date: '2005-04-02', time: '16:00', home: 'CD Chivas', away: 'D.C. United', ft: [0, 2], ht: [0, 1], status: 'final', playoffs: false });
    // No time on the line: the previous one carries on.
    expect(rows.find((r) => r.date === '2005-04-09' && r.home === 'D.C. United')).toMatchObject({ time: '19:30' });
    const final = rows[rows.length - 1]!;
    expect(final).toMatchObject({ round: 'Playoffs, Final', playoffs: true, home: 'New England Revolution', away: 'Los Angeles Galaxy', aet: [0, 1] });
    expect(finalScore(final)).toEqual([0, 1]);
    expect(rows.filter((r) => r.playoffs)).toHaveLength(11);
  });
  it('cancelled matches are kept as cancelled (2020)', () => {
    const rows = parseSeasonFile(fixture('openfootball/2020_mls.txt'), 2020);
    expect(rows.some((r) => r.status === 'cancelled' && r.ft == null)).toBe(true);
    expect(rows.filter((r) => r.status === 'final').every((r) => r.ft != null)).toBe(true);
  });
  it('2024: 522 matches, shootouts after a level 90 minutes', () => {
    const rows = parseSeasonFile(fixture('openfootball/2024_mls.txt'), 2024);
    expect(rows).toHaveLength(522);
    const shootout = rows.find((r) => r.home === 'Seattle Sounders' && r.away === 'Houston Dynamo' && r.pen)!;
    expect(shootout).toMatchObject({ ft: [0, 0], pen: [5, 4], aet: null });
  });
});

import { apiSeasonsOf, nameGroups, negativeId, tableFromResults, tablesFromResults, toSrcGame } from '../../src/jobs/sources/history.js';
import { isRegularRound, recordsFromResults } from '../../src/jobs/sources/checks.js';

describe('MLS history from openfootball', () => {
  it('ids for things API-Football does not have: negative, stable, distinct', () => {
    expect(negativeId('team|openfootball|MetroStars')).toBeLessThan(0);
    expect(negativeId('team|openfootball|MetroStars')).toBe(negativeId('team|openfootball|MetroStars'));
    expect(negativeId('team|openfootball|MetroStars')).not.toBe(negativeId('team|openfootball|CD Chivas'));
    expect(negativeId('x') >= -(2 ** 31)).toBe(true);
  });
  it('a match as a source record: final score after extra time, penalties kept, playoffs flagged', () => {
    const rows = parseSeasonFile(fixture('openfootball/2005_mls.txt'), 2005);
    const g = toSrcGame(rows.find((r) => r.pen)!, '2026-10-09T00:00:00Z');
    expect(g).toMatchObject({ source: 'openfootball', league_id: 253, season: 2005, home_ext: 'FC Dallas', away_ext: 'Colorado Rapids', home_score: 2, away_score: 2, et_home: 2, et_away: 2, pen_home: 4, pen_away: 5, knockout: true, status: 'final' });
    expect(g.ext_id).toBe('2005|2005-10-29|FC Dallas|Colorado Rapids');
    expect(g.kickoff).toBe('2005-10-30T01:30:00.000Z');
  });
  it('history never touches a season API-Football lists, crawled yet or not', () => {
    const seasons = apiSeasonsOf([{ season: 2019, coverage: {} }, { season: 2025, coverage: null }, { season: 2018, coverage: { source: 'asa' } }]);
    expect([...seasons].sort()).toEqual([2019, 2025]);
  });
  it('tables from results: one per group of clubs that played each other', () => {
    const t = tablesFromResults([{ home: 1, away: 2, hg: 1, ag: 0 }, { home: 2, away: 3, hg: 0, ag: 0 }, { home: 10, away: 11, hg: 2, ag: 2 }], 1116, 2025);
    expect([...new Set(t.map((r) => r.group_name))]).toEqual(['Group 1 (from results)', 'Group 2 (from results)']);
    expect(t.filter((r) => r.group_name.startsWith('Group 1')).map((r) => r.team_id)).toEqual([1, 3, 2]);
    expect(tablesFromResults([{ home: 1, away: 2, hg: 1, ag: 0 }], 1, 2025)[0]!.group_name).toBe('Table (from results)');
  });
  it('groups take the Wikipedia division most of their clubs are in', () => {
    const t = tablesFromResults([{ home: 1, away: 2, hg: 1, ag: 0 }, { home: 2, away: 3, hg: 0, ag: 0 }, { home: 10, away: 11, hg: 2, ag: 2 }], 256, 2026);
    const named = nameGroups(t, new Map([[1, 'Great Lakes Division'], [2, 'Great Lakes Division'], [10, 'Heartland Division']]));
    expect([...new Set(named.map((r) => r.group_name))]).toEqual(['Great Lakes Division', 'Group 2 (from results)']);
  });
  it('regular season only, and records from results', () => {
    expect(isRegularRound('Regular Season - 4')).toBe(true);
    expect(isRegularRound('Playoffs - Quarter-finals')).toBe(false);
    expect(isRegularRound('Final')).toBe(false);
    expect(Object.fromEntries(recordsFromResults([{ home_team_id: 1, away_team_id: 2, home_goals: 2, away_goals: 2 }, { home_team_id: 1, away_team_id: 3, home_goals: 1, away_goals: 0 }]))).toEqual({ 1: { played: 2, points: 4 }, 2: { played: 1, points: 1 }, 3: { played: 1, points: 0 } });
  });
  it('a table from results: 3 for a win, then goal difference, then goals', () => {
    const t = tableFromResults([{ home: 1, away: 2, hg: 2, ag: 0 }, { home: 2, away: 3, hg: 1, ag: 1 }, { home: 3, away: 1, hg: 3, ag: 0 }], 253, 2005);
    expect(t.map((r) => [r.team_id, r.points, r.gd])).toEqual([[3, 4, 3], [1, 3, -1], [2, 1, -2]]);
    expect(t[0]).toMatchObject({ rank: 1, played: 2, win: 1, draw: 1, lose: 0, gf: 4, ga: 1, group_name: 'Overall' });
  });
});

import { OF_LEAGUES, ofClub, ofLeagueFor } from '../../src/sources/openfootball/leagues.js';
describe('openfootball worldwide', () => {
  it('builds each league file path by season', () => {
    expect(ofLeagueFor(39)!.path(2024)).toBe('england/master/2024-25/1-premierleague.txt');
    expect(ofLeagueFor(61)!.path(2025)).toBe('europe/master/france/2025-26_fr1.txt');
    expect(ofLeagueFor(2)!.path(2024)).toBe('champions-league/master/2024-25/cl.txt');
    expect(ofLeagueFor(71)!.path(2024)).toBe('south-america/master/brazil/2024_br1.txt');
    expect(ofLeagueFor(128)!.path(2019)).toBe('south-america/master/argentina/2019-20_ar1.txt');
    expect(ofLeagueFor(128)!.path(2024)).toBe('south-america/master/argentina/2024_ar1.txt');
    expect(ofLeagueFor(253)!.path(2010)).toBe('world/master/north-america/major-league-soccer/2010_mls.txt');
    expect(new Set(OF_LEAGUES.map((l) => l.league)).size).toBe(OF_LEAGUES.length);
  });

  it('gives a club the same id in its league and in a European cup', () => {
    expect(ofClub('Aston Villa FC', ofLeagueFor(39)!)).toEqual({ ext_id: 'eng:Aston Villa FC', name: 'Aston Villa FC' });
    expect(ofClub('Aston Villa FC (ENG)', ofLeagueFor(2)!)).toEqual({ ext_id: 'eng:Aston Villa FC', name: 'Aston Villa FC' });
    expect(ofClub('D.C. United', ofLeagueFor(253)!)).toEqual({ ext_id: 'D.C. United', name: 'D.C. United' });
  });

  it('keeps MLS ids as they were and dates European kickoffs in their own zone', () => {
    const [m] = parseSeasonFile('▪ Matchday 1\n  Fri Aug 16 2024\n    21:00  Manchester United FC    v Fulham FC                1-0 (0-0)\n', 2024);
    const g = toSrcGame(m!, '2026-10-10T00:00:00Z', ofLeagueFor(39)!);
    expect(g).toMatchObject({ league_id: 39, home_ext: 'eng:Manchester United FC', away_ext: 'eng:Fulham FC', home_score: 1, away_score: 0, kickoff: '2024-08-16T21:00:00.000Z' });
    expect(g.ext_id).toBe('39|2024|2024-08-16|eng:Manchester United FC|eng:Fulham FC');
    const [mls] = parseSeasonFile('▪ Matchday 1\n  Sat Apr 2 2005\n    16:00  CD Chivas   v D.C. United   0-2 (0-1)\n', 2005);
    expect(toSrcGame(mls!, '2026-10-10T00:00:00Z').ext_id).toBe('2005|2005-04-02|CD Chivas|D.C. United');
  });
});
