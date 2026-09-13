// Sidearm cumulative season stats page: /sports/{sportSlug}/stats/{season}
// Server-rendered tables (located by header text, never by position):
//   individual:  # | Player | gp | Gs | min | g | A | pts | sh | sh% | sog | sog% | yc-rc | gw | pg-pa
//   goalkeeping: # | Player | gp | gs | min | ga | gaa | sv | sv% | sho ... (only when rendered)
//   team:        - | {Team} | Opponents  with labelled rows (Goals, Shots, Shots On Goal "n-m", ...)
// Quirk: on nextgen sites only the "Offensive" tab's tables are server-rendered; the
// Goalkeeping tab is client-rendered, so GK columns are usually absent from the HTML.
import { load, type CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import type { SeasonPlayerLine, SeasonStats, SeasonTeamLine, SiteContext } from '../../../model.js';
import { int, num, pair } from '../../../normalize/num.js';
import { cleanName, splitName } from '../../../normalize/names.js';
import { collapse, nameJerseyKey } from './common.js';

type Cheerio = ReturnType<CheerioAPI>;

interface Table { headers: string[]; rows: Cheerio[]; footRows: Cheerio[]; el: Cheerio }

function readTables($: CheerioAPI): Table[] {
  const out: Table[] = [];
  $('table').each((_, t) => {
    const el = $(t);
    let headerRow = el.find('thead tr').last();
    if (!headerRow.length) headerRow = el.find('tr').first();
    const headers = headerRow.find('th, td').map((_, c) => (collapse($(c).text()) ?? '').toLowerCase()).get();
    const body = el.find('tbody tr');
    const rows = (body.length ? body : el.find('tr').slice(1)).map((_, r) => $(r)).get();
    const footRows = el.find('tfoot tr').map((_, r) => $(r)).get();
    out.push({ headers, rows, footRows, el });
  });
  return out;
}

function findTable(tables: Table[], required: RegExp[], forbidden: RegExp[] = []): Table | null {
  for (const t of tables) {
    const ok = required.every((re) => t.headers.some((h) => re.test(h)));
    const bad = forbidden.some((re) => t.headers.some((h) => re.test(h)));
    if (ok && !bad) return t;
  }
  return null;
}

function colIndex(headers: string[], ...patterns: RegExp[]): number {
  for (const re of patterns) {
    const i = headers.findIndex((h) => re.test(h));
    if (i >= 0) return i;
  }
  return -1;
}

const H = {
  jersey: [/^#$/, /^no\.?$/, /^num/],
  player: [/^player$/, /^name$/, /player/],
  gp: [/^gp$/, /^games?$/],
  gs: [/^gs$/],
  min: [/^min(utes)?$/],
  g: [/^g$/, /^goals?$/],
  a: [/^a$/, /^ast$/, /^assists?$/],
  pts: [/^pts$/, /^points$/],
  sh: [/^sh$/, /^shots?$/],
  sog: [/^sog$/],
  ycrc: [/^yc-rc$/, /^yc\/rc$/, /^cards$/],
  yc: [/^yc$/],
  rc: [/^rc$/],
  gw: [/^gw$/, /^gwg$/],
  pgpa: [/^pg-pa$/, /^pk-att$/, /^pg\/pa$/, /^pk$/],
  ga: [/^ga$/],
  gaa: [/^gaa$/],
  sv: [/^sv$/, /^saves$/],
  svpct: [/^sv%$/, /^save%$/, /^sv pct/],
  sho: [/^sho$/, /^shutouts?$/, /^so$/],
};

function cellText(row: Cheerio, i: number): string | null {
  if (i < 0) return null;
  return collapse(row.find('th, td').eq(i).text());
}

function keyFor(row: Cheerio, playerCol: number, name: string, jersey: number | null): string {
  const href = row.find('th, td').eq(playerCol).find('a[href*="/roster/"]').attr('href');
  const m = href?.match(/\/roster\/[^/?#]+\/(\d+)(?:[/?#]|$)/);
  if (m) return m[1]!;
  const { firstName, lastName } = splitName(name);
  return nameJerseyKey(lastName, firstName, jersey);
}

function emptyPlayerLine(sourceKey: string, name: string, jersey: number | null): SeasonPlayerLine {
  return {
    sourceKey, name, jersey, gp: null, gs: null, minutes: null, goals: null, assists: null, points: null,
    shots: null, sog: null, yellow: null, red: null, gwg: null, pkGoals: null, pkAttempts: null,
    goalsAllowed: null, saves: null, shutouts: null, gkMinutes: null, gaa: null, savePct: null,
  };
}

function isTotalsRow(name: string | null): boolean {
  return !name || /^(total|totals|team|opponents?|tm)$/i.test(name);
}

function readOffense(t: Table, into: Map<string, SeasonPlayerLine>): void {
  const h = t.headers;
  const c = {
    jersey: colIndex(h, ...H.jersey), player: colIndex(h, ...H.player), gp: colIndex(h, ...H.gp), gs: colIndex(h, ...H.gs),
    min: colIndex(h, ...H.min), g: colIndex(h, ...H.g), a: colIndex(h, ...H.a), pts: colIndex(h, ...H.pts), sh: colIndex(h, ...H.sh),
    sog: colIndex(h, ...H.sog), ycrc: colIndex(h, ...H.ycrc), yc: colIndex(h, ...H.yc), rc: colIndex(h, ...H.rc), gw: colIndex(h, ...H.gw), pgpa: colIndex(h, ...H.pgpa),
  };
  for (const row of t.rows) {
    const nameRaw = cellText(row, c.player);
    if (isTotalsRow(nameRaw)) continue;
    const name = cleanName(nameRaw!);
    const jersey = int(cellText(row, c.jersey));
    const key = keyFor(row, c.player, name, jersey);
    const line = into.get(key) ?? emptyPlayerLine(key, name, jersey);
    line.gp = int(cellText(row, c.gp)); line.gs = int(cellText(row, c.gs)); line.minutes = int(cellText(row, c.min));
    line.goals = int(cellText(row, c.g)); line.assists = int(cellText(row, c.a)); line.points = int(cellText(row, c.pts));
    line.shots = int(cellText(row, c.sh)); line.sog = int(cellText(row, c.sog));
    if (c.ycrc >= 0) { const [y, r] = pair(cellText(row, c.ycrc)); line.yellow = y; line.red = r; }
    else { line.yellow = int(cellText(row, c.yc)); line.red = int(cellText(row, c.rc)); }
    line.gwg = int(cellText(row, c.gw));
    if (c.pgpa >= 0) { const [pg, pa] = pair(cellText(row, c.pgpa)); line.pkGoals = pg; line.pkAttempts = pa; }
    into.set(key, line);
  }
}

function readGoalkeeping(t: Table, into: Map<string, SeasonPlayerLine>): void {
  const h = t.headers;
  const c = {
    jersey: colIndex(h, ...H.jersey), player: colIndex(h, ...H.player), gp: colIndex(h, ...H.gp), gs: colIndex(h, ...H.gs), min: colIndex(h, ...H.min),
    ga: colIndex(h, ...H.ga), gaa: colIndex(h, ...H.gaa), sv: colIndex(h, ...H.sv), svpct: colIndex(h, ...H.svpct), sho: colIndex(h, ...H.sho),
  };
  for (const row of t.rows) {
    const nameRaw = cellText(row, c.player);
    if (isTotalsRow(nameRaw)) continue;
    const name = cleanName(nameRaw!);
    const jersey = int(cellText(row, c.jersey));
    const key = keyFor(row, c.player, name, jersey);
    let line = into.get(key);
    if (!line) {
      // The GK table may key differently (no link); fall back to name match.
      line = [...into.values()].find((l) => l.name.toLowerCase() === name.toLowerCase()) ?? emptyPlayerLine(key, name, jersey);
      if (!into.has(line.sourceKey)) into.set(line.sourceKey, line);
    }
    line.gp ??= int(cellText(row, c.gp)); line.gs ??= int(cellText(row, c.gs));
    line.gkMinutes = int(cellText(row, c.min)) ?? num(cellText(row, c.min));
    line.goalsAllowed = int(cellText(row, c.ga)); line.gaa = num(cellText(row, c.gaa));
    line.saves = int(cellText(row, c.sv)); line.savePct = num(cellText(row, c.svpct)); line.shutouts = num(cellText(row, c.sho));
  }
}

function emptyTeamLine(): SeasonTeamLine {
  return { goals: null, assists: null, shots: null, sog: null, saves: null, fouls: null, corners: null, offsides: null, yellow: null, red: null, pkGoals: null, pkAttempts: null, gamesPlayed: null };
}

function applyTeamRow(line: SeasonTeamLine, label: string, value: string | null): void {
  if (value == null) return;
  const l = label.toLowerCase().replace(/\s+/g, ' ').trim();
  const firstNum = () => int(value.match(/-?\d+/)?.[0]);
  if (/^goals?$/.test(l)) line.goals = int(value);
  else if (/^assists?$/.test(l)) line.assists = int(value);
  else if (/^shots?$/.test(l)) line.shots = int(value);
  else if (/^shots? on goal$/.test(l)) { const [n] = pair(value); line.sog = n ?? int(value); if (line.shots == null) { const [, m] = pair(value); line.shots = m; } }
  else if (/^saves$/.test(l)) line.saves = int(value);
  else if (/^fouls$/.test(l)) line.fouls = int(value);
  else if (/^corner/.test(l)) line.corners = int(value);
  else if (/^offside/.test(l)) line.offsides = int(value);
  else if (/^yellow/.test(l)) line.yellow = int(value);
  else if (/^red/.test(l)) line.red = int(value);
  else if (/^penalty kicks?/.test(l) || /^pk/.test(l)) { const [g, a] = pair(value); line.pkGoals = g ?? firstNum(); line.pkAttempts = a; }
  else if (/^games? played$/.test(l) || /^gp$/.test(l)) line.gamesPlayed = int(value);
}

function readTeamTable(t: Table): { team: SeasonTeamLine; opponents: SeasonTeamLine } {
  const team = emptyTeamLine();
  const opponents = emptyTeamLine();
  const oppCol = t.headers.findIndex((h) => /opponent/.test(h));
  const teamCol = t.headers.findIndex((h, i) => i > 0 && i !== oppCol && h !== '' && h !== '-');
  const tc = teamCol >= 0 ? teamCol : 1;
  const oc = oppCol >= 0 ? oppCol : 2;
  for (const row of t.rows) {
    const cells = row.find('th, td');
    if (cells.length < 3) continue; // section header rows ("Shots", "Penalties", ...)
    const label = collapse(cells.eq(0).text());
    if (!label) continue;
    applyTeamRow(team, label, collapse(cells.eq(tc).text()));
    applyTeamRow(opponents, label, collapse(cells.eq(oc).text()));
  }
  return { team, opponents };
}

/** Parse the cumulative stats page into SeasonStats. Returns empty players when no stat table exists. */
export function parseCumulativeStats(html: string, ctx: SiteContext, sourceUrl?: string): SeasonStats {
  const $ = load(html);
  const tables = readTables($);
  const players = new Map<string, SeasonPlayerLine>();

  const offense = findTable(tables, [H.player[0]!, /^gp$/, /^(g|goals?)$/], [/^ga$/, /^gaa$/]);
  if (offense) readOffense(offense, players);
  const gk = findTable(tables, [H.player[0]!, /^ga$/]) ?? findTable(tables, [H.player[0]!, /^gaa$/]);
  if (gk) readGoalkeeping(gk, players);

  let team: SeasonTeamLine | null = null;
  let opponents: SeasonTeamLine | null = null;
  const teamTable = tables.find((t) => t.headers.some((h) => /opponent/.test(h)) && !t.headers.some((h) => /^gp$/.test(h)) && !t.headers.some((h) => /^date$/.test(h)));
  if (teamTable) ({ team, opponents } = readTeamTable(teamTable));

  // Fill from the individual table's footer (Total / Opponents) when the team table lacks a value.
  if (offense && offense.footRows.length) {
    const h = offense.headers;
    const c = { player: colIndex(h, ...H.player), gp: colIndex(h, ...H.gp), g: colIndex(h, ...H.g), a: colIndex(h, ...H.a), sh: colIndex(h, ...H.sh), sog: colIndex(h, ...H.sog), ycrc: colIndex(h, ...H.ycrc), pgpa: colIndex(h, ...H.pgpa) };
    for (const row of offense.footRows) {
      const label = (cellText(row, c.player) ?? cellText(row, 0) ?? '').toLowerCase();
      const target = /opponent/.test(label) ? (opponents ??= emptyTeamLine()) : /total|team/.test(label) ? (team ??= emptyTeamLine()) : null;
      if (!target) continue;
      target.gamesPlayed ??= int(cellText(row, c.gp));
      target.goals ??= int(cellText(row, c.g)); target.assists ??= int(cellText(row, c.a));
      target.shots ??= int(cellText(row, c.sh)); target.sog ??= int(cellText(row, c.sog));
      if (c.ycrc >= 0) { const [y, r] = pair(cellText(row, c.ycrc)); target.yellow ??= y; target.red ??= r; }
      if (c.pgpa >= 0) { const [g, a] = pair(cellText(row, c.pgpa)); target.pkGoals ??= g; target.pkAttempts ??= a; }
    }
  }
  // Games played: fall back to the number of rows in the "Game Results" table.
  if (team && team.gamesPlayed == null) {
    const results = findTable(tables, [/^date$/, /^opponent$/]);
    if (results) team.gamesPlayed = results.rows.filter((r) => /\d{1,2}\/\d{1,2}\/\d{4}/.test(collapse(r.text()) ?? '')).length || null;
  }
  if (opponents && team && opponents.gamesPlayed == null) opponents.gamesPlayed = team.gamesPlayed;

  const sport = ctx.sportSlug ?? 'mens-soccer';
  return {
    players: [...players.values()],
    team,
    opponents,
    sourceUrl: sourceUrl ?? `${ctx.baseUrl.replace(/\/+$/, '')}/sports/${sport}/stats/${ctx.season}`,
  };
}
