// college-ratings: the box-score match ratings (migration 189) for every college game whose box score may have changed
// in the last three days (new finals, late site box scores, corrections). final-detail rates a game the moment its
// box score lands; this catches the rest. `season` re-rates a whole season (after a change to the formula).
import { registerJob, type JobContext } from './runner.js';

registerJob('college-ratings', async (ctx: JobContext) => {
  const season = Number(ctx.params.season) || null;
  const { data, error } = season ? await ctx.db.rpc('college_rate_season', { p_season: season }) : await ctx.db.rpc('college_rate_recent');
  if (error) throw new Error(error.message);
  ctx.inc('lines_rated', Number(data) || 0);
});
