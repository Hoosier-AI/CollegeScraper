// Minimal robots.txt reader: fetches once per host, honours Disallow / Allow and Crawl-delay for "*" and our UA token.
// As RFC 9309 asks: a missing robots.txt (4xx) allows everything; one that cannot be reached (5xx, timeout, network
// error) disallows the whole site for a while, then is read again. An API host that answers every path, robots.txt
// included, with a JSON error (NCAA's sdataprod GraphQL endpoint: a JSON 500) has no robots.txt at all: treated as
// missing, not as unreachable (2026-10-15: the strict rule stopped live college scores).
import type { RobotsPolicy } from './client.js';
import { fetch as undiciFetch } from 'undici';

interface Rules { disallow: string[]; allow: string[]; delayMs?: number; until?: number }

/** Longest Crawl-delay we honour (a site asking for more gets this). */
export const MAX_CRAWL_DELAY_MS = 10_000;
/** How long an unreachable robots.txt keeps a site off-limits before we try it again. */
export const UNREACHABLE_RETRY_MS = 10 * 60_000;

export class RobotsCache implements RobotsPolicy {
  private rules = new Map<string, Promise<Rules>>();
  private loaded = new Map<string, Rules>();
  constructor(private userAgent: string, private fetchImpl: typeof undiciFetch = undiciFetch, private now: () => number = Date.now) {}

  async allowed(url: string): Promise<boolean> {
    const u = new URL(url);
    const key = u.origin;
    let p = this.rules.get(key);
    const seen = this.loaded.get(key);
    if (!p || (seen?.until != null && this.now() > seen.until)) {
      p = this.load(u.origin).then((r) => { this.loaded.set(key, r); return r; });
      this.rules.set(key, p);
    }
    const r = await p;
    const path = u.pathname + u.search;
    const match = (list: string[]) => list.filter((d) => d && ruleMatches(d, path)).sort((a, b) => b.length - a.length)[0] ?? null;
    const dis = match(r.disallow);
    const allow = match(r.allow);
    if (!dis) return true;
    return !!allow && allow.length >= dis.length;
  }

  crawlDelayMs(url: string): number | undefined {
    return this.loaded.get(new URL(url).origin)?.delayMs;
  }

  private async load(origin: string): Promise<Rules> {
    const offLimits = (): Rules => ({ disallow: ['/'], allow: [], until: this.now() + UNREACHABLE_RETRY_MS });
    try {
      const res = await this.fetchImpl(`${origin}/robots.txt`, { headers: { 'user-agent': this.userAgent }, signal: AbortSignal.timeout(10_000) });
      if (res.status >= 500) return /json/i.test(res.headers.get('content-type') ?? '') ? { disallow: [], allow: [] } : offLimits();
      if (!res.ok) return { disallow: [], allow: [] };
      return parseRobots(await res.text(), this.userAgent);
    } catch {
      return offLimits();
    }
  }
}

/**
 * A robots.txt rule against a path: a prefix, where "*" stands for any run of characters and a final "$" ends the
 * path (Wikidata allows "/wiki/Special:EntityData/*." under a Disallow of "/wiki/Special:EntityData/"). The longest
 * matching rule wins, as before.
 */
export function ruleMatches(rule: string, path: string): boolean {
  if (!rule.includes('*') && !rule.endsWith('$')) return path.startsWith(rule);
  const anchored = rule.endsWith('$');
  const body = (anchored ? rule.slice(0, -1) : rule).split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`).test(path);
}

export function parseRobots(text: string, userAgent: string): Rules {
  // Our identifier is the last product token ("PlaibookCollege/1.0"), not the browser-compatible prefix.
  const token = (userAgent.match(/plaibook[a-z]*/i)?.[0] ?? userAgent.split('/')[0] ?? '').toLowerCase();
  const groups: { agents: string[]; disallow: string[]; allow: string[]; delay?: number }[] = [];
  let current: { agents: string[]; disallow: string[]; allow: string[]; delay?: number } | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) { current = { agents: [], disallow: [], allow: [] }; groups.push(current); }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === 'disallow') current.disallow.push(value);
    else if (field === 'allow') current.allow.push(value);
    else if (field === 'crawl-delay' && Number(value) > 0) current.delay = Number(value);
  }
  const specific = groups.find((g) => g.agents.some((a) => a !== '*' && token.includes(a)));
  const star = groups.find((g) => g.agents.includes('*'));
  const g = specific ?? star;
  if (!g) return { disallow: [], allow: [] };
  return { disallow: g.disallow, allow: g.allow, ...(g.delay ? { delayMs: Math.min(MAX_CRAWL_DELAY_MS, Math.round(g.delay * 1000)) } : {}) };
}
