// App alerts, step 2: the `push-send` job. It claims waiting alerts (push_claim_events), finds the devices that
// follow either team, the competition or conference, or (goals) the scorer, keeps those whose settings allow this
// kind of alert, and sends through Apple (src/push/apns.ts).
//   - At most once: a push_sent row is inserted first and only the rows this run inserted are sent. A send that
//     fails is not tried again by a later run.
//   - Quiet hours (the device's own time zone): kick-off, goal and half-time are dropped; full time is delivered
//     quietly (interruption-level passive).
//   - An alert older than 10 minutes (60 for full time) is marked expired, not sent.
//   - A token Apple calls gone is tried once on the other environment (a build installed from Xcode registers on
//     the sandbox); when that works the device's environment is switched, otherwise the token is cleared.
//   - PUSH_ENABLED other than '1' (the default): every step runs except the request to Apple; the log says
//     "would send".
// Runs on its own worker lane ('push', src/workerLanes.ts): a slow send never holds a crawl, and a crawl never
// holds an alert. Old rows are pruned here too (alerts, sent rows and match states after 3 days; devices the app has
// not opened for 90 days).
import { selectIn, type Db } from '../db/client.js';
import { loadConfig } from '../config.js';
import { registerJob, type JobContext } from '../jobs/runner.js';
import { log } from '../log.js';
import { ApnsClient, type ApnsEnv, type ApnsNotification, type ApnsResult } from './apns.js';
import type { FollowTarget, PushEventRow, PushEventType } from './observe.js';

/** The bit of each alert in push_device_follows.events. */
export const EVENT_BIT: Record<PushEventType, number> = { kickoff: 1, goal: 2, halftime: 4, final: 8 };
export const ALL_EVENTS = 15;
export interface DevicePrefs { kickoff: boolean; goal: boolean; halftime: boolean; final: boolean; quiet_start: string | null; quiet_end: string | null }
export const DEFAULT_PREFS: DevicePrefs = { kickoff: true, goal: true, halftime: true, final: true, quiet_start: null, quiet_end: null };
export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_AGE_MS: Record<PushEventType, number> = { kickoff: 10 * 60_000, goal: 10 * 60_000, halftime: 10 * 60_000, final: 60 * 60_000 };

/** Stored prefs with anything missing or malformed replaced by the default. */
export function normalisePrefs(raw: unknown): DevicePrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const flag = (k: 'kickoff' | 'goal' | 'halftime' | 'final') => (typeof r[k] === 'boolean' ? (r[k] as boolean) : DEFAULT_PREFS[k]);
  const time = (v: unknown) => (typeof v === 'string' && HHMM.test(v) ? v : null);
  return { kickoff: flag('kickoff'), goal: flag('goal'), halftime: flag('halftime'), final: flag('final'), quiet_start: time(r.quiet_start), quiet_end: time(r.quiet_end) };
}

/** True for a time zone name this runtime knows ("America/New_York"). */
export function validTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

/** Minutes after midnight in `tz` at `now`, or null when the zone is unknown. */
export function localMinutes(tz: string | null | undefined, now: number): number | null {
  if (!validTimeZone(tz)) return null;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now));
  const h = Number(parts.find((p) => p.type === 'hour')?.value), m = Number(parts.find((p) => p.type === 'minute')?.value);
  return Number.isFinite(h) && Number.isFinite(m) ? (h % 24) * 60 + m : null;
}

/** Quiet hours run from quiet_start up to (not including) quiet_end, across midnight when start is later than end.
 *  None when either is unset, both are the same, or the device's time zone is unknown. */
export function inQuietHours(prefs: DevicePrefs, tz: string | null | undefined, now: number): boolean {
  if (!prefs.quiet_start || !prefs.quiet_end || prefs.quiet_start === prefs.quiet_end) return false;
  const at = localMinutes(tz, now);
  if (at == null) return false;
  const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const s = mins(prefs.quiet_start), e = mins(prefs.quiet_end);
  return s < e ? at >= s && at < e : at >= s || at < e;
}

