// stat-audit: how well our numbers agree with independent references, every day, kept in stat_audit_runs (the console
// Quality tab shows the latest and the trend; the hub is told when a rate drops below its target).
//   College players: each NCAA.com individual leaderboard (goals, assists, points, saves, shutouts, game-winning goals,
//     keeper minutes, GAA, save %) against our season stats. NCAA.com is a day or two behind, so a player whose team
//     played in the two days before the list is left out.
//   College teams: NCAA.com's team leaderboards (scoring, goals against, corners and fouls a game, W-L-T %).
//   Pro: in the US leagues' current seasons, the provider's season goals, assists and minutes against the sum of its
//     match lines, and goals against American Soccer Analysis.
//   Conferences: every D1/D2 NCAA team has one, and no conference lost over a quarter of last season's teams (a job
//     once erased 169 teams' conferences and nothing noticed, 2026-10).
import { registerJob, type JobContext } from './runner.js';
import { selectAll, selectIn, type Db } from '../db/client.js';
import { currentSeason } from './seasons.js';

export interface AuditRow { area: 'college' | 'pro' | 'intl'; check_key: string; label: string; compared: number; agree: number; rate: number; target: number | null; worst: unknown[] }

/** Exact for counts, a small tolerance for rates; keeper minutes within 5. */
export const agreeWithin = (label: string) => (label === 'Goals Against Average' || label === 'Team Goals Against Average' ? 0.011 : label === 'Save Pct' ? 0.0015 : label === 'Goalie Minutes Played' ? 5.5 : /Per Game|Scoring Offense|Percentage/.test(label) ? 0.011 : 0.5);

const PLAYER: Record<string, { col: string; target: number }> = {
  'Total Goals': { col: 'goals', target: 0.95 }, 'Total Assists': { col: 'assists', target: 0.88 }, 'Total Points': { col: 'points', target: 0.88 },
  'Total Saves': { col: 'saves', target: 0.85 }, 'Shutouts': { col: 'shutouts', target: 0.85 }, 'Game-Winning Goals': { col: 'gwg', target: 0.8 },
  'Goalie Minutes Played': { col: 'gk_minutes', target: 0.85 }, 'Goals Against Average': { col: 'gaa', target: 0.85 }, 'Save Pct': { col: 'save_pct', target: 0.8 },
};
const TEAM: Record<string, { value: (t: any) => number | null; target: number }> = {
  'Scoring Offense': { value: (t) => t.gf_pg, target: 0.8 },
  'Team Goals Against Average': { value: (t) => t.ga_pg, target: 0.8 },
  'Corner Kicks Per Game': { value: (t) => t.corners_pg, target: 0.7 },
  'Fouls Per Game': { value: (t) => (t.gp ? t.fouls / t.gp : null), target: 0.7 },
  'Won-Lost-Tied Percentage': { value: (t) => (t.gp ? (t.w + 0.5 * t.t) / t.gp : null), target: 0.8 },
};

/** Rows that played in the two days before `asOf` (NCAA.com has not caught up with them). */
async function busyPrograms(db: Db, season: number, asOf: string): Promise<Set<string>> {
  const from = new Date(Date.parse(`${asOf}T12:00:00Z`) - 2 * 86400_000).toISOString().slice(0, 10);
  const games = await selectAll<any>(db, 'college_games', 'home_program_id,away_program_id', (q) => q.eq('season', season).eq('status', 'final').gte('game_date', from).order('id'));
  return new Set(games.flatMap((g) => [g.home_program_id, g.away_program_id]).filter(Boolean));
}

export function summarize(pairs: { ours: number | null; theirs: number; who: string }[], tol: number) {
  const agree = pairs.filter((p) => p.ours != null && Math.abs(p.ours - p.theirs) < tol).length;
  const worst = pairs.filter((p) => p.ours == null || Math.abs(p.ours - p.theirs) >= tol)
    .sort((a, b) => Math.abs((b.ours ?? 0) - b.theirs) - Math.abs((a.ours ?? 0) - a.theirs)).slice(0, 15)
    .map((p) => ({ who: p.who, ours: p.ours, theirs: p.theirs }));
  return { compared: pairs.length, agree, rate: pairs.length ? Math.round((agree / pairs.length) * 1000) / 1000 : 0, worst };
}

