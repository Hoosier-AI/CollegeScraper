import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { createHash, randomBytes } from 'node:crypto';
import { registerPushApi, checkDevice, checkFollows, checkPrefs, installToken, hashToken, DEVICE_ROUTES, MAX_FOLLOWS } from '../../src/push/routes.js';
import { registerUiApi } from '../../src/ui/api.js';
import { parseFollows, validFollow } from '../../src/ui/follows.js';

const TOKEN = randomBytes(32).toString('hex');
const UUID = '7f0c2a9e-1111-4222-8333-444455556666';
const APNS = 'ab'.repeat(32);

/** A stand-in for the database: one optional device row, its follows, and a record of every write. */
function fakeDb(t: { device?: { id: string } | null; follows?: Array<{ kind: string; ref: string }> } = {}) {
  const writes: Array<{ table: string; op: string; payload: any; filters: Record<string, any> }> = [];
  const reads: string[] = [];
  const from = (table: string) => {
    const q: any = { op: 'select', payload: null, filters: {} as Record<string, any> };
    q.select = () => q;
    q.eq = (c: string, v: any) => { q.filters[c] = v; return q; };
    q.neq = (c: string, v: any) => { q.filters[`${c}!`] = v; return q; };
    q.update = (p: any) => { q.op = 'update'; q.payload = p; return q; };
    q.upsert = (p: any) => { q.op = 'upsert'; q.payload = p; return q; };
    q.delete = () => { q.op = 'delete'; return q; };
    q.maybeSingle = async () => { reads.push(table); return { data: t.device ?? null, error: null }; };
    q.then = (res: any, rej: any) => {
      if (q.op === 'select') reads.push(table); else writes.push({ table, op: q.op, payload: q.payload, filters: q.filters });
      return Promise.resolve({ data: q.op === 'select' && table === 'push_device_follows' ? t.follows ?? [] : [], error: null }).then(res, rej);
    };
    return q;
  };
  return { from, writes, reads } as any;
}
const appWith = async (db: any, limits: { perMinute?: number; newPerDay?: number } = {}) => {
  const app = Fastify({ bodyLimit: 256 * 1024 });
  registerPushApi(app, { db: () => db, ...limits });
  await app.ready();
  return app;
};
const auth = (token = TOKEN) => ({ authorization: `Device ${token}` });

describe('install token', () => {
  it('64 hex characters or 43 base64url characters, nothing else', () => {
    expect(installToken(`Device ${TOKEN}`)).toBe(TOKEN);
    const b64 = randomBytes(32).toString('base64url');
    expect(b64).toHaveLength(43);
    expect(installToken(`Device ${b64}`)).toBe(b64);
    for (const bad of [undefined, '', TOKEN, `Bearer ${TOKEN}`, `Device ${TOKEN.slice(1)}`, `Device ${TOKEN}0`, `Device ${TOKEN} x`, 'Device ', `Device ${'z'.repeat(64)}`, `device  ${TOKEN}`]) expect(installToken(bad as any), String(bad)).toBeNull();
  });
  it('only the sha256 is kept', () => {
    expect(hashToken(TOKEN)).toBe(createHash('sha256').update(TOKEN).digest('hex'));
    expect(hashToken(TOKEN)).not.toContain(TOKEN);
  });
});

