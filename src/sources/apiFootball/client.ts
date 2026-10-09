// API-Football (v3.football.api-sports.io): the one source for Plaibook Stats Pro. The key is Plaibook's own Pro plan
// (7,500 requests a day, shared with the Plaibook app), so every call goes through a quota guard: the provider reports
// what is left of the day in x-ratelimit-requests-remaining on each answer, and this client refuses to spend below a
// floor. Everyday jobs (scores, finals, tables) use `reserve`; the history backfill uses the higher `backfillReserve`,
// so a long backfill can never starve today's results or the Plaibook app. /status reports the day's usage without
// counting against it and is read when nothing is known yet.
// Not the shared HttpClient: that one cannot send an API key header or hand back response headers, and its fetch
// cache would store megabytes of JSON per call in college_source_fetches.
import PQueue from 'p-queue';
import { log } from '../../log.js';

export const API_FOOTBALL_BASE = 'https://v3.football.api-sports.io';

export interface ApiEnvelope<T> { response: T[]; results: number; paging: { current: number; total: number }; errors: unknown }

export interface QuotaState {
  /** Requests left today as the provider last reported it (null until the first answer or /status). */
  remaining: number | null;
  limit: number | null;
  /** When `remaining` was read. */
  at: string | null;
  /** Calls this process made since start, and today (UTC). */
  used: number;
  usedToday: number;
  day: string;
  /** The provider refused us (daily cap, bad key, suspended plan) until this time. */
  blockedUntil: string | null;
  lastError: string | null;
}

export type Lane = 'everyday' | 'backfill';

export class QuotaExhausted extends Error {
  constructor(public readonly remaining: number | null, public readonly floor: number, message?: string) {
    super(message ?? `API-Football quota floor reached (${remaining ?? '?'} left, floor ${floor})`);
  }
}
export class ApiFootballError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export interface ApiFootballOptions {
  key: string;
  base?: string;
  /** Floor for everyday jobs: stop when this many requests or fewer are left today. */
  reserve?: number;
  /** Floor for the history backfill. */
  backfillReserve?: number;
  /**
   * Requests an hour the everyday jobs (and the Plaibook app) may need. When set, the backfill floor comes down as the
   * UTC day runs out: it only has to leave `reserve` plus what the rest of the day needs (at least `backfillMargin`),
   * never more than `backfillReserve`. 0 keeps the backfill floor fixed.
   */
  everydayPerHour?: number;
  backfillMargin?: number;
  /** Our own pace, requests per minute (the plan allows 300; the Plaibook app takes up to 60). */
  perMinute?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  userAgent?: string;
}

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const nextUtcMidnight = (ms: number) => { const d = new Date(ms); d.setUTCHours(24, 0, 0, 0); return d.getTime(); };
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The provider answers 200 with an `errors` object for quota and key problems; [] or {} means none. */
export function errorText(errors: unknown): string | null {
  if (!errors) return null;
  if (Array.isArray(errors)) return errors.length ? errors.map(String).join('; ') : null;
  if (typeof errors === 'object') {
    const entries = Object.entries(errors as Record<string, unknown>);
    return entries.length ? entries.map(([k, v]) => `${k}: ${String(v)}`).join('; ') : null;
  }
  return String(errors);
}

export class ApiFootball {
  readonly quota: QuotaState;
  private queue: PQueue;
  private o: Required<Omit<ApiFootballOptions, 'userAgent'>> & { userAgent?: string };
  private statusCheckedAt = 0;

