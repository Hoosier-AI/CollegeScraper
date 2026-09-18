// Conference websites on the Sidearm platform publish official standings server-side at
// https://{host}/standings.aspx?path=msoc|wsoc as <table class="sidearm-standings-table">.
// Every column exists twice (a mobile copy marked aria-hidden="true" + the desktop copy); only the
// desktop cells are read. Column sets differ per conference (Conf W-L-T, Pts/CPts, Pct, Overall, GF-GA,
// Home/Away, Streak…), so headers are classified heuristically. Rows inside a table can be grouped by
// <tr><th scope="colgroup" colspan=…>East Division</th></tr> separators ("pods"). Table order = official rank.
import * as cheerio from 'cheerio';
import { int, num } from '../../normalize/num.js';

export interface WLT { w: number | null; l: number | null; t: number | null }

export interface ConfStandingsRow {
  school: string;
  logoAlt: string | null;
  scheduleUrl: string | null;
  /** Explicit rank cell when present ("1", "T1"); otherwise null and the row order is the rank. */
  rankLabel: string | null;
  conf: WLT | null;
  confPts: number | null;
  confPct: number | null;
  overall: WLT | null;
  overallPct: number | null;
  confGf: number | null;
  confGa: number | null;
  gf: number | null;
  ga: number | null;
  home: string | null;
  away: string | null;
  streak: string | null;
  /** Every desktop cell keyed by header text. */
  raw: Record<string, string>;
}

export interface ConfStandingsPod { name: string | null; rows: ConfStandingsRow[] }
export interface ConfStandings { caption: string | null; pods: ConfStandingsPod[] }

export function conferenceStandingsUrl(host: string, gender: 'm' | 'w', path?: string | null): string {
  return `https://${host}${path ?? `/standings.aspx?path=${gender === 'w' ? 'wsoc' : 'msoc'}`}`;
}

const REC = /^(\d+)-(\d+)(?:-(\d+))?$/;
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

export function parseRecord(s: string | null | undefined): WLT | null {
  const m = clean(s ?? '').match(REC);
  if (!m) return null;
  return { w: Number(m[1]), l: Number(m[2]), t: m[3] != null ? Number(m[3]) : 0 };
}

type Kind = 'school' | 'rank' | 'conf' | 'overall' | 'pts' | 'confpct' | 'overallpct' | 'pct' | 'gfga' | 'home' | 'away' | 'streak' | 'other';

