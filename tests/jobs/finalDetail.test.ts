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
    expect(JSON.parse(init.body)).toEqual({ games: [{ game_id: 'g1', home_program_id: 'a', away_program_id: 'b', final_at: null }] });
  });
  it('skips without config or ready games, and never throws on a failed post', async () => {
    expect(await notifyPlaibook(games, {} as any)).toBe('skipped');
    expect(await notifyPlaibook([games[1]], { PLAIBOOK_FINAL_WEBHOOK_URL: 'u', PLAIBOOK_FINAL_WEBHOOK_SECRET: 's' } as any)).toBe('skipped');
    const failing = vi.fn(async () => { throw new Error('down'); });
    expect(await notifyPlaibook(games, { PLAIBOOK_FINAL_WEBHOOK_URL: 'u', PLAIBOOK_FINAL_WEBHOOK_SECRET: 's' } as any, failing as any, undefined, async () => {})).toBe('failed');
  });
});

describe('final-detail webhook: signed, retried, kept until Plaibook takes it', async () => {
  const { postNotices, signBody, OUTBOX_KEY } = await import('../../src/jobs/finalDetail.js');
  const { createHmac } = await import('node:crypto');
  const env = { PLAIBOOK_FINAL_WEBHOOK_URL: 'https://x.test/hook', PLAIBOOK_FINAL_WEBHOOK_SECRET: 's3' } as any;
  const noWait = async () => {};
  // A college_kv stand-in: kvGet / kvSet go through db.from('college_kv').
  const kvDb = () => {
    const store = new Map<string, unknown>();
    const db: any = { store, from: () => {
      const q: any = { _key: '', select: () => q, eq: (_c: string, v: string) => { q._key = v; return q; },
        maybeSingle: async () => ({ data: store.has(q._key) ? { value: store.get(q._key) } : null, error: null }),
        upsert: async (row: any) => { store.set(row.key, row.value); return { error: null }; } };
      return q;
    } };
    return db;
  };

  it('signs the body with the secret and a timestamp', async () => {
    const fetchFn = vi.fn(async () => new Response('{}', { status: 200 }));
    expect(await postNotices([{ game_id: 'g1', home_program_id: 'a', away_program_id: 'b', final_at: null }], env, fetchFn as any, noWait)).toBe('sent');
    const init = (fetchFn.mock.calls[0] as any)[1];
    const m = String(init.headers['x-college-signature']).match(/^t=(\d+),v1=([0-9a-f]{64})$/)!;
    expect(m).toBeTruthy();
    expect(m[2]).toBe(createHmac('sha256', 's3').update(`${m[1]}.${init.body}`).digest('hex'));
    expect(signBody('s3', 'x', 100)).toBe(`t=100,v1=${createHmac('sha256', 's3').update('100.x').digest('hex')}`);
  });
  it('retries a 5xx or a network error, never a 4xx', async () => {
    let n = 0;
    const flaky = vi.fn(async () => { n += 1; if (n === 1) throw new Error('reset'); return new Response('', { status: n === 2 ? 503 : 200 }); });
    expect(await postNotices([{ game_id: 'g', home_program_id: null, away_program_id: null, final_at: null }], env, flaky as any, noWait)).toBe('sent');
    expect(flaky).toHaveBeenCalledTimes(3);
    const refused = vi.fn(async () => new Response('', { status: 401 }));
    expect(await postNotices([{ game_id: 'g', home_program_id: null, away_program_id: null, final_at: null }], env, refused as any, noWait)).toBe('refused');
    expect(refused).toHaveBeenCalledTimes(1);
  });
  it('keeps what did not go through and sends it with the next run', async () => {
    const db = kvDb();
    const down = vi.fn(async () => new Response('', { status: 502 }));
    expect(await notifyPlaibook(games, env, down as any, db, noWait)).toBe('failed');
    expect((db.store.get(OUTBOX_KEY) as any).games.map((g: any) => g.game_id)).toEqual(['g1']);
    const up = vi.fn(async () => new Response('{}', { status: 200 }));
    const later = [{ id: 'g3', home_program_id: 'e', away_program_id: 'f', ncaa_fetched_at: '2026-10-05T03:00:00Z' }];
    expect(await notifyPlaibook(later, env, up as any, db, noWait)).toBe('sent');
    expect(JSON.parse((up.mock.calls[0] as any)[1].body).games.map((g: any) => g.game_id)).toEqual(['g3', 'g1']);
    expect((db.store.get(OUTBOX_KEY) as any).games).toEqual([]);
  });
});
