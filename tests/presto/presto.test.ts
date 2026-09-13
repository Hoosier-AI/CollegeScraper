import { describe, it, expect } from 'vitest';
import { fixture, FakeFetcher } from '../helpers/fakeFetcher.js';
import { parseRoster } from '../../src/sources/sites/presto/roster.js';
import { parseScheduleHtml, parseScheduleRss } from '../../src/sources/sites/presto/schedule.js';
import { parseTeamStatsPage, parsePlayerStatsFragment, buildSeasonStats, mergePlayerLines } from '../../src/sources/sites/presto/teamStats.js';
import { parseBoxScore } from '../../src/sources/sites/presto/boxScore.js';
import { parseSportIndex } from '../../src/sources/sites/presto/sportIndex.js';
import { prestoAdapter, looksLikePresto } from '../../src/sources/sites/presto/index.js';
import { prestoSeasonSlug, prestoSportSlug } from '../../src/sources/sites/presto/season.js';
import { looksLikeSidearm } from '../../src/sources/sites/sidearm/index.js';
import type { SiteContext } from '../../src/model.js';

const B = 'https://ccsubluedevils.com';
const ctx: SiteContext = { host: 'ccsubluedevils.com', baseUrl: B, gender: 'm', season: 2025, sportSlug: 'msoc', sportId: null, teamSlug: 'centralconnst' };

describe('presto helpers', () => {
  it('season and sport slugs', () => {
    expect(prestoSeasonSlug(2025)).toBe('2025-26');
    expect(prestoSportSlug('w')).toBe('wsoc');
  });
  it('detects the platform', () => {
    expect(looksLikePresto(fixture('presto/ccsu-home.html'))).toBe(true);
    expect(looksLikeSidearm(fixture('presto/ccsu-home.html'))).toBe(false);
  });
  it('finds the team slug on the sport index', () => {
    expect(parseSportIndex(fixture('presto/ccsu-msoc-index.html'), 'msoc').teamSlug).toBe('centralconnst');
  });
});

