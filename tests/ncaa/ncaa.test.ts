import { describe, it, expect } from 'vitest';
import { fixture, FakeFetcher } from '../helpers/fakeFetcher.js';
import * as n from '../../src/sources/ncaa/index.js';

const F = (x: string) => JSON.parse(fixture(`ncaa/${x}`));

describe('scoreboard', () => {
  it('parses every game with contest ids, dates and conferences', () => {
    const games = n.parseScoreboard(F('scoreboard-men-d1-2024-10-05.json'), { gender: 'm', division: 'd1' });
    expect(games).toHaveLength(63);
    const g = games.find((x) => x.contestId === '6310566')!;
    expect(g).toMatchObject({ date: '2024-10-05', state: 'final', gender: 'm', division: 'd1' });
    expect(g.home).toMatchObject({ seo: 'bryant', short: 'Bryant', score: 1, record: '6-3-2' });
    expect(g.away).toMatchObject({ seo: 'new-hampshire', score: 2, winner: true });
    expect(g.home.conferences[0]).toMatchObject({ name: 'America East', seo: 'america-east' });
    expect(n.scoreboardUrl('w', 'd3', '2025-09-06')).toBe('https://data.ncaa.com/casablanca/scoreboard/soccer-women/d3/2025/09/06/scoreboard.json');
  });
});

describe('box score', () => {
  const docs = { boxscore: F('boxscore-6310566.json'), pbp: F('pbp-6310566.json'), scoring: F('scoring-6310566.json'), teamStats: F('teamstats-6310566.json'), gamecenter: null } as any;
  const box = n.parseNcaaBoxScore(docs, '6310566', 'm', 'd1', '2024-10-05');
  it('maps sides, seos, scores and totals', () => {
    expect(box).toMatchObject({ source: 'ncaa', status: 'final', ncaaContestId: '6310566', date: '2024-10-05' });
    expect(box.home).toMatchObject({ name: 'Bryant', ncaaSeo: 'bryant', score: 1, isHome: true });
    expect(box.away).toMatchObject({ name: 'New Hampshire', ncaaSeo: 'new-hampshire', score: 2 });
    expect(box.home.totals).toMatchObject({ goals: 1, shots: 9, sog: 2, corners: 3, fouls: 16, offsides: 1, saves: 2, yellow: 2, red: 0 });
  });
  it('maps players with goals, minutes and keeper flags', () => {
    expect(box.home.players.length).toBeGreaterThan(20);
    const scorer = box.away.players.find((p) => (p.goals ?? 0) > 0)!;
    expect(scorer).toMatchObject({ lastName: 'Goncalves', jersey: 19, starter: true, participated: true, minutes: 60, goals: 1, gwg: 1 });
    expect(box.home.players.some((p) => p.isGoalie && (p.saves ?? 0) >= 0)).toBe(true);
    const homeGoals = box.home.players.reduce((a, p) => a + (p.goals ?? 0), 0);
    expect(homeGoals).toBe(1);
  });
  it('builds events whose running score ends at the final score', () => {
    expect(box.events.length).toBeGreaterThan(100);
    const last = box.events[box.events.length - 1]!;
    expect(last).toMatchObject({ homeScore: 1, awayScore: 2 });
    expect(box.events.filter((e) => e.type === 'goal')).toHaveLength(3);
  });
});

describe('schools, pages, stats, polls', () => {
  it('parses the schools index and the Duke school page', () => {
    const schools = n.parseSchoolsIndex(F('schools.json'));
    expect(schools).toHaveLength(1173);
    expect(schools.find((s) => s.seo === 'duke')).toMatchObject({ name: 'Duke', longName: 'Duke University' });
    const page = n.parseSchoolPage(fixture('ncaa/school-duke.html'), 'duke');
    expect(page).toMatchObject({ athleticsUrl: 'https://goduke.com', athleticsHost: 'goduke.com', logoLightUrl: 'https://www.ncaa.com/sites/default/files/images/logos/schools/bgl/duke.svg', logoDarkUrl: 'https://www.ncaa.com/sites/default/files/images/logos/schools/bgd/duke.svg' });
  });
  it('parses stat categories and tables', () => {
    const html = fixture('ncaa/stats-men-d1-2024-ind-573.html');
    const cats = n.parseStatCategories(html);
    expect(cats.individual.find((c) => c.id === 573)?.name).toBe('Total Goals');
    expect(cats.team.find((c) => c.id === 1171)?.name).toBe('Corner Kicks Per Game');
    const t = n.parseStatTable(html);
    expect(t.rows).toHaveLength(50);
    expect(t.pages).toBe(4);
    expect(t.rows[0]).toMatchObject({ Rank: '1', Name: 'Emil Jaaskelainen', Team: 'Akron', Goals: '23' });
    expect(n.statUrl('m', 'd1', 2024, 'individual', 573, 2)).toBe('https://www.ncaa.com/stats/soccer-men/d1/2024/individual/573/p2');
  });
  it('parses the USC poll', () => {
    const poll = n.parseUscPoll(fixture('ncaa/rankings-usc-men-d1.html'));
    expect(poll.rows.length).toBeGreaterThanOrEqual(20);
    expect(poll.rows[0]).toMatchObject({ rank: 1, school: 'Stanford', points: 200 });
  });
});

describe('persisted queries', () => {
  it('extracts operation hashes from bundle text', () => {
    const bundle = `x={"NCAA_GetGamecenterBoxscoreSoccerById_web":"${'a'.repeat(64)}"};y=JSON.parse('{"extensions":{"persistedQuery":{"version":1,"sha256Hash":"${'c'.repeat(64)}"}},"operationName":"GetGamecenterPbpGenericById_web"}');`;
    const found = n.extractPersistedHashes(bundle);
    expect(found['GetGamecenterBoxscoreSoccerById_web']).toBe('a'.repeat(64));
    expect(found['GetGamecenterPbpGenericById_web']).toBe('c'.repeat(64));
  });
  it('retries once with refreshed hashes on PersistedQueryNotFound', async () => {
    const good = 'b'.repeat(64);
    const store = new n.PersistedQueryStore();
    let calls = 0;
    const f = new FakeFetcher([]);
    f.get = async (url: string) => {
      calls += 1;
      if (url.startsWith('https://sdataprod.ncaa.com')) {
        if (url.includes(good)) return { status: 200, url, text: JSON.stringify({ data: { boxscore: { ok: true } } }), notModified: false };
        return { status: 200, url, text: JSON.stringify({ errors: [{ message: 'PersistedQueryNotFound' }] }), notModified: false };
      }
      // game page + bundle: expose the new hash next to the operation name
      return { status: 200, url, text: `<script src="https://www.ncaa.com/_next/static/chunks/app.js"></script> {"GetGamecenterBoxscoreSoccerById_web":"${good}"}`, notModified: false };
    };
    const res = await n.graphqlGet<any>(f, 'boxscore', n.variablesFor('boxscore', '1'), store);
    expect(res.boxscore.ok).toBe(true);
    expect(store.get('boxscore')).toBe(good);
    expect(calls).toBeGreaterThanOrEqual(3);
  });
});
