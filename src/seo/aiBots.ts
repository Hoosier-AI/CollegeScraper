// AI crawler visits and the canonical host.
//
// AiBotCounter: counts requests from AI crawlers (by user agent) in memory and
// sends the totals to the Plaibook hub every few minutes (hub SEO → Overview,
// "AI crawlers"). Never per request, never blocking, and it drops the batch if
// the hub is down: this is analytics, not data.
//
// canonicalRedirect: once PUBLIC_URL is the Stats domain, page requests that
// arrive on the old *.onrender.com host get a 301 to the same path there, so
// search engines move their rankings. /api, /v1 and /health keep answering on
// both hosts (API customers and Render's health check use them).

/** Same names the hub accepts (hub src/lib/seo/traffic.ts AI_BOTS). */
export const AI_BOT_NAMES = [
  'GPTBot', 'OAI-SearchBot', 'ChatGPT-User',
  'ClaudeBot', 'Claude-SearchBot', 'Claude-User',
  'PerplexityBot', 'Perplexity-User',
  'CCBot', 'Applebot-Extended', 'Bytespider', 'Amazonbot', 'meta-externalagent',
] as const;

export function classifyAiBot(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null;
  const ua = userAgent.toLowerCase();
  return AI_BOT_NAMES.find((b) => ua.includes(b.toLowerCase())) ?? null;
}

type Post = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number }>;

export class AiBotCounter {
  private counts = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly opts: { url: string | null; secret: string | null; site?: 'stats'; everyMs?: number; post?: Post; onError?: (msg: string) => void },
  ) {}

  get enabled(): boolean {
    return !!(this.opts.url && this.opts.secret);
  }

  hit(userAgent: string | null | undefined): string | null {
    const bot = classifyAiBot(userAgent);
    if (bot && this.enabled) this.counts.set(bot, (this.counts.get(bot) ?? 0) + 1);
    return bot;
  }

  /** Sends and clears what has been counted. Returns how many bot rows were sent. */
  async flush(): Promise<number> {
    if (!this.enabled || !this.counts.size) return 0;
    const hits = [...this.counts].map(([bot, count]) => ({ site: this.opts.site ?? 'stats', bot, count }));
    this.counts.clear();
    const post = this.opts.post ?? (fetch as unknown as Post);
    try {
      const res = await post(this.opts.url!, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.opts.secret}`, 'content-type': 'application/json' },
        body: JSON.stringify({ hits }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) this.opts.onError?.(`hub answered ${res.status}`);
    } catch (err) {
      this.opts.onError?.(err instanceof Error ? err.message : 'send failed');
    }
    return hits.length;
  }

  start(): void {
    if (!this.enabled || this.timer) return;
    this.timer = setInterval(() => void this.flush(), this.opts.everyMs ?? 5 * 60_000);
    this.timer.unref();
  }
}

/**
 * The 301 target for a request, or null to serve it here. Only page requests on
 * a *.onrender.com host move, and only when PUBLIC_URL names a different host.
 */
export function canonicalRedirect(publicUrl: string | null | undefined, host: string | null | undefined, url: string): string | null {
  if (!publicUrl || !host) return null;
  let target: URL;
  try { target = new URL(publicUrl); } catch { return null; }
  const reqHost = host.toLowerCase().split(':')[0] ?? '';
  if (!reqHost.endsWith('.onrender.com') || reqHost === target.hostname.toLowerCase()) return null;
  if (/^\/(api|v1|health)(\/|$|\?)/.test(url)) return null;
  return `${target.origin}${url.startsWith('/') ? url : `/${url}`}`;
}
