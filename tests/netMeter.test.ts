import { describe, it, expect, beforeEach } from 'vitest';
import { meterFetch, meterServed, netReport, resetNetMeter, routeGroup, withJob } from '../src/ops/netMeter.js';

const fake = async () => new Response('x'.repeat(10), { headers: { 'content-length': '10' } });

describe('netMeter', () => {
  beforeEach(() => resetNetMeter());

  it('counts what each job sends to each host, the database labelled', async () => {
    const f = meterFetch(fake);
    const body = JSON.stringify([{ id: 1, name: 'a'.repeat(1000) }]);
    await withJob(() => 'nightly > quality', () => f('https://db.example.co/rest/v1/teams', { method: 'POST', headers: { apikey: 'k' }, body }));
    await f('https://site.example.edu/roster');
    const r = netReport('db.example.co');
    const db = r.outbound.top.find((t) => t.key === 'nightly > quality|database|POST teams')!;
    expect(db.requests).toBe(1);
    expect(db.out_bytes).toBeGreaterThan(Buffer.byteLength(body));
    expect(r.outbound.by_table[0]!.key).toBe('POST teams');
    expect(r.outbound.top.find((t) => t.key === 'web|site.example.edu|')!.requests).toBe(1);
    expect(r.outbound.total.requests).toBe(2);
  });

  it('wrapping twice counts once', async () => {
    const f = meterFetch(meterFetch(fake));
    await f('https://a.example/');
    expect(netReport(null).outbound.total.requests).toBe(1);
  });

  it('groups served bytes by caller and route', () => {
    meterServed('ai:PerplexityBot', routeGroup('/api/players/123?x=1'), 900);
    meterServed('browser', routeGroup('/teams/duke/men'), 4000);
    const r = netReport(null);
    expect(r.served.by_who.map((w) => w.key)).toEqual(['browser', 'ai:PerplexityBot']);
    expect(routeGroup('/v1/site/api/teams')).toBe('/v1/site/api');
    expect(routeGroup('/api/pro/teams/x')).toBe('/api/pro/teams');
    expect(routeGroup('/assets/index-abc.js')).toBe('assets');
    expect(routeGroup('/sitemaps/players-2026-1.xml.gz')).toBe('sitemaps');
  });
});
