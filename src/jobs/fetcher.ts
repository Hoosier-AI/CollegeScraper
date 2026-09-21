import { loadConfig } from '../config.js';
import { HttpClient, type HostStats } from '../http/client.js';
import { RobotsCache } from '../http/robots.js';
import { DbFetchCache, type Db } from '../db/client.js';
import type { Fetcher } from '../model.js';

let shared: HttpClient | null = null;

/** One process-wide client so per-host rate limits hold across jobs. */
export function makeFetcher(db: Db, opts: { freshMs?: number } = {}): HttpClient {
  if (shared) return shared;
  const cfg = loadConfig();
  shared = new HttpClient({
    userAgent: cfg.userAgent,
    contactEmail: cfg.contactEmail,
    perHostRps: cfg.CRAWL_PER_HOST_RPS,
    globalConcurrency: cfg.CRAWL_GLOBAL_CONCURRENCY,
    cache: new DbFetchCache(db),
    robots: new RobotsCache(cfg.userAgent),
    freshMs: opts.freshMs ?? 0,
  });
  return shared;
}

export function resetFetcher(): void { shared = null; }

/** The same client, with every request queued ahead of ordinary crawl traffic on its host (the live lane). */
export function withPriority(f: Fetcher, priority: number): Fetcher {
  return { get: (url, o = {}) => f.get(url, { ...o, priority: o.priority ?? priority }) };
}

/** Process-wide fetch counters for the console; null before the first job created the client. */
export function getFetcherStats(): { totals: Omit<HttpClient['stats'], 'byHost'>; hosts: ({ host: string } & HostStats)[] } | null {
  if (!shared) return null;
  const { byHost, ...totals } = shared.stats;
  return { totals, hosts: [...byHost.entries()].map(([host, h]) => ({ host, ...h })).sort((a, b) => b.requests - a.requests) };
}
