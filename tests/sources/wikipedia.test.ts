import { describe, it, expect } from 'vitest';
import { fixture } from '../helpers/fakeFetcher.js';
import { mainTables, parseSeasonTables } from '../../src/sources/wikipedia/parse.js';
import { checkStanding } from '../../src/jobs/sources/checks.js';

describe('Wikipedia season tables', () => {
  it('early MLS: conference and overall tables, shootout wins instead of draws', () => {
    const t = parseSeasonTables(fixture('wikipedia/1999_Major_League_Soccer_season.html'));
    expect(t.map((x) => [x.group, x.rows.length])).toEqual([['Eastern Conference', 6], ['Western Conference', 6], ['Overall standings', 12]]);
    expect(t[0]!.rows[0]).toEqual({ rank: 1, team: 'D.C. United', title: 'D.C._United', played: 32, win: 17, draw: null, lose: 9, gf: 65, ga: 43, gd: 22, points: 57, shootout_wins: 6 });
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

import { wikiTitle } from '../../src/sources/wikipedia/parse.js';
import { heightCm, yearsOf, parseWikidataPerson } from '../../src/sources/wikipedia/people.js';
describe('Wikipedia people', () => {
  it('reads article titles from links and leaves out files and missing pages', () => {
    expect(wikiTitle('https://en.wikipedia.org/wiki/Arsenal_F.C.')).toBe('Arsenal_F.C.');
    expect(wikiTitle('./Seattle_Sounders_FC#History')).toBe('Seattle_Sounders_FC');
    expect(wikiTitle('/wiki/File:Flag.svg')).toBeNull();
    expect(wikiTitle('/w/index.php?title=Nobody&action=edit&redlink=1')).toBeNull();
  });
  it('reads years and heights the ways infoboxes write them', () => {
    expect(yearsOf('2015–')).toEqual({ start: 2015, end: null });
    expect(yearsOf('2013–2014')).toEqual({ start: 2013, end: 2014 });
    expect(yearsOf('2019')).toEqual({ start: 2019, end: 2019 });
    expect(heightCm('5 ft 8 in (1.72 m)')).toBe(172);
    expect(heightCm('1.85 m (6 ft 1 in)')).toBe(185);
    expect(heightCm('unknown')).toBeNull();
  });
  it('reads a Wikidata person: day-precise birth date, height in cm or m, citizenship and position items', () => {
    const claim = (value: unknown) => [{ rank: 'normal', mainsnak: { datavalue: { value } } }];
    const json = { entities: { Q1: { labels: { en: { value: 'Someone' } }, claims: {
      P569: claim({ time: '+1995-06-03T00:00:00Z', precision: 11 }), P2048: claim({ amount: '+1.73', unit: 'http://www.wikidata.org/entity/Q11573' }),
      P27: claim({ id: 'Q30' }), P413: claim({ id: 'Q193592' }) } } } };
    expect(parseWikidataPerson(json, 'Q1')).toEqual({ qid: 'Q1', label: 'Someone', birth_date: '1995-06-03', height_cm: 173, citizenship: ['Q30'], positions: ['Q193592'] });
    const yearOnly = { entities: { Q2: { claims: { P569: claim({ time: '+1990-00-00T00:00:00Z', precision: 9 }) } } } };
    expect(parseWikidataPerson(yearOnly, 'Q2').birth_date).toBeNull();
  });
});

import { parseClubPage, parsePlayerPage } from '../../src/sources/wikipedia/people.js';
describe('Wikipedia club and player articles', () => {
  it('reads a club squad: Wikidata item and every player link (not flags or federations)', () => {
    const c = parseClubPage(fixture('wikipedia/club-seattle-squad.html'));
    expect(c.qid).toBe('Q632511');
    expect(c.players.length).toBeGreaterThan(20);
    expect(c.players.find((p) => p.title === 'Cristian_Roldan')).toMatchObject({ name: 'Cristian Roldan', number: 7, position: 'MF' });
    expect(c.players.some((p) => /Federation|Association/.test(p.title))).toBe(false);
  });
  it('reads a player infobox: bio and each career with years, club, apps and goals', () => {
    const p = parsePlayerPage(fixture('wikipedia/player-roldan-infobox.html'));
    expect(p).toMatchObject({ qid: 'Q19519224', name: 'Cristian Roldan', birth_date: '1995-06-03', birth_place: 'Artesia, California, U.S.', height_cm: 172, position: 'Midfielder', number: 7 });
    expect(p.careers.filter((c) => c.kind === 'college')).toEqual([expect.objectContaining({ team: 'Washington Huskies', start_year: 2013, end_year: 2014, apps: 41, goals: 10 })]);
    expect(p.careers.find((c) => c.kind === 'senior' && c.team === 'Seattle Sounders FC')).toMatchObject({ start_year: 2015, end_year: null, team_title: 'Seattle_Sounders_FC' });
    expect(p.careers.filter((c) => c.kind === 'international').length).toBe(2);
  });
});
