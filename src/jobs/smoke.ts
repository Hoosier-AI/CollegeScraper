// End-to-end crawl of one program: site pass + NCAA pass + reconcile + aggregates, then checks.
import type { Db } from '../db/client.js';
import { runInline } from './runner.js';
import { selectAll } from '../db/client.js';
import './index.js';

export interface SmokeOptions { season: number; program: string; gender: 'm' | 'w'; division?: 'd1' | 'd2' | 'd3'; force: boolean }

export async function smoke(db: Db, o: SmokeOptions): Promise<boolean> {
  const out: Record<string, unknown> = {};
  const step = async (job: string, params: Record<string, unknown>) => { out[job] = await runInline(db, job, params); console.log(`\n== ${job}\n${JSON.stringify(out[job])}`); };
  await step('discover-teams', { season: o.season, program: o.program, gender: o.gender, division: o.division, force: o.force });
  await step('detect-sites', { season: o.season, program: o.program, force: o.force });
  await step('sync-site', { season: o.season, program: o.program, gender: o.gender, force: o.force });
  await step('sweep-scoreboard', { season: o.season, gender: o.gender, division: o.division, days: 'all', force: o.force });
  await step('fetch-games-ncaa', { season: o.season, program: o.program, gender: o.gender, refetch: o.force });
  await step('reconcile-games', { season: o.season, all: true });
  const { data: prog } = await db.from('college_programs').select('id,name').eq('school_seo', o.program).eq('gender', o.gender).maybeSingle();
  if (!prog) { console.error(`program ${o.program}/${o.gender} not found after discovery`); return false; }
  await step('compute-aggregates', { season: o.season, program_id: prog.id, transfers: false });

  const games = await selectAll<any>(db, 'college_games', 'id,game_date,status,home_score,away_score,source_of_truth,home_program_id,away_program_id,attendance', (q) => q.eq('season', o.season).or(`home_program_id.eq.${prog.id},away_program_id.eq.${prog.id}`));
  const finals = games.filter((g) => g.status === 'final');
  const noTruth = finals.filter((g) => !g.source_of_truth);
  const team = await selectAll<any>(db, 'college_game_team_stats', 'game_id,source,goals', (q) => q.eq('program_id', prog.id));
  const players = await selectAll<any>(db, 'college_game_player_stats', 'game_id,source,goals,player_season_id', (q) => q.eq('program_id', prog.id));
  const roster = await selectAll<any>(db, 'college_player_seasons', 'id,source,confidence', (q) => q.eq('program_id', prog.id).eq('season', o.season));
  const agg = await selectAll<any>(db, 'college_player_season_stats', 'player_season_id,gp,minutes,goals,assists', (q) => q.in('player_season_id', roster.map((r) => r.id)));
  const site = await selectAll<any>(db, 'college_site_season_stats', 'player_season_id,gp,minutes,goals,assists', (q) => q.in('player_season_id', roster.map((r) => r.id)));
  const tss = await db.from('college_team_season_stats').select('*').eq('program_id', prog.id).eq('season', o.season).maybeSingle();

  // player goals vs team goals per game/source
  let goalMismatch = 0;
  for (const t of team) {
    const pg = players.filter((p) => p.game_id === t.game_id && p.source === t.source).reduce((a, p) => a + (p.goals ?? 0), 0);
    if (t.goals != null && pg !== t.goals) goalMismatch += 1;
  }
  let aggDiff = 0;
  for (const s of site) {
    const a = agg.find((x) => x.player_season_id === s.player_season_id);
    if (!a) continue;
    if (a.goals !== s.goals || a.assists !== s.assists || Math.abs((a.minutes ?? 0) - (s.minutes ?? 0)) > 10 || Math.abs((a.gp ?? 0) - (s.gp ?? 0)) > 1) aggDiff += 1;
  }
  const summary = {
    program: prog.name, games: games.length, finals: finals.length, finals_without_truth: noTruth.length,
    truth_site: finals.filter((g) => g.source_of_truth === 'site').length, truth_ncaa: finals.filter((g) => g.source_of_truth === 'ncaa').length,
    team_stat_rows: team.length, player_stat_rows: players.length, unlinked_player_rows: players.filter((p) => !p.player_season_id).length,
    roster: roster.length, boxscore_only: roster.filter((r) => r.source === 'boxscore_only').length, low_confidence: roster.filter((r) => Number(r.confidence) < 0.75).length,
    aggregates: agg.length, site_season_rows: site.length, aggregate_vs_site_diffs: aggDiff, player_goal_mismatches: goalMismatch,
    team_season: tss.data ? { gp: tss.data.gp, w: tss.data.w, l: tss.data.l, t: tss.data.t, gf: tss.data.gf, ga: tss.data.ga, form: tss.data.form_last5 } : null,
    attendance_known: games.filter((g) => g.attendance != null).length,
  };
  console.log(`\n== smoke summary\n${JSON.stringify(summary, null, 2)}`);
  const ok = finals.length > 0 && noTruth.length === 0 && goalMismatch === 0;
  console.log(ok ? '\nSMOKE OK' : '\nSMOKE FAILED');
  return ok;
}
