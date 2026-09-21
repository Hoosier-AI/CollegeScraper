// Requests per principal per day, counted in memory and flushed to college_api_usage once a minute through the
// college_api_usage_add RPC. Principals: a key's name, 'admin', 'anon' (keyless /v1), 'site' (the viewer's own reads).
import type { Db } from '../db/client.js';
import { log } from '../log.js';

export class UsageMeter {
  private counts = new Map<string, { requests: number; limited: number; seen: number }>();
  private timer: NodeJS.Timeout | null = null;
  constructor(private db: Db | null, private flushMs = 60_000) {}

  hit(principal: string, limited = false, now = Date.now()): void {
    const key = `${new Date(now).toISOString().slice(0, 10)}|${principal}`;
    const c = this.counts.get(key) ?? { requests: 0, limited: 0, seen: now };
    c.requests += 1; if (limited) c.limited += 1; c.seen = now;
    this.counts.set(key, c);
  }

  /** What would be flushed, for tests and the console's "today so far" (in-memory, not yet stored). */
  pending(): { day: string; principal: string; requests: number; limited: number; seen: string }[] {
    return [...this.counts].map(([k, c]) => { const [day, principal] = k.split('|') as [string, string]; return { day, principal, requests: c.requests, limited: c.limited, seen: new Date(c.seen).toISOString() }; });
  }

  start(): void {
    if (this.timer || !this.db) return;
    this.timer = setInterval(() => { void this.flush(); }, this.flushMs);
    this.timer.unref();
  }

  async flush(): Promise<void> {
    if (!this.db) return;
    const rows = this.pending(); this.counts.clear();
    for (const r of rows) {
      const { error } = await this.db.rpc('college_api_usage_add', { p_day: r.day, p_principal: r.principal, p_requests: r.requests, p_limited: r.limited, p_seen: r.seen });
      if (error) log.warn({ err: error.message, principal: r.principal }, 'usage flush failed');
    }
  }
}
