// The main school-site pass for one or many program-seasons:
// roster + coaches → schedule/results → cumulative stats → box scores → bios (honors).
import { registerJob, type JobContext } from './runner.js';
import { makeFetcher } from './fetcher.js';
import { adapterFor } from '../sources/sites/detect.js';
import { listPrograms, listProgramSeasons, listSchools, listGames, writeRoster, writeCoaches, writeSchedule, writeSiteSeasonStats, writeBoxScore, writeHonors, statLineCandidates, markProgramSeason, mergeBoxscoreOnly, type ProgramRow, type SchoolRow } from '../db/repos.js';
import { selectAll } from '../db/client.js';
import { currentSeason, inSeason } from './seasons.js';
import { teamKey } from '../normalize/teamIdentity.js';
import type { SiteContext } from '../model.js';
import { log } from '../log.js';

type Stage = 'roster' | 'schedule' | 'stats' | 'boxscores' | 'bios';
const ALL_STAGES: Stage[] = ['roster', 'schedule', 'stats', 'boxscores', 'bios'];

/** params: { season?, program? (seo), gender?, division?, stages?: Stage[], only_recent_days?: number, force?: boolean } */
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
  const aliasIndex = buildAliasIndex(allPrograms, schools);
  const games = await listGames(db, season);

  let recentSet: Set<string> | null = null;
  if (ctx.params.only_recent_days) {
    const since = new Date(Date.now() - Number(ctx.params.only_recent_days) * 86400000).toISOString().slice(0, 10);
    recentSet = new Set(games.filter((g) => g.game_date >= since && g.game_date <= new Date(Date.now() + 86400000).toISOString().slice(0, 10)).flatMap((g) => [g.home_program_id, g.away_program_id]).filter((x): x is string => !!x));
  }

  for (const p of programs) {
    if (await ctx.cancelled()) return;
    const ps = seasonByProgram.get(p.id);
    if (!ps || (wantedDivision && ps.division !== wantedDivision)) continue;
    if (recentSet && !recentSet.has(p.id)) continue;
    const school = schools.get(p.school_seo);
    const adapter = school ? adapterFor(school.site_platform) : null;
    if (!school?.athletics_host || !adapter || p.site_status !== 'ok') { ctx.inc('programs_without_site'); continue; }
    const site: SiteContext = { host: school.athletics_host, baseUrl: `https://${school.athletics_host}`, gender: p.gender, season, sportSlug: p.site_sport_slug, sportId: p.site_sport_id, teamSlug: p.site_team_slug };
    ctx.inc('programs');
    try {
      await syncOne(ctx, fetcher, adapter, site, p, school, season, ps.division, stages, aliasIndex, games, divisionOf, conferenceOf, ps.conference_id ?? null);
    } catch (err) {
      ctx.inc('program_failures');
      await markProgramSeason(db, p.id, season, { site_parse_failures: (Number(ps.site_parse_failures) || 0) + 1 });
      log.warn({ seo: p.school_seo, gender: p.gender, err: err instanceof Error ? err.message : String(err) }, 'sync-site program failed');
    }
    await ctx.heartbeat();
  }
}

/** gender → teamKey → candidate program ids (several when the plain name is ambiguous, e.g. "Queens"). */
function buildAliasIndex(programs: ProgramRow[], schools: Map<string, SchoolRow>): Map<string, Map<string, string[]>> {
  const byGender = new Map<string, Map<string, string[]>>();
  const add = (gender: string, name: string | null | undefined, id: string) => {
    if (!name) return;
    for (const k of [teamKey(name), teamKeyKeepParens(name)]) {
      if (!k) continue;
      let m = byGender.get(gender);
      if (!m) { m = new Map(); byGender.set(gender, m); }
      const cur = m.get(k) ?? [];
      if (!cur.includes(id)) { cur.push(id); m.set(k, cur); }
    }
  };
  for (const p of programs) { const s = schools.get(p.school_seo); for (const n of [p.name, p.short_name, s?.name, s?.long_name, p.name6, p.school_seo.replace(/-/g, ' ')]) add(p.gender, n, p.id); }
  return byGender;
}

/** "Notre Dame (OH)" → "notre dame oh": keeps the disambiguating parenthetical as words. */
function teamKeyKeepParens(name: string): string {
  return teamKey(name.replace(/[()]/g, ' '));
}

