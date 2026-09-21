import { describe, it, expect } from 'vitest';
import { HttpClient } from '../../src/http/client.js';

const response = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/plain' } });

describe('HttpClient priority', () => {
  it('serves a high-priority request ahead of queued crawl requests on the same host', async () => {
    const order: string[] = [];
    const fetchImpl = (async (url: string | URL) => { order.push(String(url)); return response('ok'); }) as unknown as typeof fetch;
    const client = new HttpClient({ userAgent: 'test', perHostRps: 50, fetchImpl: fetchImpl as never, sleep: async () => {} });
    // First request starts immediately; the rest wait in the per-host queue where priority decides.
    const first = client.get('https://h.test/first');
    const a = client.get('https://h.test/crawl-a');
    const b = client.get('https://h.test/crawl-b');
    const live = client.get('https://h.test/live', { priority: 10 });
    await Promise.all([first, a, b, live]);
    expect(order[0]).toBe('https://h.test/first');
    expect(order.indexOf('https://h.test/live')).toBeLessThan(order.indexOf('https://h.test/crawl-a'));
    expect(order.indexOf('https://h.test/live')).toBeLessThan(order.indexOf('https://h.test/crawl-b'));
  });
  it('counts requests, errors and 429s per host', async () => {
    let n = 0;
    const fetchImpl = (async () => (n++ === 0 ? response('slow down', 429) : response('ok'))) as unknown as typeof fetch;
    const client = new HttpClient({ userAgent: 'test', perHostRps: 50, fetchImpl: fetchImpl as never, sleep: async () => {} });
    await client.get('https://h.test/x');
    expect(client.stats.status429).toBe(1);
    expect(client.stats.byHost.get('h.test')).toMatchObject({ requests: 2, errors: 1, status429: 1, lastError: 'HTTP 429' });
  });
});
