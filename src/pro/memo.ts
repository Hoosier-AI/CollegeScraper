// In-process cache for the heavy public Pro reads (leaders, Americans abroad, College to Pro, a country's page).
// They are the same for every visitor and change a few times a day, but a cold read takes seconds. An answer under
// `fresh` ms old is served as is; an older one (up to `stale` ms) is served at once and refreshed in the background;
// past that, or never read, the caller waits. Failures are never cached.
type Entry = { at: number; value: unknown; refresh: Promise<unknown> | null };

const MAX = 1500;
const entries = new Map<string, Entry>();

export async function memo<T>(key: string, load: () => Promise<T>, o: { fresh?: number; stale?: number } = {}): Promise<T> {
  const fresh = o.fresh ?? 10 * 60_000, stale = o.stale ?? 6 * 3600_000;
  const now = Date.now();
  const e = entries.get(key);
  const run = () => {
    const p = load().then((value) => {
      if (entries.size >= MAX && !entries.has(key)) entries.delete(entries.keys().next().value!);
      entries.delete(key);
      entries.set(key, { at: Date.now(), value, refresh: null });
      return value;
    }).finally(() => { const cur = entries.get(key); if (cur?.refresh === p) cur.refresh = null; });
    return p;
  };
  if (e && now - e.at < stale) {
    if (now - e.at >= fresh && !e.refresh) { const p = run(); e.refresh = p; p.catch(() => {}); }
    return e.value as T;
  }
  // Nothing usable: one load for everyone asking at the same time.
  if (e?.refresh) return e.refresh as Promise<T>;
  const p = run();
  entries.set(key, { at: e?.at ?? 0, value: e?.value, refresh: p });
  return p.catch((err) => { if (entries.get(key)?.refresh === p) entries.delete(key); throw err; });
}

export const memoKey = (name: string, args: unknown) => `${name}:${JSON.stringify(args)}`;