/** What to do with one alert for one device: send it, send it quietly, or not at all. */
export function deliveryFor(type: PushEventType, prefs: DevicePrefs, tz: string | null | undefined, now: number): 'send' | 'passive' | 'drop' {
  if (!prefs[type]) return 'drop';
  if (!inQuietHours(prefs, tz, now)) return 'send';
  return type === 'final' ? 'passive' : 'drop';
}

export const isExpired = (ev: Pick<PushEventRow, 'type' | 'created_at'>, now: number): boolean => now - Date.parse(ev.created_at) > (MAX_AGE_MS[ev.type] ?? 10 * 60_000);

/** Who an alert is for: both teams, the competition or conference(s), and for a goal the scorer (not an own goal). */
export function followTargets(ev: Pick<PushEventRow, 'type' | 'payload'>): FollowTarget[] {
  const p = ev.payload ?? ({} as PushEventRow['payload']);
  const out: FollowTarget[] = [];
  const add = (t: FollowTarget | null | undefined) => { if (t && t.kind && t.ref && !out.some((o) => o.kind === t.kind && o.ref === t.ref)) out.push({ kind: t.kind, ref: String(t.ref) }); };
  add(p.teams?.home); add(p.teams?.away); add(p.league);
  for (const r of p.refs ?? []) add(r);
  if (ev.type === 'goal' && p.scorer?.player_id != null && !p.scorer.own_goal) add({ kind: 'pro-player', ref: String(p.scorer.player_id) });
  return out;
}

export interface FollowRow { device_id: string; kind: string; ref: string; events: number }
/** The devices whose follow of one of the targets includes this kind of alert. */
export function devicesFor(type: PushEventType, targets: FollowTarget[], rows: FollowRow[]): string[] {
  const want = new Set(targets.map((t) => `${t.kind}|${t.ref}`));
  const out = new Set<string>();
  for (const r of rows) if (want.has(`${r.kind}|${r.ref}`) && (Number(r.events) & EVENT_BIT[type]) !== 0) out.add(r.device_id);
  return [...out];
}

/** The words of the alert. */
export function alertText(ev: Pick<PushEventRow, 'type' | 'payload'>): { title: string; body: string } {
  const p = ev.payload;
  const h = p.teams?.home?.name ?? 'Home', a = p.teams?.away?.name ?? 'Away';
  const score = `${h} ${p.home ?? 0}-${p.away ?? 0} ${a}`;
  const league = p.league?.name ? ` (${p.league.name})` : '';
  if (ev.type === 'kickoff') return { title: 'Kick-off', body: `${h} v ${a}${league}` };
  if (ev.type === 'halftime') return { title: 'Half-time', body: score };
  if (ev.type === 'final') return { title: p.corrected ? 'Full time (corrected score)' : 'Full time', body: score };
  const s = p.scorer;
  const who = s?.name ? `. ${s.name}${s.own_goal ? ' (own goal)' : ''}${s.minute != null ? ` ${s.minute}'` : ''}` : '';
  return { title: 'Goal', body: `${score}${who}` };
}

export const pushEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => loadConfig(env).PUSH_ENABLED === '1';

/** The scheduler's every-minute check: run the sender while the switch is on, or while alerts are waiting. */
export async function pushDue(db: Db): Promise<boolean> {
  if (pushEnabled()) return true;
  const { count, error } = await db.from('push_events').select('id', { count: 'exact', head: true }).in('status', ['pending', 'sending']);
  return !error && (count ?? 0) > 0;
}

export interface Sender { send(env: ApnsEnv, token: string, n: ApnsNotification): Promise<ApnsResult> }
let client: ApnsClient | null = null;
/** The Apple client, or null when the switch is off or the key, key id or team id is not set. */
function apnsClient(): Sender | null {
  const cfg = loadConfig();
  if (cfg.PUSH_ENABLED !== '1' || !cfg.APNS_KEY_P8 || !cfg.APNS_KEY_ID || !cfg.APNS_TEAM_ID) return null;
  client ??= new ApnsClient({ keyP8: cfg.APNS_KEY_P8, keyId: cfg.APNS_KEY_ID, teamId: cfg.APNS_TEAM_ID, bundleId: cfg.APNS_BUNDLE_ID });
  return client;
}

