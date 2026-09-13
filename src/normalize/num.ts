export function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim().replace(/,/g, '');
  if (s === '' || s === '-' || s === '—' || s === '–') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function int(v: unknown): number | null {
  const n = num(v);
  return n == null ? null : Math.trunc(n);
}

/** "5-0" → [5, 0]; "0-1" → [0, 1]. */
export function pair(v: unknown): [number | null, number | null] {
  const s = String(v ?? '').trim();
  const m = s.match(/^(-?\d+)\s*-\s*(-?\d+)$/);
  if (!m) return [null, null];
  return [Number(m[1]), Number(m[2])];
}

/** "8-3-2" → {w:8,l:3,t:2}; "8-3" → t:0 */
export function record(v: unknown): { w: number; l: number; t: number } | null {
  const s = String(v ?? '').trim().replace(/[()]/g, '');
  const m = s.match(/^(\d+)-(\d+)(?:-(\d+))?$/);
  if (!m) return null;
  return { w: Number(m[1]), l: Number(m[2]), t: m[3] ? Number(m[3]) : 0 };
}
