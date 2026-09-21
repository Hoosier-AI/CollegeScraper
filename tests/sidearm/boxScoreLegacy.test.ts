import { describe, it, expect } from 'vitest';
import { fixture, FakeFetcher } from '../helpers/fakeFetcher.js';
import { parseLegacyBoxScore, looksLikeLegacyBoxScore } from '../../src/sources/sites/sidearm/boxScoreHtml.js';
import { sidearmAdapter } from '../../src/sources/sites/sidearm/index.js';
import type { SiteContext } from '../../src/model.js';

const ctx: SiteContext = { host: 'navysports.com', baseUrl: 'https://navysports.com', gender: 'w', season: 2026, sportSlug: 'womens-soccer', sportId: null, teamSlug: null };
const URL = 'https://navysports.com/sports/womens-soccer/stats/2026/robert-morris/boxscore/27882';

describe('legacy Sidearm box score (captioned tables)', () => {
  const html = fixture('sidearm/navy-w-boxscore-legacy-27882.html');
  const b = parseLegacyBoxScore(html, URL, ctx, { date: '2026-08-14' });
  it('is detected and the new-template parser is bypassed', () => {
    expect(looksLikeLegacyBoxScore(html)).toBe(true);
    expect(looksLikeLegacyBoxScore(fixture('sidearm/duke-boxscore-24759.html'))).toBe(false);
  });
  it('maps sides, scores, totals and period lines', () => {
    expect(b).toMatchObject({ source: 'sidearm', date: '2026-08-14', status: 'final', attendance: 855, periods: 2, overtime: false });
    expect(b.away).toMatchObject({ name: 'Robert Morris', score: 0, isHome: false });
    expect(b.home).toMatchObject({ name: 'Navy', score: 4, isHome: true });
    expect(b.home.totals).toMatchObject({ goals: 4, shots: 14, sog: 7, corners: 3, fouls: 9, saves: 1, yellow: 0 });
    expect(b.away.totals).toMatchObject({ goals: 0, shots: 3, sog: 1, corners: 2, fouls: 10, saves: 3, yellow: 2, gkGoalsAllowed: 4 });
    expect(b.home.totals.periodLines.map((p) => p.score)).toEqual([1, 3]);
  });
  it('maps players, starters, minutes, goalies and cards', () => {
    expect(b.home.players).toHaveLength(23);
    expect(b.home.players.filter((p) => p.starter)).toHaveLength(11);
    expect(b.home.players.reduce((s, p) => s + (p.minutes ?? 0), 0)).toBe(990);
    expect(b.home.players.filter((p) => p.goals).map((p) => p.lastName).sort()).toEqual(['Adlam', 'Black', 'Emerson', 'Williams']);
    const cameron = b.away.players.find((p) => p.lastName === 'Cameron')!;
    expect(cameron).toMatchObject({ isGoalie: true, jersey: 0, gkMinutes: 57, goalsAllowed: 2, saves: 0, yellow: 1 });
    expect(b.away.players.find((p) => p.lastName === 'Campbell')?.yellow).toBe(1);
  });
  it('builds goal and card events with a running score', () => {
    const goals = b.events.filter((e) => e.type === 'goal');
    expect(goals).toHaveLength(4);
    expect(goals[goals.length - 1]).toMatchObject({ homeScore: 4, awayScore: 0, side: 'home' });
    expect(goals.every((g) => g.playerNameRaw)).toBe(true);
    expect(b.events.filter((e) => e.type === 'yellow')).toHaveLength(2);
  });
  it('is used by the adapter automatically', async () => {
    const f = new FakeFetcher([{ match: URL, file: 'sidearm/navy-w-boxscore-legacy-27882.html' }]);
    const box = await sidearmAdapter.boxScore(f, ctx, URL, { date: '2026-08-14' });
    expect(box.home.name).toBe('Navy');
    expect(box.date).toBe('2026-08-14');
  });
});

describe('legacy Sidearm box score without a MIN column', () => {
  // Albright, Arcadia, Hartwick and others print "Pos # Player SH SOG G A" with no minutes; every listed player
  // appeared, and the field players used to be dropped as short rows, leaving keeper-only lineups.
  const html = fixture('sidearm/albright-w-boxscore-legacy-8114.html');
  const b = parseLegacyBoxScore(html, 'https://albrightathletics.com/sports/womens-soccer/stats/2026/delaware-valley/boxscore/8114', { ...ctx, host: 'albrightathletics.com', baseUrl: 'https://albrightathletics.com' }, { date: '2026-09-14' });
  it('keeps every field player and the starter marks', () => {
    expect(b.home).toMatchObject({ name: 'Albright', score: 1 });
    expect(b.away).toMatchObject({ name: 'Delaware Valley', score: 0 });
    expect(b.home.players).toHaveLength(19);
    expect(b.home.players.filter((p) => p.starter)).toHaveLength(11);
    expect(b.away.players.filter((p) => p.starter)).toHaveLength(11);
    expect(b.home.players.every((p) => p.participated)).toBe(true);
    expect(b.home.players.filter((p) => !p.isGoalie).every((p) => p.minutes == null)).toBe(true);
    expect(b.home.players.find((p) => p.lastName === 'Kunkle')).toMatchObject({ isGoalie: true, starter: true, gkMinutes: 90, saves: 5, minutes: 90 });
    expect(b.home.players.filter((p) => p.goals).map((p) => p.lastName)).toEqual(['Hogue-Pellerin']);
  });
});
