/** Map free-text positions to GK / D / M / F (or null). Keeps the raw string alongside. */
export function normalizePosition(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim().toLowerCase();
  if (!s) return null;
  if (/^(gk|g|goalkeeper|goalie|keeper)/.test(s)) return 'GK';
  if (/^(d|def|defender|defense|cb|lb|rb|fb|wb|back)/.test(s)) return 'D';
  if (/^(m|mid|midfielder|midfield|cm|dm|am|cdm|cam|wm|lm|rm)/.test(s)) return 'M';
  if (/^(f|fw|fwd|forward|st|striker|w|winger|lw|rw|att)/.test(s)) return 'F';
  if (/^(d\/m|m\/d|def\/mid|mid\/def)/.test(s)) return 'D';
  if (/^(m\/f|f\/m|mid\/fwd|fwd\/mid)/.test(s)) return 'M';
  if (/^(d\/f|f\/d)/.test(s)) return 'D';
  return null;
}
