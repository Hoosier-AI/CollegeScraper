import { registerJob, type JobContext } from './runner.js';
import { refreshAggregates } from '../db/repos.js';
import { deriveTransfers } from './transfers.js';
import { currentSeason } from './seasons.js';

/** params: { season?: number, program_id?: string, transfers?: boolean } */
export async function computeAggregates(ctx: JobContext): Promise<void> {
  const season = Number(ctx.params.season ?? currentSeason());
  let programId = typeof ctx.params.program_id === 'string' ? ctx.params.program_id : null;
  if (!programId && typeof ctx.params.program === 'string') {
    let q = ctx.db.from('college_programs').select('id').eq('school_seo', ctx.params.program);
    if (ctx.params.gender) q = q.eq('gender', ctx.params.gender);
    const { data } = await q.limit(1).maybeSingle();
    programId = (data as any)?.id ?? null;
  }
  const result = await refreshAggregates(ctx.db, season, programId) as { players?: number; teams?: number } | null;
  ctx.inc('player_season_stats', result?.players ?? 0);
  ctx.inc('team_season_stats', result?.teams ?? 0);
  if (ctx.params.transfers !== false && !programId) {
    const t = await deriveTransfers(ctx, season);
    ctx.inc('transfers_written', t);
  }
}

registerJob('compute-aggregates', computeAggregates);
