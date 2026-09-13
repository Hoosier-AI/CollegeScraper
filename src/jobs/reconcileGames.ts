// Choose source_of_truth per final game: 'site' when the school box score validated, else 'ncaa'.
import { registerJob, type JobContext } from './runner.js';
import { selectAll } from '../db/client.js';
import { updateGame } from '../db/repos.js';
import { currentSeason } from './seasons.js';

interface G { id: string; status: string; home_program_id: string | null; away_program_id: string | null; home_score: number | null; away_score: number | null; source_of_truth: string | null; site_fetched_at: string | null; ncaa_fetched_at: string | null }
interface TS { game_id: string; program_id: string; source: string; is_home: boolean; goals: number | null; shots: number | null; yellow_cards: number | null }
interface PS { game_id: string; program_id: string; source: string; goals: number | null; participated: boolean }

/** params: { season?, all?, program? (seo) } — by default only games without a truth source or touched in the last 3 days. */
export async function reconcileGames(ctx: JobContext): Promise<void> {
  const db = ctx.db;
  const season = Number(ctx.params.season ?? currentSeason());
  let programIds: string[] | null = null;
  if (typeof ctx.params.program === 'string') { const { data } = await db.from('college_programs').select('id').eq('school_seo', ctx.params.program); programIds = (data ?? []).map((r: any) => r.id); }
  let games = await selectAll<G>(db, 'college_games', 'id,status,home_program_id,away_program_id,home_score,away_score,source_of_truth,site_fetched_at,ncaa_fetched_at',
    (q) => { q = q.eq('season', season).eq('status', 'final'); return ctx.params.all ? q : q.or(`source_of_truth.is.null,site_fetched_at.gte.${new Date(Date.now() - 3 * 86400000).toISOString()},ncaa_fetched_at.gte.${new Date(Date.now() - 3 * 86400000).toISOString()}`); });
  if (programIds) games = games.filter((g) => (g.home_program_id && programIds!.includes(g.home_program_id)) || (g.away_program_id && programIds!.includes(g.away_program_id)));
  const ids = games.map((g) => g.id);
  const team: TS[] = []; const players: PS[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    team.push(...await selectAll<TS>(db, 'college_game_team_stats', 'game_id,program_id,source,is_home,goals,shots,yellow_cards', (q) => q.in('game_id', chunk)));
    players.push(...await selectAll<PS>(db, 'college_game_player_stats', 'game_id,program_id,source,goals,participated', (q) => q.in('game_id', chunk)));
  }
  const byGame = new Map<string, { site: TS[]; ncaa: TS[] }>();
  for (const t of team) { const e = byGame.get(t.game_id) ?? { site: [], ncaa: [] }; (t.source === 'site' ? e.site : e.ncaa).push(t); byGame.set(t.game_id, e); }
  const goalsBy = new Map<string, number>();
  for (const p of players) { const k = `${p.game_id}|${p.program_id}|${p.source}`; goalsBy.set(k, (goalsBy.get(k) ?? 0) + (p.goals ?? 0)); }

  const valid = (g: G, rows: TS[], source: string) => {
    if (rows.length !== 2 || !g.home_program_id || !g.away_program_id) return false;
    for (const r of rows) {
      const score = r.is_home ? g.home_score : g.away_score;
      if (score == null || r.goals !== score) return false;
      const pg = goalsBy.get(`${g.id}|${r.program_id}|${source}`);
      if (pg != null && pg !== score) return false;
    }
    return true;
  };

  for (const g of games) {
    const e = byGame.get(g.id) ?? { site: [], ncaa: [] };
    let truth: 'site' | 'ncaa' | null = null;
    if (valid(g, e.site, 'site')) truth = 'site';
    else if (valid(g, e.ncaa, 'ncaa')) truth = 'ncaa';
    else if (e.site.length === 2) truth = 'site';
    else if (e.ncaa.length === 2) truth = 'ncaa';
    if (e.site.length === 2 && e.ncaa.length === 2) {
      const differs = e.site.some((s) => { const n = e.ncaa.find((x) => x.program_id === s.program_id); return n && (n.goals !== s.goals || n.yellow_cards !== s.yellow_cards); });
      if (differs) ctx.inc('site_ncaa_disagreements');
    }
    if (truth !== g.source_of_truth) { await updateGame(db, g.id, { source_of_truth: truth }); ctx.inc(`truth_${truth ?? 'none'}`); }
    else ctx.inc('unchanged');
    if (!truth) ctx.inc('no_truth_source');
  }
  ctx.inc('games_checked', games.length);
}

registerJob('reconcile-games', reconcileGames);