describe('body checks (pure)', () => {
  it('device', () => {
    expect(checkDevice({ apns_token: APNS.toUpperCase(), apns_env: 'sandbox', tz: 'America/New_York', app_version: '1.0 (12)' })).toEqual({ ok: true, row: { apns_token: APNS, apns_env: 'sandbox', tz: 'America/New_York', app_version: '1.0 (12)' } });
    expect(checkDevice({})).toEqual({ ok: true, row: { apns_token: null, apns_env: null, tz: null, app_version: null } });
    for (const bad of [null, [], 'x', { apns_token: 'xyz' }, { apns_token: APNS }, { apns_token: APNS, apns_env: 'prod' }, { tz: 'Mars/Olympus' }, { tz: 5 }, { app_version: '<script>' }, { app_version: 'x'.repeat(40) }]) expect(checkDevice(bad).ok, JSON.stringify(bad)).toBe(false);
  });
  it('follows: the six kinds, ids of the right shape, at most 40, duplicates folded', () => {
    const ok = checkFollows({ follows: [{ kind: 'team', ref: UUID.toUpperCase() }, { kind: 'conference', ref: UUID, events: 8 }, { kind: 'pro-league', ref: 253 }, { kind: 'pro-player', ref: '900', events: 2 }, { kind: 'team', ref: UUID, events: 3 }] });
    expect(ok).toEqual({ ok: true, follows: [{ kind: 'team', ref: UUID, events: 3 }, { kind: 'conference', ref: UUID, events: 8 }, { kind: 'pro-league', ref: '253', events: 15 }, { kind: 'pro-player', ref: '900', events: 2 }] });
    expect(checkFollows({ follows: [] })).toEqual({ ok: true, follows: [] });
    const many = (n: number) => ({ follows: Array.from({ length: n }, (_, i) => ({ kind: 'pro-team', ref: String(i + 1) })) });
    expect(checkFollows(many(MAX_FOLLOWS)).ok).toBe(true);
    expect(checkFollows(many(MAX_FOLLOWS + 1))).toEqual({ ok: false, error: 'at most 40 follows' });
    for (const bad of [null, {}, { follows: 'team:1' }, { follows: [null] }, { follows: [{ kind: 'club', ref: '1' }] }, { follows: [{ kind: 'team', ref: '12' }] }, { follows: [{ kind: 'pro-team', ref: UUID }] }, { follows: [{ kind: 'pro-league', ref: '-1' }] },
      { follows: [{ kind: 'pro-team', ref: '1', events: 16 }] }, { follows: [{ kind: 'pro-team', ref: '1', events: 1.5 }] }, { follows: [{ kind: 'pro-team', ref: '1', events: '3' }] }]) expect(checkFollows(bad).ok, JSON.stringify(bad)).toBe(false);
  });
  it('prefs', () => {
    expect(checkPrefs({})).toEqual({ ok: true, prefs: { kickoff: true, goal: true, halftime: true, final: true, quiet_start: null, quiet_end: null } });
    expect(checkPrefs({ halftime: false, quiet_start: '22:30', quiet_end: '07:00' })).toEqual({ ok: true, prefs: { kickoff: true, goal: true, halftime: false, final: true, quiet_start: '22:30', quiet_end: '07:00' } });
    for (const bad of [null, { goal: 'yes' }, { quiet_start: '25:00', quiet_end: '07:00' }, { quiet_start: '22:00' }, { quiet_start: 2200, quiet_end: 700 }]) expect(checkPrefs(bad).ok, JSON.stringify(bad)).toBe(false);
  });
});

describe('the site\'s follow parsing', () => {
  it('takes the two new kinds and treats the four old ones as before', () => {
    expect(parseFollows(`team:${UUID},player:nope,pro-team:18310,pro-player:-42,club:1,pro-team:abc,conference:${UUID},pro-league:253,conference:12,pro-league:x`)).toEqual([
      { kind: 'team', id: UUID }, { kind: 'pro-team', id: '18310' }, { kind: 'pro-player', id: '-42' }, { kind: 'conference', id: UUID }, { kind: 'pro-league', id: '253' },
    ]);
    expect(validFollow('pro-league', '-5')).toBe(false);
    expect(validFollow('player', UUID)).toBe(true);
  });
});

