// pro-catalog: the competition list (one request), each league's seasons and what the provider covers for them.
// New professional leagues switch on by themselves; youth, friendlies and amateur leagues stay listed but off.
import { registerJob, type JobContext } from '../runner.js';
import { parseLeagues, type AfLeagueItem } from '../../sources/apiFootball/parse.js';
import { upsertLeagues, upsertSeasons } from '../../db/proRepo.js';
import { withApi } from './shared.js';

export async function proCatalog(ctx: JobContext): Promise<void> {
  await withApi(ctx, async (api) => {
    const res = await api.get<AfLeagueItem>('leagues');
    const { leagues, seasons } = parseLeagues(res.response);
    ctx.inc('leagues', await upsertLeagues(ctx.db, leagues));
    ctx.inc('seasons', await upsertSeasons(ctx.db, seasons));
    ctx.inc('enabled', leagues.filter((l) => l.enabled).length);
    ctx.inc('women', leagues.filter((l) => l.enabled && l.gender === 'w').length);
  });
}

registerJob('pro-catalog', proCatalog);
