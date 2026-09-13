// Presto roster page parser: the `.roster-data` table plus the `.roster-coaches` cards.
import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import type { AnyNode } from 'domhandler';
import type { Coach, Roster, RosterPlayer } from '../../../model.js';
import { splitName } from '../../../normalize/names.js';
import { splitHometownSchool } from '../../../normalize/hometown.js';
import { int } from '../../../normalize/num.js';
import { absUrl, allTables, cellText, colIndex, lastPathSegment, playerKey, ws, type ParsedTable } from './util.js';

type Field = 'jersey' | 'name' | 'position' | 'class' | 'height' | 'weight' | 'hometown' | 'highSchool' | 'previousSchool' | 'major' | null;

function fieldFromDataAttr(attr: string | undefined): Field {
  const f = (attr ?? '').toLowerCase();
  if (!f) return null;
  if (f === 'number' || f === 'jersey' || f === 'uniform') return 'jersey';
  if (f.includes('name')) return 'name';
  if (f.startsWith('position') || f === 'pos') return 'position';
  if (f === 'year' || f.startsWith('class') || f === 'academic_year' || f === 'elig') return 'class';
  if (f.startsWith('height')) return 'height';
  if (f.startsWith('weight')) return 'weight';
  if (f.startsWith('hometown')) return 'hometown';
  if (f.includes('highschool') || f.includes('high_school')) return 'highSchool';
  if (f.includes('previous') || f.includes('college') || f.includes('last_school')) return 'previousSchool';
  if (f.includes('major')) return 'major';
  return null;
}

function fieldFromHeader(h: string): Field {
  if (!h) return null;
  if (h === 'no' || h === '#' || h === 'number' || h === 'jersey') return 'jersey';
  if (h === 'name' || h === 'player' || h === 'fullname') return 'name';
  if (h.startsWith('pos')) return 'position';
  if (h === 'cl' || h === 'class' || h === 'yr' || h === 'year' || h === 'elig' || h === 'academicyear') return 'class';
  if (h === 'ht' || h === 'height') return 'height';
  if (h === 'wt' || h === 'weight') return 'weight';
  if (h.startsWith('hometown')) return 'hometown';
  if (h === 'highschool' || h === 'hs') return 'highSchool';
  if (h === 'previousschool' || h === 'lastschool' || h === 'college') return 'previousSchool';
  if (h === 'major') return 'major';
  return null;
}

/**
 * Presto's "Last School" half is printed as "High School (Previous College)":
 * "Ponteland (Mineral Area College (MO))" → hs "Ponteland", previous "Mineral Area College (MO)";
 * "(Briar Cliff University)" → hs null, previous "Briar Cliff University".
 */
export function splitSchool(raw: string | null): { highSchool: string | null; previousSchool: string | null } {
  const s = ws(raw);
  if (!s) return { highSchool: null, previousSchool: null };
  if (!s.endsWith(')')) return { highSchool: s, previousSchool: null };
  let depth = 0;
  for (let i = s.length - 1; i >= 0; i--) {
    const ch = s[i];
    if (ch === ')') depth++;
    else if (ch === '(') {
      depth--;
      if (depth === 0) {
        const hs = ws(s.slice(0, i)) || null;
        const prev = ws(s.slice(i + 1, -1)) || null;
        return { highSchool: hs, previousSchool: prev };
      }
    }
  }
  return { highSchool: s, previousSchool: null };
}

function isRosterTable(t: ParsedTable): boolean {
  return colIndex(t.headers, 'name', 'player') >= 0 && (colIndex(t.headers, 'pos', 'position') >= 0 || colIndex(t.headers, 'no', '#', 'number') >= 0);
}

function headshotOf($: CheerioAPI, el: AnyNode, baseUrl: string): string | null {
  const style = $(el).find('[style*="background-image"]').first().attr('style') ?? '';
  const m = style.match(/url\(\s*['"]?([^'")]+)['"]?\s*\)/);
  if (m) return absUrl(baseUrl, m[1]);
  const img = $(el).find('img[src]').first().attr('src');
  return img ? absUrl(baseUrl, img) : null;
}

