// Polite HTTP client: per-host rate limit, global concurrency, identifying UA, conditional
// requests through a pluggable cache store, retries with backoff. Records every fetch.
import PQueue from 'p-queue';
import { fetch as undiciFetch, type Response } from 'undici';
import { createHash } from 'node:crypto';
import type { Fetcher, HttpResponseLike } from '../model.js';
import { log } from '../log.js';
import { meterFetch } from '../ops/netMeter.js';

export interface FetchRecord {
  url: string;
  host: string;
  status: number;
  etag: string | null;
  lastModified: string | null;
  fetchedAt: string;
  contentSha: string | null;
  error: string | null;
  attempts: number;
}

export interface FetchCacheStore {
  /** Return the last successful record + body for a URL (used for conditional requests and offline replay). */
  get(url: string): Promise<{ record: FetchRecord; body: string | null } | null>;
  /** `body` undefined keeps the stored body: the page did not change, so only the record is written. Re-sending
   * unchanged pages (up to ~1 MB each) to the database was most of the service's Render bandwidth (2026-11-02). */
  put(record: FetchRecord, body: string | null | undefined): Promise<void>;
}

export class MemoryFetchCache implements FetchCacheStore {
  private map = new Map<string, { record: FetchRecord; body: string | null }>();
  async get(url: string) { return this.map.get(url) ?? null; }
  async put(record: FetchRecord, body: string | null | undefined) {
    this.map.set(record.url, { record, body: body === undefined ? this.map.get(record.url)?.body ?? null : body });
  }
}

export interface RobotsPolicy {
  allowed(url: string): Promise<boolean>;
  /** The site's Crawl-delay in ms (capped), once its robots.txt has been read; undefined when none. */
  crawlDelayMs?(url: string): number | undefined;
}

export interface HttpClientOptions {
  userAgent: string;
  /** Sent as the From: header so site operators can reach us. */
  contactEmail?: string;
  perHostRps?: number;
  globalConcurrency?: number;
  timeoutMs?: number;
  maxAttempts?: number;
  cache?: FetchCacheStore;
  robots?: RobotsPolicy;
  /** Freshness window: a cached 200 younger than this is served without a network call. */
  freshMs?: number;
  fetchImpl?: typeof undiciFetch;
  sleep?: (ms: number) => Promise<void>;
  /** Why a URL must never be fetched (sites we agreed not to crawl, src/http/doNotCrawl.ts), or null. */
  refuse?: (url: string) => string | null;
  /** Sees every page that came back 2xx (a Presto page adds its host to the do-not-crawl list). */
  onBody?: (url: string, text: string) => void;
  /** Called once per network attempt (the pro sources' request counts, src/ops/sourceRequests.ts). */
  onRequest?: (e: { url: string; ok: boolean; status: number; bytes?: number; notModified?: boolean; error?: string | null }) => void;
}

export class HttpError extends Error {
  constructor(public readonly status: number, public readonly url: string, message?: string) {
    super(message ?? `HTTP ${status} for ${url}`);
  }
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** The longest a server's Retry-After is honoured for (see backoff). */
const RETRY_AFTER_CAP_MS = 120_000;
const MAX_REDIRECTS = 5;

export interface HostStats { requests: number; errors: number; status429: number; lastError: string | null; lastErrorAt: string | null }
export interface HttpStats { requests: number; cacheHits: number; notModified: number; errors: number; status429: number; robotsBlocked: number; byHost: Map<string, HostStats> }

export class HttpClient implements Fetcher {
  private hostQueues = new Map<string, PQueue>();
  private global: PQueue;
  private opts: Required<Omit<HttpClientOptions, 'cache' | 'robots' | 'contactEmail' | 'onRequest' | 'refuse' | 'onBody'>> & Pick<HttpClientOptions, 'cache' | 'robots' | 'contactEmail' | 'onRequest' | 'refuse' | 'onBody'>;
  /** Process-wide counters (one client per process): totals plus a per-host breakdown the console shows. */
  public stats: HttpStats = { requests: 0, cacheHits: 0, notModified: 0, errors: 0, status429: 0, robotsBlocked: 0, byHost: new Map() };
  private hostStat(host: string): HostStats { let h = this.stats.byHost.get(host); if (!h) { h = { requests: 0, errors: 0, status429: 0, lastError: null, lastErrorAt: null }; this.stats.byHost.set(host, h); } return h; }

