// Polite HTTP client: per-host rate limit, global concurrency, identifying UA, conditional
// requests through a pluggable cache store, retries with backoff. Records every fetch.
import PQueue from 'p-queue';
import { fetch as undiciFetch, type Response } from 'undici';
import { createHash } from 'node:crypto';
import type { Fetcher, HttpResponseLike } from '../model.js';
import { log } from '../log.js';

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
  put(record: FetchRecord, body: string | null): Promise<void>;
}

export class MemoryFetchCache implements FetchCacheStore {
  private map = new Map<string, { record: FetchRecord; body: string | null }>();
  async get(url: string) { return this.map.get(url) ?? null; }
  async put(record: FetchRecord, body: string | null) { this.map.set(record.url, { record, body }); }
}

export interface RobotsPolicy {
  allowed(url: string): Promise<boolean>;
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
}

export class HttpError extends Error {
  constructor(public readonly status: number, public readonly url: string, message?: string) {
    super(message ?? `HTTP ${status} for ${url}`);
  }
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class HttpClient implements Fetcher {
  private hostQueues = new Map<string, PQueue>();
  private global: PQueue;
  private opts: Required<Omit<HttpClientOptions, 'cache' | 'robots' | 'contactEmail'>> & Pick<HttpClientOptions, 'cache' | 'robots' | 'contactEmail'>;
  public stats = { requests: 0, cacheHits: 0, notModified: 0, errors: 0 };

  constructor(options: HttpClientOptions) {
    this.opts = {
      contactEmail: undefined,
      perHostRps: 1,
      globalConcurrency: 8,
      timeoutMs: 20_000,
      maxAttempts: 4,
      freshMs: 0,
      fetchImpl: undiciFetch,
      sleep: defaultSleep,
      ...options,
    };
    this.global = new PQueue({ concurrency: this.opts.globalConcurrency });
  }

  private queueFor(host: string): PQueue {
    let q = this.hostQueues.get(host);
    if (!q) {
      q = new PQueue({ concurrency: 1, interval: Math.ceil(1000 / this.opts.perHostRps), intervalCap: 1 });
      this.hostQueues.set(host, q);
    }
    return q;
  }

  async get(url: string, o: { accept?: string; skipCache?: boolean; attempts?: number } = {}): Promise<HttpResponseLike> {
    const host = new URL(url).host;
    const cached = o.skipCache ? null : await this.opts.cache?.get(url);
    if (cached?.body != null && this.opts.freshMs > 0 && Date.now() - Date.parse(cached.record.fetchedAt) < this.opts.freshMs) {
      this.stats.cacheHits += 1;
      return { status: cached.record.status, url, text: cached.body, notModified: true };
    }
    if (this.opts.robots && !(await this.opts.robots.allowed(url))) {
      throw new HttpError(999, url, `robots.txt disallows ${url}`);
    }
    return this.global.add(() => this.queueFor(host).add(() => this.fetchWithRetry(url, host, o.accept, cached ?? null, o.attempts))) as Promise<HttpResponseLike>;
  }

  private async fetchWithRetry(url: string, host: string, accept: string | undefined, cached: { record: FetchRecord; body: string | null } | null, maxAttempts = this.opts.maxAttempts): Promise<HttpResponseLike> {
    let attempt = 0;
    let lastErr: unknown = null;
    while (attempt < maxAttempts) {
      attempt += 1;
      this.stats.requests += 1;
      const headers: Record<string, string> = {
        'user-agent': this.opts.userAgent,
        accept: accept ?? 'text/html,application/json;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
      };
      if (this.opts.contactEmail) headers.from = this.opts.contactEmail;
      if (cached?.body != null && cached.record.etag) headers['if-none-match'] = cached.record.etag;
      if (cached?.body != null && cached.record.lastModified) headers['if-modified-since'] = cached.record.lastModified;
      let res: Response;
      try {
        res = await this.opts.fetchImpl(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(this.opts.timeoutMs) });
      } catch (err) {
        lastErr = err;
        this.stats.errors += 1;
        await this.backoff(attempt, null);
        continue;
      }
      if (res.status === 304 && cached?.body != null) {
        this.stats.notModified += 1;
        await this.opts.cache?.put({ ...cached.record, fetchedAt: new Date().toISOString(), attempts: attempt }, cached.body);
        return { status: 200, url: res.url || url, text: cached.body, notModified: true };
      }
      const text = await res.text();
      // PrestoSports answers 202 with an empty body while a page is being generated.
      const transient = res.status === 429 || res.status >= 500 || (res.status === 202 && text.trim().length === 0);
      if (transient) {
        lastErr = new HttpError(res.status, url);
        this.stats.errors += 1;
        await this.backoff(attempt, res.headers.get('retry-after'));
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
      await this.opts.cache?.put(record, res.ok ? text : null);
      if (!res.ok) throw new HttpError(res.status, url);
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
      const n = Number(retryAfter);
      if (Number.isFinite(n)) ms = Math.max(ms, n * 1000);
    }
    await this.opts.sleep(ms);
  }
}

export function contentSha(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