describe('presto roster', () => {
  const r = parseRoster(fixture('presto/ccsu-roster-2025.html'), B, `${B}/sports/msoc/2025-26/roster`);
  it('parses players and coaches', () => {
    expect(r.players.length).toBeGreaterThanOrEqual(25);
    const gk = r.players.find((p) => p.lastName === 'Wilson' && p.firstName === 'Grady')!;
    expect(gk).toMatchObject({ jersey: 1, positionRaw: 'GOALKEEPER', classRaw: 'Jr', heightRaw: '6-3', weightLb: 195, previousSchool: 'Mineral Area College (MO)' });
    expect(gk.bioUrl).toMatch(/\/bios\//);
    expect(r.coaches[0]).toMatchObject({ name: 'David Kelly', isHead: true });
  });
});

describe('presto schedule', () => {
  it('parses html rows with box score links', () => {
    const s = parseScheduleHtml(fixture('presto/ccsu-schedule-2025.html'), B, 2025);
    expect(s.length).toBeGreaterThanOrEqual(15);
    const g = s.find((x) => x.date === '2025-08-28')!;
    expect(g).toMatchObject({ opponentName: 'UAlbany', homeAway: 'A', state: 'final', result: { status: 'L', teamScore: 0, opponentScore: 1 } });
    expect(g.boxScoreUrl).toBe(`${B}/sports/msoc/2025-26/boxscores/20250828_79kb.xml`);
  });
  it('rss agrees on game count and dates', () => {
    const html = parseScheduleHtml(fixture('presto/ccsu-schedule-2025.html'), B, 2025);
    const rss = parseScheduleRss(fixture('presto/ccsu-schedule-2025.rss'), B, 2025);
    expect(rss.length).toBe(html.length);
    expect(rss.map((x) => x.date)).toEqual(html.map((x) => x.date));
  });
});

describe('presto team stats', () => {
  it('parses team totals, game log and player fragments', () => {
    const page = parseTeamStatsPage(fixture('presto/ccsu-teams-2025.html'), `${B}/sports/msoc/2025-26/teams/centralconnst`, 2025);
    expect(page.playerStatUrls.length).toBeGreaterThanOrEqual(3);
    expect(page.gameLog.length).toBeGreaterThanOrEqual(15);
    const st = buildSeasonStats(page, mergePlayerLines(page.players), '');
    expect(st.team).toMatchObject({ goals: 11, corners: 72, yellow: 36, gamesPlayed: 17 });
    const frag = `<table><thead><tr><th>#</th><th>Player</th><th>gp</th><th>sh</th><th>g</th><th>a</th><th>pts</th></tr></thead>
      <tbody><tr><td>7</td><td><a href="/sports/msoc/2025-26/players/colin-wright">Colin Wright</a></td><td>17</td><td>30</td><td>4</td><td>2</td><td>10</td></tr></tbody></table>`;
    const lines = parsePlayerStatsFragment(frag, '');
    expect(lines[0]).toMatchObject({ name: 'Colin Wright', jersey: 7, gp: 17, shots: 30, goals: 4, assists: 2, points: 10 });
  });
});

describe('presto box score', () => {
  const bx = parseBoxScore(fixture('presto/ccsu-boxscore-20250828.html'), `${B}/sports/msoc/2025-26/boxscores/20250828_79kb.xml?view=plays`);
  it('maps header, sides and totals', () => {
    expect(bx).toMatchObject({ source: 'presto', date: '2025-08-28', status: 'final', attendance: 760, venueName: 'Tom & Mary Casey Stadium' });
    expect(bx.home).toMatchObject({ name: 'UAlbany', score: 1, isHome: true });
    expect(bx.away).toMatchObject({ name: 'CCSU', score: 0, isHome: false });
    expect(bx.home.totals).toMatchObject({ shots: 23, sog: 10, corners: 9, fouls: 17, offsides: 3, yellow: 5 });
    expect(bx.home.totals.periodLines).toHaveLength(2);
  });
  it('maps players, goalies and cards', () => {
    expect(bx.home.players.filter((p) => p.participated).length).toBeGreaterThanOrEqual(11);
    expect(bx.away.players.filter((p) => p.participated).length).toBeGreaterThanOrEqual(11);
    expect(bx.home.players.find((p) => p.isGoalie)).toMatchObject({ lastName: 'Krivokapic', jersey: 13, minutes: 90, goalsAllowed: 0 });
    expect(bx.away.players.find((p) => p.isGoalie)).toMatchObject({ lastName: 'Torres', jersey: 24, minutes: 90, goalsAllowed: 1 });
    const yellows = bx.away.players.filter((p) => p.yellow).map((p) => p.lastName);
    expect(yellows).toEqual(expect.arrayContaining(['Rau', 'Vigil']));
  });
  it('builds events with a running score', () => {
    expect(bx.events.length).toBeGreaterThanOrEqual(40);
    const goal = bx.events.find((e) => e.type === 'goal')!;
    expect(goal).toMatchObject({ side: 'home', period: 2, clock: '76:22', homeScore: 1, awayScore: 0 });
    expect(goal.playerNameRaw).toMatch(/Bruce/);
    expect(goal.assistNameRaw).toMatch(/Navas/);
  });
});

describe('prestoAdapter', () => {
  it('discovers the team slug and fetches roster / schedule / box score', async () => {
    const f = new FakeFetcher([
      { match: `${B}/sports/msoc/index`, file: 'presto/ccsu-msoc-index.html' },
      { match: `${B}/sports/msoc/2025-26/roster`, file: 'presto/ccsu-roster-2025.html' },
      { match: `${B}/sports/msoc/2025-26/schedule`, file: 'presto/ccsu-schedule-2025.html' },
      { match: /boxscores\/20250828_79kb\.xml\?view=plays$/, file: 'presto/ccsu-boxscore-20250828.html' },
    ]);
    const found = await prestoAdapter.discover(f, { ...ctx, teamSlug: null });
    expect(found?.teamSlug).toBe('centralconnst');
    expect((await prestoAdapter.roster(f, ctx)).players.length).toBeGreaterThan(20);
    const sched = await prestoAdapter.schedule(f, ctx);
    const box = await prestoAdapter.boxScore(f, ctx, sched[0]!.boxScoreUrl!);
    expect(box.status).toBe('final');
    expect(f.calls.some((c) => c.endsWith('?view=plays'))).toBe(true);
  });
});
