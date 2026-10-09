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

import { negativeId, tableFromResults, toSrcGame } from '../../src/jobs/sources/history.js';

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
  it('a table from results: 3 for a win, then goal difference, then goals', () => {
    const t = tableFromResults([{ home: 1, away: 2, hg: 2, ag: 0 }, { home: 2, away: 3, hg: 1, ag: 1 }, { home: 3, away: 1, hg: 3, ag: 0 }], 253, 2005);
    expect(t.map((r) => [r.team_id, r.points, r.gd])).toEqual([[3, 4, 3], [1, 3, -1], [2, 1, -2]]);
    expect(t[0]).toMatchObject({ rank: 1, played: 2, win: 1, draw: 1, lose: 0, gf: 4, ga: 1, group_name: 'Overall' });
  });
});