const PLACEHOLDER_OPPONENT = /\b(tba|tbd|championship|tournament|semifinal|quarterfinal|final|round|winner|loser|opponent)\b/i;

/** Pick one program for an opponent name: exact parenthetical key first, then the plain key; ties broken by division, then conference. */
function makeResolver(aliasIndex: Map<string, Map<string, string[]>>, gender: string, ownDivision: string | null, ownConference: string | null, divisionOf: Map<string, string>, conferenceOf: Map<string, string | null>) {
  return async (name: string): Promise<string | null> => {
    if (!name || PLACEHOLDER_OPPONENT.test(name) && !/\(/.test(name) && name.split(' ').length > 2) return null;
    const m = aliasIndex.get(gender);
    if (!m) return null;
    const exact = m.get(teamKeyKeepParens(name));
    const plain = m.get(teamKey(name));
    const cands = (exact && exact.length ? exact : plain) ?? [];
    if (cands.length === 1) return cands[0]!;
    if (!cands.length) return null;
    const sameDiv = ownDivision ? cands.filter((id) => divisionOf.get(id) === ownDivision) : cands;
    if (sameDiv.length === 1) return sameDiv[0]!;
    const sameConf = ownConference ? sameDiv.filter((id) => conferenceOf.get(id) === ownConference) : [];
    if (sameConf.length === 1) return sameConf[0]!;
    const d1 = sameDiv.filter((id) => divisionOf.get(id) === 'd1');
    if (d1.length === 1) return d1[0]!;
    return null;
  };
}

async function syncOne(ctx: JobContext, fetcher: ReturnType<typeof makeFetcher>, adapter: NonNullable<ReturnType<typeof adapterFor>>, site: SiteContext, p: ProgramRow, school: SchoolRow, season: number, division: 'd1' | 'd2' | 'd3', stages: Set<Stage>, aliasIndex: Map<string, Map<string, string[]>>, games: Awaited<ReturnType<typeof listGames>>, divisionOf: Map<string, string>, conferenceOf: Map<string, string | null>, ownConference: string | null): Promise<void> {
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

  const resolveOpponent = makeResolver(aliasIndex, p.gender, division, ownConference, divisionOf, conferenceOf);
  let boxScoreUrls: { url: string; gameId: string }[] = [];
  if (stages.has('schedule') || stages.has('boxscores')) {
    const entries = (await adapter.schedule(fetcher, site)).filter((e) => inSeason(e.date, season) && !(e.state !== 'final' && PLACEHOLDER_OPPONENT.test(e.opponentName) && e.opponentName.split(' ').length > 2));
    const w = await writeSchedule(db, { programId: p.id, season, gender: p.gender, division, host: site.host, entries, resolveOpponent, existing: games });
    ctx.inc('schedule_entries', entries.length); ctx.inc('games_created', w.created); ctx.inc('games_updated', w.updated);
    if (w.unresolvedOpponents.length) { ctx.inc('unresolved_opponents', w.unresolvedOpponents.length); log.debug({ tag, unresolved: w.unresolvedOpponents }, 'unresolved opponents'); }
    for (const e of entries) {
      if (!e.boxScoreUrl || e.state !== 'final') continue;
      const gid = w.gameIds.get(`${e.boxScoreUrl}|${e.date}`);
      if (gid) boxScoreUrls.push({ url: e.boxScoreUrl, gameId: gid });
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
    // Skip games whose site box score was already stored unless forced.
    const done = new Set<string>();
    if (!ctx.params.force && boxScoreUrls.length) {
      const rows = await selectAll<{ id: string; site_fetched_at: string | null }>(db, 'college_games', 'id,site_fetched_at', (q) => q.in('id', boxScoreUrls.map((b) => b.gameId)));
      for (const r of rows) if (r.site_fetched_at) done.add(r.id);
    }
    const candMap = new Map<string, typeof candidates>([[p.id, candidates]]);
    for (const b of boxScoreUrls) {
      if (done.has(b.gameId)) { ctx.inc('boxscores_skipped'); continue; }
      if (await ctx.cancelled()) return;
      try {
        const box = await adapter.boxScore(fetcher, site, b.url);
        const game = games.find((g) => g.id === b.gameId);
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
