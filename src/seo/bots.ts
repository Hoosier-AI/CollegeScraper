// Verified search crawlers (Googlebot, Bingbot) skip the site rate limiter: a sitemap crawl of ~50k pages must not
// run into a limit sized for people. A User-Agent is trivially forged, so the claim is checked the way Google and
// Microsoft document it: reverse DNS of the address must be one of their crawler hostnames, and that hostname must
// resolve forward to the same address. Results are cached per address for 24 hours.
import { promises as dnsPromises } from 'node:dns';

export type SearchBot = 'google' | 'bing';

/** Which crawler a User-Agent claims to be, if any. */
export function claimedBot(ua: string | undefined | null): SearchBot | null {
  const s = String(ua ?? '');
  if (/Googlebot|Google-InspectionTool|GoogleOther|Storebot-Google|AdsBot-Google/i.test(s)) return 'google';
  if (/bingbot|BingPreview|msnbot|adidxbot/i.test(s)) return 'bing';
  return null;
}

/** Whether a reverse-DNS hostname belongs to that crawler (googlebot.com / google.com; search.msn.com). */
export function hostnameMatches(bot: SearchBot, hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (bot === 'google') return /\.(googlebot|google)\.com$/.test(h);
  return /\.search\.msn\.com$/.test(h);
}

export interface DnsLike {
  reverse(ip: string): Promise<string[]>;
  /** Every address a hostname resolves to (A and AAAA). */
  lookup(hostname: string): Promise<string[]>;
}

export const nodeDns: DnsLike = {
  reverse: (ip) => dnsPromises.reverse(ip),
  lookup: async (host) => (await dnsPromises.lookup(host, { all: true, verbatim: true })).map((a) => a.address),
};

const normIp = (ip: string) => ip.replace(/^::ffff:/i, '').toLowerCase();

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('dns timeout')), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

export class BotVerifier {
  private cache = new Map<string, { ok: boolean; expires: number }>();
  private pending = new Map<string, Promise<boolean>>();
  constructor(private dns: DnsLike = nodeDns, private opts: { ttlMs?: number; failTtlMs?: number; timeoutMs?: number; maxEntries?: number; now?: () => number } = {}) {}

  /** True only for a request whose User-Agent claims Googlebot/Bingbot and whose address proves it. */
  async isVerified(ip: string | undefined | null, ua: string | undefined | null): Promise<boolean> {
    const bot = claimedBot(ua);
    if (!bot || !ip) return false;
    const key = `${bot}|${normIp(ip)}`;
    const now = (this.opts.now ?? Date.now)();
    const hit = this.cache.get(key);
    if (hit && hit.expires > now) return hit.ok;
    const inflight = this.pending.get(key);
    if (inflight) return inflight;
    const p = this.check(bot, normIp(ip)).then((ok) => {
      // A DNS failure is cached briefly so a flaky resolver does not lock a real crawler out for a day.
      this.remember(key, ok, ok ? (this.opts.ttlMs ?? 24 * 3600_000) : (this.opts.failTtlMs ?? 3600_000), now);
      return ok;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, p);
    return p;
  }

  private async check(bot: SearchBot, ip: string): Promise<boolean> {
    const timeout = this.opts.timeoutMs ?? 2000;
    try {
      const names = await withTimeout(this.dns.reverse(ip), timeout);
      const host = names.find((h) => hostnameMatches(bot, h));
      if (!host) return false;
      const addrs = await withTimeout(this.dns.lookup(host), timeout);
      return addrs.some((a) => normIp(a) === ip);
    } catch {
      return false;
    }
  }

  private remember(key: string, ok: boolean, ttl: number, now: number): void {
    this.cache.set(key, { ok, expires: now + ttl });
    const max = this.opts.maxEntries ?? 10_000;
    while (this.cache.size > max) { const k = this.cache.keys().next().value; if (k === undefined) break; this.cache.delete(k); }
  }
}
