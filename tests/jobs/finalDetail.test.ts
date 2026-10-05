import { describe, expect, it, vi } from 'vitest';
import { notifyPlaibook } from '../../src/jobs/finalDetail.js';

const games = [
  { id: 'g1', home_program_id: 'a', away_program_id: 'b', ncaa_fetched_at: '2026-10-05T01:00:00Z' },
  { id: 'g2', home_program_id: 'c', away_program_id: 'd', ncaa_fetched_at: null },
];

describe('final-detail tells Plaibook', () => {
  it('posts only the games whose final box score landed, with the shared secret', async () => {
    const fetchFn = vi.fn(async () => new Response('{}', { status: 200 }));
    const out = await notifyPlaibook(games, { PLAIBOOK_FINAL_WEBHOOK_URL: 'https://x.test/hook', PLAIBOOK_FINAL_WEBHOOK_SECRET: 's3' } as any, fetchFn as any);
    expect(out).toBe('sent');
    const [url, init] = fetchFn.mock.calls[0] as any;
    expect(url).toBe('https://x.test/hook');
    expect(init.headers['x-college-secret']).toBe('s3');
    expect(JSON.parse(init.body)).toEqual({ games: [{ game_id: 'g1', home_program_id: 'a', away_program_id: 'b' }] });
  });
  it('skips without config or ready games, and never throws on a failed post', async () => {
    expect(await notifyPlaibook(games, {} as any)).toBe('skipped');
    expect(await notifyPlaibook([games[1]], { PLAIBOOK_FINAL_WEBHOOK_URL: 'u', PLAIBOOK_FINAL_WEBHOOK_SECRET: 's' } as any)).toBe('skipped');
    const failing = vi.fn(async () => { throw new Error('down'); });
    expect(await notifyPlaibook(games, { PLAIBOOK_FINAL_WEBHOOK_URL: 'u', PLAIBOOK_FINAL_WEBHOOK_SECRET: 's' } as any, failing as any)).toBe('failed');
  });
});