async function collegeChecks(db: Db, season: number): Promise<AuditRow[]> {
  const out: AuditRow[] = [];
  const lists = await selectAll<any>(db, 'college_rankings', 'label,program_id,player_season_id,subject_name,value,week_of', (q) => q.eq('season', season).like('poll', 'ncaa:%').in('label', [...Object.keys(PLAYER), ...Object.keys(TEAM)]).order('week_of', { ascending: false }).order('id'));
  if (!lists.length) return out;
  const asOf = String(lists[0].week_of).slice(0, 10);
  const busy = await busyPrograms(db, season, asOf);
  // Latest value per subject and list.
  const latest = new Map<string, any>();
  for (const r of lists) { const k = `${r.label}|${r.player_season_id ?? r.program_id}`; if (!latest.has(k)) latest.set(k, r); }
  const rows = [...latest.values()];
  const psIds = [...new Set(rows.map((r) => r.player_season_id).filter(Boolean))] as string[];
  const [stats, seasons] = await Promise.all([
    psIds.length ? selectIn<any>(db, 'college_player_season_stats', 'player_season_id,goals,assists,points,saves,shutouts,gwg,gk_minutes,gaa,save_pct', 'player_season_id', psIds) : [],
    psIds.length ? selectIn<any>(db, 'college_player_seasons', 'id,program_id', 'id', psIds) : [],
  ]);
  const st = new Map(stats.map((s) => [s.player_season_id, s])); const prog = new Map(seasons.map((s) => [s.id, s.program_id]));
  for (const [label, def] of Object.entries(PLAYER)) {
    const pairs = rows.filter((r) => r.label === label && r.player_season_id && !busy.has(prog.get(r.player_season_id)))
      .map((r) => ({ ours: st.get(r.player_season_id)?.[def.col] == null ? null : Number(st.get(r.player_season_id)[def.col]), theirs: Number(r.value), who: String(r.subject_name ?? r.player_season_id) }));
    if (pairs.length) out.push({ area: 'college', check_key: `ncaa:${label}`, label: `Players: ${label} vs NCAA.com`, target: def.target, ...summarize(pairs, agreeWithin(label)) });
  }
  const progIds = [...new Set(rows.filter((r) => !r.player_season_id && r.program_id).map((r) => r.program_id))] as string[];
  const teams = new Map((progIds.length ? await selectIn<any>(db, 'college_team_season_stats', 'program_id,gp,w,t,gf_pg,ga_pg,corners_pg,fouls', 'program_id', progIds, (q) => q.eq('season', season)) : []).map((t) => [t.program_id, t]));
  for (const [label, def] of Object.entries(TEAM)) {
    const pairs = rows.filter((r) => r.label === label && !r.player_season_id && r.program_id && !busy.has(r.program_id))
      .map((r) => { const t = teams.get(r.program_id); return { ours: t ? def.value(t) : null, theirs: Number(r.value), who: String(r.subject_name ?? r.program_id) }; });
    if (pairs.length) out.push({ area: 'college', check_key: `ncaa-team:${label}`, label: `Teams: ${label} vs NCAA.com`, target: def.target, ...summarize(pairs, agreeWithin(label)) });
  }
  return out;
}

/** The US leagues' current seasons: provider totals against the sum of the provider's own match lines, and goals
 *  against American Soccer Analysis where it covers the league. */
async function proChecks(db: Db): Promise<AuditRow[]> {
  const out: AuditRow[] = [];
  const leagues = await selectAll<any>(db, 'pro_leagues', 'id,name,current_season', (q) => q.eq('enabled', true).eq('scope', 'club').eq('country', 'USA').eq('type', 'league').not('current_season', 'is', null));
  const pairs: Record<string, { ours: number | null; theirs: number; who: string }[]> = { goals: [], assists: [], minutes: [], asa_goals: [] };
  for (const l of leagues) {
    const prov = await selectAll<any>(db, 'pro_player_season_stats', 'player_id,team_id,goals,assists,minutes', (q) => q.eq('league_id', l.id).eq('season', l.current_season).eq('source', 'provider'));
    if (!prov.length) continue;
    const fixtures = await selectAll<any>(db, 'pro_fixtures', 'id', (q) => q.eq('league_id', l.id).eq('season', l.current_season).eq('status', 'final'));
    const lines = fixtures.length ? await selectIn<any>(db, 'pro_fixture_players', 'player_id,team_id,goals,assists,minutes,from_events', 'fixture_id', fixtures.map((f) => f.id)) : [];
    const sum = new Map<string, { goals: number; assists: number; minutes: number }>();
    for (const x of lines) { if (x.player_id == null) continue; const k = `${x.player_id}|${x.team_id}`; const s = sum.get(k) ?? { goals: 0, assists: 0, minutes: 0 }; s.goals += x.goals ?? 0; s.assists += x.assists ?? 0; s.minutes += x.minutes ?? 0; sum.set(k, s); }
    for (const p of prov) {
      const s = sum.get(`${p.player_id}|${p.team_id}`); if (!s) continue;
      const who = `${l.name}: ${p.player_id}`;
      pairs.goals!.push({ ours: s.goals, theirs: p.goals ?? 0, who }); pairs.assists!.push({ ours: s.assists, theirs: p.assists ?? 0, who }); pairs.minutes!.push({ ours: s.minutes, theirs: p.minutes ?? 0, who });
    }
    const asa = await selectAll<any>(db, 'pro_adv_player_seasons', 'player_ext,goals', (q) => q.eq('league_id', l.id).eq('season', l.current_season));
    if (asa.length) {
      const ids = new Map((await selectIn<any>(db, 'pro_source_ids', 'ext_id,pro_id', 'ext_id', [...new Set(asa.map((a) => a.player_ext))], (q) => q.eq('source', 'asa').eq('kind', 'player').eq('rejected', false))).map((r) => [r.ext_id, Number(r.pro_id)]));
      const asaGoals = new Map<number, number>(); for (const a of asa) { const id = ids.get(a.player_ext); if (id != null) asaGoals.set(id, (asaGoals.get(id) ?? 0) + (a.goals ?? 0)); }
      const provGoals = new Map<number, number>(); for (const p of prov) provGoals.set(p.player_id, (provGoals.get(p.player_id) ?? 0) + (p.goals ?? 0));
      for (const [id, g] of provGoals) if (asaGoals.has(id)) pairs.asa_goals!.push({ ours: g, theirs: asaGoals.get(id)!, who: `${l.name}: ${id}` });
    }
  }
  const def: Record<string, [string, number, number]> = { goals: ['Pro US: season goals vs match lines', 0.95, 0.5], assists: ['Pro US: season assists vs match lines', 0.9, 0.5], minutes: ['Pro US: season minutes vs match lines (within 30)', 0.85, 30.5], asa_goals: ['Pro US: season goals vs American Soccer Analysis', 0.9, 0.5] };
  for (const [k, [label, target, tol]] of Object.entries(def)) if (pairs[k]!.length) out.push({ area: 'pro', check_key: `pro-us:${k}`, label, target, ...summarize(pairs[k]!, tol) });
  return out;
}

