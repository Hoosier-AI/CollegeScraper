// Presto team statistics page (/sports/<sport>/<season>/teams/<slug>) and the AJAX player-stat
// fragments (/players?teamId=...&view=lineup...) it pulls in client-side.
import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import type { AnyNode } from 'domhandler';
import type { Num, SeasonPlayerLine, SeasonStats, SeasonTeamLine } from '../../../model.js';
import { nameKey, splitName } from '../../../normalize/names.js';
import { int, num, pair } from '../../../normalize/num.js';
import { absUrl, allTables, colIndex, lastPathSegment, parseMonthDay, parseResultText, playerKey, ws, type ParsedTable } from './util.js';

export interface PrestoGameLogRow {
  date: string;
  opponentName: string;
  homeAway: 'H' | 'A' | 'N';
  result: { status: 'W' | 'L' | 'T'; teamScore: number; opponentScore: number } | null;
  boxScoreUrl: string | null;
  goals: Num;
  assists: Num;
  shots: Num;
  shotPct: Num;
  saves: Num;
  shutouts: Num;
  yellow: Num;
  red: Num;
  corners: Num;
  attendance: Num;
}

export interface PrestoTeamStatsPage {
  gameLog: PrestoGameLogRow[];
  team: SeasonTeamLine | null;
  opponents: SeasonTeamLine | null;
  /** Split rows ("Total", "Conference", "Home", "August", …) → header → value. */
  splits: Record<string, Record<string, Num>>;
  /** Presto internal team id (teamId=… in the AJAX URLs). */
  teamId: string | null;
  /** Absolute URLs of the overall (non-conference) individual-stat fragments the page loads via AJAX. */
  playerStatUrls: string[];
  /** Player lines rendered inline (older templates); usually empty on the current template. */
  players: SeasonPlayerLine[];
}

const emptyTeamLine = (): SeasonTeamLine => ({
  goals: null, assists: null, shots: null, sog: null, saves: null,
  fouls: null, corners: null, offsides: null, yellow: null, red: null, pkGoals: null, pkAttempts: null,
  gamesPlayed: null,
});

