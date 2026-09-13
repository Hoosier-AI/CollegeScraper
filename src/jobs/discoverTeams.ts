// Schools index + school pages (athletics URL, logos) + season scoreboard sweep → schools, programs, program_seasons, conferences.
import { registerJob, type JobContext } from './runner.js';
import { makeFetcher } from './fetcher.js';
import { SCHOOLS_URL, parseSchoolsIndex, parseSchoolPage, schoolPageUrl, scoreboardDay } from '../sources/ncaa/index.js';
import { makeTransport } from './fetchGamesNcaa.js';
import { upsertSchools, upsertProgram, upsertProgramSeasons, upsertConference, listSchools, listPrograms } from '../db/repos.js';
import { currentSeason, eachDate } from './seasons.js';
import type { Division, Gender } from '../model.js';
import { log } from '../log.js';

const DIVISIONS: Division[] = ['d1', 'd2', 'd3'];
const today = () => new Date().toISOString().slice(0, 10);
const minDate = (a: string, b: string) => (a < b ? a : b);
const GENDERS: Gender[] = ['m', 'w'];

/** params: { season?, gender?, division?, program? (seo), skip_school_pages? } */
export async function discoverTeams(ctx: JobContext): Promise<void> {
  const db = ctx.db;
  const season = Number(ctx.params.season ?? currentSeason());
  const fetcher = makeFetcher(db);
  const { store } = makeTransport(db, fetcher);
  await store.init();
  const onlySeo = typeof ctx.params.program === 'string' ? ctx.params.program : null;
  const genders = ctx.params.gender ? [ctx.params.gender as Gender] : GENDERS;
  const divisions = ctx.params.division ? [ctx.params.division as Division] : DIVISIONS;

  // 1. schools index
  const idx = parseSchoolsIndex(JSON.parse((await fetcher.get(SCHOOLS_URL, { accept: 'application/json' })).text));
  // The whole index is always loaded: opponents must resolve even when only one school's pages are refreshed.
  const wanted = idx;
  await upsertSchools(db, wanted.map((s) => ({ seo: s.seo, ncaa_tid: Number(s.tid) || null, name: s.name, long_name: s.longName })));
  ctx.inc('schools_indexed', wanted.length);

  // 2. scoreboard sweep → programs that played + conferences
  const seen = new Map<string, { seo: string; gender: Gender; division: Division; name: string; short: string; char6: string; conf: { name: string; seo: string } | null }>();
  for (const gender of genders) for (const division of divisions) {
    let days = 0, games = 0;
    for (const date of eachDate(`${season}-08-10`, minDate(`${season}-12-20`, today()))) {
      if (await ctx.cancelled()) return;
      let dayGames;
      try { dayGames = await scoreboardDay(fetcher, store, gender, division, date); }
      catch (err) { ctx.inc('scoreboard_errors'); log.warn({ gender, division, date, err: err instanceof Error ? err.message : String(err) }, 'scoreboard day failed'); continue; }
      if (!dayGames.length) continue;
      days += 1;
      for (const g of dayGames) {
        games += 1;
        for (const t of [g.home, g.away]) {
          if (!t.seo) continue;
          const key = `${t.seo}|${gender}`;
          if (!seen.has(key)) seen.set(key, { seo: t.seo, gender, division, name: t.short || t.full || t.seo, short: t.short ?? '', char6: t.char6 ?? '', conf: t.conferences[0] && t.conferences[0].seo ? { name: t.conferences[0].name, seo: t.conferences[0].seo } : null });
        }
      }
      await ctx.heartbeat();
    }
    ctx.inc(`scoreboard_days_${gender}_${division}`, days);
    ctx.inc(`scoreboard_games_${gender}_${division}`, games);
  }

  // Schools that appear on scoreboards but not in the index still need a school row.
  const known = new Set((await listSchools(db)).map((s) => s.seo));
  const missing = [...seen.values()].filter((t) => !known.has(t.seo)).map((t) => ({ seo: t.seo, name: t.short || t.seo, long_name: null }));
  if (missing.length) await upsertSchools(db, [...new Map(missing.map((m) => [m.seo, m])).values()]);

  // 3. programs + program_seasons (+ conferences)
  const confIds = new Map<string, string>();
  const seasonRows: { program_id: string; season: number; division: Division; conference_id: string | null }[] = [];
  for (const t of seen.values()) {
    let confId: string | null = null;
    if (t.conf?.seo) {
      confId = confIds.get(t.conf.seo) ?? null;
      if (!confId) { confId = await upsertConference(db, t.conf.seo, t.conf.name, t.division); confIds.set(t.conf.seo, confId); }
    }
    const program = await upsertProgram(db, { school_seo: t.seo, gender: t.gender, name: t.name, short_name: t.short, name6: t.char6 });
    seasonRows.push({ program_id: program.id, season, division: t.division, conference_id: confId });
  }
  if (seasonRows.length) await upsertProgramSeasons(db, seasonRows);
  ctx.inc('programs', seasonRows.length);

  // 4. school pages → athletics URL + logos (only for schools that have a program and no athletics url yet, unless force)
  if (!ctx.params.skip_school_pages) {
    const programs = await listPrograms(db);
    const seos = [...new Set(programs.map((p) => p.school_seo))].filter((s) => !onlySeo || s === onlySeo);
    const schools = new Map((await listSchools(db)).map((s) => [s.seo, s]));
    let fetched = 0;
    for (const seo of seos) {
      const s = schools.get(seo);
      if (s?.athletics_url && !ctx.params.force) continue;
      if (await ctx.cancelled()) return;
      try {
        const res = await fetcher.get(schoolPageUrl(seo));
        const info = parseSchoolPage(res.text, seo);
        await upsertSchools(db, [{ seo, athletics_url: info.athleticsUrl, athletics_host: info.athleticsHost, logo_svg_url: info.logoLightUrl, logo_dark_url: info.logoDarkUrl, name: s?.name ?? seo }]);
        fetched += 1;
      } catch (err) {
        ctx.inc('school_page_errors');
        log.warn({ seo, err: err instanceof Error ? err.message : String(err) }, 'school page failed');
      }
      await ctx.heartbeat();
    }
    ctx.inc('school_pages_fetched', fetched);
  }
}

registerJob('discover-teams', discoverTeams);
