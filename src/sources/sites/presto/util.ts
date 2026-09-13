// Shared helpers for the PrestoSports parsers: whitespace, label stripping, table
// extraction by header text, result/date parsing and URL resolution.
import type { Cheerio, CheerioAPI } from 'cheerio';
import type { AnyNode } from 'domhandler';

/** Collapse whitespace (including NBSP) and trim. */
export function ws(s: string | null | undefined): string {
  return (s ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

export function txt($el: Cheerio<AnyNode>): string {
  return ws($el.text());
}

const LABEL_PREFIX = /^(?:no|#|name|player|pos|position|cl|class|yr|year|ht|height|wt|weight|hometown(?:\s*\/\s*(?:last|high)\s*school)?|high school|last school|previous school|major|elig)\.?\s*:\s*/i;

/** Strip responsive "Pos.:", "Hometown/Last School:" style prefixes that Presto prints inside cells. */
export function stripLabelPrefix(s: string): string {
  return ws(s).replace(LABEL_PREFIX, '').trim();
}

/** Visible text of a table cell with the responsive label spans and hidden duplicates removed. */
export function cellText($: CheerioAPI, el: AnyNode): string {
  const c = $(el).clone();
  c.find('.label, .visually-hidden, .offscreen, .sr-only, .d-print-block, script, style').remove();
  return stripLabelPrefix(ws(c.text()));
}

/** Resolve a (possibly relative, possibly whitespace padded) href against a base or page URL. */
export function absUrl(base: string, href: string | null | undefined): string | null {
  const h = ws(href);
  if (!h) return null;
  try {
    return new URL(h, base).toString();
  } catch {
    return null;
  }
}

/** Normalise a header label for comparisons: lower-case, drop punctuation except % and #. */
export function normHeader(s: string): string {
  return ws(s).toLowerCase().replace(/[^a-z0-9%#]/g, '');
}

export interface TableRow {
  el: AnyNode;
  cells: AnyNode[];
  texts: string[];
}

export interface ParsedTable {
  el: AnyNode;
  caption: string;
  /** Header labels with colspans expanded, normalised via normHeader(). */
  headers: string[];
  /** Raw header labels (whitespace collapsed), colspans expanded. */
  rawHeaders: string[];
  rows: TableRow[];
}

function expandCells($: CheerioAPI, tr: AnyNode): { cells: AnyNode[]; texts: string[] } {
  const cells: AnyNode[] = [];
  const texts: string[] = [];
  $(tr)
    .children('td, th')
    .each((_, c) => {
      const span = Math.max(1, Number($(c).attr('colspan') ?? 1) || 1);
      const t = cellText($, c);
      for (let i = 0; i < span; i++) {
        cells.push(c);
        texts.push(t);
      }
    });
  return { cells, texts };
}

/** Parse a <table> into headers + body rows. The header row is the <thead> row or the first all-<th> row. */
export function parseTable($: CheerioAPI, table: AnyNode): ParsedTable {
  const T = $(table);
  const caption = txt(T.find('caption').first());
  let headerTr: AnyNode | null = T.find('thead tr').first().get(0) ?? null;
  const allTrs = T.find('tr').toArray().filter((tr) => $(tr).closest('table').get(0) === table);
  if (!headerTr) {
    const first = allTrs[0];
    if (first) {
      const kids = $(first).children('td, th');
      if (kids.length > 0 && kids.filter('th').length === kids.length) headerTr = first;
    }
  }
  const rawHeaders = headerTr ? expandCells($, headerTr).texts : [];
  const headers = rawHeaders.map(normHeader);
  const rows: TableRow[] = [];
  for (const tr of allTrs) {
    if (tr === headerTr) continue;
    if ($(tr).closest('thead').length) continue;
    const { cells, texts } = expandCells($, tr);
    if (cells.length === 0) continue;
    rows.push({ el: tr, cells, texts });
  }
  return { el: table, caption, headers, rawHeaders, rows };
}

export function allTables($: CheerioAPI, root?: Cheerio<AnyNode>): ParsedTable[] {
  const scope = root ?? $.root();
  return scope
    .find('table')
    .toArray()
    .map((t) => parseTable($, t));
}

/** Index of the first header equal to one of the given (normalised) names, else -1. */
export function colIndex(headers: string[], ...names: string[]): number {
  const wanted = names.map(normHeader);
  for (let i = 0; i < headers.length; i++) {
    if (wanted.includes(headers[i] ?? '')) return i;
  }
  return -1;
}

export function hasHeaders(t: ParsedTable, ...names: string[]): boolean {
  return names.every((n) => colIndex(t.headers, n) >= 0);
}

export interface ResultText {
  status: 'W' | 'L' | 'T';
  teamScore: number;
  opponentScore: number;
}

/**
 * Presto prints results winner-first: "L, 2-1" means the team lost 1-2, "W, 2-1" won 2-1.
 * Returns null unless the string starts with W/L/T and carries a score.
 */
export function parseResultText(raw: string | null | undefined): ResultText | null {
  const s = ws(raw);
  const m = s.match(/^([WLT])\s*,?\s*(\d+)\s*[-–]\s*(\d+)/i);
  if (!m) return null;
  const status = m[1]!.toUpperCase() as 'W' | 'L' | 'T';
  const a = Number(m[2]);
  const b = Number(m[3]);
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  if (status === 'W') return { status, teamScore: hi, opponentScore: lo };
  if (status === 'L') return { status, teamScore: lo, opponentScore: hi };
  return { status, teamScore: a, opponentScore: b };
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** "Aug", "august", "Sept." → 1..12, else null. */
export function monthIndex(name: string | null | undefined): number | null {
  const s = ws(name).toLowerCase().replace(/\./g, '');
  if (!s) return null;
  const i = MONTHS.findIndex((m) => m.startsWith(s.slice(0, 3)));
  return i >= 0 ? i + 1 : null;
}

export function isoDate(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Fall sports span two calendar years: Jul–Dec belong to `season`, Jan–Jun to `season + 1`. */
export function seasonYearFor(month: number, season: number): number {
  return month >= 7 ? season : season + 1;
}

/** "August 28, 2025", "Aug 28, 2025", "8/28/2025", "2025-08-28" → ISO date, else null. */
export function parseDateText(raw: string | null | undefined): string | null {
  const s = ws(raw);
  if (!s) return null;
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return isoDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return isoDate(Number(m[3]), Number(m[1]), Number(m[2]));
  m = s.match(/([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (m) {
    const mo = monthIndex(m[1]);
    if (mo) return isoDate(Number(m[3]), mo, Number(m[2]));
  }
  return null;
}

/** "Aug 28" / "Sep 4" (no year) → ISO date using the season's year rollover. */
export function parseMonthDay(raw: string | null | undefined, season: number): string | null {
  const s = ws(raw);
  const full = parseDateText(s);
  if (full) return full;
  let m = s.match(/([A-Za-z]{3,9})\.?\s+(\d{1,2})\b/);
  if (m) {
    const mo = monthIndex(m[1]);
    if (mo) return isoDate(seasonYearFor(mo, season), mo, Number(m[2]));
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (m) {
    const mo = Number(m[1]);
    if (mo >= 1 && mo <= 12) return isoDate(seasonYearFor(mo, season), mo, Number(m[2]));
  }
  return null;
}

/**
 * "06:30 PM" → "18:30"; "6:30 p.m." → "18:30"; "18:30" → "18:30".
 * Without a meridiem, hours 1–7 are assumed PM (Presto box scores print "06:30" for a 6:30 PM kickoff;
 * no college soccer kicks off at 6:30 AM). Returns null when no time is present.
 */
export function to24h(raw: string | null | undefined): string | null {
  const s = ws(raw);
  const m = s.match(/(\d{1,2}):(\d{2})\s*([AaPp])?\.?\s*[Mm]?\.?/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const mer = m[3]?.toLowerCase();
  if (mer === 'p' && h < 12) h += 12;
  else if (mer === 'a' && h === 12) h = 0;
  else if (!mer && h >= 1 && h <= 7) h += 12;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** Canonical player key: "last|first|jersey" lower-cased. */
export function playerKey(lastName: string, firstName: string, jersey: number | null): string {
  return `${lastName}|${firstName}|${jersey ?? ''}`.toLowerCase();
}

/** Last path segment of a URL (without query/hash), else null. */
export function lastPathSegment(href: string | null | undefined): string | null {
  const h = ws(href).split(/[?#]/)[0] ?? '';
  const seg = h.split('/').filter(Boolean).pop();
  return seg || null;
}
