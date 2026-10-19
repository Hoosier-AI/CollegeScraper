import { describe, expect, it } from 'vitest';
import { HttpClient, HttpError } from '../../src/http/client.js';
import { addDoNotCrawlHost, doNotCrawlReason, looksLikePrestoPage } from '../../src/http/doNotCrawl.js';
import { adapterFor } from '../../src/sources/sites/detect.js';

describe('sites we do not crawl (PrestoSports, 2026-10-19)', () => {
  it('refuses Presto hosts and the platform domain, with or without www', () => {
    expect(doNotCrawlReason('https://www.thegnac.com/sports/msoc/2026-27/standings')).toMatch(/do not crawl/);
    expect(doNotCrawlReason('https://cdn.prestosports.com/x.js')).toMatch(/PrestoSports/);
    addDoNotCrawlHost('www.gocobbers.com');
    expect(doNotCrawlReason('https://gocobbers.com/sports/msoc')).not.toBeNull();
    expect(doNotCrawlReason('https://goduke.com/sports/mens-soccer')).toBeNull();
  });
  it('the client sends no request to a refused host, and a Presto page puts its host on the list', async () => {
    let calls = 0;
    const fetchImpl = (async () => { calls += 1; return new Response('<html><script src="https://cdn.prestosports.com/a.js"></script></html>', { status: 200 }); }) as any;
    const seen: string[] = [];
    const c = new HttpClient({ userAgent: 't', fetchImpl, refuse: doNotCrawlReason, onBody: (url, text) => { if (looksLikePrestoPage(text)) { addDoNotCrawlHost(new URL(url).host); seen.push(url); } } });
    await expect(c.get('https://mascac.com/standings')).rejects.toBeInstanceOf(HttpError);
    expect(calls).toBe(0);
    await c.get('https://newschool.edu/');
    expect(seen).toEqual(['https://newschool.edu/']);
    await expect(c.get('https://newschool.edu/sports/msoc')).rejects.toThrow(/do not crawl/);
    expect(calls).toBe(1);
  });
  it('no adapter for Presto sites, so no sync or discovery reaches them', () => {
    expect(adapterFor('presto')).toBeNull();
    expect(adapterFor('sidearm')).not.toBeNull();
  });
});
