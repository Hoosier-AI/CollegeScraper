// Standings: official tables from conference websites (Sidearm standings.aspx) where a site is registered in
// data/conference-sites.json, computed from our own game results everywhere else; every official row is
// compared with our computed conference/overall record and with the NCAA leaderboard record.
// params: { season?, gender?, division?, conference? (ncaa_seo) }
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { registerJob, type JobContext } from './runner.js';
import { makeFetcher } from './fetcher.js';
import { parseSidearmStandings, conferenceStandingsUrl, type ConfStandingsRow } from '../sources/conferences/sidearmStandings.js';
import { parsePrestoStandings, prestoSeasonSlug } from '../sources/conferences/prestoStandings.js';
import { listPrograms, listSchools, listProgramSeasons, upsertSchools, upsertProgram, upsertProgramSeasons } from '../db/repos.js';
import { listConferences, updateConference, writeStandings, writeStandingsChecks, confPoints, type StandingRow, type StandingsCheck } from '../db/standingsRepo.js';
import { selectAll, kvSet, kvGet } from '../db/client.js';
import { setMembership, setKnownConferences, buildAliasIndex, resolveName, matchAmongMembers, opponentSeo, isCleanOpponentName, type MemberNames } from '../normalize/aliasIndex.js';
import { currentSeason } from './seasons.js';
import { compareRecord, wltString, type GameResult } from '../normalize/records.js';
import type { Gender } from '../model.js';
import { log } from '../log.js';

interface SiteEntry { ncaa_seo: string; host?: string; platform?: string; standings_path_m?: string | null; standings_path_w?: string | null; points_rule?: string; notes?: string }

export function loadConferenceSites(): SiteEntry[] {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    for (const f of [resolve(here, '../../data/conference-sites.json'), resolve(process.cwd(), 'data/conference-sites.json')]) {
      try { return JSON.parse(readFileSync(f, 'utf8')).conferences as SiteEntry[]; } catch { /* next */ }
    }
  } catch { /* ignore */ }
  return [];
}

interface TeamStat { program_id: string; w: number; l: number; t: number; conf_w: number; conf_l: number; conf_t: number; gf: number | null; ga: number | null; gd: number | null; gp: number }
const rec = (w: number | null | undefined, l: number | null | undefined, t: number | null | undefined) => (w == null ? null : `${w}-${l ?? 0}-${t ?? 0}`);

