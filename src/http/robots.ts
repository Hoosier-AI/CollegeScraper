// Minimal robots.txt reader: fetches once per host, honours Disallow for "*" and our UA token.
import type { RobotsPolicy } from './client.js';
import { fetch as undiciFetch } from 'undici';

interface Rules { disallow: string[]; allow: string[] }

export class RobotsCache implements RobotsPolicy {
  private rules = new Map<string, Promise<Rules>>();
  constructor(private userAgent: string, private fetchImpl: typeof undiciFetch = undiciFetch) {}

  async allowed(url: string): Promise<boolean> {
    const u = new URL(url);
    const key = u.origin;
    let p = this.rules.get(key);
    if (!p) { p = this.load(u.origin); this.rules.set(key, p); }
    const r = await p;
    const path = u.pathname + u.search;
    const match = (list: string[]) => list.filter((d) => d && path.startsWith(d)).sort((a, b) => b.length - a.length)[0] ?? null;
    const dis = match(r.disallow);
    const allow = match(r.allow);
    if (!dis) return true;
    return !!allow && allow.length >= dis.length;
  }

  private async load(origin: string): Promise<Rules> {
    try {
      const res = await this.fetchImpl(`${origin}/robots.txt`, { headers: { 'user-agent': this.userAgent }, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return { disallow: [], allow: [] };
      return parseRobots(await res.text(), this.userAgent);
    } catch {
      return { disallow: [], allow: [] };
    }
  }
}

export function parseRobots(text: string, userAgent: string): Rules {
  // Our identifier is the last product token ("PlaibookCollege/1.0"), not the browser-compatible prefix.
  const token = (userAgent.match(/plaibook[a-z]*/i)?.[0] ?? userAgent.split('/')[0] ?? '').toLowerCase();
  const groups: { agents: string[]; disallow: string[]; allow: string[] }[] = [];
  let current: { agents: string[]; disallow: string[]; allow: string[] } | null = null;
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
  }
  const specific = groups.find((g) => g.agents.some((a) => a !== '*' && token.includes(a)));
  const star = groups.find((g) => g.agents.includes('*'));
  const g = specific ?? star;
  return g ? { disallow: g.disallow, allow: g.allow } : { disallow: [], allow: [] };
}