describe('device routes', () => {
  it('a malformed or missing install token is refused before the database is touched', async () => {
    const db = fakeDb(); const app = await appWith(db);
    for (const headers of [{}, { authorization: 'Device short' }, { authorization: `Bearer ${TOKEN}` }, { authorization: `Device ${TOKEN}zz` }]) {
      const r = await app.inject({ method: 'POST', url: '/api/device', headers, payload: {} });
      expect(r.statusCode).toBe(401); expect(r.json()).toEqual({ error: 'bad_token' });
    }
    expect((await app.inject({ method: 'PUT', url: '/api/device/follows', payload: { follows: [] } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'PUT', url: '/api/device/prefs', payload: {} })).statusCode).toBe(401);
    expect((await app.inject({ method: 'DELETE', url: '/api/device' })).statusCode).toBe(401);
    expect(db.reads).toEqual([]); expect(db.writes).toEqual([]);
    await app.close();
  });
  it('registers a new device with the token\'s hash, never the token', async () => {
    const db = fakeDb(); const app = await appWith(db);
    const r = await app.inject({ method: 'POST', url: '/api/device', headers: auth(), payload: { apns_token: APNS, apns_env: 'production', tz: 'America/Chicago', app_version: '1.0' } });
    expect(r.statusCode).toBe(201); expect(r.json()).toEqual({ ok: true });
    const insert = db.writes.find((w: any) => w.op === 'upsert')!;
    expect(insert.table).toBe('push_devices');
    expect(insert.payload).toMatchObject({ token_hash: hashToken(TOKEN), apns_token: APNS, apns_env: 'production', tz: 'America/Chicago', app_version: '1.0', disabled_at: null });
    expect(JSON.stringify(db.writes)).not.toContain(TOKEN);
    // The same Apple token on another install is taken off that row first.
    expect(db.writes[0]).toMatchObject({ table: 'push_devices', op: 'update', payload: { apns_token: null }, filters: { apns_token: APNS, 'token_hash!': hashToken(TOKEN) } });
    await app.close();
  });
  it('updates a device it knows', async () => {
    const db = fakeDb({ device: { id: 'dev-1' } }); const app = await appWith(db);
    const r = await app.inject({ method: 'POST', url: '/api/device', headers: auth(), payload: { tz: 'Europe/London' } });
    expect(r.statusCode).toBe(200);
    expect(db.writes).toHaveLength(1);
    expect(db.writes[0]).toMatchObject({ table: 'push_devices', op: 'update', filters: { id: 'dev-1' }, payload: { tz: 'Europe/London', apns_token: null } });
    expect((await app.inject({ method: 'POST', url: '/api/device', headers: auth(), payload: { apns_token: 'nope' } })).statusCode).toBe(400);
    await app.close();
  });
  it('a body over 4 KB is refused', async () => {
    const db = fakeDb({ device: { id: 'dev-1' } }); const app = await appWith(db);
    const big = JSON.stringify({ follows: [], pad: 'x'.repeat(5000) });
    for (const [method, url] of [['POST', '/api/device'], ['PUT', '/api/device/follows'], ['PUT', '/api/device/prefs']] as const) {
      const r = await app.inject({ method, url, headers: { ...auth(), 'content-type': 'application/json' }, payload: big });
      expect(r.statusCode, url).toBe(413);
    }
    expect(db.writes).toEqual([]);
    await app.close();
  });
  it('too many follows, or a bad one, changes nothing', async () => {
    const db = fakeDb({ device: { id: 'dev-1' } }); const app = await appWith(db);
    const many = { follows: Array.from({ length: 41 }, (_, i) => ({ kind: 'pro-team', ref: String(i + 1) })) };
    const r = await app.inject({ method: 'PUT', url: '/api/device/follows', headers: auth(), payload: many });
    expect(r.statusCode).toBe(400); expect(r.json().error).toBe('at most 40 follows');
    expect((await app.inject({ method: 'PUT', url: '/api/device/follows', headers: auth(), payload: { follows: [{ kind: 'club', ref: '1' }] } })).statusCode).toBe(400);
    expect(db.writes).toEqual([]);
    await app.close();
  });
  it('follows are replaced: the new list written, what left it removed', async () => {
    const db = fakeDb({ device: { id: 'dev-1' }, follows: [{ kind: 'pro-team', ref: '10' }, { kind: 'pro-team', ref: '20' }] }); const app = await appWith(db);
    const r = await app.inject({ method: 'PUT', url: '/api/device/follows', headers: auth(), payload: { follows: [{ kind: 'pro-team', ref: '20', events: 10 }, { kind: 'conference', ref: UUID }] } });
    expect(r.statusCode).toBe(204); expect(r.body).toBe('');
    expect(db.writes[0]).toMatchObject({ table: 'push_device_follows', op: 'upsert', payload: [{ device_id: 'dev-1', kind: 'pro-team', ref: '20', events: 10 }, { device_id: 'dev-1', kind: 'conference', ref: UUID, events: 15 }] });
    expect(db.writes.filter((w: any) => w.op === 'delete')).toEqual([{ table: 'push_device_follows', op: 'delete', payload: null, filters: { device_id: 'dev-1', kind: 'pro-team', ref: '10' } }]);
    await app.close();
  });
  it('follows and prefs need a registered device; prefs and delete answer 204', async () => {
    const unknown = await appWith(fakeDb());
    expect((await unknown.inject({ method: 'PUT', url: '/api/device/follows', headers: auth(), payload: { follows: [] } })).statusCode).toBe(404);
    expect((await unknown.inject({ method: 'PUT', url: '/api/device/prefs', headers: auth(), payload: {} })).statusCode).toBe(404);
    await unknown.close();
    const db = fakeDb({ device: { id: 'dev-1' } }); const app = await appWith(db);
    expect((await app.inject({ method: 'PUT', url: '/api/device/prefs', headers: auth(), payload: { goal: false, quiet_start: '9pm' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: '/api/device/prefs', headers: auth(), payload: { goal: false, quiet_start: '21:00', quiet_end: '06:30' } })).statusCode).toBe(204);
    expect(db.writes[0].payload.prefs).toEqual({ kickoff: true, goal: false, halftime: true, final: true, quiet_start: '21:00', quiet_end: '06:30' });
    expect((await app.inject({ method: 'DELETE', url: '/api/device', headers: auth() })).statusCode).toBe(204);
    expect(db.writes[1]).toMatchObject({ table: 'push_devices', op: 'delete', filters: { token_hash: hashToken(TOKEN) } });
    await app.close();
  });
  it('limits: requests a minute, and new devices a day, per address', async () => {
    const app = await appWith(fakeDb({ device: { id: 'dev-1' } }), { perMinute: 3 });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await app.inject({ method: 'PUT', url: '/api/device/prefs', headers: auth(), payload: {} })).statusCode);
    expect(codes).toEqual([204, 204, 204, 429, 429]);
    // A bad token counts too: guessing is limited like anything else.
    const guess = await appWith(fakeDb(), { perMinute: 2 });
    const g: number[] = [];
    for (let i = 0; i < 3; i++) g.push((await guess.inject({ method: 'DELETE', url: '/api/device', headers: { authorization: 'Device nope' } })).statusCode);
    expect(g).toEqual([401, 401, 429]);
    const fresh = await appWith(fakeDb(), { newPerDay: 2 });
    const made: number[] = [];
    for (let i = 0; i < 3; i++) made.push((await fresh.inject({ method: 'POST', url: '/api/device', headers: auth(randomBytes(32).toString('hex')), payload: {} })).statusCode);
    expect(made).toEqual([201, 201, 429]);
    // Another address has its own count.
    expect((await fresh.inject({ method: 'POST', url: '/api/device', headers: auth(randomBytes(32).toString('hex')), payload: {}, remoteAddress: '203.0.113.9' })).statusCode).toBe(201);
    await app.close(); await guess.close(); await fresh.close();
  });
});

