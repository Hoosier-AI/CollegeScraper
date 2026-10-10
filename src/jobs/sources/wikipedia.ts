// wikipedia-sync: league tables from Wikipedia season articles (CC BY-SA 4.0, credited): the US leagues (MLS from
// 1996, NWSL from 2013, USL Pro / USL / USL Championship from 2011, USL League Two, NPSL) and the main leagues
// worldwide (England, Germany, Spain, Italy, France, the Netherlands, Portugal, Scotland, Belgium, Turkey, Austria,
// Brazil, and the top women's leagues), whose season in play is read every run. Pages are the ordinary /wiki/ HTML (robots.txt
// allows it; the API paths are disallowed), one request a second through the shared client, with a contact address in
// the User-Agent. Finished seasons are read once; the season in play is left to API-Football.
// source-map matches the clubs by name, source-check compares points and matches played with API-Football's tables,
// and history-fill uses the tables for seasons API-Football does not have.
import { registerJob, type JobContext } from '../runner.js';
import { makeFetcher } from '../fetcher.js';
import { selectAll } from '../../db/client.js';
import { patchSourceSeason, replaceSrcStandings, upsertSrcTeams, type SrcStandingRow } from '../../db/sourceRepo.js';
import { parseSeasonTables } from '../../sources/wikipedia/parse.js';

export const WIKI_SOURCE = 'wikipedia';
export const WIKI_CREDIT = { name: 'Wikipedia', url: 'https://en.wikipedia.org', license: 'CC BY-SA 4.0' };

/**
 * current: also read the season in play. byLeague: club ids carry the league ("39:Arsenal"), so a women's and a men's
 * club of the same name never share one (the US leagues keep plain names, as the alias file has them).
 */
export interface WikiTarget { league: number; first: number; title: (season: number) => string; current?: boolean; byLeague?: boolean }

const DASH = '%E2%80%93';
/** "2024–25_Premier_League". */
const euro = (name: string) => (y: number) => `${y}${DASH}${String((y + 1) % 100).padStart(2, '0')}_${name}`;
const world = (first: number, league: number, title: (y: number) => string): WikiTarget => ({ league, first, title, current: true, byLeague: true });
export const WIKI_TARGETS: WikiTarget[] = [
  { league: 253, first: 1996, title: (y) => `${y}_Major_League_Soccer_season` },
  { league: 254, first: 2013, title: (y) => `${y}_National_Women%27s_Soccer_League_season` },
  { league: 255, first: 2011, title: (y) => (y <= 2014 ? `${y}_USL_Pro_season` : y <= 2018 ? `${y}_United_Soccer_League_season` : `${y}_USL_Championship_season`) },
  // Pre-pro leagues API-Football has no tables for: their division and conference tables.
  { league: 256, first: 2017, title: (y) => (y >= 2019 ? `${y}_USL_League_Two_season` : `${y}_Premier_Development_League_season`), current: true },
  { league: 1118, first: 2019, title: (y) => `${y}_National_Premier_Soccer_League_season`, current: true },
  // Worldwide: the table each season article keeps up to date.
  world(2000, 39, euro('Premier_League')),
  world(2016, 40, euro('EFL_Championship')),
  world(2016, 41, euro('EFL_League_One')),
  world(2016, 42, euro('EFL_League_Two')),
  world(2000, 78, euro('Bundesliga')),
  world(2000, 79, euro('2._Bundesliga')),
  world(2008, 80, euro('3._Liga')),
  world(2000, 140, euro('La_Liga')),
  world(2000, 141, euro('Segunda_Divisi%C3%B3n')),
  world(2000, 135, euro('Serie_A')),
  world(2000, 136, euro('Serie_B')),
  world(2002, 61, euro('Ligue_1')),
  world(2002, 62, euro('Ligue_2')),
  world(2000, 88, euro('Eredivisie')),
  world(2000, 94, euro('Primeira_Liga')),
  world(2013, 179, euro('Scottish_Premiership')),
  // Belgian First Division A until 2021-22, Belgian Pro League from 2022-23.
  world(2016, 144, (y) => euro(y >= 2022 ? 'Belgian_Pro_League' : 'Belgian_First_Division_A')(y)),
  world(2001, 203, euro('S%C3%BCper_Lig')),
  world(2000, 218, euro('Austrian_Football_Bundesliga')),
  world(2003, 71, (y) => `${y}_Campeonato_Brasileiro_S%C3%A9rie_A`),
  world(2006, 72, (y) => `${y}_Campeonato_Brasileiro_S%C3%A9rie_B`),
  // "2011 FA WSL" (calendar years to 2016), "2017–18 FA WSL", then "2022–23 Women's Super League".
  world(2011, 44, (y) => (y <= 2016 ? `${y}_FA_WSL` : euro(y >= 2022 ? 'Women%27s_Super_League' : 'FA_WSL')(y))),
  world(2010, 82, euro('Frauen-Bundesliga')),
];

