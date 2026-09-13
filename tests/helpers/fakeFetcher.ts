// Test helper: a Fetcher that serves recorded fixtures by URL (exact or regex) and records calls.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Fetcher, HttpResponseLike } from '../../src/model.js';

export const FIXTURES = resolve(process.cwd(), 'fixtures');

export function fixture(rel: string): string {
  return readFileSync(resolve(FIXTURES, rel), 'utf8');
}

export type Route = { match: string | RegExp; file?: string; body?: string; status?: number };

export class FakeFetcher implements Fetcher {
  calls: string[] = [];
  constructor(private routes: Route[]) {}
  async get(url: string): Promise<HttpResponseLike> {
    this.calls.push(url);
    for (const r of this.routes) {
      const hit = typeof r.match === 'string' ? url === r.match || url.startsWith(r.match) : r.match.test(url);
      if (!hit) continue;
      const status = r.status ?? 200;
      const text = r.body ?? (r.file ? fixture(r.file) : '');
      if (status >= 400) {
        const err = new Error(`HTTP ${status} for ${url}`) as Error & { status: number };
        err.status = status;
        throw err;
      }
      return { status, url, text, notModified: false };
    }
    const err = new Error(`No fixture route for ${url}`) as Error & { status: number };
    err.status = 404;
    throw err;
  }
}
