// American Soccer Analysis over the shared HttpClient: one request a second per host, retries and backoff. It is a
// documented public API (no robots.txt on its host), so the robots check is skipped. Answers are not kept in the page
// cache (some are close to 1 MB); the parsed rows are what we store.
import type { Fetcher } from '../../model.js';
import { ASA_BASE } from './leagues.js';

export class AsaError extends Error {
  constructor(public readonly status: number, message: string) { super(message); this.name = 'AsaError'; }
}

export class AsaClient {
  /** Requests made by this client (job counters). */
  calls = 0;
  constructor(private readonly f: Fetcher, private readonly base = ASA_BASE) {}

  async get<T>(path: string, params: Record<string, string | number | boolean | undefined | null> = {}): Promise<T[]> {
    const qs = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
    const url = `${this.base}/${path.replace(/^\//, '')}${qs ? `?${qs}` : ''}`;
    this.calls += 1;
    const res = await this.f.get(url, { accept: 'application/json', documentedApi: true, noStore: true, skipCache: true });
    if (res.status !== 200) throw new AsaError(res.status, `ASA HTTP ${res.status} for ${url}`);
    let body: unknown;
    try { body = JSON.parse(res.text); } catch { throw new AsaError(res.status, `ASA answered with something that is not JSON for ${url}`); }
    // An unknown season or filter answers with a message object rather than a list.
    if (!Array.isArray(body)) {
      const msg = body && typeof body === 'object' ? String((body as Record<string, unknown>).message ?? (body as Record<string, unknown>).detail ?? '') : '';
      if (/no data|not found|no results/i.test(msg) || !msg) return [];
      throw new AsaError(res.status, `ASA: ${msg} (${url})`);
    }
    return body as T[];
  }
}
