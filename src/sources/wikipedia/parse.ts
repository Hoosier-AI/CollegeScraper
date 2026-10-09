// Pure: a Wikipedia season article (CC BY-SA 4.0; the page's /wiki/ HTML, which robots.txt allows) -> its league tables.
// Season articles build tables with the same module, so the headers are regular: Pos, Team, Pld, W, D (or T for ties,
// or SOW for the shootout wins of early MLS), L, GF, GA, GD, Pts. Each table takes its name from the heading above it
// (Eastern Conference, Western Conference, Overall standings).
import * as cheerio from 'cheerio';

export interface WikiTableRow { rank: number | null; team: string; played: number | null; win: number | null; draw: number | null; lose: number | null; gf: number | null; ga: number | null; gd: number | null; points: number | null; shootout_wins: number | null }
export interface WikiTable { group: string; rows: WikiTableRow[] }

const num = (s: string): number | null => { const t = s.replace(/[−–]/g, '-').replace(/[^\d+-]/g, ''); if (!t || t === '-' || t === '+') return null; const n = Number(t); return Number.isFinite(n) ? n : null; };
const clean = (s: string) => s.replace(/\[[^\]]*\]/g, '').replace(/\([A-Z, ]+\)$/, '').replace(/\s+/g, ' ').trim();

const COLS: Record<string, keyof WikiTableRow> = { pos: 'rank', team: 'team', club: 'team', pld: 'played', gp: 'played', w: 'win', d: 'draw', t: 'draw', l: 'lose', gf: 'gf', ga: 'ga', gd: 'gd', pts: 'points', sow: 'shootout_wins' };

export function parseSeasonTables(html: string): WikiTable[] {
  const $ = cheerio.load(html);
  const out: WikiTable[] = [];
  let heading = '';
  $('h2, h3, h4, table.wikitable').each((_, el) => {
    const tag = el.tagName.toLowerCase();
    if (tag !== 'table') { heading = clean($(el).text()); return; }
    const t = $(el);
    const headerCells = t.find('tr').first().find('th').toArray().map((h) => clean($(h).text()).toLowerCase().replace(/\s*v\s*t\s*e$/, '').replace(/[^a-z]/g, ''));
    const map = headerCells.map((h) => COLS[h] ?? (h.startsWith('team') ? 'team' : null));
    // A league table: club, played, wins, losses, points at least.
    if (!['team', 'played', 'win', 'lose', 'points'].every((k) => map.includes(k as keyof WikiTableRow))) return;
    const rows: WikiTableRow[] = [];
    t.find('tr').slice(1).each((__, tr) => {
      const cells = $(tr).children('th, td').toArray();
      if (cells.length < 6) return;
      const r: WikiTableRow = { rank: null, team: '', played: null, win: null, draw: null, lose: null, gf: null, ga: null, gd: null, points: null, shootout_wins: null };
      cells.forEach((c, i) => {
        const k = map[i]; if (!k) return;
        const text = clean($(c).text());
        if (k === 'team') r.team = clean($(c).find('a').first().text() || text);
        else (r as unknown as Record<string, number | null>)[k] = num(text);
      });
      if (r.team && r.played != null && r.points != null) rows.push(r);
    });
    if (rows.length) out.push({ group: heading || 'Table', rows });
  });
  return out;
}

/** The tables a season's clubs are ranked in: the conferences when there are any, else the overall one. */
export function mainTables(tables: WikiTable[]): WikiTable[] {
  const conf = tables.filter((t) => /conference|division|group/i.test(t.group));
  return conf.length ? conf : tables.slice(0, 1);
}
