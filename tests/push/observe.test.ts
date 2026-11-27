import { beforeEach, describe, expect, it, vi } from 'vitest';
import { diffMatch, observeAndQueue, observeMatches, observePaused, observeStats, resetObserve, type MatchSnapshot, type MatchState } from '../../src/push/observe.js';
import { meaningfulChange, scorerOf } from '../../src/push/snapshots.js';

const NOW = Date.parse('2026-11-28T20:00:00Z');
const minsAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();
const snap = (over: Partial<MatchSnapshot> = {}): MatchSnapshot => ({
  key: 'p:1001', status: 'live', home: 0, away: 0, period: '1H', kickoff: minsAgo(30),
  teams: { home: { kind: 'pro-team', ref: '10', name: 'Home FC' }, away: { kind: 'pro-team', ref: '20', name: 'Away FC' } },
  league: { kind: 'pro-league', ref: '253', name: 'MLS' }, to: '/pro/matches/home-fc-away-fc', ...over,
});
const state = (over: Partial<MatchState> = {}): MatchState => ({ status: 'live', home: 0, away: 0, gen: 0, period: '1H', ...over });
const keys = (prev: MatchState | null, next: MatchSnapshot) => diffMatch(prev, next, NOW).events.map((e) => e.dedupe_key);
/** A run of observations of one match, each compared with the state the one before left. */
const play = (steps: MatchSnapshot[], start: MatchState | null = null) => {
  let st = start; const out: string[] = [];
  for (const s of steps) { const r = diffMatch(st, s, NOW); st = r.state; out.push(...r.events.map((e) => e.dedupe_key)); }
  return { keys: out, state: st! };
};

