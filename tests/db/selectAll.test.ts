import { describe, it, expect, beforeEach } from 'vitest';
import { selectAll, resetOrderKeys, type Db } from '../../src/db/client.js';

// A fake table that behaves like Postgres without ORDER BY: every unordered request sees its own row order, so
// LIMIT/OFFSET pages overlap. Ordered requests sort by the requested columns.
function fakeDb(rows: { id: number }[], keys: Record<string, string[]> = { t: ['id'] }) {
  const calls: { order: string[]; from: number }[] = [];
  let seed = 7;
  const shuffle = <X,>(a: X[]) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { seed = (seed * 1103515245 + 12345) % 2 ** 31; const j = seed % (i + 1); [b[i], b[j]] = [b[j]!, b[i]!]; } return b; };
  const db = {
    rpc: async () => ({ data: keys, error: null }),
    from: () => {
      const st = { from: 0, to: 0, order: [] as string[] };
      const q: any = {
        select: () => q,
        range: (a: number, b: number) => { st.from = a; st.to = b; return q; },
        order: (c: string) => { st.order.push(c); return q; },
        then: (res: (v: unknown) => void) => {
          calls.push({ order: [...st.order], from: st.from });
          const list = st.order.length ? [...rows].sort((x: any, y: any) => x[st.order[0]!] - y[st.order[0]!]) : shuffle(rows);
          res({ data: list.slice(st.from, st.to + 1), error: null });
        },
      };
      return q;
    },
  } as unknown as Db;
  return { db, calls };
}

describe('selectAll', () => {
  beforeEach(() => resetOrderKeys());
  const rows = Array.from({ length: 2500 }, (_, i) => ({ id: i + 1 }));

  it('reads every row once when the read is longer than a page', async () => {
    const { db, calls } = fakeDb(rows);
    const out = await selectAll<{ id: number }>(db, 't', 'id');
    expect(out).toHaveLength(2500);
    expect(new Set(out.map((r) => r.id)).size).toBe(2500);
    expect(calls.slice(1).every((c) => c.order.includes('id'))).toBe(true);
  });

  it('asks once, unordered, when the read fits one page', async () => {
    const { db, calls } = fakeDb(rows.slice(0, 40));
    expect(await selectAll(db, 't', 'id')).toHaveLength(40);
    expect(calls).toEqual([{ order: [], from: 0 }]);
  });

  it('uses the known key of a view', async () => {
    const { db, calls } = fakeDb(rows.map((r) => ({ ...r, player_season_id: r.id })) as any, {});
    await selectAll(db, 'college_v_player_leaders', '*');
    expect(calls[1]!.order).toEqual(['player_season_id']);
  });
});
