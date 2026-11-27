import { describe, expect, it, vi } from 'vitest';
import {
  alertText, deliver, deliveryFor, devicesFor, followTargets, inQuietHours, isExpired, localMinutes, normalisePrefs, pushDue, pushEnabled, pushSend, sendOne,
  DEFAULT_PREFS, EVENT_BIT, type FollowRow, type Sender,
} from '../../src/push/send.js';
import type { PushEventRow } from '../../src/push/observe.js';
import type { ApnsResult } from '../../src/push/apns.js';

const NOW = Date.parse('2026-11-28T04:30:00Z'); // 23:30 Friday in New York, 13:30 Saturday in Tokyo
const event = (over: Partial<PushEventRow> = {}, payload: Record<string, unknown> = {}): PushEventRow => ({
  id: 7, dedupe_key: 'p:1001:goal:0:1-0', match_key: 'p:1001', type: 'goal', status: 'sending', created_at: new Date(NOW - 20_000).toISOString(),
  payload: {
    key: 'p:1001', status: 'live', home: 1, away: 0, to: '/pro/matches/home-fc-away-fc',
    teams: { home: { kind: 'pro-team', ref: '10', name: 'Home FC' }, away: { kind: 'pro-team', ref: '20', name: 'Away FC' } },
    league: { kind: 'pro-league', ref: '253', name: 'MLS' },
    scorer: { name: 'A. Striker', player_id: 900, team_id: 10, minute: 27, own_goal: false }, gen: 0, corrected: false, ...payload,
  } as any, ...over,
});