function classify(header: string): Kind {
  const h = header.toLowerCase().replace(/\./g, '').trim();
  if (!h || /^(rank|pos|#)$/.test(h)) return 'rank';
  if (/^(school|team|member|institution)/.test(h)) return 'school';
  // Games played and "last ten" columns hold plain numbers or W-L-T strings that are not records.
  if (/^(conf(erence)? )?gp$|^games( played)?$|^l\d+$|^last \d+/.test(h)) return 'other';
  // Goals for/against, also printed as PF-PA (points for/against) on some conference sites.
  if ((/gf|goals? (for|against)|g\/g/.test(h) || /^(conf(erence)? )?(pf-pa|pf\/pa|pf|pa|gf-ga|gf\/ga|ga)$/.test(h)) && !/pct/.test(h)) return 'gfga';
  if (/^(overall|all|record|ovr|ovrl)$/.test(h) || /^overall (record|w-l(-t)?)$/.test(h)) return 'overall';
  if (/^(c ?pts?|conf(erence)? ?(pts|points)|div(ision)?\.? ?points|league pts|pts?|points|cpt)$/.test(h)) return 'pts';
  if (/^c ?pct|^conf(erence)? ?pct|^league pct/.test(h)) return 'confpct';
  if (/^(ovr|overall) ?pct|^overall win/.test(h)) return 'overallpct';
  if (/pct|win ?%|percentage|^%$/.test(h)) return 'pct';
  if (/streak/.test(h)) return 'streak';
  if (/home/.test(h) && !/away/.test(h)) return 'home';
  if (/away|road/.test(h)) return 'away';
  if (/neutral/.test(h)) return 'other';
  // Anything else that holds a W-L(-T) value is the conference record (header = conference abbreviation, "Conf", "League", "W-L-T", "Division"…).
  return 'conf';
}

export function parseSidearmStandings(html: string): ConfStandings {
  const $ = cheerio.load(html);
  let tables = $('table.sidearm-standings-table');
  if (tables.length === 0) tables = $('table').filter((_, t) => /standings/i.test($(t).find('caption').text()) || $(t).find('thead th').length > 3);
  const caption = clean(tables.first().find('caption').first().text()) || null;
  const pods: ConfStandingsPod[] = [];
  tables.each((ti, table) => {
    const $t = $(table);
    const headers = $t.find('thead th').filter((_, th) => $(th).attr('aria-hidden') !== 'true').map((_, th) => clean($(th).text())).get();
    if (headers.length < 3) return;
    const kinds = headers.map(classify);
    // Records: first "conf" header before the overall column; a second record-like column after "overall" is home/away etc.
    const overallIdx = kinds.indexOf('overall');
    let podName: string | null = null;
    if (tables.length > 1) {
      const heading = $t.closest('.sidearm-table-overflow, .standings-table, div').prevAll('h2, h3, h4').first().text();
      const cap = clean($t.find('caption').text());
      podName = clean(heading) || (cap && cap !== caption ? cap : null) || `Table ${ti + 1}`;
    }
    let pod: ConfStandingsPod = { name: podName, rows: [] };
    let pushed = false;
    $t.find('tbody tr, tr').each((_, tr) => {
      const $tr = $(tr);
      if ($tr.parents('thead').length) return;
      const groupTh = $tr.children('th').filter((_, th) => $(th).attr('aria-hidden') !== 'true');
      if (groupTh.length && $tr.children('td').length === 0) {
        const name = clean(groupTh.first().text());
        if (pod.rows.length || pushed) { if (pod.rows.length) { pods.push(pod); pushed = true; } }
        pod = { name: name || podName, rows: [] };
        return;
      }
      const cells = $tr.children('td').filter((_, td) => $(td).attr('aria-hidden') !== 'true');
      if (cells.length === 0) return;
      const raw: Record<string, string> = {};
      const row: ConfStandingsRow = { school: '', logoAlt: null, scheduleUrl: null, rankLabel: null, conf: null, confPts: null, confPct: null, overall: null, overallPct: null, confGf: null, confGa: null, gf: null, ga: null, home: null, away: null, streak: null, raw };
      let confSeen = false, pctSeen = 0;
      cells.each((i, td) => {
        const $td = $(td);
        const text = clean($td.text());
        const header = headers[i] ?? `col${i}`;
        raw[header in raw ? `${header} (${i})` : header] = text;
        const kind = kinds[i] ?? 'other';
        const link = $td.find('a[href]').first();
        if ((kind === 'school' || (!row.school && link.length)) && (link.length || text)) {
          if (!row.school) {
            row.school = clean(link.length ? link.text() : text) || text;
            row.scheduleUrl = link.attr('href') ?? null;
            row.logoAlt = $td.find('img[alt]').attr('alt')?.trim() || null;
            return;
          }
        }
        switch (kind) {
          case 'rank': if (text && !row.school) row.rankLabel = text; else if (text && row.school && !row.rankLabel && /^t?\d+$/i.test(text)) row.rankLabel = text; break;
          case 'conf': {
            const rec = parseRecord(text);
            if (rec && !confSeen) { row.conf = rec; confSeen = true; }
            else if (rec && confSeen && !row.overall && overallIdx < 0) row.overall = rec;
            break;
          }
          case 'overall': row.overall = parseRecord(text) ?? row.overall; break;
          case 'pts': if (row.confPts == null) row.confPts = num(text); break;
          case 'confpct': row.confPct = num(text); break;
          case 'overallpct': row.overallPct = num(text); break;
          case 'pct': {
            const v = num(text);
            pctSeen += 1;
            if (row.confPct == null && (overallIdx < 0 ? pctSeen === 1 : i < overallIdx)) row.confPct = v;
            else if (row.overallPct == null) row.overallPct = v;
            break;
          }
          case 'gfga': {
            const m = text.match(/^(\d+)\s*[-/]\s*(\d+)$/);
            if (!m) break;
            const isConf = /conf/i.test(header) || (overallIdx >= 0 && i < overallIdx && !/overall|all/i.test(header));
            if (isConf && row.confGf == null) { row.confGf = Number(m[1]); row.confGa = Number(m[2]); }
            else if (row.gf == null) { row.gf = Number(m[1]); row.ga = Number(m[2]); }
            break;
          }
          case 'home': if (!row.home) row.home = text || null; break;
          case 'away': if (!row.away) row.away = text || null; break;
          case 'streak': if (!row.streak) row.streak = text || null; break;
          default: break;
        }
      });
      if (row.school) pod.rows.push(row);
    });
    if (pod.rows.length) pods.push(pod);
  });
  void int;
  return { caption, pods };
}