describe('diffMatch: the transition matrix', () => {
  it('kick-off: scheduled then live', () => {
    expect(keys(state({ status: 'scheduled', home: null, away: null, period: null }), snap())).toEqual(['p:1001:kickoff:0']);
  });
  it('a status that is neither live nor final counts as scheduled', () => {
    expect(diffMatch(null, snap({ status: 'postponed', home: null, away: null }), NOW).state.status).toBe('scheduled');
    expect(keys(state({ status: 'scheduled' }), snap({ status: 'abandoned' }))).toEqual([]);
  });
  it('a goal carries the new score in its key', () => {
    const r = diffMatch(state(), snap({ home: 1 }), NOW);
    expect(r.events).toEqual([{ type: 'goal', dedupe_key: 'p:1001:goal:0:1-0', home: 1, away: 0, gen: 0, corrected: false }]);
    expect(r.state).toEqual({ status: 'live', home: 1, away: 0, gen: 0, period: '1H' });
  });
  it('two goals between two looks are one alert with the new score', () => {
    expect(keys(state(), snap({ home: 1, away: 1 }))).toEqual(['p:1001:goal:0:1-1']);
    expect(keys(state({ home: 1 }), snap({ home: 3 }))).toEqual(['p:1001:goal:0:3-0']);
  });
  it('a goal taken back says nothing, and the same scoreline alerts again later', () => {
    const r = play([snap({ home: 1 }), snap({ home: 0 }), snap({ home: 1 })], state());
    expect(r.keys).toEqual(['p:1001:goal:0:1-0', 'p:1001:goal:1:1-0']);
    expect(r.state.gen).toBe(1);
  });
  it('one side down and the other up in one look is treated as a goal taken back', () => {
    const r = diffMatch(state({ home: 1, away: 0 }), snap({ home: 0, away: 1 }), NOW);
    expect(r.events).toEqual([]); expect(r.state.gen).toBe(1);
  });
  it('half-time once, and only for pro', () => {
    const r = play([snap({ period: 'HT' }), snap({ period: 'HT' }), snap({ period: '2H' })], state());
    expect(r.keys).toEqual(['p:1001:halftime:0']);
    expect(keys(state({ period: '1st' }), snap({ key: 'c:7f0c2a9e-0000-4000-8000-000000000001', period: 'HT' }))).toEqual([]);
  });
  it('a goal on the stroke of half-time is both alerts', () => {
    expect(keys(state(), snap({ home: 1, period: 'HT' }))).toEqual(['p:1001:goal:0:1-0', 'p:1001:halftime:0']);
  });
  it('full time', () => {
    const r = diffMatch(state({ home: 2, away: 1, period: '2H' }), snap({ status: 'final', home: 2, away: 1, period: 'FT', kickoff: minsAgo(115) }), NOW);
    expect(r.events.map((e) => [e.dedupe_key, e.corrected])).toEqual([['p:1001:final:0', false]]);
    expect(r.state.status).toBe('final');
  });
  it('a late goal seen only at full time is the full-time alert alone', () => {
    expect(keys(state({ home: 1 }), snap({ status: 'final', home: 2, period: 'FT' }))).toEqual(['p:1001:final:0']);
  });
  it('scheduled straight to final still says full time, unless kick-off was more than 8 hours ago', () => {
    const was = state({ status: 'scheduled', home: null, away: null, period: null });
    expect(keys(was, snap({ status: 'final', home: 1, away: 0, kickoff: minsAgo(120) }))).toEqual(['p:1001:final:0']);
    expect(keys(was, snap({ status: 'final', home: 1, away: 0, kickoff: minsAgo(9 * 60) }))).toEqual([]);
    expect(keys(was, snap({ status: 'final', home: 1, away: 0, kickoff: null }))).toEqual(['p:1001:final:0']);
  });
  it('a corrected final is sent again under a new key; an unchanged one is nothing', () => {
    const fin = state({ status: 'final', home: 2, away: 1, period: 'FT' });
    expect(keys(fin, snap({ status: 'final', home: 2, away: 1, period: 'FT' }))).toEqual([]);
    const r = diffMatch(fin, snap({ status: 'final', home: 2, away: 2, period: 'FT' }), NOW);
    expect(r.events).toEqual([{ type: 'final', dedupe_key: 'p:1001:final:1', home: 2, away: 2, gen: 1, corrected: true }]);
    // Days later the state follows the correction silently.
    const late = diffMatch(fin, snap({ status: 'final', home: 2, away: 2, kickoff: minsAgo(30 * 60) }), NOW);
    expect(late.events).toEqual([]); expect(late.state).toMatchObject({ home: 2, away: 2, gen: 1 });
  });
  it('a revert to scheduled resets silently, and a flapping feed does not alert twice', () => {
    const r = play([snap(), snap({ status: 'scheduled', home: null, away: null, period: null }), snap()], state({ status: 'scheduled', home: null, away: null, period: null }));
    expect(r.keys).toEqual(['p:1001:kickoff:0', 'p:1001:kickoff:0']); // the same key twice: one row in push_events
    expect(keys(state({ status: 'final', home: 1, away: 0 }), snap({ status: 'scheduled', home: null, away: null }))).toEqual([]);
  });
  it('a final taken back to live says nothing, then full time alerts again', () => {
    const r = play([snap({ home: 1, period: '2H' }), snap({ status: 'final', home: 1, period: 'FT' })], state({ status: 'final', home: 1, away: 0, period: 'FT' }));
    expect(r.keys).toEqual(['p:1001:final:1']);
  });
  it('first sight: live for 5 minutes or less is a kick-off; longer, final, scheduled or unknown is silent', () => {
    expect(keys(null, snap({ elapsed: 3 }))).toEqual(['p:1001:kickoff:0']);
    expect(keys(null, snap({ elapsed: 5, home: 1 }))).toEqual(['p:1001:kickoff:0']);
    expect(keys(null, snap({ elapsed: 6 }))).toEqual([]);
    expect(keys(null, snap({ kickoff: minsAgo(4) }))).toEqual(['p:1001:kickoff:0']);
    expect(keys(null, snap({ kickoff: minsAgo(30) }))).toEqual([]);
    expect(keys(null, snap({ kickoff: null }))).toEqual([]);
    expect(keys(null, snap({ status: 'final', home: 2, away: 0, kickoff: minsAgo(100) }))).toEqual([]);
    expect(keys(null, snap({ status: 'scheduled', home: null, away: null, kickoff: minsAgo(-30) }))).toEqual([]);
    // The elapsed minute wins over the kick-off time (a match that started late).
    expect(keys(null, snap({ elapsed: 2, kickoff: minsAgo(20) }))).toEqual(['p:1001:kickoff:0']);
    expect(diffMatch(null, snap({ elapsed: 40, home: 1 }), NOW).state).toEqual({ status: 'live', home: 1, away: 0, gen: 0, period: '1H' });
  });
  it('with no stored state, the job\'s own previous row is what it compares with', () => {
    const c = snap({ key: 'c:7f0c2a9e-0000-4000-8000-000000000001', kickoff: minsAgo(50), period: '1st' });
    expect(keys(null, { ...c, prev: { status: 'scheduled', home: null, away: null } })).toEqual([`${c.key}:kickoff:0`]);
    expect(keys(null, { ...c, home: 1, prev: { status: 'live', home: 0, away: 0 } })).toEqual([`${c.key}:goal:0:1-0`]);
    expect(keys(null, { ...c, status: 'final', home: 1, prev: { status: 'live', home: 1, away: 0 } })).toEqual([`${c.key}:final:0`]);
    // A stored state wins over it.
    expect(keys(state({ home: 1 }), { ...c, home: 1, prev: { status: 'live', home: 0, away: 0 } })).toEqual([]);
  });
  it('two servers seeing the same change make the same keys, and the second look after the first makes none', () => {
    const before = state({ home: 1 }), change = snap({ home: 2 });
    const a = diffMatch(before, change, NOW), b = diffMatch(before, change, NOW + 900);
    expect(a.events.map((e) => e.dedupe_key)).toEqual(b.events.map((e) => e.dedupe_key));
    expect(a.events).toHaveLength(1);
    expect(diffMatch(a.state, change, NOW + 900).events).toEqual([]);
  });
  it('a whole match', () => {
    const r = play([
      snap({ status: 'scheduled', home: null, away: null, period: 'NS', kickoff: minsAgo(-5) }),
      snap({ elapsed: 1 }), snap({ home: 1, elapsed: 20 }), snap({ home: 1, period: 'HT', elapsed: 45 }),
      snap({ home: 1, away: 1, period: '2H', elapsed: 60 }), snap({ status: 'final', home: 1, away: 1, period: 'FT' }),
    ]);
    expect(r.keys).toEqual(['p:1001:kickoff:0', 'p:1001:goal:0:1-0', 'p:1001:halftime:0', 'p:1001:goal:0:1-1', 'p:1001:final:0']);
  });
});