  constructor(opts: ApiFootballOptions) {
    // Unset options (undefined from an empty env var) keep their defaults.
    const given = Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined)) as ApiFootballOptions;
    this.o = { base: API_FOOTBALL_BASE, reserve: 1500, backfillReserve: 2500, everydayPerHour: 0, backfillMargin: 300, perMinute: 120, fetchImpl: fetch, sleep: defaultSleep, now: Date.now, ...given };
    this.queue = new PQueue({ concurrency: 4, interval: 60_000, intervalCap: this.o.perMinute });
    const now = this.o.now();
    this.quota = { remaining: null, limit: null, at: null, used: 0, usedToday: 0, day: utcDay(now), blockedUntil: null, lastError: null };
  }

  floor(lane: Lane): number {
    if (lane !== 'backfill') return this.o.reserve;
    if (!this.o.everydayPerHour) return this.o.backfillReserve;
    // The quota resets at midnight UTC: requests the rest of today's everyday work cannot use would go to waste.
    const now = this.o.now();
    const hoursLeft = (nextUtcMidnight(now) - now) / 3600_000;
    return Math.min(this.o.backfillReserve, this.o.reserve + Math.max(this.o.backfillMargin, Math.ceil(hoursLeft * this.o.everydayPerHour)));
  }

  /** Requests the lane may still spend today (Infinity while the provider has not said). */
  headroom(lane: Lane = 'everyday'): number {
    this.rollDay();
    if (this.blocked()) return 0;
    return this.quota.remaining == null ? Number.POSITIVE_INFINITY : Math.max(0, this.quota.remaining - this.floor(lane));
  }

  private rollDay(): void {
    const day = utcDay(this.o.now());
    if (day !== this.quota.day) {
      // The provider's day restarts at 00:00 UTC; what we knew about yesterday no longer applies.
      this.quota.day = day; this.quota.usedToday = 0; this.quota.remaining = null; this.quota.at = null; this.statusCheckedAt = 0;
      if (this.quota.blockedUntil && Date.parse(this.quota.blockedUntil) <= this.o.now()) this.quota.blockedUntil = null;
    }
  }

  private blocked(): boolean {
    if (!this.quota.blockedUntil) return false;
    if (Date.parse(this.quota.blockedUntil) <= this.o.now()) { this.quota.blockedUntil = null; return false; }
    return true;
  }

  /** /status: today's usage, free of charge. Read at most every 10 minutes while we have no fresher number. */
  async refreshStatus(force = false): Promise<void> {
    const now = this.o.now();
    if (!force && now - this.statusCheckedAt < 10 * 60_000) return;
    this.statusCheckedAt = now;
    try {
      const res = await this.o.fetchImpl(`${this.o.base}/status`, { headers: this.headers(), signal: AbortSignal.timeout(15_000) });
      const body = (await res.json()) as { response?: { requests?: { current?: number; limit_day?: number } } | unknown[] };
      const r = !Array.isArray(body.response) ? body.response?.requests : undefined;
      if (r && Number.isFinite(r.limit_day) && Number.isFinite(r.current)) {
        this.quota.limit = Number(r.limit_day);
        this.quota.remaining = Math.max(0, Number(r.limit_day) - Number(r.current));
        this.quota.at = new Date(now).toISOString();
      }
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, 'api-football status check failed');
    }
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'x-apisports-key': this.o.key, accept: 'application/json' };
    if (this.o.userAgent) h['user-agent'] = this.o.userAgent;
    return h;
  }

  /**
   * GET /<path>?<params>. Throws QuotaExhausted before spending below the lane's floor, ApiFootballError on a
   * provider refusal. Retries 429 / 5xx / network failures (3 attempts).
   */
  async get<T>(path: string, params: Record<string, string | number | undefined | null> = {}, lane: Lane = 'everyday'): Promise<ApiEnvelope<T>> {
    this.rollDay();
    if (this.blocked()) throw new QuotaExhausted(this.quota.remaining, this.floor(lane), `API-Football refused us until ${this.quota.blockedUntil}: ${this.quota.lastError ?? ''}`);
    if (this.quota.remaining == null) await this.refreshStatus();
    const floor = this.floor(lane);
    if (this.quota.remaining != null && this.quota.remaining <= floor) throw new QuotaExhausted(this.quota.remaining, floor);
    const qs = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
    const url = `${this.o.base}/${path.replace(/^\//, '')}${qs ? `?${qs}` : ''}`;
    // Reserve the request before it is queued, so concurrent callers cannot all slip under the floor at once.
    if (this.quota.remaining != null) this.quota.remaining -= 1;
    return this.queue.add(() => this.fetchWithRetry<T>(url)) as Promise<ApiEnvelope<T>>;
  }

  private async fetchWithRetry<T>(url: string): Promise<ApiEnvelope<T>> {
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      let res: Response;
      try {
        res = await this.o.fetchImpl(url, { headers: this.headers(), signal: AbortSignal.timeout(30_000) });
      } catch (err) {
        lastErr = err; await this.o.sleep(2_000 * attempt); continue;
      }
      this.quota.used += 1; this.quota.usedToday += 1;
      this.observe(res.headers);
      if (res.status === 429 || res.status >= 500) {
        lastErr = new ApiFootballError(res.status, `HTTP ${res.status} for ${url}`);
        const ra = Number(res.headers.get('retry-after'));
        await this.o.sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 5_000 * attempt);
        continue;
      }
      if (!res.ok) throw new ApiFootballError(res.status, `HTTP ${res.status} for ${url}`);
      const body = (await res.json()) as ApiEnvelope<T>;
      const err = errorText(body.errors);
      if (err) {
        this.quota.lastError = err;
        // A spent day, a bad key or a lapsed plan: stop until tomorrow (or an hour, for key/plan trouble).
        if (/request|limit|quota/i.test(err)) this.quota.blockedUntil = new Date(nextUtcMidnight(this.o.now())).toISOString();
        else if (/token|key|subscription|suspend|account/i.test(err)) this.quota.blockedUntil = new Date(this.o.now() + 3600_000).toISOString();
        else if (/rate/i.test(err)) { await this.o.sleep(60_000); continue; }
        throw new ApiFootballError(200, `API-Football: ${err}`);
      }
      // A few endpoints (teams/statistics) answer with one object: it comes back as a list of one.
      const one = body.response as unknown;
      const list = Array.isArray(one) ? one : one && typeof one === 'object' ? [one as T] : [];
      return { response: list, results: Number(body.results) || 0, paging: body.paging ?? { current: 1, total: 1 }, errors: null };
    }
    const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
    this.quota.lastError = msg;
    throw lastErr instanceof ApiFootballError ? lastErr : new ApiFootballError(0, msg);
  }

  private observe(h: Headers): void {
    const rem = Number(h.get('x-ratelimit-requests-remaining'));
    const lim = Number(h.get('x-ratelimit-requests-limit'));
    if (h.get('x-ratelimit-requests-remaining') != null && Number.isFinite(rem)) {
      // Keep the lower of our own count (which already holds back calls still in flight) and the provider's number
      // (which also counts what the Plaibook app spent from the same pool).
      this.quota.remaining = this.quota.remaining == null ? rem : Math.min(this.quota.remaining, rem);
      this.quota.at = new Date(this.o.now()).toISOString();
    }
    if (h.get('x-ratelimit-requests-limit') != null && Number.isFinite(lim)) this.quota.limit = lim;
  }
}
