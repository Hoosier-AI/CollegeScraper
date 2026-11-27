// The app's device routes (the iOS app has no user accounts; a device is known by an install token it makes itself).
//   POST   /api/device           register, or update the Apple token, its environment, the time zone and app version
//   PUT    /api/device/follows   replace what the device follows: { follows: [{ kind, ref, events? }] }, at most 40
//   PUT    /api/device/prefs     replace its alert settings: { kickoff, goal, halftime, final, quiet_start, quiet_end }
//   DELETE /api/device           forget the device (its follows and sent rows go with it)
// Auth: `Authorization: Device <install token>`, a 256-bit random value as 64 hex characters or 43 base64url
// characters. Only its sha256 is stored (push_devices.token_hash), so a copy of the table cannot act as a device.
// These four are the only writes on /api that do not need the admin secret (the exemption is in src/ui/api.ts,
// by method and matched route); they keep their own limits: 20 requests a minute and 10 new devices a day per
// address, bodies up to 4 KB.
import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDb, type Db } from '../db/client.js';
import { RateLimiter } from '../api/auth.js';
import { validFollow } from '../ui/follows.js';
import { ALL_EVENTS, DEFAULT_PREFS, HHMM, validTimeZone, type DevicePrefs } from './send.js';

/** `<METHOD> <matched route>` of the routes above, for the /api gate. */
export const DEVICE_ROUTES: ReadonlySet<string> = new Set(['POST /api/device', 'PUT /api/device/follows', 'PUT /api/device/prefs', 'DELETE /api/device']);
export const MAX_FOLLOWS = 40;
export const MAX_BODY = 4 * 1024;
const INSTALL_TOKEN = /^(?:[0-9a-f]{64}|[A-Za-z0-9_-]{43})$/;
const APNS_TOKEN = /^[0-9a-f]{64,200}$/i;
const APP_VERSION = /^[0-9A-Za-z][0-9A-Za-z .()+_-]{0,31}$/;

/** The install token from `Authorization: Device <token>`, or null when the header or the token is malformed. */
export function installToken(header: string | string[] | undefined): string | null {
  const raw = Array.isArray(header) ? header[0] : header;
  const m = String(raw ?? '').match(/^Device ([^\s]+)$/);
  return m && INSTALL_TOKEN.test(m[1]!) ? m[1]! : null;
}
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

type Bad = { ok: false; error: string };
const bad = (error: string): Bad => ({ ok: false, error });
const obj = (b: unknown): Record<string, unknown> | null => (b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : null);

export interface DeviceInput { apns_token: string | null; apns_env: 'sandbox' | 'production' | null; tz: string | null; app_version: string | null }
export function checkDevice(body: unknown): { ok: true; row: DeviceInput } | Bad {
  const b = obj(body); if (!b) return bad('body must be a JSON object');
  const token = b.apns_token == null || b.apns_token === '' ? null : b.apns_token;
  if (token !== null && (typeof token !== 'string' || !APNS_TOKEN.test(token))) return bad('apns_token must be the device token as hex');
  const env = b.apns_env == null ? null : b.apns_env;
  if (env !== null && env !== 'sandbox' && env !== 'production') return bad('apns_env must be sandbox or production');
  if (token && !env) return bad('apns_env is required with apns_token');
  if (b.tz != null && !validTimeZone(b.tz)) return bad('tz must be a time zone name like America/New_York');
  if (b.app_version != null && (typeof b.app_version !== 'string' || !APP_VERSION.test(b.app_version))) return bad('app_version is malformed');
  return { ok: true, row: { apns_token: token ? (token as string).toLowerCase() : null, apns_env: env as DeviceInput['apns_env'], tz: (b.tz as string | undefined) ?? null, app_version: (b.app_version as string | undefined) ?? null } };
}

export interface FollowInput { kind: string; ref: string; events: number }
export function checkFollows(body: unknown): { ok: true; follows: FollowInput[] } | Bad {
  const list = obj(body)?.follows;
  if (!Array.isArray(list)) return bad('follows must be a list');
  if (list.length > MAX_FOLLOWS) return bad(`at most ${MAX_FOLLOWS} follows`);
  const out = new Map<string, FollowInput>();
  for (const item of list) {
    const f = obj(item); if (!f) return bad('each follow must be an object');
    const kind = f.kind, ref = typeof f.ref === 'number' ? String(f.ref) : f.ref;
    if (typeof kind !== 'string' || typeof ref !== 'string' || !validFollow(kind, ref)) return bad('a follow has an unknown kind or a malformed ref');
    const events = f.events == null ? ALL_EVENTS : f.events;
    if (typeof events !== 'number' || !Number.isInteger(events) || events < 0 || events > ALL_EVENTS) return bad('events must be a whole number from 0 to 15');
    out.set(`${kind}|${ref.toLowerCase()}`, { kind, ref: ref.toLowerCase(), events });
  }
  return { ok: true, follows: [...out.values()] };
}

export function checkPrefs(body: unknown): { ok: true; prefs: DevicePrefs } | Bad {
  const b = obj(body); if (!b) return bad('body must be a JSON object');
  const prefs: DevicePrefs = { ...DEFAULT_PREFS };
  for (const k of ['kickoff', 'goal', 'halftime', 'final'] as const) {
    if (b[k] == null) continue;
    if (typeof b[k] !== 'boolean') return bad(`${k} must be true or false`);
    prefs[k] = b[k] as boolean;
  }
  for (const k of ['quiet_start', 'quiet_end'] as const) {
    if (b[k] == null || b[k] === '') continue;
    if (typeof b[k] !== 'string' || !HHMM.test(b[k] as string)) return bad(`${k} must be a time like 22:30`);
    prefs[k] = b[k] as string;
  }
  if (!!prefs.quiet_start !== !!prefs.quiet_end) return bad('quiet_start and quiet_end go together');
  return { ok: true, prefs };
}

