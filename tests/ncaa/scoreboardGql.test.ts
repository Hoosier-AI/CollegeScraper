import { describe, it, expect } from 'vitest';
import { fixture } from '../helpers/fakeFetcher.js';
import { parseGqlScoreboard, scoreboardVariables, titleizeSeo } from '../../src/sources/ncaa/scoreboardGql.js';

describe('GraphQL scoreboard (2026 season)', () => {
  const doc = JSON.parse(fixture('ncaa/scoreboard-gql-men-d1-2026-09-11.json'));
  it('builds the variables ncaa.com sends', () => {
    expect(scoreboardVariables('m', 'd1', '2026-09-11')).toEqual({ sportCode: 'MSO', division: 1, seasonYear: 2026, contestDate: '2026/09/11' });
    expect(scoreboardVariables('w', 'd3', '2026-09-05').sportCode).toBe('WSO');
  });
  it('maps contests to the scoreboard shape', () => {
    const games = parseGqlScoreboard(doc, 'm', 'd1');
    expect(games).toHaveLength(31);
    const g = games.find((x) => x.contestId === '6616548')!;
    expect(g).toMatchObject({ date: '2026-09-11', state: 'final', gender: 'm', division: 'd1', url: 'https://www.ncaa.com/game/6616548' });
    expect(g.home).toMatchObject({ seo: 'vcu', short: 'VCU', score: 0, winner: false });
    expect(g.away).toMatchObject({ seo: 'ucf', short: 'UCF', score: 2, winner: true });
    expect(g.away.conferences[0]).toEqual({ name: 'Sun Belt', seo: 'sun-belt' });
    expect(g.home.conferences[0]?.seo).toBe('atlantic-10');
  });
  it('titleizes conference slugs', () => {
    expect(titleizeSeo('atlantic-10')).toBe('Atlantic 10');
    expect(titleizeSeo('acc')).toBe('ACC');
  });
});
