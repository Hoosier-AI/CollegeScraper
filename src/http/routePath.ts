// Which path a request is judged by.
//
// Fastify's router percent-decodes a path before it matches a route, so
// `/api/%63onsole/requests` runs the handler for `/api/console/requests`. Every
// gate in this service used to test the RAW `req.url` text, where that request
// starts with neither `/api/console` nor, for `/%61pi/...`, even `/api/`. The
// admin secret, the API key check and the per-visitor limit were all skipped
// by encoding one letter (found 2026-11-10; nothing checks the raw text now).
import type { FastifyRequest } from 'fastify';

/** The pathname of a request URL, decoded as the router sees it (the raw text when an escape is malformed). */
export function decodedPath(url: string): string {
  const raw = (url ?? '').split('?')[0] ?? '';
  try { return decodeURIComponent(raw); } catch { return raw; }
}

/**
 * The route this request was matched to (`/api/runs/:id`), which is what a
 * gate must test. A request that matched nothing (it will 404) falls back to
 * its decoded pathname.
 */
export function routedPath(req: FastifyRequest): string {
  const matched = (req as FastifyRequest & { routeOptions?: { url?: string } }).routeOptions?.url;
  return typeof matched === 'string' && matched ? matched : decodedPath(req.url);
}

const UNRESERVED = /^[A-Za-z0-9\-._~]$/;
/**
 * True when the pathname percent-encodes a character that never needs it: a
 * letter, a digit, `-`, `.`, `_` or `~`. No browser or client of ours sends
 * that; its only use is to make a path read differently to a check than to
 * the router. Such a request is refused outright (400) before anything else
 * looks at it.
 */
export function hasDisguisedPath(url: string): boolean {
  const raw = (url ?? '').split('?')[0] ?? '';
  for (const m of raw.matchAll(/%([0-9A-Fa-f]{2})/g)) {
    if (UNRESERVED.test(String.fromCharCode(parseInt(m[1]!, 16)))) return true;
  }
  return false;
}