describe('alert settings (pure)', () => {
  it('fills in what is missing or malformed', () => {
    expect(normalisePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(normalisePrefs({ goal: false, halftime: 'no', quiet_start: '22:00', quiet_end: '7am' })).toEqual({ ...DEFAULT_PREFS, goal: false, quiet_start: '22:00', quiet_end: null });
  });
  it('local time in the device\'s zone', () => {
    expect(localMinutes('America/New_York', NOW)).toBe(23 * 60 + 30);
    expect(localMinutes('Asia/Tokyo', NOW)).toBe(13 * 60 + 30);
    expect(localMinutes('Mars/Olympus', NOW)).toBeNull();
    expect(localMinutes(null, NOW)).toBeNull();
    expect(localMinutes('America/New_York', Date.parse('2026-11-28T05:00:00Z'))).toBe(0); // midnight is 0, not 24:00
  });
  it('quiet hours, across midnight or not, by the device\'s own clock', () => {
    const night = { ...DEFAULT_PREFS, quiet_start: '22:00', quiet_end: '07:00' };
    expect(inQuietHours(night, 'America/New_York', NOW)).toBe(true);
    expect(inQuietHours(night, 'Asia/Tokyo', NOW)).toBe(false);
    expect(inQuietHours(night, 'America/New_York', Date.parse('2026-11-28T12:00:00Z'))).toBe(false); // 07:00: the end is not included
    expect(inQuietHours(night, 'America/New_York', Date.parse('2026-11-28T11:59:00Z'))).toBe(true);
    const lunch = { ...DEFAULT_PREFS, quiet_start: '13:00', quiet_end: '14:00' };
    expect(inQuietHours(lunch, 'Asia/Tokyo', NOW)).toBe(true);
    expect(inQuietHours(lunch, 'America/New_York', NOW)).toBe(false);
    expect(inQuietHours({ ...DEFAULT_PREFS, quiet_start: '22:00', quiet_end: '22:00' }, 'Asia/Tokyo', NOW)).toBe(false);
    expect(inQuietHours(night, null, NOW)).toBe(false);
    expect(inQuietHours(DEFAULT_PREFS, 'America/New_York', NOW)).toBe(false);
  });
  it('quiet hours drop kick-off, goal and half-time and deliver full time quietly; a switched-off alert is never sent', () => {
    const night = { ...DEFAULT_PREFS, quiet_start: '22:00', quiet_end: '07:00' };
    for (const t of ['kickoff', 'goal', 'halftime'] as const) {
      expect(deliveryFor(t, night, 'America/New_York', NOW)).toBe('drop');
      expect(deliveryFor(t, night, 'Asia/Tokyo', NOW)).toBe('send');
    }
    expect(deliveryFor('final', night, 'America/New_York', NOW)).toBe('passive');
    expect(deliveryFor('final', night, 'Asia/Tokyo', NOW)).toBe('send');
    expect(deliveryFor('final', { ...night, final: false }, 'America/New_York', NOW)).toBe('drop');
    expect(deliveryFor('goal', { ...DEFAULT_PREFS, goal: false }, 'Asia/Tokyo', NOW)).toBe('drop');
  });
});

describe('who an alert is for (pure)', () => {
  it('both teams, the competition, extra refs, and the scorer of a goal', () => {
    expect(followTargets(event())).toEqual([{ kind: 'pro-team', ref: '10' }, { kind: 'pro-team', ref: '20' }, { kind: 'pro-league', ref: '253' }, { kind: 'pro-player', ref: '900' }]);
    expect(followTargets(event({ type: 'final' })).some((t) => t.kind === 'pro-player')).toBe(false);
    expect(followTargets(event({}, { scorer: { name: 'O. Goal', player_id: 901, team_id: 20, minute: 3, own_goal: true } })).some((t) => t.kind === 'pro-player')).toBe(false);
    const college = event({ type: 'final' }, { teams: { home: { kind: 'team', ref: 'aaa', name: 'A' }, away: { kind: 'team', ref: '', name: 'TBD' } }, league: { kind: 'conference', ref: 'c1', name: 'ACC' }, refs: [{ kind: 'conference', ref: 'c2' }, { kind: 'conference', ref: 'c1' }], scorer: null });
    expect(followTargets(college)).toEqual([{ kind: 'team', ref: 'aaa' }, { kind: 'conference', ref: 'c1' }, { kind: 'conference', ref: 'c2' }]);
  });
  it('a follow\'s event mask decides, and one allowing follow is enough', () => {
    const targets = followTargets(event());
    const rows: FollowRow[] = [
      { device_id: 'd1', kind: 'pro-team', ref: '10', events: 15 },
      { device_id: 'd2', kind: 'pro-team', ref: '20', events: EVENT_BIT.final },            // full time only
      { device_id: 'd3', kind: 'pro-team', ref: '10', events: EVENT_BIT.final },
      { device_id: 'd3', kind: 'pro-player', ref: '900', events: EVENT_BIT.goal },          // but follows the scorer's goals
      { device_id: 'd4', kind: 'pro-team', ref: '99', events: 15 },                         // another team
      { device_id: 'd5', kind: 'team', ref: '10', events: 15 },                             // same id, other kind
      { device_id: 'd6', kind: 'pro-league', ref: '253', events: EVENT_BIT.goal | EVENT_BIT.kickoff },
    ];
    expect(devicesFor('goal', targets, rows).sort()).toEqual(['d1', 'd3', 'd6']);
    expect(devicesFor('final', targets, rows).sort()).toEqual(['d1', 'd2', 'd3']);
    expect(devicesFor('halftime', targets, rows)).toEqual(['d1']);
  });
  it('the words', () => {
    expect(alertText(event())).toEqual({ title: 'Goal', body: 'Home FC 1-0 Away FC. A. Striker 27\'' });
    expect(alertText(event({}, { scorer: null }))).toEqual({ title: 'Goal', body: 'Home FC 1-0 Away FC' });
    expect(alertText(event({}, { scorer: { name: 'O. Goal', player_id: 1, team_id: 20, minute: null, own_goal: true } })).body).toBe('Home FC 1-0 Away FC. O. Goal (own goal)');
    expect(alertText(event({ type: 'kickoff' }))).toEqual({ title: 'Kick-off', body: 'Home FC v Away FC (MLS)' });
    expect(alertText(event({ type: 'halftime' }))).toEqual({ title: 'Half-time', body: 'Home FC 1-0 Away FC' });
    expect(alertText(event({ type: 'final' }, { home: 2, away: 1 }))).toEqual({ title: 'Full time', body: 'Home FC 2-1 Away FC' });
    expect(alertText(event({ type: 'final' }, { corrected: true })).title).toBe('Full time (corrected score)');
  });
  it('an alert is too old after 10 minutes, a full time after 60', () => {
    const at = (m: number) => new Date(NOW - m * 60_000).toISOString();
    expect(isExpired({ type: 'goal', created_at: at(9) }, NOW)).toBe(false);
    expect(isExpired({ type: 'goal', created_at: at(11) }, NOW)).toBe(true);
    expect(isExpired({ type: 'kickoff', created_at: at(11) }, NOW)).toBe(true);
    expect(isExpired({ type: 'final', created_at: at(59) }, NOW)).toBe(false);
    expect(isExpired({ type: 'final', created_at: at(61) }, NOW)).toBe(true);
  });
});

/** A stand-in for the database: answers the reads deliver() makes and records every write. */
function fakeDb(t: { follows?: FollowRow[]; devices?: any[]; alreadySent?: string[]; waiting?: number | null; claims?: PushEventRow[][] } = {}) {
  const writes: Array<{ table: string; op: string; payload: any; filters: Record<string, any> }> = [];
  const claims = [...(t.claims ?? [])];
  const from = (table: string) => {
    const q: any = { op: 'select', payload: null, filters: {} as Record<string, any>, head: false };
    q.select = (_c?: string, o?: { head?: boolean }) => { if (o?.head) q.head = true; return q; };
    q.range = () => q; q.order = () => q;
    q.eq = (c: string, v: any) => { q.filters[c] = v; return q; };
    q.in = (c: string, v: any) => { q.filters[c] = v; return q; };
    q.lt = (c: string, v: any) => { q.filters[`${c}<`] = v; return q; };
    q.update = (p: any) => { q.op = 'update'; q.payload = p; return q; };
    q.upsert = (p: any) => { q.op = 'upsert'; q.payload = p; return q; };
    q.delete = () => { q.op = 'delete'; return q; };
    q.then = (res: any, rej: any) => {
      if (q.op !== 'select') writes.push({ table, op: q.op, payload: q.payload, filters: q.filters });
      let data: any = [];
      if (q.op === 'select' && table === 'push_device_follows') data = (t.follows ?? []).filter((r) => r.kind === q.filters.kind && q.filters.ref.includes(r.ref));
      if (q.op === 'select' && table === 'push_devices') data = (t.devices ?? []).filter((d) => q.filters.id.includes(d.id));
      if (q.op === 'upsert' && table === 'push_sent') data = q.payload.filter((r: any) => !(t.alreadySent ?? []).includes(r.device_id)).map((r: any) => ({ device_id: r.device_id }));
      const out = q.head ? { count: t.waiting ?? 0, error: t.waiting === null ? { message: 'relation "push_events" does not exist' } : null } : { data, error: null };
      return Promise.resolve(out).then(res, rej);
    };
    return q;
  };
  const rpc = async (name: string) => (name === 'push_claim_events' ? { data: claims.shift() ?? [], error: null } : { data: null, error: { message: `unexpected ${name}` } });
  return { from, rpc, writes } as any;
}
const device = (id: string, over: Record<string, unknown> = {}) => ({ id, apns_token: `tok-${id}`, apns_env: 'production', tz: 'Asia/Tokyo', prefs: DEFAULT_PREFS, disabled_at: null, ...over });
const counters = () => { const c: Record<string, number> = {}; return { c, inc: (k: string, by = 1) => { c[k] = (c[k] ?? 0) + by; } }; };
const okSender = () => { const calls: Array<[string, string, any]> = []; const s: Sender = { send: async (env, token, n) => { calls.push([env, token, n]); return { kind: 'ok', status: 200 }; } }; return { s, calls }; };
const statusWrites = (db: any) => db.writes.filter((w: any) => w.table === 'push_events').map((w: any) => w.payload.status);

describe('deliver', () => {
  const follows: FollowRow[] = [{ device_id: 'd1', kind: 'pro-team', ref: '10', events: 15 }, { device_id: 'd2', kind: 'pro-team', ref: '20', events: 15 }, { device_id: 'd3', kind: 'pro-league', ref: '253', events: 15 }];

  it('sends once to each following device that has a token, with the sent row written first', async () => {
    const db = fakeDb({ follows, devices: [device('d1'), device('d2', { apns_token: null }), device('d3', { disabled_at: '2026-11-01T00:00:00Z' })] });
    const { s, calls } = okSender(); const k = counters();
    await deliver({ db, inc: k.inc }, event(), s, NOW);
    expect(calls.map((c) => [c[0], c[1]])).toEqual([['production', 'tok-d1']]);
    expect(calls[0]![2]).toMatchObject({ title: 'Goal', matchKey: 'p:1001', to: '/pro/matches/home-fc-away-fc', passive: false });
    expect(calls[0]![2].expiresAt).toBe(Math.floor((NOW - 20_000 + 10 * 60_000) / 1000));
    expect(db.writes.find((w: any) => w.table === 'push_sent')!.payload).toEqual([{ event_id: 7, device_id: 'd1' }]);
    expect(db.writes.findIndex((w: any) => w.table === 'push_sent')).toBeLessThan(db.writes.findIndex((w: any) => w.table === 'push_events'));
    expect(statusWrites(db)).toEqual(['sent']);
    expect(k.c).toEqual({ sent: 1 });
  });
  it('at most once: a device already in push_sent is not sent again', async () => {
    const db = fakeDb({ follows, devices: [device('d1'), device('d2')], alreadySent: ['d1'] });
    const { s, calls } = okSender();
    await deliver({ db, inc: counters().inc }, event(), s, NOW);
    expect(calls.map((c) => c[1])).toEqual(['tok-d2']);
  });
  it('quiet hours: a goal is held back, a full time goes quietly', async () => {
    const asleep = device('d1', { tz: 'America/New_York', prefs: { ...DEFAULT_PREFS, quiet_start: '22:00', quiet_end: '07:00' } });
    const db = fakeDb({ follows, devices: [asleep, device('d2', { prefs: { ...DEFAULT_PREFS, goal: false } })] });
    const first = okSender(); const k = counters();
    await deliver({ db, inc: k.inc }, event(), first.s, NOW);
    expect(first.calls).toEqual([]); expect(k.c).toEqual({ held_back: 2 });
    const second = okSender();
    await deliver({ db: fakeDb({ follows, devices: [asleep] }), inc: counters().inc }, event({ type: 'final', dedupe_key: 'p:1001:final:0' }), second.s, NOW);
    expect(second.calls.map((c) => c[2].passive)).toEqual([true]);
  });
  it('switched off (no sender): every step but the request, and the alert is closed', async () => {
    const db = fakeDb({ follows, devices: [device('d1'), device('d2')] }); const k = counters();
    await deliver({ db, inc: k.inc }, event(), null, NOW);
    expect(db.writes.find((w: any) => w.table === 'push_sent')!.payload).toHaveLength(2);
    expect(statusWrites(db)).toEqual(['sent']);
    expect(k.c).toEqual({ would_send: 2 });
  });
  it('an old alert is marked expired and nobody is looked up', async () => {
    const db = fakeDb({ follows, devices: [device('d1')] }); const { s, calls } = okSender(); const k = counters();
    await deliver({ db, inc: k.inc }, event({ created_at: new Date(NOW - 11 * 60_000).toISOString() }), s, NOW);
    expect(calls).toEqual([]); expect(statusWrites(db)).toEqual(['expired']); expect(db.writes).toHaveLength(1);
  });
});

describe('sendOne: what Apple says about a token', () => {
  const d = { id: 'd1', apns_token: 'tok', apns_env: 'production' as const };
  const n = { title: 'Goal', body: 'x', matchKey: 'p:1', to: '/', expiresAt: 1 };
  const scripted = (answers: ApnsResult[]) => { const calls: string[] = []; const s: Sender = { send: async (env) => { calls.push(env); return answers.shift() ?? { kind: 'other', status: 0, reason: 'script ran out' }; } }; return { s, calls }; };
  const noWait = async () => {};

  it('ok; busy is tried once more', async () => {
    const a = scripted([{ kind: 'ok', status: 200 }]);
    expect(await sendOne(fakeDb(), a.s, d, n, noWait)).toBe('sent');
    const b = scripted([{ kind: 'retry', status: 429, reason: 'TooManyRequests' }, { kind: 'ok', status: 200 }]);
    expect(await sendOne(fakeDb(), b.s, d, n, noWait)).toBe('sent'); expect(b.calls).toEqual(['production', 'production']);
    const c = scripted([{ kind: 'retry', status: 503, reason: '' }, { kind: 'retry', status: 503, reason: '' }]);
    const db = fakeDb();
    expect(await sendOne(db, c.s, d, n, noWait)).toBe('failed'); expect(c.calls).toHaveLength(2); expect(db.writes).toEqual([]);
  });
  it('gone: the other environment is tried once, and a success is remembered', async () => {
    const a = scripted([{ kind: 'gone', status: 400, reason: 'BadDeviceToken' }, { kind: 'ok', status: 200 }]); const db = fakeDb();
    expect(await sendOne(db, a.s, d, n, noWait)).toBe('flipped');
    expect(a.calls).toEqual(['production', 'sandbox']);
    expect(db.writes).toEqual([{ table: 'push_devices', op: 'update', payload: { apns_env: 'sandbox' }, filters: { id: 'd1' } }]);
  });
  it('gone on both: the token is cleared', async () => {
    const a = scripted([{ kind: 'gone', status: 410, reason: 'Unregistered' }, { kind: 'gone', status: 400, reason: 'BadDeviceToken' }]); const db = fakeDb();
    expect(await sendOne(db, a.s, d, n, noWait)).toBe('cleared');
    expect(db.writes).toHaveLength(1);
    expect(db.writes[0]).toMatchObject({ table: 'push_devices', op: 'update', filters: { id: 'd1', apns_token: 'tok' } });
    expect(db.writes[0].payload.apns_token).toBeNull(); expect(db.writes[0].payload.disabled_at).toBeTruthy();
  });
  it('gone, then Apple busy on the other side: the token is kept', async () => {
    const a = scripted([{ kind: 'gone', status: 410, reason: 'Unregistered' }, { kind: 'retry', status: 503, reason: '' }]); const db = fakeDb();
    expect(await sendOne(db, a.s, d, n, noWait)).toBe('failed'); expect(db.writes).toEqual([]);
  });
  it('a request Apple refuses for another reason is not retried and the token is kept', async () => {
    const a = scripted([{ kind: 'other', status: 400, reason: 'BadCollapseId' }]); const db = fakeDb();
    expect(await sendOne(db, a.s, d, n, noWait)).toBe('failed'); expect(a.calls).toHaveLength(1); expect(db.writes).toEqual([]);
  });
});

describe('the switch and the job', () => {
  it('PUSH_ENABLED is off unless it is exactly 1', () => {
    expect(pushEnabled({} as any)).toBe(false);
    expect(pushEnabled({ PUSH_ENABLED: 'true' } as any)).toBe(false);
    expect(pushEnabled({ PUSH_ENABLED: '1' } as any)).toBe(true);
  });
  it('switched off, the scheduler queues the sender only while alerts wait (and not when the table is missing)', async () => {
    expect(pushEnabled()).toBe(false); // the test environment does not set it
    expect(await pushDue(fakeDb({ waiting: 0 }))).toBe(false);
    expect(await pushDue(fakeDb({ waiting: 3 }))).toBe(true);
    expect(await pushDue(fakeDb({ waiting: null }))).toBe(false);
  });
  it('push-send switched off: claims until nothing waits, logs instead of sending, prunes', async () => {
    const db = fakeDb({ follows: [{ device_id: 'd1', kind: 'pro-team', ref: '10', events: 15 }], devices: [device('d1')], claims: [[{ ...event(), created_at: new Date().toISOString() }]] });
    const k = counters(); const notes: Record<string, unknown> = {};
    const rpc = vi.spyOn(db, 'rpc');
    await pushSend({ db, runId: null, params: {}, counters: {}, inc: k.inc, note: (key: string, v: unknown) => { notes[key] = v; }, cancelled: async () => false, heartbeat: async () => {} } as any);
    expect(rpc).toHaveBeenCalledTimes(2); // one batch, then an empty claim
    expect(notes.mode).toBe('dry run (would send)');
    expect(k.c).toMatchObject({ events: 1, would_send: 1, pruned: 1 });
    const pruned = db.writes.filter((w: any) => w.op === 'delete').map((w: any) => w.table);
    expect(pruned).toEqual(['push_sent', 'push_events', 'push_match_state', 'push_devices', 'college_crawl_runs']);
    expect(db.writes.find((w: any) => w.table === 'college_crawl_runs')!.filters).toMatchObject({ job: 'push-send', status: 'done' });
  });
});