function parsePlayers($: CheerioAPI, table: ParsedTable, baseUrl: string): RosterPlayer[] {
  const players: RosterPlayer[] = [];
  for (const row of table.rows) {
    const vals: Partial<Record<Exclude<Field, null>, string>> = {};
    let nameCell: AnyNode | null = null;
    row.cells.forEach((cell, i) => {
      if (i > 0 && row.cells[i - 1] === cell) return; // colspan duplicate
      const f = fieldFromDataAttr($(cell).attr('data-field')) ?? fieldFromHeader(table.headers[i] ?? '');
      if (!f) return;
      if (f === 'name') nameCell = cell;
      if (vals[f] === undefined) vals[f] = cellText($, cell);
    });
    const nc = nameCell as AnyNode | null;
    if (!nc) continue;
    const link = $(nc).find('a[href*="/bios/"], a[href*="/players/"], a[href*="/roster/"]').first();
    const nameRaw = ws(link.length ? link.text() : vals.name ?? '');
    const isCaptain = /\(c\)|\bcaptain\b/i.test(ws($(nc).text())) || $(row.el).is('.captain') || $(nc).find('.captain').length > 0;
    const cleaned = nameRaw.replace(/\((?:c|cc|a)\)/gi, '').trim();
    if (!cleaned) continue;
    const { firstName, lastName } = splitName(cleaned);
    const jersey = int((vals.jersey ?? '').replace(/[^\d]/g, ''));
    const bioHref = link.attr('href') ?? null;
    const sitePlayerId = bioHref ? lastPathSegment(bioHref) : null;
    const hs = splitHometownSchool(vals.hometown ?? null);
    const schoolParts = splitSchool(hs.school);
    const weightRaw = vals.weight ?? '';
    players.push({
      sourceKey: sitePlayerId ?? playerKey(lastName, firstName, jersey),
      sitePlayerId,
      firstName,
      lastName,
      jersey,
      positionRaw: vals.position || null,
      classRaw: vals.class || null,
      heightRaw: vals.height || null,
      weightLb: /\d/.test(weightRaw) ? int(weightRaw.replace(/[^\d.]/g, '')) : null,
      hometownRaw: hs.hometown,
      highSchool: vals.highSchool || schoolParts.highSchool,
      previousSchool: vals.previousSchool || schoolParts.previousSchool,
      major: vals.major || null,
      isCaptain,
      headshotUrl: headshotOf($, row.el, baseUrl),
      bioUrl: bioHref ? absUrl(baseUrl, bioHref) : null,
    });
  }
  return players;
}

function isHeadTitle(title: string): boolean {
  return /head coach/i.test(title) && !/assistant|associate|assoc\.|volunteer/i.test(title);
}

function parseCoaches($: CheerioAPI, baseUrl: string): Coach[] {
  const out: Coach[] = [];
  const seen = new Set<string>();
  const push = (name: string, title: string | null, el: AnyNode | null) => {
    const n = ws(name);
    if (!n || seen.has(n.toLowerCase())) return;
    seen.add(n.toLowerCase());
    out.push({ name: n, title: ws(title) || null, isHead: isHeadTitle(ws(title)), headshotUrl: el ? headshotOf($, el, baseUrl) : null });
  };
  const root = $('.roster-coaches').first();
  if (!root.length) return out;
  root.find('.card').each((_, card) => {
    const name = $(card).find('.card-title').first().text();
    const title = $(card).find('.card-text').first().text();
    if (ws(name)) push(name, title, card);
  });
  if (out.length === 0) {
    root.find('table').each((_, t) => {
      $(t)
        .find('tr')
        .each((__, tr) => {
          const cells = $(tr).children('td, th');
          if (cells.length < 2 || $(tr).closest('thead').length) return;
          const name = cellText($, cells.get(0)!);
          const title = cellText($, cells.get(1)!);
          if (name && !/^name$/i.test(name)) push(name, title, tr);
        });
    });
  }
  if (out.length === 0) {
    root.find('li').each((_, li) => {
      const t = ws($(li).text());
      const m = t.match(/^(.+?)\s+[-–|]\s+(.+)$/);
      if (m) push(m[1]!, m[2]!, li);
    });
  }
  return out;
}

export function parseRoster(html: string, baseUrl: string, sourceUrl: string): Roster {
  const $ = cheerio.load(html);
  let tables = allTables($, $('.roster-data').first()).filter(isRosterTable);
  if (tables.length === 0) tables = allTables($).filter(isRosterTable);
  const players: RosterPlayer[] = [];
  const seen = new Set<string>();
  for (const t of tables) {
    for (const p of parsePlayers($, t, baseUrl)) {
      if (seen.has(p.sourceKey)) continue;
      seen.add(p.sourceKey);
      players.push(p);
    }
  }
  return { players, coaches: parseCoaches($, baseUrl), sourceUrl };
}
