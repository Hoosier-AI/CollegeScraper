// The crawl client and redirects, Retry-After and repeat enqueues.
import { describe, it, expect } from 'vitest';
import { HttpClient, HttpError } from '../../src/http/client.js';
import { canonicalJson } from '../../src/jobs/runner.js';

const reply = (status: number, headers: Record<string, string> = {}, body = '') => new Response(status === 204 || status === 304 ? null : body, { status, headers });

function client(script: (url: string) => Response, extra: Record<string, unknown> = {}) {
  const seen: string[] = [];
  const slept: number[] = [];
  const c = new HttpClient({
    userAgent: 'test',
    perHostRps: 1000,
    fetchImpl: (async (url: string) => { seen.push(String(url)); return script(String(url)); }) as never,
    sleep: async (ms: number) => { slept.push(ms); },
    ...extra,
  } as never);
  return { c, seen, slept };
}

describe('redirects are checked hop by hop', () => {
  it('follows an ordinary redirect to the final page', async () => {
    const { c, seen } = client((url) => (url.endsWith('/old') ? reply(301, { location: '/new' }) : reply(200, {}, 'page')));
    const res = await c.get('https://school.example/old');
    expect(res.text).toBe('page');
    expect(seen).toEqual(['https://school.example/old', 'https://school.example/new']);
  });

  it('never requests a host on the do-not-crawl list, even when a school site redirects there', async () => {
    const refuse = (url: string) => (new URL(url).host.endsWith('prestosports.com') ? 'PrestoSports asked us to stop' : null);
    const { c, seen, slept } = client((url) => (url.includes('school.example') ? reply(302, { location: 'https://team.prestosports.com/roster' }) : reply(200, {}, 'presto page')), { refuse });
    await expect(c.get('https://school.example/roster')).rejects.toMatchObject({ status: 451 });
    expect(seen).toEqual(['https://school.example/roster']);
    expect(slept).toEqual([]); // final: not retried
  });

  it('gives up on a redirect loop', async () => {
    const { c } = client(() => reply(302, { location: '/again' }), { maxAttempts: 1 });
    await expect(c.get('https://school.example/again')).rejects.toBeInstanceOf(HttpError);
  });
});

describe('Retry-After', () => {
  it('is honoured up to two minutes, and there is no wait after the last attempt', async () => {
    const { c, slept } = client(() => reply(429, { 'retry-after': '3600' }), { maxAttempts: 3 });
    await expect(c.get('https://school.example/busy')).rejects.toMatchObject({ status: 429 });
    expect(slept).toEqual([120_000, 120_000]);
  });
});

describe('canonicalJson (the enqueue duplicate check)', () => {
  it('is the same for objects that differ only in key order, at any depth', () => {
    // Postgres returns jsonb keys by length, then bytes: { season, manual } comes back as { manual, season }.
    expect(canonicalJson({ season: 2026, manual: true })).toBe(canonicalJson({ manual: true, season: 2026 }));
    expect(canonicalJson({ a: { y: 1, x: [2, { d: 1, c: 2 }] }, b: null })).toBe(canonicalJson({ b: null, a: { x: [2, { c: 2, d: 1 }], y: 1 } }));
  });
  it('still tells different params apart', () => {
    expect(canonicalJson({ season: 2026 })).not.toBe(canonicalJson({ season: 2025 }));
    expect(canonicalJson({ ids: [1, 2] })).not.toBe(canonicalJson({ ids: [2, 1] }));
  });
});
