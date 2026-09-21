// The main school-site pass for one or many program-seasons:
// roster + coaches → schedule/results → cumulative stats → box scores → bios (honors).
import { registerJob, type JobContext } from './runner.js';
import { makeFetcher } from './fetcher.js';
import { adapterFor } from '../sources/sites/detect.js';
import { listPrograms, listProgramSeasons, listSchools, listGames, writeRoster, writeCoaches, writeSchedule, writeSiteSeasonStats, writeBoxScore, writeHonors, statLineCandidates, markProgramSeason, mergeBoxscoreOnly, reorientGame, type ProgramRow, type SchoolRow } from '../db/repos.js';
import { selectAll, kvGet } from '../db/client.js';
import { currentSeason, inSeason } from './seasons.js';
import { swapBoxSides } from '../normalize/boxScore.js';
import { setMembership, setKnownConferences, buildAliasIndex, makeResolver, isPlaceholderOpponent, isExhibitionName, matchAmongMembers, type AliasIndex } from '../normalize/aliasIndex.js';
import { listConferences } from '../db/standingsRepo.js';
import type { Fetcher, SiteContext } from '../model.js';
import { log } from '../log.js';

type Stage = 'roster' | 'schedule' | 'stats' | 'boxscores' | 'bios';
const ALL_STAGES: Stage[] = ['roster', 'schedule', 'stats', 'boxscores', 'bios'];

/** params: { season?, program? (seo), gender?, division?, stages?: Stage[], only_recent_days?: number, only_pending_boxscores?: number|boolean, only_never_synced?: boolean, force?: boolean, reparse?: boolean } */
/** gender_division → first NCAA-listed contest date of the season (written by reconcile-games). */
let seasonOpeners: Record<string, string> = {};

export async function syncSite(ctx: JobContext): Promise<void> {
  const db = ctx.db;
  const season = Number(ctx.params.season ?? currentSeason());
  const stages = new Set<Stage>((ctx.params.stages as Stage[] | undefined) ?? ALL_STAGES);
  const fetcher = makeFetcher(db, { freshMs: ctx.params.force ? 0 : 6 * 3600_000 });
  const onlySeo = typeof ctx.params.program === 'string' ? ctx.params.program : null;
  const schools = new Map((await listSchools(db)).map((s) => [s.seo, s]));
  const allPrograms = await listPrograms(db);
  const programs = allPrograms.filter((p) => (!onlySeo || p.school_seo === onlySeo) && (!ctx.params.gender || p.gender === ctx.params.gender));
  const seasons = await listProgramSeasons(db, season);
  const wantedDivision = typeof ctx.params.division === 'string' ? ctx.params.division : null;
  const seasonByProgram = new Map(seasons.map((s) => [s.program_id, s]));
  const divisionOf = new Map(seasons.map((s) => [s.program_id, s.division as string]));
  const conferenceOf = new Map(seasons.map((s) => [s.program_id, (s.conference_id as string | null) ?? null]));
  const programById = new Map(programs.map((p) => [p.id, p]));
  // Opponent resolution: by school name aliases within the same gender.
  setKnownConferences((await listConferences(db)).map((c) => c.name));
  setMembership(new Map(seasons.map((x) => [x.program_id, (x as { ncaa_member?: boolean }).ncaa_member !== false])));
  const aliasIndex = buildAliasIndex(allPrograms, schools);
  const games = await listGames(db, season);
  seasonOpeners = (await kvGet<Record<string, string>>(db, `season_open:${season}`)) ?? {};
  const allById = new Map(allPrograms.map((x) => [x.id, x]));
  const namesOf = (id: string): (string | null | undefined)[] => { const pr = allById.get(id); const sc = pr ? schools.get(pr.school_seo) : undefined; return pr ? [pr.name, pr.short_name, sc?.name, sc?.long_name, pr.school_seo.replace(/-/g, ' ')] : []; };

  let recentSet: Set<string> | null = null;
  // only_pending_boxscores: just the programs with a final in the last N days whose school box score is still missing
  // (the in-season hourly pass; a full schedule refresh for every program is the nightly job's work).
  if (ctx.params.only_pending_boxscores) {
    const days = typeof ctx.params.only_pending_boxscores === 'number' ? ctx.params.only_pending_boxscores : 3;
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    recentSet = new Set(games.filter((g) => g.status === 'final' && g.game_date >= since && !g.site_fetched_at).flatMap((g) => [g.home_program_id, g.away_program_id]).filter((x): x is string => !!x));
    ctx.inc('programs_with_pending_boxscores', recentSet.size);
  }
  if (ctx.params.only_recent_days) {
    const since = new Date(Date.now() - Number(ctx.params.only_recent_days) * 86400000).toISOString().slice(0, 10);
    recentSet = new Set(games.filter((g) => g.game_date >= since && g.game_date <= new Date(Date.now() + 86400000).toISOString().slice(0, 10)).flatMap((g) => [g.home_program_id, g.away_program_id]).filter((x): x is string => !!x));
  }

  for (const p of programs) {
    if (await ctx.cancelled()) return;
    const ps = seasonByProgram.get(p.id);
    if (!ps || (wantedDivision && ps.division !== wantedDivision)) continue;
    // only_never_synced: programs whose roster has never been read (newly detected sites), nothing else.
    if (ctx.params.only_never_synced && ps.roster_synced_at) continue;
    if (recentSet && !recentSet.has(p.id)) continue;
    const school = schools.get(p.school_seo);
    const adapter = school ? adapterFor(school.site_platform) : null;
    if (!school?.athletics_host || !adapter || p.site_status !== 'ok') { ctx.inc('programs_without_site'); continue; }
    const site: SiteContext = { host: school.athletics_host, baseUrl: `https://${school.athletics_host}`, gender: p.gender, season, sportSlug: p.site_sport_slug, sportId: p.site_sport_id, teamSlug: p.site_team_slug };
    ctx.inc('programs');
    try {
      await syncOne(ctx, fetcher, adapter, site, p, school, season, ps.division, stages, aliasIndex, games, divisionOf, conferenceOf, ps.conference_id ?? null, namesOf);
    } catch (err) {
      ctx.inc('program_failures');
      await markProgramSeason(db, p.id, season, { site_parse_failures: (Number(ps.site_parse_failures) || 0) + 1 });
      log.warn({ seo: p.school_seo, gender: p.gender, err: err instanceof Error ? err.message : String(err) }, 'sync-site program failed');
    }
    await ctx.heartbeat();
  }
}