describe('observeMatches never throws into a crawl job', () => {
  beforeEach(() => resetObserve());
  it('returns the rows the database made', async () => {
    const rpc = vi.fn(async () => ({ data: [{ id: 5, dedupe_key: 'p:1001:goal:0:1-0', match_key: 'p:1001', type: 'goal', payload: {}, status: 'pending', created_at: 'x' }], error: null }));
    const out = await observeMatches({ rpc } as any, [snap({ home: 1 })]);
    expect(out).toHaveLength(1);
    expect(rpc).toHaveBeenCalledWith('push_observe_many', { snapshots: [snap({ home: 1 })] });
    expect(observeStats).toMatchObject({ calls: 1, snapshots: 1, events: 1, failures: 0 });
  });
  it('an error answer, a thrown error and a rejected call all come back as []', async () => {
    expect(await observeMatches({ rpc: async () => ({ data: null, error: { message: 'function push_observe_many does not exist' } }) } as any, [snap()])).toEqual([]);
    resetObserve();
    expect(await observeMatches({ rpc: () => { throw new Error('boom'); } } as any, [snap()])).toEqual([]);
    resetObserve();
    expect(await observeMatches({ rpc: async () => { throw new Error('socket hang up'); } } as any, [snap()])).toEqual([]);
    expect(observeStats.failures).toBe(1);
    expect(await observeMatches(null as any, null as any)).toEqual([]);
  });
  it('after a failure it leaves the database alone for a while', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: 'down' } }));
    await observeMatches({ rpc } as any, [snap()]);
    expect(observePaused()).toBe(true);
    await observeMatches({ rpc } as any, [snap()]);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(observeStats.skipped).toBe(1);
  });
  it('drops snapshots with no usable key and does not call for none', async () => {
    const rpc = vi.fn(async () => ({ data: [], error: null }));
    expect(await observeMatches({ rpc } as any, [snap({ key: '' }), snap({ key: 'x:1' })])).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('queues the sender only when alerts were made, keyed by the newest one', async () => {
    const inserted: any[] = [];
    const runs = () => { const q: any = { select: () => q, eq: () => q, in: () => q, order: async () => ({ data: [] }), insert: (row: any) => { inserted.push(row); return { select: () => ({ single: async () => ({ data: { id: 'r1', status: 'queued' }, error: null }) }) }; } }; return q; };
    const db: any = { from: runs, rpc: async () => ({ data: [{ id: 41 }, { id: 42 }], error: null }) };
    expect(await observeAndQueue(db, [snap({ home: 1 })])).toBe(2);
    expect(inserted).toEqual([{ job: 'push-send', params: { upto: 42 }, status: 'queued' }]);
    db.rpc = async () => ({ data: [], error: null });
    expect(await observeAndQueue(db, [snap()])).toBe(0);
    expect(inserted).toHaveLength(1);
    // A queue that cannot be written is not the crawl job's problem either.
    db.rpc = async () => ({ data: [{ id: 43 }], error: null }); db.from = () => { throw new Error('queue down'); };
    expect(await observeAndQueue(db, [snap({ home: 2 })])).toBe(1);
  });
});

