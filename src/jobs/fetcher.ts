import { loadConfig } from '../config.js';
import { HttpClient } from '../http/client.js';
import { RobotsCache } from '../http/robots.js';
import { DbFetchCache, type Db } from '../db/client.js';

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