async function syncOne(ctx: JobContext, fetcher: ReturnType<typeof makeFetcher>, adapter: NonNullable<ReturnType<typeof adapterFor>>, site: SiteContext, p: ProgramRow, school: SchoolRow, season: number, division: 'd1' | 'd2' | 'd3', stages: Set<Stage>, aliasIndex: AliasIndex, games: Awaited<ReturnType<typeof listGames>>, divisionOf: Map<string, string>, conferenceOf: Map<string, string | null>, ownConference: string | null, namesOf: (id: string) => (string | null | undefined)[]): Promise<void> {
  const db = ctx.db;
  const tag = `${p.school_seo}/${p.gender}`;
  let rosterIds: Map<string, string> | null = null;
  let rosterBios: { sourceKey: string; bioUrl: string | null }[] = [];

  if (stages.has('roster')) {
    const roster = await adapter.roster(fetcher, site);
    if (roster.players.length) {
      const r = await writeRoster(db, p.id, season, site.host, roster, roster.players.some((x) => x.sitePlayerId) ? 'site_json' : 'site_html');
      rosterIds = r.playerSeasonIds;
      rosterBios = roster.players.map((x) => ({ sourceKey: x.sourceKey, bioUrl: x.bioUrl }));
      ctx.inc('roster_players', roster.players.length); ctx.inc('players_created', r.created); ctx.inc('players_linked', r.linked); ctx.inc('low_confidence_links', r.lowConfidence);
      ctx.inc('coaches', await writeCoaches(db, p.id, season, roster.coaches));
      const mg = await mergeBoxscoreOnly(db, p.id, season);
      ctx.inc('boxscore_only_merged', mg.merged); ctx.inc('boxscore_only_kept', mg.kept);
      await markProgramSeason(db, p.id, season, { roster_synced_at: new Date().toISOString() });
    } else ctx.inc('empty_rosters');
  }

  const resolveOpponent = makeResolver(aliasIndex, { gender: p.gender, ownDivision: division, ownConference, divisionOf, conferenceOf });
  let boxScoreUrls: { url: string; gameId: string; date: string }[] = [];
  if (stages.has('schedule') || stages.has('boxscores')) {
    // Placeholder rows ("TBD", "Semifinals", "MAC Tournament") are dropped unless the game was actually played.
    const entries = (await adapter.schedule(fetcher, site)).filter((e) => inSeason(e.date, season) && !(e.state !== 'final' && isPlaceholderOpponent(e.opponentName)));
    const opener = seasonOpeners[`${p.gender}_${division}`];
    for (const e of entries) if (isExhibitionName(e.opponentName) || (opener && e.date < opener)) e.isExhibition = true;
    const w = await writeSchedule(db, { programId: p.id, season, gender: p.gender, division, host: site.host, entries, resolveOpponent, existing: games });
    ctx.inc('schedule_entries', entries.length); ctx.inc('games_created', w.created); ctx.inc('games_updated', w.updated);
    if (w.unresolvedOpponents.length) { ctx.inc('unresolved_opponents', w.unresolvedOpponents.length); log.debug({ tag, unresolved: w.unresolvedOpponents }, 'unresolved opponents'); }
    for (const e of entries) {
      if (!e.boxScoreUrl || e.state !== 'final') continue;
      const gid = w.gameIds.get(`${e.boxScoreUrl}|${e.date}`);
      if (gid) boxScoreUrls.push({ url: e.boxScoreUrl, gameId: gid, date: e.date });
    }
    await markProgramSeason(db, p.id, season, { schedule_synced_at: new Date().toISOString() });
  }

  const candidates = await statLineCandidates(db, p.id, season);

  if (stages.has('stats')) {
    const stats = await adapter.seasonStats(fetcher, site);
    if (stats) {
      const r = await writeSiteSeasonStats(db, p.id, season, stats, candidates);
      ctx.inc('site_season_stat_rows', r.written); ctx.inc('site_season_stat_unmatched', r.unmatched);
      await markProgramSeason(db, p.id, season, { stats_synced_at: new Date().toISOString() });
    }
  }

  if (stages.has('boxscores')) {
    // Skip games whose site box score was already stored unless forced. `reparse` re-reads every box score from the
    // stored fetch bodies (a parser fix applied to pages already crawled) without asking the school again.
    const reparse = !!ctx.params.reparse;
    const boxFetcher: Fetcher = reparse ? { get: (u, o) => fetcher.get(u, { ...o, freshMs: 400 * 86400_000 }) } : fetcher;
    const done = new Set<string>();
    if (!ctx.params.force && !reparse && boxScoreUrls.length) {
      const rows = await selectAll<{ id: string; site_fetched_at: string | null }>(db, 'college_games', 'id,site_fetched_at', (q) => q.in('id', boxScoreUrls.map((b) => b.gameId)));
      for (const r of rows) if (r.site_fetched_at) done.add(r.id);
    }
    const candMap = new Map<string, typeof candidates>([[p.id, candidates]]);
    for (const b of boxScoreUrls) {
      if (done.has(b.gameId)) { ctx.inc('boxscores_skipped'); continue; }
      if (await ctx.cancelled()) return;
      try {
        // Box scores name the home and visiting teams explicitly, so they beat a schedule's home/away stamp. They do
        // not beat NCAA.com: a school's box score sometimes lists its own team first whatever the venue, and flipping
        // an NCAA-linked fixture here would undo the orientation the scoreboard sweep just set (Spalding at Aurora).
        // For a linked game the box itself is turned round instead, so each side's stats and score land on the right
        // program (Marietta 3 at Piedmont 2 was stored as a Marietta loss when the box was paired positionally).
        let box = await adapter.boxScore(boxFetcher, site, b.url, { date: b.date });
        const game = games.find((g) => g.id === b.gameId);
        if (game?.home_program_id && game.away_program_id) {
          const sides = [{ id: game.home_program_id, names: namesOf(game.home_program_id) }, { id: game.away_program_id, names: namesOf(game.away_program_id) }];
          const bh = matchAmongMembers(box.home.name, sides), ba = matchAmongMembers(box.away.name, sides);
          const swapped = (bh === game.away_program_id && ba !== game.away_program_id) || (ba === game.home_program_id && bh !== game.home_program_id);
          if (swapped && game.ncaa_contest_id) { box = swapBoxSides(box); ctx.inc('boxscore_sides_swapped'); }
          else if (swapped) ctx.inc(await reorientGame(db, game) ? 'boxscore_orientation_fixed' : 'boxscore_orientation_conflicts');
        }
        const homeId = game?.home_program_id ?? null, awayId = game?.away_program_id ?? null;
        for (const pid of [homeId, awayId]) if (pid && pid !== p.id && !candMap.has(pid)) candMap.set(pid, await statLineCandidates(db, pid, season));
        // Only the tenant's own side gets boxscore-only players created; the opponent's site will create theirs.
        const r = await writeBoxScore(db, { gameId: b.gameId, source: 'site', homeProgramId: homeId, awayProgramId: awayId, box, candidates: candMap, season, createMissing: true });
        ctx.inc('boxscores'); ctx.inc('boxscore_player_rows', r.playerRows); ctx.inc('boxscore_events', r.events); ctx.inc('boxscore_unmatched_lines', r.unmatched); ctx.inc('boxscore_only_players', r.createdPlayers);
        if (!r.valid) { ctx.inc('boxscores_invalid'); log.debug({ tag, url: b.url, problems: r.problems }, 'box score validation'); }
      } catch (err) {
        ctx.inc('boxscore_errors');
        log.warn({ tag, url: b.url, err: err instanceof Error ? err.message : String(err) }, 'box score failed');
      }
      await ctx.heartbeat();
    }
    await markProgramSeason(db, p.id, season, { boxscores_synced_at: new Date().toISOString() });
  }

  if (stages.has('bios') && rosterIds) {
    // Only players without honors yet (bios rarely change mid-season).
    const psIds = [...rosterIds.values()];
    const have = new Set((await selectAll<{ player_season_id: string }>(db, 'college_player_honors', 'player_season_id', (q) => q.in('player_season_id', psIds))).map((h) => h.player_season_id));
    for (const rb of rosterBios) {
      const psId = rosterIds.get(rb.sourceKey);
      if (!psId || !rb.bioUrl || (have.has(psId) && !ctx.params.force)) continue;
      if (await ctx.cancelled()) return;
      try {
        const bio = await adapter.playerBio(fetcher, site, rb.bioUrl);
        ctx.inc('bios'); ctx.inc('honors', await writeHonors(db, psId, bio));
      } catch { ctx.inc('bio_errors'); }
      await ctx.heartbeat();
    }
  }
  void school;
}

registerJob('sync-site', syncSite);