  constructor(options: HttpClientOptions) {
    this.opts = {
      contactEmail: undefined,
      perHostRps: 1,
      globalConcurrency: 8,
      timeoutMs: 20_000,
      maxAttempts: 4,
      freshMs: 0,
      fetchImpl: meterFetch(undiciFetch),
      sleep: defaultSleep,
      ...options,
    };
    this.global = new PQueue({ concurrency: this.opts.globalConcurrency });
  }

  private queueFor(host: string, delayMs = 0): PQueue {
    let q = this.hostQueues.get(host);
    if (!q) {
      // One request at a time per host, no faster than perHostRps, and slower when the site's robots.txt asks.
      q = new PQueue({ concurrency: 1, interval: Math.max(Math.ceil(1000 / this.opts.perHostRps), delayMs), intervalCap: 1 });
      this.hostQueues.set(host, q);
    }
    return q;
  }

  /** `freshMs` per call overrides the client default: a stored body younger than that is served without a request.
   * `priority` orders waiting work on the shared per-host queue (higher first); the live lane uses it so a scoreboard
   * tick is never stuck behind a long crawl on the same host. */
  async get(url: string, o: { accept?: string; skipCache?: boolean; attempts?: number; freshMs?: number; priority?: number; noStore?: boolean; documentedApi?: boolean; userAgent?: string } = {}): Promise<HttpResponseLike> {
    const host = new URL(url).host;
    // Before anything else, the cache included: a site we agreed not to crawl gets no request at all.
    const refused = this.opts.refuse?.(url);
    if (refused) throw new HttpError(451, url, `do not crawl: ${refused}`);
    const cached = o.skipCache ? null : await this.opts.cache?.get(url);
    const freshMs = o.freshMs ?? this.opts.freshMs;
    if (cached?.body != null && freshMs > 0 && Date.now() - Date.parse(cached.record.fetchedAt) < freshMs) {
      this.stats.cacheHits += 1;
      return { status: cached.record.status, url, text: cached.body, notModified: true };
    }
    // `documentedApi`: a public API whose owner documents programmatic use (api.weather.gov asks only for an
    // identifying User-Agent); its robots.txt exists to keep search engines out and is not addressed to API clients.
    if (this.opts.robots && !o.documentedApi && !(await this.opts.robots.allowed(url))) {
      this.stats.robotsBlocked += 1;
      throw new HttpError(999, url, `robots.txt disallows ${url}`);
    }
    const priority = o.priority ?? 0;
    const delayMs = o.documentedApi ? 0 : this.opts.robots?.crawlDelayMs?.(url) ?? 0;
    return this.global.add(() => this.queueFor(host, delayMs).add(() => this.fetchWithRetry(url, host, o.accept, cached ?? null, o.attempts, o.noStore, o.userAgent), { priority }), { priority }) as Promise<HttpResponseLike>;
  }

