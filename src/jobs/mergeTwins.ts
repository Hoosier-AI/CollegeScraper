// Synthetic twins: an `x-` program created beside the real NCAA.com program of the same school (a standings table,
// schedule or scoreboard row that missed its usual match while the real program had lost its conference). They
// doubled standings rows (Notre Dame and California twice in the ACC women's table) and left poll rows unmatched.
// The jobs no longer create them (realProgramFor); this folds the existing ones into the real program with
// college_merge_program (migration 131). Dry run by default: the pairs are listed in the run's notes.
// params: { season?, apply?: boolean, only?: string[] (x- school seos) }
import { registerJob, type JobContext } from './runner.js';
import { listPrograms, listSchools, listProgramSeasons } from '../db/repos.js';
import { realProgramFor, isSyntheticSeo, matchAmongMembers, type MemberNames } from '../normalize/aliasIndex.js';
import { currentSeason } from './seasons.js';
import { log } from '../log.js';

export interface TwinPair { from: string; to: string; fromSeo: string; toSeo: string; gender: string; name: string }

/** Every synthetic program whose name (or its school's) is exactly one real program's of the same gender. */
export function findTwins(programs: Parameters<typeof realProgramFor>[0], schools: Parameters<typeof realProgramFor>[1], divisionOf: Map<string, string>): TwinPair[] {
  const byId = new Map(programs.map((p) => [p.id, p]));
  const pairs: TwinPair[] = [];
  for (const p of programs) {
    if (!isSyntheticSeo(p.school_seo)) continue;
    const opts = { division: divisionOf.get(p.id) ?? null, divisionOf };
    const to = realProgramFor(programs, schools, p.gender, p.name, opts) ?? (p.short_name && p.short_name !== p.name ? realProgramFor(programs, schools, p.gender, p.short_name, opts) : null);
    const real = to ? byId.get(to) : null;
    if (real) pairs.push({ from: p.id, to: real.id, fromSeo: p.school_seo, toSeo: real.school_seo, gender: p.gender, name: p.name });
  }
  return pairs;
}

/**
 * Twins inside one conference: an `x-` program with a conference this season whose name fits exactly one real program
 * of the same conference and gender ("Miami" in the ACC is Miami (FL), "Lincoln" in the GLVC is Lincoln (MO)). A name
 * that is ambiguous nationally is not ambiguous among one conference's members; the standings job matches its rows the
 * same way. 52 such twins were made in 2026 while the real programs had lost their conference.
 */
export function findConferenceTwins(programs: { id: string; school_seo: string; gender: string; name: string; short_name?: string | null }[],
  schools: Map<string, { seo: string; name?: string | null; long_name?: string | null }>, seasons: { program_id: string; conference_id?: string | null }[], skip: Set<string>): TwinPair[] {
  const byId = new Map(programs.map((p) => [p.id, p]));
  const members = new Map<string, MemberNames[]>();
  for (const s of seasons) {
    const p = byId.get(s.program_id);
    if (!p || !s.conference_id || isSyntheticSeo(p.school_seo)) continue;
    const sc = schools.get(p.school_seo);
    const k = `${s.conference_id}|${p.gender}`;
    members.set(k, [...(members.get(k) ?? []), { id: p.id, names: [p.name, p.short_name, sc?.name, sc?.long_name, p.school_seo.replace(/-/g, ' ')] }]);
  }
  const pairs: TwinPair[] = [];
  for (const s of seasons) {
    const p = byId.get(s.program_id);
    if (!p || !s.conference_id || !isSyntheticSeo(p.school_seo) || skip.has(p.id)) continue;
    const pool = members.get(`${s.conference_id}|${p.gender}`) ?? [];
    const to = matchAmongMembers(p.name, pool) ?? (p.short_name && p.short_name !== p.name ? matchAmongMembers(p.short_name, pool) : null);
    const real = to ? byId.get(to) : null;
    if (real) pairs.push({ from: p.id, to: real.id, fromSeo: p.school_seo, toSeo: real.school_seo, gender: p.gender, name: p.name });
  }
  return pairs;
}

export async function mergeTwins(ctx: JobContext): Promise<void> {
  const db = ctx.db;
  const season = Number(ctx.params.season ?? currentSeason());
  const only = Array.isArray(ctx.params.only) ? new Set((ctx.params.only as unknown[]).map(String)) : null;
  const programs = await listPrograms(db);
  const schools = new Map((await listSchools(db)).map((s) => [s.seo, s]));
  const seasons = await listProgramSeasons(db, season);
  const divisionOf = new Map(seasons.map((s) => [s.program_id, s.division as string]));
  const named = findTwins(programs, schools, divisionOf);
  const inConference = findConferenceTwins(programs, schools, seasons, new Set(named.map((t) => t.from)));
  ctx.inc('conference_twins_found', inConference.length);
  const pairs = [...named, ...inConference].filter((t) => !only || only.has(t.fromSeo));
  ctx.inc('twins_found', pairs.length);
  ctx.note('twins', pairs.map((t) => `${t.fromSeo} (${t.gender}) -> ${t.toSeo}`));
  if (!ctx.params.apply) return;
  const results: unknown[] = [];
  for (const t of pairs) {
    if (await ctx.cancelled()) return;
    const { data, error } = await db.rpc('college_merge_program', { p_from: t.from, p_to: t.to });
    if (error) { ctx.inc('merge_errors'); log.warn({ from: t.fromSeo, to: t.toSeo, err: error.message }, 'twin merge failed'); results.push({ from: t.fromSeo, error: error.message }); }
    else { ctx.inc('twins_merged'); results.push(data); }
    await ctx.heartbeat();
  }
  ctx.note('merged', results.map((r) => JSON.stringify(r)));
}

registerJob('merge-twins', mergeTwins);