interface DeviceRow { id: string; apns_token: string | null; apns_env: ApnsEnv | null; tz: string | null; prefs: unknown; disabled_at: string | null }
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const other = (env: ApnsEnv): ApnsEnv => (env === 'production' ? 'sandbox' : 'production');

async function setStatus(db: Db, id: number, status: 'sent' | 'expired' | 'failed'): Promise<void> {
  const { error } = await db.from('push_events').update({ status }).eq('id', id);
  if (error) log.warn({ event: id, status, err: error.message }, 'push: event status not written');
}

/** One alert to one device, with the retry and the other-environment try. Returns what happened. */
export async function sendOne(db: Db, sender: Sender, d: { id: string; apns_token: string; apns_env: ApnsEnv }, n: ApnsNotification, wait = sleep): Promise<'sent' | 'flipped' | 'cleared' | 'failed'> {
  let r = await sender.send(d.apns_env, d.apns_token, n);
  if (r.kind === 'retry') { await wait(400); r = await sender.send(d.apns_env, d.apns_token, n); }
  if (r.kind === 'ok') return 'sent';
  if (r.kind === 'gone') {
    const alt = other(d.apns_env);
    const second = await sender.send(alt, d.apns_token, n);
    if (second.kind === 'ok') {
      await db.from('push_devices').update({ apns_env: alt }).eq('id', d.id);
      return 'flipped';
    }
    // Apple busy on the other side tells us nothing: the token is kept for the next alert to settle.
    if (second.kind === 'retry') return 'failed';
    await db.from('push_devices').update({ apns_token: null, disabled_at: new Date().toISOString() }).eq('id', d.id).eq('apns_token', d.apns_token);
    return 'cleared';
  }
  log.warn({ device: d.id, status: r.status, reason: r.reason, kind: r.kind }, 'push: Apple refused an alert');
  return 'failed';
}

const SEND_CONCURRENCY = 25;

/** Everything for one claimed alert. `sender` null = the switch is off (or Apple is not configured): no request. */
export async function deliver(ctx: Pick<JobContext, 'db' | 'inc'>, ev: PushEventRow, sender: Sender | null, now = Date.now()): Promise<void> {
  const db = ctx.db;
  if (isExpired(ev, now)) { ctx.inc('expired'); await setStatus(db, ev.id, 'expired'); return; }
  const targets = followTargets(ev);
  const byKind = new Map<string, string[]>();
  for (const t of targets) byKind.set(t.kind, [...(byKind.get(t.kind) ?? []), t.ref]);
  const rows = (await Promise.all([...byKind].map(([kind, refs]) => selectIn<FollowRow>(db, 'push_device_follows', 'device_id,kind,ref,events', 'ref', refs, (q) => q.eq('kind', kind))))).flat();
  const ids = devicesFor(ev.type, targets, rows);
  const devices = ids.length ? await selectIn<DeviceRow>(db, 'push_devices', 'id,apns_token,apns_env,tz,prefs,disabled_at', 'id', ids) : [];
  const text = alertText(ev);
  const expiresAt = Math.floor((Date.parse(ev.created_at) + MAX_AGE_MS[ev.type]) / 1000);
  const plan: Array<{ d: DeviceRow; passive: boolean }> = [];
  for (const d of devices) {
    if (!d.apns_token || d.disabled_at) continue;
    const how = deliveryFor(ev.type, normalisePrefs(d.prefs), d.tz, now);
    if (how === 'drop') { ctx.inc('held_back'); continue; }
    plan.push({ d, passive: how === 'passive' });
  }
  // The sent row first; only the rows this run inserted are sent.
  const mine = new Set<string>();
  for (let i = 0; i < plan.length; i += 500) {
    const part = plan.slice(i, i + 500).map(({ d }) => ({ event_id: ev.id, device_id: d.id }));
    const { data, error } = await db.from('push_sent').upsert(part, { onConflict: 'event_id,device_id', ignoreDuplicates: true }).select('device_id');
    if (error) throw new Error(`push_sent insert: ${error.message}`);
    for (const r of (data ?? []) as { device_id: string }[]) mine.add(r.device_id);
  }
  const todo = plan.filter(({ d }) => mine.has(d.id));
  if (!sender) {
    if (todo.length) log.info({ event: ev.id, type: ev.type, match: ev.match_key, title: text.title, body: text.body, to: ev.payload?.to, devices: todo.length, quiet: todo.filter((t) => t.passive).length }, 'push: would send');
    ctx.inc('would_send', todo.length);
  } else {
    let next = 0;
    const worker = async () => {
      for (;;) {
        const item = todo[next++];
        if (!item) return;
        const n: ApnsNotification = { ...text, matchKey: ev.match_key, to: ev.payload?.to ?? '/', expiresAt, passive: item.passive };
        try {
          ctx.inc(await sendOne(db, sender, { id: item.d.id, apns_token: item.d.apns_token!, apns_env: item.d.apns_env ?? 'production' }, n));
        } catch (err) {
          ctx.inc('failed');
          log.warn({ device: item.d.id, err: err instanceof Error ? err.message : String(err) }, 'push: send failed');
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(SEND_CONCURRENCY, todo.length) }, worker));
  }
  await setStatus(db, ev.id, 'sent');
}