  private async fetchWithRetry(url: string, host: string, accept: string | undefined, cached: { record: FetchRecord; body: string | null } | null, maxAttempts = this.opts.maxAttempts, noStore = false, userAgent?: string): Promise<HttpResponseLike> {
    let attempt = 0;
    let lastErr: unknown = null;
    while (attempt < maxAttempts) {
      attempt += 1;
      this.stats.requests += 1;
      const hs = this.hostStat(host); hs.requests += 1;
      const headers: Record<string, string> = {
        'user-agent': userAgent ?? this.opts.userAgent,
        accept: accept ?? 'text/html,application/json;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
      };
      if (this.opts.contactEmail) headers.from = this.opts.contactEmail;
      if (cached?.body != null && cached.record.etag) headers['if-none-match'] = cached.record.etag;
      if (cached?.body != null && cached.record.lastModified) headers['if-modified-since'] = cached.record.lastModified;
      let res: Response;
      try {
        res = await this.fetchFollowing(url, headers);
      } catch (err) {
        // A redirect to a site we agreed not to crawl is final: no retry, no backoff.
        if (err instanceof HttpError && err.status === 451) throw err;
        lastErr = err;
        this.stats.errors += 1; hs.errors += 1; hs.lastError = err instanceof Error ? err.message : String(err); hs.lastErrorAt = new Date().toISOString();
        this.opts.onRequest?.({ url, ok: false, status: 0, error: hs.lastError });
        if (attempt < maxAttempts) await this.backoff(attempt, null);
        continue;
      }
      if (res.status === 304 && cached?.body != null) {
        this.stats.notModified += 1;
        this.opts.onRequest?.({ url, ok: true, status: 304, notModified: true });
        await this.opts.cache?.put({ ...cached.record, fetchedAt: new Date().toISOString(), attempts: attempt }, undefined);
        return { status: 200, url: res.url || url, text: cached.body, notModified: true };
      }
      const text = await res.text();
      // PrestoSports answers 202 with an empty body while a page is being generated.
      const transient = res.status === 429 || res.status >= 500 || (res.status === 202 && text.trim().length === 0);
      this.opts.onRequest?.({ url, ok: res.ok && !transient, status: res.status, bytes: text.length });
      if (transient) {
        lastErr = new HttpError(res.status, url);
        this.stats.errors += 1; hs.errors += 1; hs.lastError = `HTTP ${res.status}`; hs.lastErrorAt = new Date().toISOString();
        if (res.status === 429) { this.stats.status429 += 1; hs.status429 += 1; }
        // No wait after the last attempt: it only held the queue (a whole Retry-After) before failing anyway.
        if (attempt < maxAttempts) await this.backoff(attempt, res.headers.get('retry-after'));
        continue;
      }
      const record: FetchRecord = {
        url, host, status: res.status,
        etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified'),
        fetchedAt: new Date().toISOString(),
        contentSha: createHash('sha256').update(text).digest('hex'),
        error: res.ok ? null : `HTTP ${res.status}`,
        attempts: attempt,
      };
      // Most school sites answer 200 every time (no ETag): the same page as stored keeps its stored body.
      const unchanged = cached?.body != null && cached.record.contentSha === record.contentSha;
      if (!noStore) await this.opts.cache?.put(record, !res.ok ? null : unchanged ? undefined : text);
      if (!res.ok) throw new HttpError(res.status, url);
      this.opts.onBody?.(res.url || url, text);
      return { status: res.status, url: res.url || url, text, notModified: false };
    }
    const err = lastErr instanceof Error ? lastErr : new Error(String(lastErr));
    log.warn({ url, attempts: attempt, err: err.message }, 'fetch failed after retries');
    if (lastErr instanceof HttpError) throw lastErr;
    throw new HttpError(0, url, err.message);
  }

  private async backoff(attempt: number, retryAfter: string | null): Promise<void> {
    let ms = Math.min(60_000, 2_000 * 2 ** (attempt - 1));
    if (retryAfter) {
      // Honoured up to a ceiling. The wait is spent inside this host's queue AND one of the eight global slots, so a
      // single `Retry-After: 3600` parked a slot for an hour per attempt; eight of them stopped all crawling.
      const n = Number(retryAfter);
      if (Number.isFinite(n) && n > 0) ms = Math.min(RETRY_AFTER_CAP_MS, Math.max(ms, n * 1000));
    }
    await this.opts.sleep(ms);
  }

  /**
   * One network attempt, following redirects by hand so every hop is checked against the do-not-crawl list. With
   * `redirect: 'follow'` only the first URL was checked: a school site that redirects to a host we agreed not to
   * request was followed there on every crawl.
   */
  private async fetchFollowing(url: string, headers: Record<string, string>): Promise<Response> {
    let current = url;
    for (let hop = 0; ; hop += 1) {
      const res = await this.opts.fetchImpl(current, { headers, redirect: 'manual', signal: AbortSignal.timeout(this.opts.timeoutMs) });
      const location = res.status >= 300 && res.status < 400 && res.status !== 304 ? res.headers.get('location') : null;
      if (!location) return res;
      if (hop >= MAX_REDIRECTS) throw new HttpError(0, url, `too many redirects from ${url}`);
      let next: string;
      try { next = new URL(location, current).toString(); } catch { throw new HttpError(0, url, `bad redirect from ${current}`); }
      if (!/^https?:/i.test(next)) throw new HttpError(0, url, `redirect to a non-web address from ${current}`);
      const refused = this.opts.refuse?.(next);
      if (refused) throw new HttpError(451, url, `do not crawl: ${refused} (redirect from ${current})`);
      try { await res.body?.cancel(); } catch { /* nothing to release */ }
      current = next;
    }
  }
}

export function contentSha(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
