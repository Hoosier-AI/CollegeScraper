import { describe, it, expect } from 'vitest';
import { liveTransition, pendingFilter, playedEastern, type PendingGame } from '../../src/jobs/liveScoreboard.js';
import { eastern, inLiveWindow, liveDates, shiftIso } from '../../src/jobs/seasons.js';
import type { ScoreboardGame } from '../../src/sources/ncaa/scoreboard.js';

const team = (seo: string, score: number | null) => ({ seo, short: seo, full: null, char6: null, score, winner: false, record: null, rank: null, seed: null, conferences: [] });
const feed = (o: Partial<ScoreboardGame> & { hs?: number | null; as?: number | null }): ScoreboardGame => ({
  contestId: '1', gameId: null, url: '', gender: 'm', division: 'd1', date: '2026-09-20', startTimeEpoch: 1_800_000_000, startTime: null,
  gameStateRaw: null, state: 'scheduled', currentPeriod: null, contestClock: null, finalMessage: null, title: null, bracketRound: null,
  home: team('duke', o.hs ?? null), away: team('stanford', o.as ?? null), ...o,
});
const stored = (o: Partial<PendingGame> = {}): PendingGame => ({
  id: 'g', season: 2026, game_date: '2026-09-20', gender: 'm', division: 'd1', status: 'scheduled', start_epoch: 1_800_000_000, ncaa_contest_id: 1,
  home_program_id: 'D', away_program_id: 'S', home_score: null, away_score: null, source_of_truth: null, live_period: null, live_clock: null, home_seo: 'duke', away_seo: 'stanford', ...o,
});
const opts = { swapped: false, etToday: '2026-09-20', nowIso: '2026-09-20T23:00:00.000Z' };

describe('liveTransition', () => {
  it('pre → live carries score, period and clock', () => {
    expect(liveTransition(stored(), feed({ state: 'live', currentPeriod: '2ND HALF', contestClock: '63:10', hs: 2, as: 1 }), opts))
      .toEqual({ status: 'live', home_score: 2, away_score: 1, live_period: '2ND HALF', live_clock: '63:10', live_updated_at: opts.nowIso });
  });
  it('live tick writes only when something changed', () => {
    const g = stored({ status: 'live', home_score: 2, away_score: 1, live_period: '2ND HALF', live_clock: '63:10' });
    expect(liveTransition(g, feed({ state: 'live', currentPeriod: '2ND HALF', contestClock: '63:10', hs: 2, as: 1 }), opts)).toBeNull();
    expect(liveTransition(g, feed({ state: 'live', currentPeriod: '2ND HALF', contestClock: '66:00', hs: 2, as: 1 }), opts)).toMatchObject({ live_clock: '66:00' });
  });
  it('live → final marks overtime from the final message when no box score exists', () => {
    const g = stored({ status: 'live', home_score: 1, away_score: 1 });
    expect(liveTransition(g, feed({ state: 'final', finalMessage: 'FINAL (OT)', hs: 2, as: 1 }), opts)).toEqual({ status: 'final', home_score: 2, away_score: 1, live_period: 'FINAL', live_clock: null, live_updated_at: opts.nowIso, overtime: true, shootout: false });
    expect(liveTransition(stored({ status: 'live', source_of_truth: 'site' }), feed({ state: 'final', finalMessage: 'FINAL (OT)', hs: 2, as: 1 }), opts)).not.toHaveProperty('overtime');
  });
  it('a final game is left alone (score corrections belong to the sweep)', () => {
    expect(liveTransition(stored({ status: 'final', home_score: 1, away_score: 0 }), feed({ state: 'final', hs: 2, as: 0 }), opts)).toBeNull();
  });
  it('live → pre reverts only a game without a box score', () => {
    expect(liveTransition(stored({ status: 'live', home_score: 1, away_score: 0 }), feed({ state: 'scheduled', hs: 0, as: 0 }), opts)).toMatchObject({ status: 'scheduled', home_score: null, live_period: null });
    expect(liveTransition(stored({ status: 'live', source_of_truth: 'ncaa' }), feed({ state: 'scheduled' }), opts)).toBeNull();
  });
  it('maps scores when NCAA lists the sides the other way round', () => {
    expect(liveTransition(stored(), feed({ state: 'live', hs: 3, as: 0 }), { ...opts, swapped: true })).toMatchObject({ home_score: 0, away_score: 3 });
  });
  it('kickoff corrections travel alone', () => {
    expect(liveTransition(stored({ start_epoch: 1 }), feed({}), opts)).toEqual({ start_epoch: 1_800_000_000 });
  });
  it('the played rule uses the Eastern date', () => {
    expect(playedEastern(feed({ hs: 0, as: 0 }), '2026-09-20')).toBe(false);      // today, scores 0-0 pre-game
    expect(playedEastern(feed({ hs: 0, as: 0 }), '2026-09-21')).toBe(true);       // yesterday with scores
  });
});

describe('pending filter', () => {
  it('builds the live-or-about-to-start predicate', () => {
    const calls: string[] = [];
    const q: any = { eq: (...a: any[]) => { calls.push(`eq ${a.join('=')}`); return q; }, in: (...a: any[]) => { calls.push(`in ${a[0]}`); return q; }, not: (...a: any[]) => { calls.push(`not ${a.join(' ')}`); return q; }, or: (s: string) => { calls.push(`or ${s}`); return q; } };
    pendingFilter(q, 2026, ['2026-09-20'], 1_000_000);
    expect(calls).toEqual(['eq season=2026', 'in game_date', 'not ncaa_contest_id is ', 'or status.eq.live,and(status.eq.scheduled,start_epoch.gte.985600,start_epoch.lte.1000900)']);
  });
});

describe('eastern time helpers', () => {
  it('23:30 ET on Sep 19 is still Sep 19, one date', () => {
    const et = eastern(new Date('2026-09-20T03:30:00Z'));
    expect(et.date).toBe('2026-09-19'); expect(et.hour).toBe(23); expect(liveDates(et)).toEqual(['2026-09-19']);
  });
  it('01:30 ET keeps yesterday in play', () => {
    const et = eastern(new Date('2026-09-20T05:30:00Z'));
    expect(et.hour).toBe(1); expect(liveDates(et)).toEqual(['2026-09-19', '2026-09-20']); expect(inLiveWindow(et)).toBe(true);
  });
  it('window edges and the November clock change', () => {
    expect(inLiveWindow(eastern(new Date('2026-09-20T14:59:00Z')))).toBe(false); // 10:59 EDT
    expect(inLiveWindow(eastern(new Date('2026-09-20T15:00:00Z')))).toBe(true);  // 11:00 EDT
    expect(eastern(new Date('2026-11-01T06:30:00Z')).hour).toBe(1);               // 01:30 EST after the change
    expect(inLiveWindow(eastern(new Date('2026-07-15T20:00:00Z')))).toBe(false);  // out of season
  });
  it('shiftIso ignores daylight saving', () => { expect(shiftIso('2026-11-01', -1)).toBe('2026-10-31'); expect(shiftIso('2026-12-31', 1)).toBe('2027-01-01'); });
});
