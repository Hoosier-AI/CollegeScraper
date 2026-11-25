import { describe, expect, it } from 'vitest';
import { gdeltPatiently } from '../../src/jobs/news.js';

const ctx = () => { const counts: Record<string, number> = {}; return { counts, ctx: { inc: (k: string, by = 1) => { counts[k] = (counts[k] ?? 0) + by; } } as any }; };

describe('gdeltPatiently', () => {
  it('tries again after a 429 and returns the answer that gets through', async () => {
    const c = ctx(); let n = 0;
    const body = await gdeltPatiently(c.ctx, 'u', async () => { n += 1; if (n < 4) throw new Error('HTTP 429'); return '{"articles":[]}'; }, 1);
    expect(body).toBe('{"articles":[]}');
    expect(c.counts.gdelt_retries).toBe(3);
  });
  it('gives up after five tries, and at once on an error that waiting will not fix', async () => {
    const c = ctx(); let n = 0;
    await expect(gdeltPatiently(c.ctx, 'u', async () => { n += 1; throw new Error('HTTP 429'); }, 1)).rejects.toThrow('429');
    expect(n).toBe(5);
    n = 0;
    await expect(gdeltPatiently(c.ctx, 'u', async () => { n += 1; throw new Error('HTTP 404'); }, 1)).rejects.toThrow('404');
    expect(n).toBe(1);
  });
});
