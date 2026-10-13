// Console reads that take seconds (the Pro crawl document, the leagues list): the last answer is served at once and a
// fresh one is built in the background when it is older than `freshMs`. Only the first read ever waits. The hub gives a
// read 8 seconds; while the crawlers are busy these took 20+.
const store = new Map<string, { at: number; value: unknown }>();
const building = new Map<string, Promise<unknown>>();

export async function swr<T>(key: string, freshMs: number, build: () => Promise<T>): Promise<T> {
  const refresh = () => {
    let p = building.get(key) as Promise<T> | undefined;
    if (!p) {
      p = build().then((value) => { store.set(key, { at: Date.now(), value }); return value; }).finally(() => building.delete(key));
      building.set(key, p);
    }
    return p;
  };
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < freshMs) return hit.value as T;
  if (hit) { void refresh().catch(() => {}); return hit.value as T; }
  return refresh();
}

/** After a write the hub should see at once (a switch, a run queued): the next read builds afresh. */
export function forgetSwr(prefix = ''): void {
  for (const k of [...store.keys()]) if (k.startsWith(prefix)) store.delete(k);
}
