// Requests per day, source and host for the pro crawl's sites (the hub's Crawling page). The HTTP clients call
// recordRequest for every attempt; counts are held in memory and added to pro_source_requests every 30 s
// (migration 147). Only the pro sources are counted: college traffic has its own fetch log.
import type { Db } from '../db/client.js';
import { log } from '../log.js';

export type SourceId = 'api-football' | 'asa' | 'wikipedia' | 'wikidata' | 'openfootball' | 'football-data'
  // International (national teams): martj42's results, openfootball's World Cups, Fjelstul's World Cup database, RSSSF.
  | 'intl-results' | 'openfootball-wc' | 'worldcup-db' | 'rsssf'
  // News (src/news).
  | 'news-schools' | 'news-publishers' | 'gdelt' | 'guardian' | 'news-clubs';

// News feeds (src/news/feeds.ts): publisher hosts, and the club and federation feed hosts found by news-discover
// (set by the news jobs as they read them).
// NCAA.com only for its news feeds: its other hosts (sdataprod, data APIs) are the college crawl.
const PUBLISHER_HOSTS = /(^|\.)(bbci\.co\.uk|espn\.com|topdrawersoccer\.com|socceramerica\.com|unitedsoccercoaches\.org|equalizersoccer\.com|cbssports\.com|sports\.yahoo\.com|skysports\.com)$/;
const newsHosts = new Set<string>();
export function setNewsHosts(urls: string[]): void { for (const u of urls) { try { newsHosts.add(new URL(u).host.toLowerCase()); } catch { /* skip */ } } }

/** Which pro source a URL belongs to; null for everything else (college sites, NCAA). */
export function sourceOfUrl(url: string): { source: SourceId; host: string } | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const host = u.host.toLowerCase();
  if (host.endsWith('api-sports.io')) return { source: 'api-football', host };
  if (host.endsWith('americansocceranalysis.com')) return { source: 'asa', host };
  if (host === 'en.wikipedia.org') return { source: 'wikipedia', host };
  if (host === 'www.wikidata.org') return { source: 'wikidata', host };
  if (host === 'raw.githubusercontent.com' && u.pathname.startsWith('/openfootball/worldcup')) return { source: 'openfootball-wc', host };
  if (host === 'raw.githubusercontent.com' && u.pathname.startsWith('/openfootball/')) return { source: 'openfootball', host };
  if (host === 'raw.githubusercontent.com' && u.pathname.startsWith('/martj42/')) return { source: 'intl-results', host };
  if (host === 'raw.githubusercontent.com' && u.pathname.startsWith('/jfjelstul/')) return { source: 'worldcup-db', host };
  if (host === 'www.rsssf.org' || host === 'rsssf.org') return { source: 'rsssf', host };
  if (host.endsWith('football-data.co.uk')) return { source: 'football-data', host };
  if (host === 'api.gdeltproject.org') return { source: 'gdelt', host };
  if (host === 'content.guardianapis.com') return { source: 'guardian', host };
  if (u.pathname === '/api/v2/rss/xml') return { source: 'news-schools', host };
  if (PUBLISHER_HOSTS.test(host) || (host === 'www.ncaa.com' && u.pathname.startsWith('/news/'))) return { source: 'news-publishers', host };
  if (newsHosts.has(host)) return { source: 'news-clubs', host };
  return null;
}

export interface RequestEvent { url: string; ok: boolean; status: number; bytes?: number; notModified?: boolean; error?: string | null }

type Tally = { day: string; source: SourceId; host: string; requests: number; errors: number; not_modified: number; bytes: number; last_at: string; last_error: string | null };
const pending = new Map<string, Tally>();

export function recordRequest(e: RequestEvent, now = new Date()): void {
  const s = sourceOfUrl(e.url);
  if (!s) return;
  const day = now.toISOString().slice(0, 10);
  const k = `${day}|${s.source}|${s.host}`;
  const t = pending.get(k) ?? { day, ...s, requests: 0, errors: 0, not_modified: 0, bytes: 0, last_at: now.toISOString(), last_error: null };
  t.requests += 1;
  // A 404 is an answer ("not published"), not a failure: openfootball and Wikipedia have seasons they never kept.
  if (!e.ok && e.status !== 404) { t.errors += 1; t.last_error = (e.error ?? `HTTP ${e.status}`).slice(0, 300); }
  if (e.notModified) t.not_modified += 1;
  t.bytes += e.bytes ?? 0;
  t.last_at = now.toISOString();
  pending.set(k, t);
}

/** What has not been written yet (tests and the flush). */
export function pendingRequests(): Tally[] { return [...pending.values()]; }

export async function flushRequests(db: Db): Promise<number> {
  if (!pending.size) return 0;
  const rows = [...pending.values()];
  pending.clear();
  const { error } = await db.rpc('pro_source_requests_add', { p_rows: rows });
  if (error) {
    // Put them back so the next flush tries again (counts are additive, so nothing is double counted).
    for (const r of rows) { const k = `${r.day}|${r.source}|${r.host}`; const t = pending.get(k); if (t) { t.requests += r.requests; t.errors += r.errors; t.not_modified += r.not_modified; t.bytes += r.bytes; } else pending.set(k, r); }
    log.warn({ err: error.message }, 'source request counts not saved');
    return 0;
  }
  return rows.length;
}

let timer: NodeJS.Timeout | null = null;
/** Flush every 30 s for the life of the process (the server starts it once). */
export function startRequestFlush(db: Db, everyMs = 30_000): void {
  if (timer) return;
  timer = setInterval(() => { void flushRequests(db); }, everyMs);
  timer.unref();
}
