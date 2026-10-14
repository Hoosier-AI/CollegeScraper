// asa-salaries: MLS salaries, the MLS Players Association releases (base salary and guaranteed compensation, about
// twice a season) as American Soccer Analysis serves them (/mls/players/salaries; ASA has none for the NWSL or USL).
// One request per season: every season once, then the current and last season each run. Players and clubs map to
// ours through pro_source_ids (the asa-sync job's matches). No API-Football requests.
import { registerJob, type JobContext } from '../runner.js';
import { makeFetcher } from '../fetcher.js';
import { kvGet, kvSet, selectIn, upsertChunked } from '../../db/client.js';
import { leagueIndex } from '../../db/proRepo.js';
import { AsaClient } from '../../sources/asa/client.js';
import { parseSalaries, SOURCE, type AsaSalary } from '../../sources/asa/parse.js';
import { sourcesOff } from '../../pro/sources.js';
import { log } from '../../log.js';

const MLS = 253;
const FIRST = 2013;
const DONE_KEY = 'asa:salaries:seasons';

async function proIds(ctx: JobContext, kind: 'player' | 'team', exts: string[]): Promise<Map<string, number>> {
  const rows = exts.length ? await selectIn<{ ext_id: string; pro_id: number | null; rejected: boolean }>(ctx.db, 'pro_source_ids', 'ext_id,pro_id,rejected', 'ext_id', [...new Set(exts)], (q) => q.eq('source', SOURCE).eq('kind', kind)) : [];
  return new Map(rows.filter((r) => r.pro_id != null && !r.rejected).map((r) => [r.ext_id, Number(r.pro_id)]));
}

/** params: { season?: number, all?: boolean } */
export async function asaSalaries(ctx: JobContext): Promise<void> {
  if ((await sourcesOff(ctx.db)).has(SOURCE)) { ctx.note('skipped', 'American Soccer Analysis is switched off'); return; }
  const asa = new AsaClient(makeFetcher(ctx.db));
  const current = (await leagueIndex(ctx.db)).get(MLS)?.current_season ?? new Date().getUTCFullYear();
  const done = new Set((await kvGet<number[]>(ctx.db, DONE_KEY)) ?? []);
  const only = Number(ctx.params.season) || null;
  const seasons = only ? [only] : [current, current - 1, ...Array.from({ length: current - 1 - FIRST }, (_, i) => current - 2 - i).filter((s) => ctx.params.all || !done.has(s))];
  for (const season of seasons) {
    if (await ctx.cancelled()) break;
    try {
      const rows = parseSalaries(await asa.get<AsaSalary>('mls/players/salaries', { season_name: season }), MLS);
      const [players, teams] = await Promise.all([proIds(ctx, 'player', rows.map((r) => r.player_ext)), proIds(ctx, 'team', rows.map((r) => r.team_ext).filter(Boolean))]);
      const withIds = rows.map((r) => ({ ...r, player_id: players.get(r.player_ext) ?? null, team_id: teams.get(r.team_ext) ?? null }));
      ctx.inc('rows', await upsertChunked(ctx.db, 'pro_salaries', withIds, { onConflict: 'source,player_ext,season,release_date,team_ext' }));
      ctx.inc('matched', withIds.filter((r) => r.player_id != null).length);
      done.add(season);
      ctx.inc('seasons');
    } catch (err) {
      ctx.inc('errors');
      log.warn({ season, err: String(err) }, 'asa salaries failed');
    }
    await ctx.heartbeat();
  }
  await kvSet(ctx.db, DONE_KEY, [...done].sort());
  ctx.inc('asa_calls', asa.calls);
}

registerJob('asa-salaries', asaSalaries);
