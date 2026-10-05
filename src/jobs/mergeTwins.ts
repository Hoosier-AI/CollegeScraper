// Synthetic twins: an `x-` program created beside the real NCAA.com program of the same school (a standings table,
// schedule or scoreboard row that missed its usual match while the real program had lost its conference). They
// doubled standings rows (Notre Dame and California twice in the ACC women's table) and left poll rows unmatched.
// The jobs no longer create them (realProgramFor); this folds the existing ones into the real program with
// college_merge_program (migration 131). Dry run by default: the pairs are listed in the run's notes.
// params: { season?, apply?: boolean, only?: string[] (x- school seos) }
import { registerJob, type JobContext } from './runner.js';
import { listPrograms, listSchools, listProgramSeasons } from '../db/repos.js';
import { realProgramFor, isSyntheticSeo } from '../normalize/aliasIndex.js';
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

export async function mergeTwins(ctx: JobContext): Promise<void> {
  const db = ctx.db;
  const season = Number(ctx.params.season ?? currentSeason());
  const only = Array.isArray(ctx.params.only) ? new Set((ctx.params.only as unknown[]).map(String)) : null;
  const programs = await listPrograms(db);
  const schools = new Map((await listSchools(db)).map((s) => [s.seo, s]));
  const divisionOf = new Map((await listProgramSeasons(db, season)).map((s) => [s.program_id, s.division as string]));
  const pairs = findTwins(programs, schools, divisionOf).filter((t) => !only || only.has(t.fromSeo));
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
