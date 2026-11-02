import { describe, it, expect } from 'vitest';
import { HttpClient, MemoryFetchCache, type FetchRecord } from '../../src/http/client.js';

// A cache that records what each put sends (an unchanged page must not be sent to the database again).
class SpyCache extends MemoryFetchCache {
  puts: (string | null | undefined)[] = [];
  override async put(record: FetchRecord, body: string | null | undefined) { this.puts.push(body); await super.put(record, body); }
}

const client = (cache: SpyCache, answer: () => Response) =>
  new HttpClient({ userAgent: 'test', perHostRps: 50, cache, fetchImpl: (async () => answer()) as never, sleep: async () => {} });

describe('HttpClient fetch cache bodies', () => {
  it('stores a page once and keeps it when the site sends the same page again', async () => {
    const cache = new SpyCache();
    let page = 'roster v1';
    const c = client(cache, () => new Response(page, { status: 200 }));
    expect((await c.get('https://h.test/roster')).text).toBe('roster v1');
    expect((await c.get('https://h.test/roster')).text).toBe('roster v1');
    page = 'roster v2';
    expect((await c.get('https://h.test/roster')).text).toBe('roster v2');
    expect(cache.puts).toEqual(['roster v1', undefined, 'roster v2']);
    expect((await cache.get('https://h.test/roster'))!.body).toBe('roster v2');
  });

  it('does not send the stored page again on 304', async () => {
    const cache = new SpyCache();
    let first = true;
    const c = client(cache, () => {
      if (first) { first = false; return new Response('box score', { status: 200, headers: { etag: '"a"' } }); }
      return new Response(null, { status: 304 });
    });
    await c.get('https://h.test/box');
    const again = await c.get('https://h.test/box');
    expect(again.text).toBe('box score');
    expect(cache.puts).toEqual(['box score', undefined]);
    expect((await cache.get('https://h.test/box'))!.body).toBe('box score');
  });
});
