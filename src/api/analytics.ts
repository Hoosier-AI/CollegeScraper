// First-party, cookie-free analytics for the Stats site: page views per page, referrer host and device per day, a
// daily count of distinct visitors, and site searches (with the ones that found nothing). The viewer sends a beacon
// to /api/t on every page change; bots and the owner (an admin token in the browser) are not counted.
//
// Nothing personal is stored. A visitor is a hash of IP, user agent, the day and a salt that only lives in this
// process's memory, kept for the day to count distinct visitors; only the count reaches the database. Counted in
// memory and written once a minute through stats_analytics_add (migration 163), like the API usage meter.
import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '../db/client.js';
import { log } from '../log.js';

export type Section = 'college' | 'pro' | 'other';
export interface PageKind { group: string; section: Section; /** False when the address carries no page of its own (lists). */ keep: boolean }

/** Every page of the viewer as a template, from ui/src/main.tsx. Anything else is counted as "other" without its address. */
const PAGES: [RegExp, string, Section][] = [
  // The one home page for every area (2026-10-14).
  [/^\/$/, 'Home', 'other'],
  [/^\/teams$/, 'College teams', 'college'],
  [/^\/teams\/[^/]+(\/[mw])?$/, 'College team', 'college'],
  [/^\/matches$/, 'College matches', 'college'],
  [/^\/matches\/[^/]+$/, 'College match', 'college'],
  [/^\/conferences$/, 'College conferences', 'college'],
  [/^\/conferences\/[^/]+$/, 'College conference', 'college'],
  [/^\/players$/, 'College players', 'college'],
  [/^\/leaders$/, 'College leaders', 'college'],
  [/^\/transfers$/, 'College transfers', 'college'],
  [/^\/compare$/, 'College compare', 'college'],
  [/^\/h2h$/, 'College head to head', 'college'],
  [/^\/coaches\/[^/]+$/, 'College coach', 'college'],
  [/^\/players\/[^/]+$/, 'College player', 'college'],
  [/^\/rankings$/, 'College rankings', 'college'],
  [/^\/search$/, 'Search', 'college'],
  [/^\/news$/, 'College news', 'college'],
  [/^\/pro\/matches$/, 'Pro matches', 'pro'],
  [/^\/pro\/matches\/[^/]+$/, 'Pro match', 'pro'],
  [/^\/pro\/leagues$/, 'Pro leagues', 'pro'],
  [/^\/pro\/leagues\/[^/]+$/, 'Pro league', 'pro'],
  [/^\/pro\/teams$/, 'Pro teams', 'pro'],
  [/^\/pro\/teams\/[^/]+$/, 'Pro team', 'pro'],
  [/^\/pro\/rankings$/, 'Pro rankings', 'pro'],
  [/^\/pro\/h2h$/, 'Pro head to head', 'pro'],
  [/^\/pro\/coaches\/[^/]+$/, 'Pro coach', 'pro'],
  [/^\/pro\/players$/, 'Pro players', 'pro'],
  [/^\/pro\/players\/[^/]+$/, 'Pro player', 'pro'],
  [/^\/pro\/leaders$/, 'Pro leaders', 'pro'],
  [/^\/pro\/countries$/, 'Pro countries', 'pro'],
  [/^\/pro\/countries\/[^/]+$/, 'Pro country', 'pro'],
  [/^\/pro\/compare$/, 'Pro compare', 'pro'],
  [/^\/pro\/transfers$/, 'Pro transfers', 'pro'],
  [/^\/pro\/college$/, 'College to Pro', 'pro'],
  [/^\/pro\/abroad$/, 'Americans abroad', 'pro'],
  [/^\/pro\/sources$/, 'Pro sources', 'pro'],
  [/^\/pro\/news$/, 'Pro news', 'pro'],
  [/^\/intl\/news$/, 'International news', 'pro'],
  [/^\/intl\/matches(\/[^/]+)?$/, 'International match', 'pro'],
  [/^\/intl\/tournaments(\/[^/]+)?$/, 'International tournament', 'pro'],
  [/^\/intl\/teams(\/[^/]+)?$/, 'International team', 'pro'],
  [/^\/intl\/players(\/[^/]+)?$/, 'International player', 'pro'],
  [/^\/intl\/leaders$/, 'International leaders', 'pro'],
  [/^\/intl\/(rankings|h2h)$/, 'International rankings', 'pro'],
];
/** Pages that are never counted: the owner's own. */
const SKIP = /^\/(admin|console|jobs|quality)(\/|$)/;