export async function computeStandings(ctx: JobContext): Promise<void> {
  const db = ctx.db;
  const season = Number(ctx.params.season ?? currentSeason());
  const fetcher = makeFetcher(db);
  const genders: Gender[] = ctx.params.gender ? [ctx.params.gender as Gender] : ['m', 'w'];
  const onlyDivision = typeof ctx.params.division === 'string' ? ctx.params.division : null;
  const onlyConf = typeof ctx.params.conference === 'string' ? ctx.params.conference : null;

  // 1. registry → conference rows
  const sites = new Map(loadConferenceSites().map((s) => [s.ncaa_seo, s]));
  const conferences = await listConferences(db);
  for (const c of conferences) {
    const s = sites.get(c.ncaa_seo);
    if (!s) continue;
    const patch: Record<string, unknown> = {};
    const host = s.platform === 'sidearm' || s.platform === 'presto' ? (s.host ?? null) : null;
    const dflt = (g: 'm' | 'w') => (s.platform === 'presto' ? `/sports/${g === 'w' ? 'wsoc' : 'msoc'}/{season}/standings` : `/standings.aspx?path=${g === 'w' ? 'wsoc' : 'msoc'}`);
    const pm = host ? (s.standings_path_m === null ? null : (s.standings_path_m ?? dflt('m'))) : null;
    const pw = host ? (s.standings_path_w === null ? null : (s.standings_path_w ?? dflt('w'))) : null;
    if (c.site_host !== host) patch.site_host = host;
    if (c.standings_path_m !== pm) patch.standings_path_m = pm;
    if (c.standings_path_w !== pw) patch.standings_path_w = pw;
    if (s.points_rule && c.points_rule !== s.points_rule) patch.points_rule = s.points_rule;
    if (Object.keys(patch).length) { await updateConference(db, c.id, patch); Object.assign(c, patch); }
  }

  // 2. context
  const programs = await listPrograms(db);
  const schools = new Map((await listSchools(db)).map((s) => [s.seo, s]));
  const programById = new Map(programs.map((p) => [p.id, p]));
  const seasons = await listProgramSeasons(db, season);
  const seasonOf = new Map(seasons.map((s) => [s.program_id, s]));
  const divisionOf = new Map(seasons.map((s) => [s.program_id, s.division as string]));
  const conferenceOf = new Map(seasons.map((s) => [s.program_id, (s.conference_id as string | null) ?? null]));
  setKnownConferences((await listConferences(db)).map((c) => c.name));
  setMembership(new Map(seasons.map((x) => [x.program_id, (x as { ncaa_member?: boolean }).ncaa_member !== false])));
  const index = buildAliasIndex(programs, schools);
  const stats = new Map((await selectAll<TeamStat>(db, 'college_team_season_stats', 'program_id,w,l,t,conf_w,conf_l,conf_t,gf,ga,gd,gp', (q) => q.eq('season', season))).map((s) => [s.program_id, s]));
  // Checks are rebuilt for the whole scope of this run: a conference whose page fails or yields no rows must not keep
  // mismatches from an earlier run.
  const scopeIds = seasons.filter((x) => (!onlyDivision || x.division === onlyDivision) && genders.includes(programById.get(x.program_id)?.gender as Gender) && (!onlyConf || conferences.find((c) => c.id === x.conference_id)?.ncaa_seo === onlyConf)).map((x) => x.program_id);
  await writeStandingsChecks(db, season, scopeIds, []);
  // Every final with both programs and a score, per program, for record verification (independent of aggregates).
  const finals = await selectAll<{ game_date: string; home_program_id: string; away_program_id: string; home_score: number; away_score: number; conference_game: boolean; forfeit: boolean }>(db, 'college_games', 'game_date,home_program_id,away_program_id,home_score,away_score,conference_game,forfeit',
    (q) => q.eq('season', season).eq('status', 'final').not('home_program_id', 'is', null).not('away_program_id', 'is', null).not('home_score', 'is', null).not('away_score', 'is', null));
  const gamesOf = new Map<string, GameResult[]>();
  for (const g of finals) {
    gamesOf.set(g.home_program_id, [...(gamesOf.get(g.home_program_id) ?? []), { date: g.game_date, gf: g.home_score, ga: g.away_score, conf: g.conference_game, forfeit: g.forfeit }]);
    gamesOf.set(g.away_program_id, [...(gamesOf.get(g.away_program_id) ?? []), { date: g.game_date, gf: g.away_score, ga: g.home_score, conf: g.conference_game, forfeit: g.forfeit }]);
  }
  const dupList = Object.values((await kvGet<Record<string, { gender: string; date: string; home: string | null; away: string | null; homeScore: number | null; awayScore: number | null }>>(db, `ncaa_duplicate_contests:${season}`)) ?? {});
  const verify = (checks: StandingsCheck[], pid: string, field: string, official: { w: number | null; l: number | null; t: number | null } | null, confOnly: boolean) => {
    if (!official || official.w == null) return;
    const c = compareRecord(gamesOf.get(pid) ?? [], official, confOnly);
    if (c.status === 'ok') return;
    if (field === 'ncaa_record') {
      const pr = programById.get(pid);
      const extra = dupList.filter((d) => pr && d.gender === pr.gender && (d.home === pr.school_seo || d.away === pr.school_seo) && d.homeScore != null && d.awayScore != null)
        .map((d) => ({ date: d.date, gf: d.home === pr!.school_seo ? d.homeScore! : d.awayScore!, ga: d.home === pr!.school_seo ? d.awayScore! : d.homeScore!, conf: false }));
      if (extra.length && compareRecord([...(gamesOf.get(pid) ?? []), ...extra], official, false).status !== 'mismatch') {
        checks.push({ season, program_id: pid, field: 'ncaa_record_ncaa_duplicate', official: wltString(official), computed: wltString(c.ours), checked_at: now });
        ctx.inc('ncaa_record_explained_by_ncaa_duplicate');
        return;
      }
    }
    checks.push({ season, program_id: pid, field: c.status === 'lag' ? `${field}_lag` : field, official: wltString(official), computed: wltString(c.ours), checked_at: now });
    ctx.inc(c.status === 'lag' ? `${field}_lag` : `${field}_mismatch`);
  };
  const unresolvedNotes: string[] = [];
  const officialMembership: [string, string][] = [];
  const now = new Date().toISOString();

  for (const c of conferences) {
    if (onlyConf && c.ncaa_seo !== onlyConf) continue;
    if (onlyDivision && c.division && c.division !== onlyDivision) continue;
    if (await ctx.cancelled()) return;
    for (const gender of genders) {
      const members = seasons.filter((s) => s.conference_id === c.id && (s as any).ncaa_member !== false && programById.get(s.program_id)?.gender === gender);
      if (!members.length) continue;
      const division = (c.division ?? members[0]!.division) as string;
      const path = gender === 'w' ? c.standings_path_w : c.standings_path_m;
      const rows: StandingRow[] = [];
      const checks: StandingsCheck[] = [];
      let official = false;

      if (c.site_host && path) {
        const url = conferenceStandingsUrl(c.site_host, gender, path.replace('{season}', prestoSeasonSlug(season)));
        const presto = sites.get(c.ncaa_seo)?.platform === 'presto' || /\/sports\/[mw]soc\//.test(path);
        try {
          const html = (await fetcher.get(url, { skipCache: true })).text;
          const parsed = presto ? parsePrestoStandings(html) : parseSidearmStandings(html);
          // Two conferences can share one site and page (MAC Commonwealth / MAC Freedom): keep the pods named after this one.
          const distinctive = c.name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !['mac', 'conference', 'league', 'athletic', 'the', 'and'].includes(w));
          const named = parsed.pods.filter((pod) => pod.name && distinctive.some((w) => pod.name!.toLowerCase().includes(w)));
          if (parsed.pods.length > 1 && named.length) parsed.pods = named;
          const memberNames: MemberNames[] = members.map((m) => { const pr = programById.get(m.program_id)!; const sc = schools.get(pr.school_seo); return { id: m.program_id, names: [pr.name, pr.short_name, sc?.name, sc?.long_name, pr.school_seo.replace(/-/g, ' ')] }; });
          // A program may appear in a division/pod table and in the full table: keep the row from the biggest
          // table (conference-wide rank) and remember the small pod's name.
          const best = new Map<string, { row: ConfStandingsRow; rank: number; podSize: number; pod: string | null }>();
          const pendingCreates: { row: ConfStandingsRow; rank: number; pod: string | null; podSize: number }[] = [];
          const podOf = new Map<string, string>();
          for (const pod of parsed.pods) {
            pod.rows.forEach((row, i) => {
              const pid = matchAmongMembers(row.school, memberNames) ?? matchAmongMembers(row.logoAlt, memberNames)
                ?? resolveName(index, { gender, ownDivision: division, ownConference: c.id, divisionOf, conferenceOf }, row.school)
                ?? (row.logoAlt ? resolveName(index, { gender, ownDivision: division, ownConference: c.id, divisionOf, conferenceOf }, row.logoAlt) : null);
              if (!pid && isCleanOpponentName(row.school)) {
                // The conference lists a member we have never seen on an NCAA.com scoreboard or leaderboard
                // (new or provisional members): the official table is the source, so the program is created in it.
                pendingCreates.push({ row, rank: i + 1, pod: pod.name, podSize: pod.rows.length });
                return;
              }
              if (!pid) { ctx.inc('standings_unresolved'); unresolvedNotes.push(`${c.ncaa_seo}/${gender}: ${row.school}`); return; }
              officialMembership.push([pid, c.id]);
              // A row that resolves to a program of another conference is never written under this one (the move is
              // applied at the end of the run, once every conference has been read).
              if (conferenceOf.get(pid) !== c.id) { ctx.inc('standings_foreign_rows'); unresolvedNotes.push(`${c.ncaa_seo}/${gender}: ${row.school} (stored under another conference)`); return; }
              const cur = best.get(pid);
              if (!cur || pod.rows.length > cur.podSize) best.set(pid, { row, rank: i + 1, podSize: pod.rows.length, pod: cur?.pod ?? null });
              if (parsed.pods.length > 1 && pod.name && pod.rows.length < Math.max(...parsed.pods.map((p) => p.rows.length))) podOf.set(pid, pod.name);
            });
          }
          for (const pc of pendingCreates) {
            const seo = opponentSeo(pc.row.school);
            await upsertSchools(db, [{ seo, name: pc.row.school }]);
            const prog = await upsertProgram(db, { school_seo: seo, gender, name: pc.row.school, short_name: pc.row.school });
            await upsertProgramSeasons(db, [{ program_id: prog.id, season, division: division as 'd1' | 'd2' | 'd3', conference_id: c.id, ncaa_member: true, member_source: 'conference_site' } as any]);
            conferenceOf.set(prog.id, c.id); divisionOf.set(prog.id, division);
            const cur = best.get(prog.id);
            if (!cur || pc.podSize > cur.podSize) best.set(prog.id, { row: pc.row, rank: pc.rank, podSize: pc.podSize, pod: cur?.pod ?? null });
            ctx.inc('programs_created_from_standings');
          }
          if (best.size) {
            official = true;
            for (const [pid, b] of best) {
              const r = b.row;
              const ts = stats.get(pid);
              const ps = seasonOf.get(pid);
              rows.push({ season, program_id: pid, division, conference_id: c.id,
                conf_w: r.conf?.w ?? null, conf_l: r.conf?.l ?? null, conf_t: r.conf?.t ?? null,
                conf_pts: r.confPts ?? confPoints(c.points_rule, r.conf?.w ?? null, r.conf?.l ?? null, r.conf?.t ?? null),
                overall_w: r.overall?.w ?? null, overall_l: r.overall?.l ?? null, overall_t: r.overall?.t ?? null, rank: b.rank,
                source: 'conference', source_url: url, pod: podOf.get(pid) ?? null, conf_pct: r.confPct, overall_pct: r.overallPct,
                conf_gf: r.confGf, conf_ga: r.confGa, gf: r.gf, ga: r.ga, streak: r.streak, home_record: r.home, away_record: r.away, fetched_at: now, updated_at: now });
              verify(checks, pid, 'conf_record', r.conf, true);
              verify(checks, pid, 'overall_record', r.overall, false);
              if (ps && (ps as any).official_w != null) verify(checks, pid, 'ncaa_record', { w: (ps as any).official_w, l: (ps as any).official_l, t: (ps as any).official_t }, false);
            }
            ctx.inc('official_conferences');
          } else ctx.inc('standings_empty_pages');
        } catch (err) {
          ctx.inc('standings_fetch_errors');
          log.warn({ conference: c.ncaa_seo, gender, url, err: err instanceof Error ? err.message : String(err) }, 'conference standings failed');
        }
      }

      if (!official) {
        // Computed fallback from our own truth-source results.
        const derived = members.map((m) => ({ m, ts: stats.get(m.program_id) })).filter((x) => x.ts && x.ts.gp > 0).map(({ m, ts }) => {
          const t = ts!;
          const pts = confPoints(c.points_rule, t.conf_w, t.conf_l, t.conf_t);
          const cg = t.conf_w + t.conf_l + t.conf_t;
          return { m, t, pts, confPct: cg ? Math.round(1000 * (t.conf_w + 0.5 * t.conf_t) / cg) / 1000 : null };
        });
        derived.sort((a, b) => (b.pts ?? 0) - (a.pts ?? 0) || (b.confPct ?? 0) - (a.confPct ?? 0) || (b.t.gd ?? 0) - (a.t.gd ?? 0) || (b.t.w - a.t.w));
        derived.forEach(({ m, t, pts, confPct }, i) => {
          const g = t.w + t.l + t.t;
          rows.push({ season, program_id: m.program_id, division, conference_id: c.id, conf_w: t.conf_w, conf_l: t.conf_l, conf_t: t.conf_t, conf_pts: pts,
            overall_w: t.w, overall_l: t.l, overall_t: t.t, rank: i + 1, source: 'computed', source_url: null, pod: null, conf_pct: confPct,
            overall_pct: g ? Math.round(1000 * (t.w + 0.5 * t.t) / g) / 1000 : null, conf_gf: null, conf_ga: null, gf: t.gf, ga: t.ga, streak: null, home_record: null, away_record: null, fetched_at: now, updated_at: now });
          const ps = seasonOf.get(m.program_id);
          if (ps && (ps as any).official_w != null) verify(checks, m.program_id, 'ncaa_record', { w: (ps as any).official_w, l: (ps as any).official_l, t: (ps as any).official_t }, false);
        });
        if (rows.length) ctx.inc('computed_conferences');
      }
      if (rows.length) {
        await writeStandings(db, rows);
        ctx.inc('standings_rows', rows.length);
        await writeStandingsChecks(db, season, rows.map((r) => r.program_id), checks);
      }
      await ctx.heartbeat();
    }
  }
  // A conference's own table is the authority on who is in it: a program listed by exactly one conference and stored
  // under another (Shawnee State in the MEC, SUNY Cobleskill in the North Atlantic) is moved.
  const listedIn = new Map<string, Set<string>>();
  for (const [pid, cid] of officialMembership) listedIn.set(pid, (listedIn.get(pid) ?? new Set<string>()).add(cid));
  const moves = [...listedIn].filter(([pid, cids]) => cids.size === 1 && conferenceOf.get(pid) !== [...cids][0]);
  for (const [pid, cids] of moves) {
    const cid = [...cids][0]!;
    const { error } = await db.from('college_program_seasons').update({ conference_id: cid }).eq('program_id', pid).eq('season', season);
    if (error) log.warn({ pid, err: error.message }, 'conference move failed');
    else { conferenceOf.set(pid, cid); ctx.inc('conference_moved_to_official'); }
  }

  await kvSet(db, `standings:unresolved:${season}`, { at: now, rows: unresolvedNotes.slice(0, 500) });
  if (unresolvedNotes.length) ctx.note('standings_unresolved_sample', unresolvedNotes.slice(0, 40));
}

registerJob('compute-standings', computeStandings);