function stripAt(s: string): { name: string; homeAway: 'H' | 'A' | 'N' } {
  const m = ws(s).match(/^(at|vs\.?)\s+(.+)$/i);
  if (!m) return { name: ws(s).replace(/[*~^#%]+$/g, '').trim(), homeAway: 'H' };
  return { name: ws(m[2]).replace(/[*~^#%]+$/g, '').trim(), homeAway: /^at$/i.test(m[1]!) ? 'A' : 'N' };
}

function isGameLog(t: ParsedTable): boolean {
  return colIndex(t.headers, 'date') >= 0 && colIndex(t.headers, 'opponent') >= 0;
}

function isSplitTable(t: ParsedTable): boolean {
  return t.headers[0] === '' && colIndex(t.headers, 'gp') >= 0 && !isGameLog(t);
}

function parseGameLogs($: CheerioAPI, tables: ParsedTable[], pageUrl: string, season: number): PrestoGameLogRow[] {
  const byKey = new Map<string, PrestoGameLogRow>();
  const order: string[] = [];
  for (const t of tables) {
    const di = colIndex(t.headers, 'date');
    const oi = colIndex(t.headers, 'opponent');
    const si = colIndex(t.headers, 'score', 'result');
    const cols: Record<string, number> = {};
    t.headers.forEach((h, i) => {
      if (h && cols[h] === undefined) cols[h] = i;
    });
    const val = (row: string[], ...names: string[]): Num => {
      for (const n of names) {
        const i = cols[n];
        if (i !== undefined) return num(row[i] ?? null);
      }
      return null;
    };
    for (const row of t.rows) {
      const date = parseMonthDay(row.texts[di] ?? '', season);
      if (!date) continue;
      const opp = stripAt(row.texts[oi] ?? '');
      if (!opp.name) continue;
      const key = `${date}|${opp.name.toLowerCase()}`;
      let g = byKey.get(key);
      if (!g) {
        g = {
          date, opponentName: opp.name, homeAway: opp.homeAway, result: null, boxScoreUrl: null,
          goals: null, assists: null, shots: null, shotPct: null, saves: null, shutouts: null, yellow: null, red: null, corners: null, attendance: null,
        };
        byKey.set(key, g);
        order.push(key);
      }
      if (si >= 0 && !g.result) g.result = parseResultText(row.texts[si] ?? '');
      if (!g.boxScoreUrl) {
        const href = $(row.el).find('a[href*="boxscore"]').first().attr('href');
        if (href) g.boxScoreUrl = absUrl(pageUrl, href);
      }
      g.goals = g.goals ?? val(row.texts, 'g', 'goals');
      g.assists = g.assists ?? val(row.texts, 'a', 'ast');
      g.shots = g.shots ?? val(row.texts, 'sh', 'shots');
      g.shotPct = g.shotPct ?? val(row.texts, 'sh%', 'shotpct');
      g.saves = g.saves ?? val(row.texts, 'sv', 'saves');
      g.shutouts = g.shutouts ?? val(row.texts, 'so', 'sho');
      g.yellow = g.yellow ?? val(row.texts, 'yc');
      g.red = g.red ?? val(row.texts, 'rc');
      g.corners = g.corners ?? val(row.texts, 'ck', 'corners');
      g.attendance = g.attendance ?? val(row.texts, 'attend', 'attendance', 'att');
      if (g.result && g.goals == null) g.goals = g.result.teamScore;
    }
  }
  return order.map((k) => byKey.get(k)!);
}

function parseSplits(tables: ParsedTable[]): Record<string, Record<string, Num>> {
  const splits: Record<string, Record<string, Num>> = {};
  for (const t of tables) {
    for (const row of t.rows) {
      const label = ws(row.texts[0] ?? '');
      if (!label) continue;
      const rec = (splits[label] ??= {});
      t.headers.forEach((h, i) => {
        if (i === 0 || !h) return;
        if (rec[h] === undefined) rec[h] = num(row.texts[i] ?? null);
      });
    }
  }
  return splits;
}

function teamLineFromSplit(rec: Record<string, Num> | undefined): SeasonTeamLine | null {
  if (!rec) return null;
  const line = emptyTeamLine();
  line.gamesPlayed = rec['gp'] ?? null;
  line.goals = rec['g'] ?? null;
  line.assists = rec['a'] ?? null;
  line.shots = rec['sh'] ?? null;
  line.sog = rec['sog'] ?? null;
  line.saves = rec['sv'] ?? null;
  line.yellow = rec['yc'] ?? null;
  line.red = rec['rc'] ?? null;
  line.corners = rec['ck'] ?? null;
  line.fouls = rec['fouls'] ?? rec['f'] ?? null;
  line.offsides = rec['off'] ?? rec['offsides'] ?? null;
  return line;
}

function opponentLineFromSplit(rec: Record<string, Num> | undefined): SeasonTeamLine | null {
  if (!rec || rec['ga'] == null) return null;
  const line = emptyTeamLine();
  line.gamesPlayed = rec['gp'] ?? null;
  line.goals = rec['ga'] ?? null;
  return line;
}

export function parseTeamStatsPage(html: string, pageUrl: string, season: number): PrestoTeamStatsPage {
  const $ = cheerio.load(html);
  const tables = allTables($);
  const gameLog = parseGameLogs($, tables.filter(isGameLog), pageUrl, season);
  const splits = parseSplits(tables.filter(isSplitTable));
  const total = splits['Total'] ?? splits['Overall'] ?? splits['Season'];
  const urls = new Set<string>();
  let teamId: string | null = null;
  $('[data-url]').each((_, el) => {
    const u = ws($(el).attr('data-url'));
    if (!u) return;
    const idm = u.match(/[?&]teamId=([a-z0-9]+)/i);
    if (idm && !teamId) teamId = idm[1]!;
    if (!/\/players\?/.test(u) || !/view=lineup/.test(u)) return;
    if (/[?&]r=1\b/.test(u)) return; // conference-only split
    const abs = absUrl(pageUrl, u);
    if (abs) urls.add(abs);
  });
  if (!teamId) {
    const m = html.match(/teams\?id=([a-z0-9]+)/i) ?? html.match(/teamId=([a-z0-9]+)/i);
    if (m) teamId = m[1]!;
  }
  return {
    gameLog,
    team: teamLineFromSplit(total),
    opponents: opponentLineFromSplit(total),
    splits,
    teamId,
    playerStatUrls: [...urls],
    players: parsePlayerStatsFragment(html, pageUrl),
  };
}

const emptyPlayerLine = (sourceKey: string, name: string, jersey: Num): SeasonPlayerLine => ({
  sourceKey, name, jersey,
  gp: null, gs: null, minutes: null,
  goals: null, assists: null, points: null, shots: null, sog: null,
  yellow: null, red: null, gwg: null, pkGoals: null, pkAttempts: null,
  goalsAllowed: null, saves: null, shutouts: null, gkMinutes: null, gaa: null, savePct: null,
});

const SKIP_ROW = /^(total|totals|team|tm|opponents?|opp)$/i;

function isPlayerTable(t: ParsedTable): boolean {
  return colIndex(t.headers, 'player', 'name') >= 0 && (colIndex(t.headers, 'gp') >= 0 || colIndex(t.headers, 'g', 'goals') >= 0 || colIndex(t.headers, 'sv', 'saves') >= 0);
}

/**
 * Header-driven parser for Presto individual statistics tables (any of the offense / goalkeeping /
 * cards layouts). Lines from several tables are merged by player name. Presto's current layout
 * carries no GS or minutes columns for field players, so those stay null.
 */
export function parsePlayerStatsFragment(html: string, pageUrl: string): SeasonPlayerLine[] {
  const $ = cheerio.load(html);
  const lines = new Map<string, SeasonPlayerLine>();
  for (const t of allTables($).filter(isPlayerTable)) {
    const ni = colIndex(t.headers, 'player', 'name');
    const ji = colIndex(t.headers, '#', 'no', 'number', 'uniform');
    const isGk = colIndex(t.headers, 'ga', 'gaa', 'sv', 'saves') >= 0;
    const cols: Record<string, number> = {};
    t.headers.forEach((h, i) => {
      if (h && cols[h] === undefined) cols[h] = i;
    });
    const val = (row: string[], ...names: string[]): Num => {
      for (const n of names) {
        const i = cols[n];
        if (i !== undefined) return num(row[i] ?? null);
      }
      return null;
    };
    for (const row of t.rows) {
      const cell = row.cells[ni];
      if (!cell) continue;
      const link = $(cell).find('a[href*="/players/"], a[href*="/bios/"]').first();
      let nameRaw = ws(link.length ? link.text() : row.texts[ni] ?? '');
      let jersey: Num = ji >= 0 ? int((row.texts[ji] ?? '').replace(/[^\d]/g, '')) : null;
      if (jersey == null) {
        const jm = nameRaw.match(/^#?(\d{1,2})\s*[-–]?\s+(.+)$/);
        if (jm) {
          jersey = Number(jm[1]);
          nameRaw = ws(jm[2]);
        }
      }
      if (!nameRaw || SKIP_ROW.test(nameRaw)) continue;
      const { firstName, lastName } = splitName(nameRaw);
      const key = nameKey(firstName, lastName);
      let line = lines.get(key);
      if (!line) {
        const slug = link.length ? lastPathSegment(link.attr('href')) : null;
        line = emptyPlayerLine(slug ?? playerKey(lastName, firstName, jersey), `${firstName} ${lastName}`.trim(), jersey);
        lines.set(key, line);
      }
      if (line.jersey == null && jersey != null) line.jersey = jersey;
      line.gp = line.gp ?? val(row.texts, 'gp', 'games');
      line.gs = line.gs ?? val(row.texts, 'gs');
      if (isGk) {
        line.gkMinutes = line.gkMinutes ?? val(row.texts, 'min', 'minutes', 'mins');
        line.goalsAllowed = line.goalsAllowed ?? val(row.texts, 'ga');
        line.gaa = line.gaa ?? val(row.texts, 'gaa');
        line.saves = line.saves ?? val(row.texts, 'sv', 'saves');
        line.savePct = line.savePct ?? val(row.texts, 'sv%', 'save%', 'svpct', 'pct');
        line.shutouts = line.shutouts ?? val(row.texts, 'so', 'sho', 'shutouts');
      } else {
        line.minutes = line.minutes ?? val(row.texts, 'min', 'minutes', 'mins');
      }
      line.goals = line.goals ?? val(row.texts, 'g', 'goals');
      line.assists = line.assists ?? val(row.texts, 'a', 'ast', 'assists');
      line.points = line.points ?? val(row.texts, 'pts', 'points');
      line.shots = line.shots ?? val(row.texts, 'sh', 'shots');
      line.sog = line.sog ?? val(row.texts, 'sog');
      line.yellow = line.yellow ?? val(row.texts, 'yc', 'yellow');
      line.red = line.red ?? val(row.texts, 'rc', 'red');
      line.gwg = line.gwg ?? val(row.texts, 'gw', 'gwg');
      const pkIdx = cols['pkatt'] ?? cols['pk-att'] ?? cols['pk'];
      if (pkIdx !== undefined && line.pkGoals == null) {
        const [pg, pa] = pair(row.texts[pkIdx] ?? '');
        if (pg != null) {
          line.pkGoals = pg;
          line.pkAttempts = pa;
        } else line.pkGoals = num(row.texts[pkIdx] ?? null);
      }
      if (line.pkGoals == null) line.pkGoals = val(row.texts, 'pkg', 'pkgoals');
      if (line.pkAttempts == null) line.pkAttempts = val(row.texts, 'pka', 'pkattempts');
    }
  }
  return [...lines.values()];
}

/** Merge player lines from several fragments (by name), filling nulls from later lists. */
export function mergePlayerLines(...lists: SeasonPlayerLine[][]): SeasonPlayerLine[] {
  const out = new Map<string, SeasonPlayerLine>();
  for (const list of lists) {
    for (const l of list) {
      const { firstName, lastName } = splitName(l.name);
      const key = nameKey(firstName, lastName);
      const cur = out.get(key);
      if (!cur) {
        out.set(key, { ...l });
        continue;
      }
      for (const k of Object.keys(l) as (keyof SeasonPlayerLine)[]) {
        if (k === 'sourceKey' || k === 'name') continue;
        if (cur[k] == null && l[k] != null) (cur as unknown as Record<string, unknown>)[k] = l[k];
      }
      if (/\|/.test(cur.sourceKey) && !/\|/.test(l.sourceKey)) cur.sourceKey = l.sourceKey;
    }
  }
  return [...out.values()];
}

export function buildSeasonStats(page: PrestoTeamStatsPage, players: SeasonPlayerLine[], sourceUrl: string): SeasonStats {
  return { players, team: page.team, opponents: page.opponents, sourceUrl };
}

export type { AnyNode as _AnyNode };