/** The page's address without query, hash or trailing slash, lower-cased; null when it is not a page we count. */
export function normalizePath(raw: string): string | null {
  let p = String(raw ?? '').split(/[?#]/)[0]!.trim().toLowerCase();
  if (!p.startsWith('/')) return null;
  if (p.length > 1) p = p.replace(/\/+$/, '');
  if (p.length > 160 || SKIP.test(p)) return null;
  try { p = decodeURI(p); } catch { /* keep as sent */ }
  return p;
}

export function pageKind(path: string): PageKind {
  for (const [re, group, section] of PAGES) if (re.test(path)) return { group, section, keep: true };
  return { group: 'Other', section: 'other', keep: false };
}

export type Device = 'mobile' | 'tablet' | 'desktop';
export function deviceOf(ua: string | undefined): Device {
  const s = String(ua ?? '');
  if (/ipad|tablet|kindle|silk|playbook|(android(?!.*mobile))/i.test(s)) return 'tablet';
  if (/mobi|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(s)) return 'mobile';
  return 'desktop';
}

/** The referring site's host (no www.), or null for none, our own site or anything unreadable. */
export function referrerHost(ref: string | undefined | null, ownHosts: string[]): string | null {
  if (!ref) return null;
  let host: string;
  try { host = new URL(ref).hostname.toLowerCase(); } catch { return null; }
  host = host.replace(/^www\./, '');
  if (!host || ownHosts.some((h) => host === h || host.endsWith(`.${h}`))) return null;
  // Search engines and social apps send many subdomains (l.facebook.com, lm.facebook.com, news.google.com ...).
  if (/(^|\.)google\.[a-z.]+$/.test(host)) return 'google';
  if (/(^|\.)bing\.com$/.test(host)) return 'bing';
  if (/(^|\.)(facebook|fb)\.com$/.test(host)) return 'facebook';
  if (/(^|\.)instagram\.com$/.test(host)) return 'instagram';
  if (host === 't.co' || /(^|\.)(x|twitter)\.com$/.test(host)) return 'x';
  if (/(^|\.)reddit\.com$/.test(host)) return 'reddit';
  if (/(^|\.)duckduckgo\.com$/.test(host)) return 'duckduckgo';
  if (/(^|\.)(chatgpt\.com|openai\.com)$/.test(host)) return 'chatgpt';
  if (/(^|\.)perplexity\.ai$/.test(host)) return 'perplexity';
  return host.slice(0, 80);
}

/** A search as counted: trimmed, lower-cased, spaces collapsed, at most 80 characters; null when too short. */
export function normalizeQuery(q: string | undefined): string | null {
  const s = String(q ?? '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 80);
  return s.length >= 2 ? s : null;
}

interface Pending { views: Map<string, number>; refs: Map<string, number>; devices: Map<string, number>; visitors: Map<string, { uniques: number; views: number }>; searches: Map<string, { n: number; zero: number }> }
const empty = (): Pending => ({ views: new Map(), refs: new Map(), devices: new Map(), visitors: new Map(), searches: new Map() });
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

export class AnalyticsMeter {
  private p = empty();
  private seen = new Set<string>();
  private seenDay = '';
  private salt = randomBytes(16).toString('hex');
  private timer: NodeJS.Timeout | null = null;
  constructor(private db: Db | null, private ownHosts: string[] = [], private flushMs = 60_000) {}

  /** A page view. Returns false when it was not counted (unknown page, owner page). Bots are filtered by the caller. */
  view(v: { path: string; ref?: string | null; ua?: string; ip?: string }, now = Date.now()): boolean {
    const path = normalizePath(v.path);
    if (!path) return false;
    const day = new Date(now).toISOString().slice(0, 10);
    const kind = pageKind(path);
    bump(this.p.views, `${day}|${kind.keep ? path : '(other)'}|${kind.group}`);
    const host = referrerHost(v.ref, this.ownHosts);
    if (host) bump(this.p.refs, `${day}|${host}`);
    bump(this.p.devices, `${day}|${deviceOf(v.ua)}`);
    if (day !== this.seenDay) { this.seen.clear(); this.seenDay = day; this.salt = randomBytes(16).toString('hex'); }
    const who = createHash('sha256').update(`${this.salt}|${day}|${v.ip ?? ''}|${v.ua ?? ''}`).digest('base64url').slice(0, 22);
    const vis = this.p.visitors.get(day) ?? { uniques: 0, views: 0 };
    vis.views += 1;
    if (!this.seen.has(who)) { this.seen.add(who); vis.uniques += 1; }
    this.p.visitors.set(day, vis);
    return true;
  }

  /** A search the visitor settled on (the viewer sends it once typing stops), with whether anything matched. */
  search(scope: 'college' | 'pro' | 'all', query: string | undefined, results: number, now = Date.now()): boolean {
    const q = normalizeQuery(query);
    if (!q) return false;
    const day = new Date(now).toISOString().slice(0, 10);
    const k = `${day}|${scope}|${q}`;
    const s = this.p.searches.get(k) ?? { n: 0, zero: 0 };
    s.n += 1; if (results <= 0) s.zero += 1;
    this.p.searches.set(k, s);
    return true;
  }

  /** What the next flush would write (tests, and today's numbers before the first flush). */
  pending() {
    const split = (k: string) => k.split('|');
    return {
      views: [...this.p.views].map(([k, n]) => { const [day, path, group] = split(k) as [string, string, string]; return { day, path, group, n }; }),
      refs: [...this.p.refs].map(([k, n]) => { const [day, host] = split(k) as [string, string]; return { day, host, n }; }),
      devices: [...this.p.devices].map(([k, n]) => { const [day, device] = split(k) as [string, string]; return { day, device, n }; }),
      visitors: [...this.p.visitors].map(([day, v]) => ({ day, uniques: v.uniques, views: v.views })),
      searches: [...this.p.searches].map(([k, v]) => { const [day, scope, query] = split(k) as [string, string, string]; return { day, scope, query, n: v.n, zero: v.zero }; }),
    };
  }

  start(): void {
    if (this.timer || !this.db) return;
    this.timer = setInterval(() => { void this.flush(); }, this.flushMs);
    this.timer.unref();
  }

  async flush(): Promise<void> {
    if (!this.db) return;
    const body = this.pending();
    if (!body.views.length && !body.searches.length) return;
    this.p = empty();
    const { error } = await this.db.rpc('stats_analytics_add', { p: body });
    if (error) log.warn({ err: error.message }, 'analytics flush failed');
  }
}