export interface MemberRow { season: number; program: string; gender: string; division: string; conference: string | null; ncaa_member: boolean | null }

/** Pure: the two conference checks over this season's and last season's program seasons. */
export function conferenceAudit(rows: MemberRow[], season: number): AuditRow[] {
  const side = (g: string) => (g === 'w' ? 'Women' : 'Men');
  const members = rows.filter((r) => r.season === season && r.ncaa_member !== false && (r.division === 'd1' || r.division === 'd2'));
  const missing = members.filter((r) => !r.conference);
  const size = new Map<string, { last: number; now: number }>();
  for (const r of rows) {
    if (!r.conference || r.ncaa_member === false) continue;
    const k = `${side(r.gender)} ${r.conference}`, e = size.get(k) ?? { last: 0, now: 0 };
    if (r.season === season) e.now += 1; else if (r.season === season - 1) e.last += 1;
    size.set(k, e);
  }
  const compared = [...size].filter(([, e]) => e.last >= 4);
  const shrank = compared.filter(([, e]) => e.now < e.last * 0.75).sort((a, b) => (b[1].last - b[1].now) - (a[1].last - a[1].now));
  const rate = (agree: number, n: number) => (n ? Math.round((agree / n) * 1000) / 1000 : 0);
  return [
    { area: 'college', check_key: 'conf:members', label: 'Conferences: D1 and D2 teams with a conference', target: 0.99, compared: members.length, agree: members.length - missing.length,
      rate: rate(members.length - missing.length, members.length), worst: missing.slice(0, 15).map((r) => ({ who: `${side(r.gender)} ${r.division.toUpperCase()}: ${r.program}`, ours: null, theirs: 1 })) },
    { area: 'college', check_key: 'conf:size', label: "Conferences: kept at least 75% of last season's teams", target: 0.95, compared: compared.length, agree: compared.length - shrank.length,
      rate: rate(compared.length - shrank.length, compared.length), worst: shrank.slice(0, 15).map(([who, e]) => ({ who, ours: e.now, theirs: e.last })) },
  ];
}

async function conferenceChecks(db: Db, season: number): Promise<AuditRow[]> {
  const rows = await selectAll<any>(db, 'college_program_seasons', 'program_id,season,division,conference_id,ncaa_member,college_programs(name,gender),college_conferences(short_name,name)', (q) => q.in('season', [season, season - 1]));
  return conferenceAudit(rows.map((r) => ({ season: r.season, program: r.college_programs?.name ?? r.program_id, gender: r.college_programs?.gender ?? 'm', division: r.division,
    conference: r.conference_id ? (r.college_conferences?.short_name ?? r.college_conferences?.name ?? r.conference_id) : null, ncaa_member: r.ncaa_member })), season);
}

export async function statAudit(ctx: JobContext): Promise<void> {
  const season = Number(ctx.params.season ?? currentSeason());
  const rows = [...(await collegeChecks(ctx.db, season)), ...(await conferenceChecks(ctx.db, season)), ...(await proChecks(ctx.db))];
  if (rows.length) { const { error } = await ctx.db.from('stat_audit_runs').insert(rows); if (error) throw new Error(`stat audit: ${error.message}`); }
  for (const r of rows) ctx.note(r.check_key, `${(r.rate * 100).toFixed(1)}% of ${r.compared}`);
  ctx.inc('checks', rows.length);
  ctx.inc('below_target', rows.filter((r) => r.target != null && r.rate < r.target).length);
}

registerJob('stat-audit', statAudit);
