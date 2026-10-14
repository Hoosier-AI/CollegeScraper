// Schools index + school pages (athletics URL, logos) + season scoreboard sweep → schools, programs, program_seasons, conferences.
import { registerJob, type JobContext } from './runner.js';
import { makeFetcher } from './fetcher.js';
import { SCHOOLS_URL, parseSchoolsIndex, parseSchoolPage, schoolPageUrl, scoreboardDay } from '../sources/ncaa/index.js';
import { makeTransport } from './fetchGamesNcaa.js';
import { upsertSchools, upsertProgram, upsertProgramSeasons, upsertConference, listSchools, listPrograms } from '../db/repos.js';
import { selectAll } from '../db/client.js';
import { currentSeason, eachDate } from './seasons.js';
import type { Division, Gender } from '../model.js';
import { log } from '../log.js';
import { ncaaLogoUrl } from '../normalize/logos.js';

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
  const seen = new Map<string, { seo: string; gender: Gender; division: Division; name: string; short: string; char6: string; conf: { name: string; seo: string } | null; divCounts: Partial<Record<Division, number>> }>();
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
          const cur = seen.get(key);
          const conf = t.conferences[0] && t.conferences[0].seo ? { name: t.conferences[0].name, seo: t.conferences[0].seo } : null;
          if (!cur) seen.set(key, { seo: t.seo, gender, division, name: t.short || t.full || t.seo, short: t.short ?? '', char6: t.char6 ?? '', conf, divCounts: { [division]: 1 } });
          else { cur.divCounts[division] = (cur.divCounts[division] ?? 0) + 1; if (!cur.conf && conf) cur.conf = conf; }
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
  // A run over some divisions only (a per-division backfill) sees a team only on the scoreboards of those divisions:
  // a D1 side that played one D3 opponent appears on the D3 scoreboard once and nowhere else in that run. Such a run
  // never changes the division of a team the season already has (2026-10-14: per-division backfills had relabelled
  // ~290 program-seasons, Indiana as D3 in 2025); it only adds teams that are new.
  const partial = divisions.length < DIVISIONS.length;
  const knownDiv = partial ? new Map((await selectAll<{ program_id: string; division: Division }>(db, 'college_program_seasons', 'program_id,division', (q) => q.eq('season', season).order('program_id'))).map((r) => [r.program_id, r.division])) : new Map<string, Division>();
  const confIds = new Map<string, string>();
  const seasonRows: { program_id: string; season: number; division: Division; conference_id: string | null }[] = [];
  for (const t of seen.values()) {
    // A D3 school on a D1 scoreboard is still D3: use the division it appeared in most often.
    t.division = (Object.entries(t.divCounts).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0]?.[0] as Division) ?? t.division;
    let confId: string | null = null;
    if (t.conf?.seo) {
      confId = confIds.get(t.conf.seo) ?? null;
      if (!confId) { confId = await upsertConference(db, t.conf.seo, t.conf.name, t.division); confIds.set(t.conf.seo, confId); }
    }
    const program = await upsertProgram(db, { school_seo: t.seo, gender: t.gender, name: t.name, short_name: t.short, name6: t.char6 });
    seasonRows.push({ program_id: program.id, season, division: knownDiv.get(program.id) ?? t.division, conference_id: confId });
  }
  // A scoreboard that shows no conference for a team never clears the one we have (Cal women lost the ACC this way,
  // and the standings job then created a synthetic twin): rows without one are written without the column.
  const withConf = seasonRows.filter((r) => r.conference_id);
  const noConf = seasonRows.filter((r) => !r.conference_id).map(({ conference_id: _c, ...r }) => r);
  if (withConf.length) await upsertProgramSeasons(db, withConf);
  if (noConf.length) await upsertProgramSeasons(db, noConf as typeof seasonRows);
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

    // 5. Crest fallback: a real school whose page gave no logo (or failed) gets NCAA.com's crest at its fixed address,
    // when that address serves an image. Without it 800+ fixtures showed a blank crest (2026-10).
    const noLogo = [...new Map((await listSchools(db)).map((s) => [s.seo, s])).values()].filter((s) => !s.logo_svg_url && seos.includes(s.seo) && ncaaLogoUrl(s.seo));
    let crests = 0;
    for (const s of noLogo.slice(0, 600)) {
      if (await ctx.cancelled()) return;
      const url = ncaaLogoUrl(s.seo)!;
      if (await imageServed(url)) { await upsertSchools(db, [{ seo: s.seo, name: s.name, logo_svg_url: url }]); crests += 1; }
    }
    ctx.inc('crests_from_ncaa_address', crests);
  }
}

/** True when `url` answers 200 with an image (NCAA.com answers 403/404 for a slug it has no crest for). */
export async function imageServed(url: string, doFetch: typeof fetch = fetch): Promise<boolean> {
  try {
    const r = await doFetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PlaibookStats/1.0)' }, signal: AbortSignal.timeout(10_000) });
    const ok = r.ok && /image|svg/.test(r.headers.get('content-type') ?? '');
    await r.body?.cancel().catch(() => undefined);
    return ok;
  } catch { return false; }
}

registerJob('discover-teams', discoverTeams);

/** A team-season's division from its own games: the division of the scoreboards most of its games were on, where it
 *  played 5+ games and 70%+ of them sit in one division. Repairs labels a partial discovery run got wrong (the backfill
 *  runs it after every per-division pass). Non-members with a game or two keep whatever they have. */
export async function fixDivisions(ctx: JobContext): Promise<void> {
  const season = Number(ctx.params.season ?? currentSeason());
  const games = await selectAll<{ home_program_id: string | null; away_program_id: string | null; division: Division | null }>(ctx.db, 'college_games', 'home_program_id,away_program_id,division', (q) => q.eq('season', season).not('division', 'is', null).order('id'));
  const counts = new Map<string, Map<Division, number>>();
  for (const g of games) for (const pid of [g.home_program_id, g.away_program_id]) {
    if (!pid || !g.division) continue;
    const c = counts.get(pid) ?? new Map<Division, number>(); c.set(g.division, (c.get(g.division) ?? 0) + 1); counts.set(pid, c);
  }
  const rows = await selectAll<{ program_id: string; division: Division }>(ctx.db, 'college_program_seasons', 'program_id,division', (q) => q.eq('season', season).order('program_id'));
  let fixed = 0;
  for (const r of rows) {
    const c = counts.get(r.program_id); if (!c) continue;
    const total = [...c.values()].reduce((a, b) => a + b, 0);
    const [best, n] = [...c].sort((a, b) => b[1] - a[1])[0]!;
    if (total < 5 || n / total < 0.7 || best === r.division) continue;
    const { error } = await ctx.db.from('college_program_seasons').update({ division: best }).eq('program_id', r.program_id).eq('season', season);
    if (error) throw new Error(`fix-divisions: ${error.message}`);
    fixed += 1;
    log.info({ program_id: r.program_id, season, from: r.division, to: best }, 'division fixed from games');
  }
  ctx.inc('checked', rows.length);
  ctx.inc('fixed', fixed);
}
registerJob('fix-divisions', fixDivisions);
