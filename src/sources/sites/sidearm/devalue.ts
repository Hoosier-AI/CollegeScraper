// Decoder for Nuxt 3 "__NUXT_DATA__" payloads (devalue format).
//
// The payload is a flat JSON array. Entry 0 is the root. Objects and arrays reference other
// entries by index; primitives are stored inline. Special negative indices encode undefined /
// holes / NaN / ±Infinity / -0. Tuples of the form ["Kind", ...] are reducers: devalue's own
// (Date, Set, Map, RegExp, BigInt, Object, null-prototype) plus Nuxt's Vue wrappers
// (Reactive, ShallowReactive, Ref, ShallowRef, EmptyRef, EmptyShallowRef, NuxtError).

const UNDEFINED = -1;
const HOLE = -2;
const NAN = -3;
const POSITIVE_INFINITY = -4;
const NEGATIVE_INFINITY = -5;
const NEGATIVE_ZERO = -6;

const VUE_WRAPPERS = new Set(['Reactive', 'ShallowReactive', 'Ref', 'ShallowRef']);

/** Pull the raw JSON text out of `<script id="__NUXT_DATA__" type="application/json">…</script>`. */
export function extractNuxtDataJson(html: string): string | null {
  const m = html.match(/<script\b[^>]*\bid=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return null;
  const body = m[1]!.trim();
  return body.length ? body : null;
}

/** Resolve a devalue array into plain JS values. Cycles are preserved via memoisation. */
export function decodeDevalue(flat: unknown[]): unknown {
  if (!Array.isArray(flat) || flat.length === 0) return undefined;
  const memo = new Map<number, unknown>();
  const inProgress = new Set<number>();

  const decode = (idx: unknown): unknown => {
    if (typeof idx !== 'number' || !Number.isInteger(idx)) return undefined;
    if (idx === UNDEFINED || idx === HOLE) return undefined;
    if (idx === NAN) return NaN;
    if (idx === POSITIVE_INFINITY) return Infinity;
    if (idx === NEGATIVE_INFINITY) return -Infinity;
    if (idx === NEGATIVE_ZERO) return -0;
    if (idx < 0 || idx >= flat.length) return undefined;
    if (memo.has(idx)) return memo.get(idx);
    // A reference back into a wrapper that is still being unwrapped: break the cycle.
    if (inProgress.has(idx)) return undefined;

    const value = flat[idx];
    if (value === null || typeof value !== 'object') {
      memo.set(idx, value);
      return value;
    }

    if (Array.isArray(value)) {
      const kind = value[0];
      if (typeof kind === 'string' && value.length >= 1) {
        if (VUE_WRAPPERS.has(kind) && value.length === 2) {
          inProgress.add(idx);
          const inner = decode(value[1]);
          inProgress.delete(idx);
          memo.set(idx, inner);
          return inner;
        }
        if ((kind === 'EmptyRef' || kind === 'EmptyShallowRef') && value.length === 2) {
          let inner: unknown = undefined;
          try { inner = typeof value[1] === 'string' ? JSON.parse(value[1]) : value[1]; } catch { inner = value[1]; }
          memo.set(idx, inner);
          return inner;
        }
        if (kind === 'NuxtError' && value.length === 2) {
          inProgress.add(idx);
          const inner = decode(value[1]);
          inProgress.delete(idx);
          memo.set(idx, inner);
          return inner;
        }
        if (kind === 'Date' && value.length === 2) {
          const d = new Date(String(value[1]));
          memo.set(idx, d);
          return d;
        }
        if (kind === 'Set') {
          const set = new Set<unknown>();
          memo.set(idx, set);
          for (let i = 1; i < value.length; i++) set.add(decode(value[i]));
          return set;
        }
        if (kind === 'Map') {
          const map = new Map<unknown, unknown>();
          memo.set(idx, map);
          for (let i = 1; i + 1 < value.length; i += 2) map.set(decode(value[i]), decode(value[i + 1]));
          return map;
        }
        if (kind === 'RegExp' && value.length >= 2) {
          let re: unknown;
          try { re = new RegExp(String(value[1]), value[2] ? String(value[2]) : ''); } catch { re = String(value[1]); }
          memo.set(idx, re);
          return re;
        }
        if (kind === 'BigInt' && value.length === 2) {
          let b: unknown;
          try { b = BigInt(String(value[1])); } catch { b = String(value[1]); }
          memo.set(idx, b);
          return b;
        }
        if (kind === 'Object' && value.length === 2) {
          // Boxed primitive (new String(...) etc.): keep the primitive.
          const inner = decode(value[1]);
          memo.set(idx, inner);
          return inner;
        }
        if (kind === 'null' && value.length === 2) {
          // Object.create(null) with entries stored as an object at value[1].
          const inner = decode(value[1]);
          memo.set(idx, inner);
          return inner;
        }
      }
      const out: unknown[] = [];
      memo.set(idx, out);
      for (const item of value) out.push(decode(item));
      return out;
    }

    const out: Record<string, unknown> = {};
    memo.set(idx, out);
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = decode(v);
    return out;
  };

  return decode(0);
}

/** Parse and resolve the embedded Nuxt payload of a Sidearm page. Returns undefined when absent. */
export function decodeNuxtData(html: string): unknown {
  const json = extractNuxtDataJson(html);
  if (!json) return undefined;
  let flat: unknown;
  try { flat = JSON.parse(json); } catch { return undefined; }
  if (!Array.isArray(flat)) return flat;
  return decodeDevalue(flat);
}

/** Depth-first search for the first object satisfying `pred` inside a decoded payload. */
export function findObject(root: unknown, pred: (o: Record<string, unknown>) => boolean, maxDepth = 12): Record<string, unknown> | null {
  const seen = new Set<object>();
  const walk = (v: unknown, depth: number): Record<string, unknown> | null => {
    if (depth > maxDepth || v === null || typeof v !== 'object') return null;
    if (seen.has(v as object)) return null;
    seen.add(v as object);
    if (v instanceof Map) {
      for (const x of v.values()) { const r = walk(x, depth + 1); if (r) return r; }
      return null;
    }
    if (v instanceof Set) {
      for (const x of v) { const r = walk(x, depth + 1); if (r) return r; }
      return null;
    }
    if (Array.isArray(v)) {
      for (const x of v) { const r = walk(x, depth + 1); if (r) return r; }
      return null;
    }
    const o = v as Record<string, unknown>;
    if (pred(o)) return o;
    for (const x of Object.values(o)) { const r = walk(x, depth + 1); if (r) return r; }
    return null;
  };
  return walk(root, 0);
}