describe('snapshot helpers', () => {
  it('only a change of status or score is worth a look (not the clock)', () => {
    const was = { status: 'live', home: 1, away: 0 };
    expect(meaningfulChange(was, { live_clock: '55:10' } as any)).toBe(false);
    expect(meaningfulChange(was, { status: 'live', home_score: 1, away_score: 0 })).toBe(false);
    expect(meaningfulChange(was, { status: 'live', home_score: 2, away_score: 0 })).toBe(true);
    expect(meaningfulChange(was, { status: 'final', home_score: 1, away_score: 0 })).toBe(true);
    expect(meaningfulChange({ status: 'scheduled', home: null, away: null }, { status: 'live', home_score: 0, away_score: 0 })).toBe(true);
  });
  it('names the scorer only when the goals on file add up to the score', () => {
    const g = (seq: number, over: any = {}) => ({ fixture_id: 1, seq, minute: 10 * seq, team_id: 10, player_id: 100 + seq, player_name: `Player ${seq}`, detail: 'Normal Goal', comments: null, ...over });
    expect(scorerOf([g(1), g(2)], 1, 1)).toEqual({ name: 'Player 2', player_id: 102, team_id: 10, minute: 20, own_goal: false });
    expect(scorerOf([g(1)], 1, 1)).toBeNull(); // the feed is a goal behind
    expect(scorerOf([g(1), g(2, { detail: 'Missed Penalty' })], 1, 0)?.name).toBe('Player 1');
    expect(scorerOf([g(1, { detail: 'Own Goal' })], 0, 1)?.own_goal).toBe(true);
    expect(scorerOf([], 0, 0)).toBeNull();
  });
});
