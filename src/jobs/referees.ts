// referees: rebuild the referee tables (migration 187) once a day from the matches we already hold. Pro: each
// referee's matches with cards, penalties, VAR checks and fouls (pro_referee_fixtures, pro_referees); college: the
// box score's referee with cards, fouls and penalty kicks (college_referee_games, college_referees). No requests out.
import { registerJob, type JobContext } from './runner.js';

registerJob('referees', async (ctx: JobContext) => {
  for (const [fn, counter] of [['pro_refresh_referees', 'pro_referees'], ['college_refresh_referees', 'college_referees']] as const) {
    const { data, error } = await ctx.db.rpc(fn);
    if (error) throw new Error(`${fn}: ${error.message}`);
    ctx.inc(counter, Number(data) || 0);
  }
});
