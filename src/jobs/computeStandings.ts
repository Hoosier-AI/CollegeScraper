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
import { listPrograms, listSchools, listProgramSeasons } from '../db/repos.js';
import { listConferences, updateConference, writeStandings, writeStandingsChecks, confPoints, type StandingRow, type StandingsCheck } from '../db/standingsRepo.js';
import { selectAll, kvSet } from '../db/client.js';
import { buildAliasIndex, resolveName } from '../normalize/aliasIndex.js';
import { currentSeason } from './seasons.js';
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
    const host = s.platform === 'sidearm' ? (s.host ?? null) : null;
    const pm = host ? (s.standings_path_m === null ? null : (s.standings_path_m ?? '/standings.aspx?path=msoc')) : null;
    const pw = host ? (s.standings_path_w === null ? null : (s.standings_path_w ?? '/standings.aspx?path=wsoc')) : null;
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
  const index = buildAliasIndex(programs, schools);
  const stats = new Map((await selectAll<TeamStat>(db, 'college_team_season_stats', 'program_id,w,l,t,conf_w,conf_l,conf_t,gf,ga,gd,gp', (q) => q.eq('season', season))).map((s) => [s.program_id, s]));
  const unresolvedNotes: string[] = [];
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
        const url = conferenceStandingsUrl(c.site_host, gender, path);
        try {
          const parsed = parseSidearmStandings((await fetcher.get(url, { skipCache: true })).text);
          // A program may appear in a division/pod table and in the full table: keep the row from the biggest
          // table (conference-wide rank) and remember the small pod's name.
          const best = new Map<string, { row: ConfStandingsRow; rank: number; podSize: number; pod: string | null }>();
          const podOf = new Map<string, string>();
          for (const pod of parsed.pods) {
            pod.rows.forEach((row, i) => {
              const pid = resolveName(index, { gender, ownDivision: division, ownConference: c.id, divisionOf, conferenceOf }, row.school)
                ?? (row.logoAlt ? resolveName(index, { gender, ownDivision: division, ownConference: c.id, divisionOf, conferenceOf }, row.logoAlt) : null);
              if (!pid) { ctx.inc('standings_unresolved'); unresolvedNotes.push(`${c.ncaa_seo}/${gender}: ${row.school}`); return; }
              const cur = best.get(pid);
              if (!cur || pod.rows.length > cur.podSize) best.set(pid, { row, rank: i + 1, podSize: pod.rows.length, pod: cur?.pod ?? null });
              if (parsed.pods.length > 1 && pod.name && pod.rows.length < Math.max(...parsed.pods.map((p) => p.rows.length))) podOf.set(pid, pod.name);
            });
          }
          if (best.size) {
            official = true;
            for (const [pid, b] of best) {
              const r = b.row;
              if (conferenceOf.get(pid) !== c.id) ctx.inc('standings_foreign_rows');
              const ts = stats.get(pid);
              const ps = seasonOf.get(pid);
              rows.push({ season, program_id: pid, division, conference_id: c.id,
                conf_w: r.conf?.w ?? null, conf_l: r.conf?.l ?? null, conf_t: r.conf?.t ?? null,
                conf_pts: r.confPts ?? confPoints(c.points_rule, r.conf?.w ?? null, r.conf?.l ?? null, r.conf?.t ?? null),
                overall_w: r.overall?.w ?? null, overall_l: r.overall?.l ?? null, overall_t: r.overall?.t ?? null, rank: b.rank,
                source: 'conference', source_url: url, pod: podOf.get(pid) ?? null, conf_pct: r.confPct, overall_pct: r.overallPct,
                conf_gf: r.confGf, conf_ga: r.confGa, gf: r.gf, ga: r.ga, streak: r.streak, home_record: r.home, away_record: r.away, fetched_at: now, updated_at: now });
              if (ts) {
                const oc = rec(r.conf?.w, r.conf?.l, r.conf?.t), cc = rec(ts.conf_w, ts.conf_l, ts.conf_t);
                if (oc && oc !== cc) { checks.push({ season, program_id: pid, field: 'conf_record', official: oc, computed: cc, checked_at: now }); ctx.inc('standings_conf_mismatch'); }
                const oo = rec(r.overall?.w, r.overall?.l, r.overall?.t), co = rec(ts.w, ts.l, ts.t);
                if (oo && oo !== co) { checks.push({ season, program_id: pid, field: 'overall_record', official: oo, computed: co, checked_at: now }); ctx.inc('standings_overall_mismatch'); }
              }
              if (ts && ps && (ps as any).official_w != null) {
                const on = rec((ps as any).official_w, (ps as any).official_l, (ps as any).official_t), co = rec(ts.w, ts.l, ts.t);
                if (on !== co) { checks.push({ season, program_id: pid, field: 'ncaa_record', official: on, computed: co, checked_at: now }); ctx.inc('ncaa_record_mismatch'); }
              }
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
          if (ps && (ps as any).official_w != null) {
            const on = rec((ps as any).official_w, (ps as any).official_l, (ps as any).official_t), co = rec(t.w, t.l, t.t);
            if (on !== co) { checks.push({ season, program_id: m.program_id, field: 'ncaa_record', official: on, computed: co, checked_at: now }); ctx.inc('ncaa_record_mismatch'); }
          }
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
  await kvSet(db, `standings:unresolved:${season}`, { at: now, rows: unresolvedNotes.slice(0, 500) });
  if (unresolvedNotes.length) ctx.note('standings_unresolved_sample', unresolvedNotes.slice(0, 40));
}

registerJob('compute-standings', computeStandings);
