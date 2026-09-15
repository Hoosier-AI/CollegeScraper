// PrestoSports conference websites: https://{host}/sports/msoc/2026-27/standings renders one
// <table> per division with a two-row header: a group row (<th colspan=4>Conference</th><th colspan=3>Overall</th>)
// and a column row (Team | Pts | GP | W-L | Pct | GP | W-L | Pct). Team cells are <th class="team-name"><a …><span>Name</span>.
import * as cheerio from 'cheerio';
import { num } from '../../normalize/num.js';
import { parseRecord, type ConfStandings, type ConfStandingsPod, type ConfStandingsRow } from './sidearmStandings.js';

export function prestoSeasonSlug(season: number): string {
  return `${season}-${String(season + 1).slice(2)}`;
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

export function parsePrestoStandings(html: string): ConfStandings {
  const $ = cheerio.load(html);
  const pods: ConfStandingsPod[] = [];
  const tables = $('table').filter((_, t) => $(t).find('th.team-name, .team-name').length > 0);
  tables.each((ti, table) => {
    const $t = $(table);
    const headerRows = $t.find('thead tr');
    // Column → group from the colspan row; column → label from the last header row.
    const groups: string[] = [];
    const groupRow = headerRows.filter((_, tr) => $(tr).find('th[colspan]').length > 0).first();
    groupRow.children('th, td').each((_, c) => {
      const span = Number($(c).attr('colspan')) || 1;
      const g = clean($(c).text()).toLowerCase();
      for (let i = 0; i < span; i++) groups.push(g);
    });
    const labelRow = headerRows.last();
    const labels = labelRow.children('th, td').map((_, c) => clean($(c).text())).get();
    const heading = clean($t.prevAll('h2, h3, h4, .card-header').first().text()) || clean($t.find('caption').text());
    const pod: ConfStandingsPod = { name: tables.length > 1 ? heading || `Table ${ti + 1}` : null, rows: [] };
    $t.find('tbody tr').each((_, tr) => {
      const cells = $(tr).children('th, td');
      const raw: Record<string, string> = {};
      const row: ConfStandingsRow = { school: '', logoAlt: null, scheduleUrl: null, rankLabel: null, conf: null, confPts: null, confPct: null, overall: null, overallPct: null, confGf: null, confGa: null, gf: null, ga: null, home: null, away: null, streak: null, raw };
      cells.each((i, c) => {
        const $c = $(c);
        const text = clean($c.text());
        const label = labels[i] ?? `col${i}`;
        const group = groups[i] ?? '';
        raw[label in raw ? `${label} (${i})` : label] = text;
        if ($c.hasClass('team-name') || $c.find('a[href*="schedule"]').length) {
          row.school = clean($c.find('span').first().text()) || clean($c.find('a').first().text()) || text;
          row.scheduleUrl = $c.find('a[href]').first().attr('href') ?? null;
          row.logoAlt = $c.find('img[alt]').attr('alt')?.trim() || null;
          return;
        }
        const l = label.toLowerCase();
        const isConf = group.includes('conf') || group.includes('league') || group.includes('division');
        const isOverall = group.includes('overall') || group.includes('all');
        const rec = parseRecord(text);
        if (rec && /w-?l|record|^w$/.test(l) || (rec && !/gf|ga|goals/.test(l))) {
          if (isConf && !row.conf) row.conf = rec;
          else if (isOverall && !row.overall) row.overall = rec;
          else if (/home/.test(l)) row.home = text;
          else if (/away|road/.test(l)) row.away = text;
          return;
        }
        if (/^pts|points/.test(l)) { if (isConf && row.confPts == null) row.confPts = num(text); return; }
        if (/pct|%/.test(l)) { if (isConf && row.confPct == null) row.confPct = num(text); else if (isOverall && row.overallPct == null) row.overallPct = num(text); return; }
        if (/streak/.test(l)) { row.streak = text || null; return; }
        if (/^gf$/.test(l)) { if (isConf) row.confGf = num(text); else row.gf = num(text); return; }
        if (/^ga$/.test(l)) { if (isConf) row.confGa = num(text); else row.ga = num(text); return; }
      });
      if (row.school) pod.rows.push(row);
    });
    if (pod.rows.length) pods.push(pod);
  });
  return { caption: clean($('h1').first().text()) || null, pods };
}
