import { describe, expect, it, vi } from 'vitest';

import { retryingFetch, safeToRepeat } from '../src/db/retryFetch.js';

const BASE = 'https://db.example.supabase.co/rest/v1';
const ok = () => new Response('[]', { status: 200 });
const gateway = () => new Response('<html>502 Bad Gateway</html>', { status: 502 });

describe('safeToRepeat', () => {
  it('reads, updates, deletes and upserts are; inserts and RPCs are not', () => {
    expect(safeToRepeat(`${BASE}/college_games?id=eq.1`)).toBe(true);
    expect(safeToRepeat(`${BASE}/college_games?id=eq.1`, { method: 'PATCH' })).toBe(true);
    expect(safeToRepeat(`${BASE}/college_games?id=eq.1`, { method: 'DELETE' })).toBe(true);
    expect(safeToRepeat(`${BASE}/college_games`, { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } })).toBe(true);
    expect(safeToRepeat(`${BASE}/college_games`, { method: 'POST', headers: { Prefer: 'return=representation' } })).toBe(false);
    expect(safeToRepeat(`${BASE}/rpc/college_claim_run`, { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' } })).toBe(false);
  });
});

describe('retryingFetch', () => {
  it('a 502 on an update is tried again and the job sees the success', async () => {
    const inner = vi.fn().mockResolvedValueOnce(gateway()).mockResolvedValueOnce(ok());
    const onRetry = vi.fn();
    const res = await retryingFetch(inner, { delaysMs: [0], onRetry })(`${BASE}/college_games?id=eq.1`, { method: 'PATCH', body: '{}' });
    expect(res.status).toBe(200);
    expect(inner).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ attempt: 1, reason: 'HTTP 502' }));
  });

  it('a dropped connection is tried again; the last error is thrown after 3 tries', async () => {
    const drop = () => Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: new Error('read ECONNRESET') }));
    const inner = vi.fn(drop);
    await expect(retryingFetch(inner, { delaysMs: [0] })(`${BASE}/college_games`)).rejects.toThrow('fetch failed');
    expect(inner).toHaveBeenCalledTimes(3);
  });

  it('gives back the last 502 after 3 tries', async () => {
    const inner = vi.fn(async () => gateway());
    const res = await retryingFetch(inner, { delaysMs: [0] })(`${BASE}/college_games`);
    expect(res.status).toBe(502);
    expect(inner).toHaveBeenCalledTimes(3);
  });

  it('never repeats an insert or an RPC, and leaves other errors alone', async () => {
    const insert = vi.fn(async () => gateway());
    expect((await retryingFetch(insert, { delaysMs: [0] })(`${BASE}/college_games`, { method: 'POST' })).status).toBe(502);
    expect(insert).toHaveBeenCalledTimes(1);
    const rpc = vi.fn(async () => gateway());
    await retryingFetch(rpc, { delaysMs: [0] })(`${BASE}/rpc/college_claim_run`, { method: 'POST' });
    expect(rpc).toHaveBeenCalledTimes(1);
    const conflict = vi.fn(async () => new Response('{}', { status: 409 }));
    await retryingFetch(conflict, { delaysMs: [0] })(`${BASE}/college_games?id=eq.1`, { method: 'PATCH' });
    expect(conflict).toHaveBeenCalledTimes(1);
    const aborted = vi.fn(() => Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    await expect(retryingFetch(aborted, { delaysMs: [0] })(`${BASE}/college_games`)).rejects.toThrow('aborted');
    expect(aborted).toHaveBeenCalledTimes(1);
  });
});