/** params: { league?: number, season?: number, force?: boolean } */
export async function wikipediaSync(ctx: JobContext): Promise<void> {
  const f = makeFetcher(ctx.db);
  const done = new Set((await selectAll<{ league_id: number; season: number }>(ctx.db, 'pro_source_seasons', 'league_id,season', (q) => q.eq('source', WIKI_SOURCE).not('synced_at', 'is', null)))
    .map((r) => `${r.league_id}|${r.season}`));
  const current = new Map((await selectAll<{ id: number; current_season: number | null }>(ctx.db, 'pro_leagues', 'id,current_season', (q) => q.in('id', WIKI_TARGETS.map((t) => t.league)))).map((l) => [l.id, l.current_season ?? new Date().getUTCFullYear()]));
  for (const t of WIKI_TARGETS.filter((x) => !Number(ctx.params.league) || x.league === Number(ctx.params.league))) {
    const cur = current.get(t.league) ?? new Date().getUTCFullYear();
    const last = t.current ? cur : cur - 1;
    for (let season = t.first; season <= last; season += 1) {
      if (Number(ctx.params.season) && season !== Number(ctx.params.season)) continue;
      // Finished seasons once; a current one every run (it can still change).
      if (done.has(`${t.league}|${season}`) && season !== cur && !ctx.params.force) continue;
      if (await ctx.cancelled()) return;
      try {
        const res = await f.get(`https://en.wikipedia.org/wiki/${t.title(season)}`, { accept: 'text/html', noStore: true, skipCache: true, attempts: 2 });
        const tables = parseSeasonTables(res.text);
        const at = new Date().toISOString();
        const ext = (team: string) => (t.byLeague ? `${t.league}:${team}` : team);
        const rows: SrcStandingRow[] = tables.flatMap((tb) => tb.rows.map((r) => ({
          source: WIKI_SOURCE, league_id: t.league, season, group_name: tb.group, team_ext: ext(r.team), rank: r.rank, played: r.played, win: r.win, draw: r.draw, lose: r.lose,
          shootout_wins: r.shootout_wins, gf: r.gf, ga: r.ga, gd: r.gd, points: r.points, updated_at: at,
        })));
        // One row per club and table (a page can list a club twice in one table when it is split by a heading).
        const uniq = [...new Map(rows.map((r) => [`${r.group_name}|${r.team_ext}`, r])).values()];
        // Each club's article, for the people crawl (wikidata-sync reads its squad).
        const titles = new Map(tables.flatMap((tb) => tb.rows).filter((r) => r.title).map((r) => [ext(r.team), r.title!]));
        await upsertSrcTeams(ctx.db, [...new Set(uniq.map((r) => r.team_ext))].map((id) => ({ source: WIKI_SOURCE, ext_id: id, league_id: t.league, name: t.byLeague ? id.slice(id.indexOf(':') + 1) : id, short_name: null, abbr: null, updated_at: at, url: titles.get(id) ?? null })));
        await replaceSrcStandings(ctx.db, WIKI_SOURCE, t.league, season, uniq);
        await patchSourceSeason(ctx.db, WIKI_SOURCE, t.league, season, { synced_at: at, games: 0, player_rows: 0, calls: 1, last_error: uniq.length ? null : 'no league table found on the page' });
        ctx.inc('seasons'); ctx.inc('table_rows', uniq.length);
      } catch (err) {
        ctx.inc('errors');
        await patchSourceSeason(ctx.db, WIKI_SOURCE, t.league, season, { last_error: String(err instanceof Error ? err.message : err).slice(0, 500) });
      }
      await ctx.heartbeat();
    }
  }
}

registerJob('wikipedia-sync', wikipediaSync);