let prunedAt = 0;
const PRUNE_EVERY_MS = 6 * 3600_000;
/** Old rows out: alerts, sent rows and match states after 3 days, devices not seen for 90, this job's own runs after a day. */
export async function prunePush(db: Db, now = Date.now()): Promise<void> {
  const days = (n: number) => new Date(now - n * 86400_000).toISOString();
  const run = async (what: string, q: PromiseLike<{ error: { message: string } | null }>) => { const { error } = await q; if (error) log.warn({ what, err: error.message }, 'push: prune failed'); };
  await run('sent', db.from('push_sent').delete().lt('sent_at', days(3)));
  await run('events', db.from('push_events').delete().lt('created_at', days(3)));
  await run('states', db.from('push_match_state').delete().lt('updated_at', days(3)));
  await run('devices', db.from('push_devices').delete().lt('last_seen', days(90)));
  await run('runs', db.from('college_crawl_runs').delete().eq('job', 'push-send').eq('status', 'done').lt('created_at', days(1)));
}

/** params: none (`upto` and `scheduled` only tell runs apart in the queue). */
export async function pushSend(ctx: JobContext): Promise<void> {
  const enabled = pushEnabled();
  const sender = apnsClient();
  if (enabled && !sender) { ctx.note('apple', 'not configured: APNS_KEY_P8, APNS_KEY_ID and APNS_TEAM_ID are needed'); log.error('push: PUSH_ENABLED is on but the Apple key, key id or team id is not set; nothing is sent'); }
  ctx.note('mode', sender ? 'sending' : 'dry run (would send)');
  for (let round = 0; round < 40; round++) {
    if (await ctx.cancelled()) break;
    const { data, error } = await ctx.db.rpc('push_claim_events', { n: 50 });
    if (error) throw new Error(`push_claim_events: ${error.message}`);
    const events = (data ?? []) as PushEventRow[];
    if (!events.length) break;
    for (const ev of events) {
      try {
        await deliver(ctx, ev, sender);
        ctx.inc('events');
      } catch (err) {
        ctx.inc('event_errors');
        log.warn({ event: ev.id, err: err instanceof Error ? err.message : String(err) }, 'push: alert failed');
        await setStatus(ctx.db, ev.id, 'failed');
      }
    }
    await ctx.heartbeat();
  }
  if (Date.now() - prunedAt > PRUNE_EVERY_MS) { prunedAt = Date.now(); await prunePush(ctx.db); ctx.inc('pruned'); }
}

registerJob('push-send', pushSend);
