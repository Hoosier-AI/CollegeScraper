// Authentication for the public read API: named API keys (COLLEGE_API_KEYS="plaibook:xxxx,other:yyyy") for
// consumers such as Plaibook, plus the admin trigger secret for the internal viewer and job routes.
// Every comparison is constant-time. A small in-memory sliding-window limiter caps requests per key per minute.
import { createHash, timingSafeEqual } from 'node:crypto';

export interface ApiPrincipal { kind: 'admin' | 'key'; name: string }

export interface ApiKey { name: string; key: string }

/** "plaibook:abc123,partner:def456" → [{ name, key }]; blank or malformed entries are ignored. */
export function parseApiKeys(raw: string | undefined | null): ApiKey[] {
  return String(raw ?? '').split(',').map((s) => s.trim()).filter(Boolean).map((entry) => {
    const i = entry.indexOf(':');
    if (i <= 0) return null;
    const name = entry.slice(0, i).trim(), key = entry.slice(i + 1).trim();
    return name && key.length >= 16 ? { name, key } : null;
  }).filter((k): k is ApiKey => !!k);
}

function same(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest(), hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}

/** Reads `Authorization: Bearer <token>` or `X-Api-Key: <token>`. */
export function bearerOf(headers: { authorization?: string | string[]; 'x-api-key'?: string | string[] }): string | null {
  const auth = Array.isArray(headers.authorization) ? headers.authorization[0] : headers.authorization;
  const m = String(auth ?? '').match(/^Bearer\s+(.+)$/i);
  if (m) return m[1]!.trim();
  const x = Array.isArray(headers['x-api-key']) ? headers['x-api-key'][0] : headers['x-api-key'];
  return x ? String(x).trim() : null;
}

export function makeAuthenticator(opts: { adminSecret?: string | null; keys: ApiKey[] }): (token: string | null) => ApiPrincipal | null {
  return (token) => {
    if (!token) return null;
    if (opts.adminSecret && same(token, opts.adminSecret)) return { kind: 'admin', name: 'admin' };
    for (const k of opts.keys) if (same(token, k.key)) return { kind: 'key', name: k.name };
    return null;
  };
}

/** Sliding-window limiter: at most `limit` hits per `windowMs` per principal name. */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private limit: number, private windowMs = 60_000) {}
  /** Returns { ok, remaining, resetMs }. */
  take(name: string, now = Date.now()): { ok: boolean; remaining: number; resetMs: number } {
    const cutoff = now - this.windowMs;
    const list = (this.hits.get(name) ?? []).filter((t) => t > cutoff);
    const ok = list.length < this.limit;
    if (ok) list.push(now);
    this.hits.set(name, list);
    const oldest = list[0] ?? now;
    return { ok, remaining: Math.max(0, this.limit - list.length), resetMs: Math.max(0, oldest + this.windowMs - now) };
  }
}
