/** "6-1", "6'1\"", "6' 1''", "6-1.5", feet+inches → centimetres (rounded). */
export function heightToCm(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const m = s.match(/(\d{1,2})\s*(?:'|-|ft|’)\s*(\d{1,2}(?:\.\d+)?)?/);
  if (!m) return null;
  const ft = Number(m[1]);
  const inch = m[2] ? Number(m[2]) : 0;
  if (!Number.isFinite(ft) || ft < 4 || ft > 7) return null;
  return Math.round((ft * 12 + inch) * 2.54);
}

export function heightFromFeetInches(feet: number | null | undefined, inches: number | null | undefined): number | null {
  if (feet == null || !Number.isFinite(Number(feet)) || Number(feet) <= 0) return null;
  return Math.round((Number(feet) * 12 + Number(inches ?? 0)) * 2.54);
}
