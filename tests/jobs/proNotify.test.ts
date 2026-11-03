import { describe, expect, it, vi } from 'vitest';
import { notifyPlaibookPro, usFinals, PRO_OUTBOX_KEY, PER_POST, type ProNotice } from '../../src/jobs/pro/notify.js';

const env = { PLAIBOOK_FINAL_WEBHOOK_URL: 'https://x.test/hook', PLAIBOOK_FINAL_WEBHOOK_SECRET: 's3' } as any;
const noWait = async () => {};
// A college_kv stand-in (kvGet / kvSet go through db.from('college_kv')).
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
const n = (fixture_id: number, settled = false): ProNotice => ({ fixture_id, home_team_id: 18310, away_team_id: 1598, league_id: 253, final_at: '2026-10-31T19:07:27Z', settled });

describe('pro finals reach Plaibook', () => {
  it('only US-scene finals, settled when the final pass ran', () => {
    const leagues = new Map<number, any>([[253, { id: 253, country: 'USA' }], [39, { id: 39, country: 'England' }]]);
    const rows = [
      { id: 1, league_id: 253, home_team_id: 18310, away_team_id: 1598, final_at: 't', status: 'final', detail_fetched_at: null },
      { id: 2, league_id: 253, home_team_id: 18310, away_team_id: 1598, final_at: 't', status: 'final', detail_fetched_at: '2026-10-31T19:22:00Z' },
      { id: 3, league_id: 39, home_team_id: 33, away_team_id: 34, final_at: 't', status: 'final', detail_fetched_at: null },
      { id: 4, league_id: 253, home_team_id: 1, away_team_id: 2, final_at: null, status: 'live', detail_fetched_at: null },
    ];
    expect(usFinals(rows, leagues).map((x) => [x.fixture_id, x.settled])).toEqual([[1, false], [2, true]]);
  });

  it('posts pro_games on the signed webhook, at most 40 a request', async () => {
    const fetchFn = vi.fn(async () => new Response('{}', { status: 200 }));
    const many = Array.from({ length: PER_POST + 3 }, (_, i) => n(i + 1));
    expect(await notifyPlaibookPro(many, null, env, fetchFn as any, noWait)).toBe('sent');
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const first = JSON.parse((fetchFn.mock.calls[0] as any)[1].body);
    expect(first.pro_games).toHaveLength(PER_POST); expect(first.games).toBeUndefined();
    expect(first.pro_games[0]).toEqual(n(1));
    expect(String((fetchFn.mock.calls[0] as any)[1].headers['x-college-signature'])).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
  });

  it('keeps what Plaibook did not take and sends it with the next run; skips without config', async () => {
    const db = kvDb();
    const down = vi.fn(async () => { throw new Error('down'); });
    expect(await notifyPlaibookPro([n(7)], db, env, down as any, noWait)).toBe('failed');
    expect((db.store.get(PRO_OUTBOX_KEY) as any).games.map((g: any) => [g.fixture_id, g.tries])).toEqual([[7, 1]]);
    const up = vi.fn(async () => new Response('{}', { status: 200 }));
    expect(await notifyPlaibookPro([n(7, true)], db, env, up as any, noWait)).toBe('sent');
    expect(JSON.parse((up.mock.calls[0] as any)[1].body).pro_games.map((g: ProNotice) => [g.fixture_id, g.settled])).toEqual([[7, true], [7, false]]);
    expect((db.store.get(PRO_OUTBOX_KEY) as any).games).toEqual([]);
    expect(await notifyPlaibookPro([], db, env, up as any, noWait)).toBe('skipped');
    expect(await notifyPlaibookPro([n(8)], db, {} as any, up as any, noWait)).toBe('skipped');
  });
});
