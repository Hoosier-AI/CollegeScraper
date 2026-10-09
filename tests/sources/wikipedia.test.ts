import { describe, it, expect } from 'vitest';
import { fixture } from '../helpers/fakeFetcher.js';
import { mainTables, parseSeasonTables } from '../../src/sources/wikipedia/parse.js';
import { checkStanding } from '../../src/jobs/sources/checks.js';

describe('Wikipedia season tables', () => {
  it('early MLS: conference and overall tables, shootout wins instead of draws', () => {
    const t = parseSeasonTables(fixture('wikipedia/1999_Major_League_Soccer_season.html'));
    expect(t.map((x) => [x.group, x.rows.length])).toEqual([['Eastern Conference', 6], ['Western Conference', 6], ['Overall standings', 12]]);
    expect(t[0]!.rows[0]).toEqual({ rank: 1, team: 'D.C. United', played: 32, win: 17, draw: null, lose: 9, gf: 65, ga: 43, gd: 22, points: 57, shootout_wins: 6 });
    expect(mainTables(t).map((x) => x.group)).toEqual(['Eastern Conference', 'Western Conference']);
  });
  it('ties, negative goal differences, one-table leagues', () => {
    const mls = parseSeasonTables(fixture('wikipedia/2003_Major_League_Soccer_season.html'));
    expect(mls[0]!.rows[0]).toMatchObject({ team: 'Chicago Fire', played: 30, win: 15, draw: 8, lose: 7, points: 53 });
    expect(mls.flatMap((x) => x.rows).some((r) => (r.gd ?? 0) < 0)).toBe(true);
    const nwsl = parseSeasonTables(fixture('wikipedia/2013_National_Women_s_Soccer_League_season.html'));
    expect(nwsl[0]).toMatchObject({ group: 'League standings' });
    expect(nwsl[0]!.rows).toHaveLength(8);
    expect(nwsl[0]!.rows[0]).toMatchObject({ team: 'Western New York Flash', points: 38 });
    const usl = parseSeasonTables(fixture('wikipedia/2012_USL_Pro_season.html'));
    expect(mainTables(usl)[0]!.rows[0]).toMatchObject({ team: 'Orlando City SC', played: 24, points: 57 });
  });
  it("a table line against API-Football's: points and played", () => {
    const r = { source: 'wikipedia', league_id: 253, season: 2015, group_name: 'Eastern Conference', team_ext: 'D.C. United', points: 51, played: 34 };
    expect(checkStanding(r, { key: '1615', points: 51, played: 34 }).map((x) => x.status)).toEqual(['agree', 'agree']);
    expect(checkStanding(r, { key: '1615', points: 50, played: 34 }).map((x) => x.status)).toEqual(['differ', 'agree']);
    expect(checkStanding(r, null)[0]).toMatchObject({ field: 'team', status: 'unmatched' });
  });
});