describe('the /api gate lets only these four through without the admin secret', () => {
  it('device routes reach their own token check; every other write still needs the secret', async () => {
    const db = fakeDb({ device: { id: 'dev-1' } });
    const app = Fastify();
    registerUiApi(app, { authorized: (h) => h === 'Bearer admin-secret' });
    registerPushApi(app, { db: () => db });
    app.post('/api/device/other', async () => ({ reached: true }));
    app.post('/api/device/follows', async () => ({ reached: true }));
    await app.ready();
    expect([...DEVICE_ROUTES].sort()).toEqual(['DELETE /api/device', 'POST /api/device', 'PUT /api/device/follows', 'PUT /api/device/prefs']);
    // Through the gate, then judged by the route itself.
    expect((await app.inject({ method: 'PUT', url: '/api/device/prefs', headers: auth(), payload: {} })).statusCode).toBe(204);
    expect((await app.inject({ method: 'PUT', url: '/api/device/prefs', payload: {} })).json()).toEqual({ error: 'bad_token' });
    expect((await app.inject({ method: 'POST', url: '/api/device', headers: auth(), payload: {} })).statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: '/api/device', headers: auth() })).statusCode).toBe(204);
    // Not on the list: the admin gate answers, with or without a device token.
    for (const [method, url] of [['POST', '/api/device/other'], ['POST', '/api/device/follows'], ['POST', '/api/jobs/enqueue'], ['DELETE', '/api/runs/abc'], ['PUT', '/api/console/requests/1']] as const) {
      const r = await app.inject({ method, url, headers: auth(), payload: {} });
      expect(r.statusCode, `${method} ${url}`).toBe(401); expect(r.json()).toEqual({ error: 'unauthorized' });
    }
    expect((await app.inject({ method: 'POST', url: '/api/device/other', headers: { authorization: 'Bearer admin-secret' }, payload: {} })).json()).toEqual({ reached: true });
    await app.close();
  });
});
