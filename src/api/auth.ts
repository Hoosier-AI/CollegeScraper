// Authentication for the public read API. Three kinds of caller:
//   - admin: the trigger secret (COLLEGE_TRIGGER_SECRET), used by the viewer's own job routes;
//   - key:   a named key from COLLEGE_API_KEYS ("plaibook:xxxx,partner:yyyy"), for heavy consumers;
//   - anon:  no credentials at all — the free tier, bucketed by client IP.
// Every comparison is constant-time. A small in-memory sliding-window limiter caps requests per principal.
import { createHash, timingSafeEqual } from 'node:crypto';

export interface ApiPrincipal { kind: 'admin' | 'key' | 'anon'; name: string }

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

/** The anonymous free tier: one bucket per client IP. */
export function anonPrincipal(ip: string | undefined | null): ApiPrincipal {
  return { kind: 'anon', name: `ip:${ip || 'unknown'}` };
}

/**
 * Sliding-window limiter: at most `limit` hits per `windowMs` per principal name.
 * Anonymous callers are keyed by IP, so the map is swept once per window to drop cold buckets;
 * without that it would grow with every distinct address that ever called us.
 */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  private sweptAt = 0;
  constructor(private limit: number, private windowMs = 60_000) {}
  /** Returns { ok, remaining, resetMs }. */
  take(name: string, now = Date.now()): { ok: boolean; remaining: number; resetMs: number } {
    const cutoff = now - this.windowMs;
    if (now - this.sweptAt > this.windowMs) this.sweep(cutoff, now);
    const list = (this.hits.get(name) ?? []).filter((t) => t > cutoff);
    const ok = list.length < this.limit;
    if (ok) list.push(now);
    this.hits.set(name, list);
    const oldest = list[0] ?? now;
    return { ok, remaining: Math.max(0, this.limit - list.length), resetMs: Math.max(0, oldest + this.windowMs - now) };
  }
  /** Requests allowed per window (advertised as X-RateLimit-Limit). */
  get max(): number { return this.limit; }
  /** Buckets currently held — exposed for tests. */
  get size(): number { return this.hits.size; }
  private sweep(cutoff: number, now: number): void {
    for (const [name, list] of this.hits) if (!list.some((t) => t > cutoff)) this.hits.delete(name);
    this.sweptAt = now;
  }
}
