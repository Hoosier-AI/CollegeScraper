// Tiny LRU with a time-to-live, for rendered pages and sitemaps. A Map keeps insertion order, so re-inserting on
// read moves an entry to the young end and the first key is always the least recently used.
export class LruCache<V> {
  private map = new Map<string, { value: V; expires: number }>();
  constructor(private max = 500, private ttlMs = 5 * 60_000, private now: () => number = Date.now) {}
  get(key: string): V | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    this.map.delete(key);
    if (e.expires <= this.now()) return undefined;
    this.map.set(key, e);
    return e.value;
  }
  set(key: string, value: V, ttlMs = this.ttlMs): void {
    this.map.delete(key);
    this.map.set(key, { value, expires: this.now() + ttlMs });
    while (this.map.size > this.max) { const oldest = this.map.keys().next().value; if (oldest === undefined) break; this.map.delete(oldest); }
  }
  clear(): void { this.map.clear(); }
  get size(): number { return this.map.size; }
}