export interface PushApiOptions { db?: () => Db; perMinute?: number; newPerDay?: number }

export function registerPushApi(app: FastifyInstance, o: PushApiOptions = {}): void {
  const db = o.db ?? (() => getDb());
  const limiter = new RateLimiter(o.perMinute ?? 20);
  const newDevices = new RateLimiter(o.newPerDay ?? 10, 86_400_000);
  const route = { bodyLimit: MAX_BODY };
  const fail = (what: string, message: string) => { throw new Error(`${what}: ${message}`); };

  /** The limit, then the token. Returns the token's hash, or null when the reply has been sent. */
  const enter = (req: FastifyRequest, reply: FastifyReply): string | null => {
    // req.ip is the visitor's address: the edge's CF-Connecting-IP (src/server.ts) with trustProxy on.
    const r = limiter.take(`ip:${req.ip || 'unknown'}`);
    if (!r.ok) { reply.header('Retry-After', String(Math.ceil(r.resetMs / 1000))).code(429).send({ error: 'rate_limited' }); return null; }
    const token = installToken(req.headers.authorization);
    if (!token) { reply.code(401).send({ error: 'bad_token' }); return null; }
    return hashToken(token);
  };
  const deviceId = async (hash: string): Promise<string | null> => {
    const { data, error } = await db().from('push_devices').select('id').eq('token_hash', hash).maybeSingle();
    if (error) fail('device read', error.message);
    return (data?.id as string | undefined) ?? null;
  };

  app.post('/api/device', route, async (req, reply) => {
    const hash = enter(req, reply); if (!hash) return reply;
    const checked = checkDevice(req.body);
    if (!checked.ok) return reply.code(400).send({ error: checked.error });
    const now = new Date().toISOString();
    const id = await deviceId(hash);
    if (!id) {
      const r = newDevices.take(`ip:${req.ip || 'unknown'}`);
      if (!r.ok) return reply.header('Retry-After', String(Math.ceil(r.resetMs / 1000))).code(429).send({ error: 'rate_limited' });
    }
    // An Apple token belongs to one install: a reinstall makes a new install token and gets the same Apple token,
    // and the old row would get every alert a second time.
    if (checked.row.apns_token) {
      const { error } = await db().from('push_devices').update({ apns_token: null }).eq('apns_token', checked.row.apns_token).neq('token_hash', hash);
      if (error) fail('device token move', error.message);
    }
    const row = { ...checked.row, last_seen: now, disabled_at: null };
    const { error } = id
      ? await db().from('push_devices').update(row).eq('id', id)
      : await db().from('push_devices').upsert({ token_hash: hash, ...row }, { onConflict: 'token_hash' });
    if (error) fail('device write', error.message);
    return reply.code(id ? 200 : 201).send({ ok: true });
  });

  app.put('/api/device/follows', route, async (req, reply) => {
    const hash = enter(req, reply); if (!hash) return reply;
    const checked = checkFollows(req.body);
    if (!checked.ok) return reply.code(400).send({ error: checked.error });
    const id = await deviceId(hash);
    if (!id) return reply.code(404).send({ error: 'unknown_device' });
    // The new list is written first and what is no longer on it removed after, so a failure half way leaves the
    // device following too much for a moment, never nothing.
    if (checked.follows.length) {
      const { error } = await db().from('push_device_follows').upsert(checked.follows.map((f) => ({ device_id: id, ...f })), { onConflict: 'device_id,kind,ref' });
      if (error) fail('follows write', error.message);
    }
    const { data: have, error: readError } = await db().from('push_device_follows').select('kind,ref').eq('device_id', id);
    if (readError) fail('follows read', readError.message);
    const keep = new Set(checked.follows.map((f) => `${f.kind}|${f.ref}`));
    for (const old of ((have ?? []) as { kind: string; ref: string }[]).filter((h) => !keep.has(`${h.kind}|${h.ref}`))) {
      const { error } = await db().from('push_device_follows').delete().eq('device_id', id).eq('kind', old.kind).eq('ref', old.ref);
      if (error) fail('follows delete', error.message);
    }
    await db().from('push_devices').update({ last_seen: new Date().toISOString() }).eq('id', id);
    return reply.code(204).send();
  });

  app.put('/api/device/prefs', route, async (req, reply) => {
    const hash = enter(req, reply); if (!hash) return reply;
    const checked = checkPrefs(req.body);
    if (!checked.ok) return reply.code(400).send({ error: checked.error });
    const id = await deviceId(hash);
    if (!id) return reply.code(404).send({ error: 'unknown_device' });
    const { error } = await db().from('push_devices').update({ prefs: checked.prefs, last_seen: new Date().toISOString() }).eq('id', id);
    if (error) fail('prefs write', error.message);
    return reply.code(204).send();
  });

  app.delete('/api/device', route, async (req, reply) => {
    const hash = enter(req, reply); if (!hash) return reply;
    const { error } = await db().from('push_devices').delete().eq('token_hash', hash);
    if (error) fail('device delete', error.message);
    return reply.code(204).send();
  });
}
