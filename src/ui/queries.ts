// Read helpers for the stats-viewer API. Service-role reads (internal tool).
import type { Db } from '../db/client.js';
import { selectAll, kvGet } from '../db/client.js';
import { eastern } from '../jobs/seasons.js';
import { teamCategories } from '../normalize/logos.js';

export const PLAYER_STATS = ['goals', 'assists', 'points', 'shots', 'sog', 'minutes', 'gp', 'gs', 'gwg', 'hat_tricks', 'goals_p90', 'assists_p90', 'points_p90', 'shots_p90', 'sog_p90', 'shot_accuracy', 'conversion_pct', 'saves', 'save_pct', 'gaa', 'shutouts', 'clean_sheets', 'saves_p90', 'ga', 'gk_minutes', 'yc', 'rc', 'fouls', 'corners', 'offsides', 'pk_goals', 'pk_att', 'pk_pct', 'minutes_share', 'goals_1h', 'goals_2h', 'goals_ot', 'minutes_per_goal', 'shots_per_goal', 'pct_points_p90', 'pct_goals_p90', 'pct_assists_p90', 'pct_shots_p90', 'pct_save_pct', 'pct_gaa', 'div_rank_points', 'div_rank_goals', 'div_rank_assists', 'conf_rank_points', 'conf_rank_goals'];
export const TEAM_STATS = ['w', 'l', 't', 'gp', 'ppg', 'gf', 'ga', 'gd', 'gf_pg', 'ga_pg', 'gf_home', 'gf_away', 'ga_home', 'ga_away', 'gf_1h', 'gf_2h', 'ga_1h', 'ga_2h', 'shots', 'sog', 'shots_pg', 'sog_pg', 'sog_pct', 'shots_per_goal', 'corners', 'corners_pg', 'fouls', 'offsides', 'saves', 'yc', 'rc', 'pk_goals', 'pk_att', 'clean_sheets', 'avg_attendance', 'conf_w', 'conf_l', 'conf_t', 'vs_ranked_w', 'vs_ranked_l', 'vs_ranked_t', 'last5_gf', 'last5_ga', 'div_rank_ppg', 'conf_rank_ppg', 'conf_rank_gf_pg', 'conf_rank_ga_pg', 'div_pct_gf_pg', 'div_pct_ga_pg', 'div_pct_shots_pg'];
const ASC = new Set(['gaa', 'ga', 'ga_pg', 'l', 'minutes_per_goal', 'shots_per_goal', 'div_rank_points', 'div_rank_goals', 'div_rank_assists', 'conf_rank_points', 'conf_rank_goals', 'div_rank_ppg', 'conf_rank_ppg', 'conf_rank_gf_pg', 'conf_rank_ga_pg', 'ga_home', 'ga_away', 'ga_1h', 'ga_2h', 'last5_ga', 'vs_ranked_l']);

const clamp = (v: unknown, lo: number, hi: number, d: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.trunc(n))) : d; };

export async function meta(db: Db) {
  const [seasons, confs] = await Promise.all([
    selectAll<{ season: number; is_current: boolean }>(db, 'college_seasons', 'season,is_current', (q) => q.order('season', { ascending: false })),
    selectAll<{ id: string; ncaa_seo: string; name: string; division: string | null }>(db, 'college_conferences', 'id,ncaa_seo,name,division', (q) => q.order('name')),
  ]);
  const now = new Date();
  const currentSeason = now.getUTCMonth() + 1 >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return { seasons: seasons.map((s) => s.season), currentSeason, genders: ['m', 'w'], divisions: ['d1', 'd2', 'd3'], conferences: confs };
}

export interface ProgramFilter { season: number; gender?: string; division?: string; conference?: string; q?: string; members?: boolean }

export async function programs(db: Db, f: ProgramFilter) {
  // No `in (...)` id lists: PostgREST URLs blow past 8 KB with 300 UUIDs. Filter by season/gender and join in JS.
  const seasons = await selectAll<any>(db, 'college_program_seasons', 'program_id,season,division,conference_id,roster_synced_at,schedule_synced_at,stats_synced_at,boxscores_synced_at,site_parse_failures,ncaa_member,member_source,official_w,official_l,official_t,official_record_at',
    (q) => { q = q.eq('season', f.season); if (f.division) q = q.eq('division', f.division); if (f.conference) q = q.eq('conference_id', f.conference); if (f.members !== false) q = q.eq('ncaa_member', true); return q; });
  if (!seasons.length) return [];
  const bySeason = new Map(seasons.map((s) => [s.program_id, s]));
  const progs = (await selectAll<any>(db, 'college_programs', 'id,name,short_name,gender,school_seo,site_status,site_sport_slug,college_schools(seo,name,logo_svg_url,athletics_host,site_platform)',
    (q) => (f.gender ? q.eq('gender', f.gender) : q))).filter((p) => bySeason.has(p.id));
  const [stats, games, confRows, checks] = await Promise.all([
    selectAll<any>(db, 'college_team_season_stats', 'program_id,gp,w,l,t,gf,ga,computed_at', (q) => q.eq('season', f.season)),
    selectAll<any>(db, 'college_games', 'id,home_program_id,away_program_id,status,source_of_truth,site_fetched_at,ncaa_fetched_at', (q) => (f.gender ? q.eq('season', f.season).eq('gender', f.gender) : q.eq('season', f.season))),
    selectAll<any>(db, 'college_conferences', 'id,name,ncaa_seo'),
    selectAll<any>(db, 'college_standings_checks', 'program_id,field,official,computed', (q) => q.eq('season', f.season).in('field', ['ncaa_record', 'ncaa_record_lag', 'ncaa_record_ncaa_duplicate'])),
  ]);
  const confs = new Map(confRows.map((c) => [c.id, c]));
  // How our record compares with NCAA.com's leaderboard record: a stale leaderboard is "behind", not a difference.
  const ncaaCheck = new Map<string, { state: 'mismatch' | 'lag'; official: string; ours: string }>();
  for (const c of checks) {
    const state = c.field === 'ncaa_record' ? 'mismatch' : 'lag';
    if (state === 'mismatch' || !ncaaCheck.has(c.program_id)) ncaaCheck.set(c.program_id, { state, official: c.official, ours: c.computed });
  }
  const byStats = new Map(stats.map((s) => [s.program_id, s]));
  const gameAgg = new Map<string, { games: number; finals: number; site: number; ncaa: number; truth: number }>();
  for (const g of games) for (const pid of [g.home_program_id, g.away_program_id]) {
    if (!pid) continue;
    const a = gameAgg.get(pid) ?? { games: 0, finals: 0, site: 0, ncaa: 0, truth: 0 };
    a.games += 1; if (g.status === 'final') a.finals += 1; if (g.site_fetched_at) a.site += 1; if (g.ncaa_fetched_at) a.ncaa += 1; if (g.source_of_truth) a.truth += 1;
    gameAgg.set(pid, a);
  }
  const ql = (f.q ?? '').trim().toLowerCase();
  return progs
    .filter((p) => !ql || p.name.toLowerCase().includes(ql) || p.college_schools?.name?.toLowerCase().includes(ql) || p.school_seo.includes(ql))
    .map((p) => {
      const s = bySeason.get(p.id); const st = byStats.get(p.id); const c = s?.conference_id ? confs.get(s.conference_id) : null;
      return { id: p.id, name: p.name, gender: p.gender, school_seo: p.school_seo, site_status: p.site_status, school: p.college_schools, division: s?.division, conference: c ?? null,
        member: s?.ncaa_member !== false, member_source: s?.member_source ?? null, official: s?.official_w != null ? { w: s.official_w, l: s.official_l, t: s.official_t, at: s.official_record_at ?? null } : null,
        ncaa_check: ncaaCheck.get(p.id) ?? null,
        synced: { roster: s?.roster_synced_at, schedule: s?.schedule_synced_at, stats: s?.stats_synced_at, boxscores: s?.boxscores_synced_at, failures: s?.site_parse_failures ?? 0 },
        record: st ? { gp: st.gp, w: st.w, l: st.l, t: st.t, gf: st.gf, ga: st.ga, computed_at: st.computed_at } : null,
        games: gameAgg.get(p.id) ?? { games: 0, finals: 0, site: 0, ncaa: 0, truth: 0 } };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function program(db: Db, id: string, season: number) {
  const { data: p, error } = await db.from('college_programs').select('*,college_schools(*)').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!p) return null;
  const [ps, coaches, tss, standing, rankings, runs, seasonsAvail, checks] = await Promise.all([
    db.from('college_program_seasons').select('*,college_conferences(id,name,ncaa_seo,site_host,points_rule)').eq('program_id', id).eq('season', season).maybeSingle(),
    selectAll<any>(db, 'college_coach_seasons', 'title,is_head,college_coaches(id,name,headshot_url)', (q) => q.eq('program_id', id).eq('season', season)),
    db.from('college_team_season_stats').select('*').eq('program_id', id).eq('season', season).maybeSingle(),
    db.from('college_standings').select('*').eq('program_id', id).eq('season', season).maybeSingle(),
    selectAll<any>(db, 'college_rankings', 'poll,week_of,rank,value,label,previous_rank,record,first_place_votes,player_season_id,subject_name', (q) => q.eq('program_id', id).eq('season', season).order('week_of', { ascending: false }).limit(400)),
    selectAll<any>(db, 'college_crawl_runs', 'id,job,status,started_at,finished_at,counters,error,params', (q) => q.contains('params', { program: p.school_seo }).order('created_at', { ascending: false }).limit(5)),
    selectAll<any>(db, 'college_program_seasons', 'season', (q) => q.eq('program_id', id).order('season', { ascending: false })),
    selectAll<any>(db, 'college_standings_checks', '*', (q) => q.eq('program_id', id).eq('season', season)),
  ]);
  // Conference table for the position badge (rank within the conference).
  const confRows = ps.data?.conference_id ? await selectAll<any>(db, 'college_standings', 'program_id,rank,pod,source,conf_w,conf_l,conf_t,conf_pts,college_programs!inner(id,name,gender)', (q) => q.eq('season', season).eq('conference_id', ps.data.conference_id).eq('college_programs.gender', p.gender).order('rank')) : [];
  const usc = rankings.filter((r) => r.poll === 'usc' && !String(r.label ?? '').includes('(RV)')).sort((a, b) => String(b.week_of).localeCompare(String(a.week_of)));
  const categories = teamCategories(rankings);
  return { program: p, season: ps.data, coaches, teamStats: tss.data, standing: standing.data, standingsChecks: checks, conferenceTable: confRows, rankings, usc: usc[0] ?? null, uscHistory: usc, categories, runs, seasons: seasonsAvail.map((s) => s.season) };
}

export async function roster(db: Db, id: string, season: number) {
  const rows = await selectAll<any>(db, 'college_player_seasons', '*,college_players(id,first_name,last_name,display_name,hometown_city,hometown_region,hometown_country,headshot_url,bio_url,suppress)', (q) => q.eq('program_id', id).eq('season', season));
  const ids = rows.map((r) => r.id);
  if (!ids.length) return [];
  const [agg, site, honors, splits] = await Promise.all([
    selectAll<any>(db, 'college_player_season_stats', '*', (q) => q.in('player_season_id', ids)),
    selectAll<any>(db, 'college_site_season_stats', '*', (q) => q.in('player_season_id', ids)),
    selectAll<any>(db, 'college_player_honors', 'player_season_id,text', (q) => q.in('player_season_id', ids)),
    selectAll<any>(db, 'college_player_season_splits', '*', (q) => q.in('player_season_id', ids)),
  ]);
  const a = new Map(agg.map((x) => [x.player_season_id, x])); const s = new Map(site.map((x) => [x.player_season_id, x]));
  const h = new Map<string, string[]>(); for (const x of honors) h.set(x.player_season_id, [...(h.get(x.player_season_id) ?? []), x.text]);
  const sp = new Map<string, Record<string, any>>(); for (const x of splits) { const m = sp.get(x.player_season_id) ?? {}; m[x.split] = x; sp.set(x.player_season_id, m); }
  return rows.map((r) => ({ ...r, player: r.college_players, college_players: undefined, stats: a.get(r.id) ?? null, site: s.get(r.id) ?? null, honors: h.get(r.id) ?? [], splits: sp.get(r.id) ?? {} }))
    .sort((x, y) => (x.jersey ?? 999) - (y.jersey ?? 999));
}

export async function programGames(db: Db, id: string, season: number) {
  const games = await selectAll<any>(db, 'college_v_schedule', '*', (q) => q.eq('season', season).or(`home_program_id.eq.${id},away_program_id.eq.${id}`).order('game_date'));
  const gids = games.map((g) => g.id);
  const team = gids.length ? await selectAll<any>(db, 'college_game_team_stats', '*', (q) => q.in('game_id', gids)) : [];
  return games.map((g) => ({ ...g, team_stats: team.filter((t) => t.game_id === g.id) }));
}

export async function game(db: Db, id: string) {
  const { data: g, error } = await db.from('college_v_schedule').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!g) return null;
  const [header, team, players, events, raw] = await Promise.all([
    db.from('college_games').select('officials,duration_min,site_game_refs,site_fetched_at,ncaa_fetched_at,detail_attempts,start_epoch').eq('id', id).maybeSingle(),
    selectAll<any>(db, 'college_game_team_stats', '*', (q) => q.eq('game_id', id)),
    selectAll<any>(db, 'college_game_player_stats', '*,college_player_seasons(player_id,college_players(suppress))', (q) => q.eq('game_id', id).order('program_id').order('jersey')),
    selectAll<any>(db, 'college_game_events', '*', (q) => q.eq('game_id', id).order('period').order('seq')),
    selectAll<any>(db, 'college_game_raw', 'source,payload,fetched_at', (q) => q.eq('game_id', id)),
  ]);
  // Box-score lines link to the player page through their roster identity.
  // `suppress` rides along so the public API can withhold the name; the admin viewer shows it as is.
  const lines = players.map((p) => ({ ...p, player_id: p.college_player_seasons?.player_id ?? null, suppress: !!p.college_player_seasons?.college_players?.suppress, college_player_seasons: undefined }));
  return { game: { ...g, ...(header.data ?? {}) }, team, players: lines, events, raw };
}

export async function player(db: Db, id: string) {
  const { data: p, error } = await db.from('college_players').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!p) return null;
  const seasons = await selectAll<any>(db, 'college_player_seasons', '*,college_programs(id,name,gender,school_seo,college_schools(logo_svg_url,name))', (q) => q.eq('player_id', id).order('season', { ascending: false }));
  const ids = seasons.map((s) => s.id);
  const [agg, site, honors, career, transfers, log, splits, ranks] = await Promise.all([
    ids.length ? selectAll<any>(db, 'college_player_season_stats', '*', (q) => q.in('player_season_id', ids)) : [],
    ids.length ? selectAll<any>(db, 'college_site_season_stats', '*', (q) => q.in('player_season_id', ids)) : [],
    ids.length ? selectAll<any>(db, 'college_player_honors', '*', (q) => q.in('player_season_id', ids)) : [],
    db.from('college_v_player_career').select('*').eq('player_id', id).maybeSingle(),
    selectAll<any>(db, 'college_transfers', '*', (q) => q.eq('player_id', id)),
    ids.length ? selectAll<any>(db, 'college_game_player_stats', '*,college_games!inner(id,game_date,season,home_program_id,away_program_id,home_name,away_name,home_score,away_score,source_of_truth)', (q) => q.in('player_season_id', ids)) : [],
    ids.length ? selectAll<any>(db, 'college_player_season_splits', '*', (q) => q.in('player_season_id', ids)) : [],
    ids.length ? selectAll<any>(db, 'college_rankings', 'player_season_id,season,poll,label,rank,value,week_of', (q) => q.in('player_season_id', ids).order('rank')) : [],
  ]);
  const truthLog = log.filter((r) => r.college_games?.source_of_truth === r.source).map((r) => ({ ...r, game: r.college_games, college_games: undefined })).sort((a, b) => String(b.game.game_date).localeCompare(String(a.game.game_date)));
  // Own-side names are null on site-created games; fill both sides from the programs table.
  const pids = [...new Set(truthLog.flatMap((r) => [r.game.home_program_id, r.game.away_program_id]).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  for (let i = 0; i < pids.length; i += 100) for (const x of await selectAll<any>(db, 'college_programs', 'id,name', (q) => q.in('id', pids.slice(i, i + 100)))) names.set(x.id, x.name);
  for (const r of truthLog) { r.game.home_name = names.get(r.game.home_program_id) ?? r.game.home_name; r.game.away_name = names.get(r.game.away_program_id) ?? r.game.away_name; }
  // The same honor is re-extracted from the bio every season: keep one row per text (latest season first).
  const seen = new Set<string>();
  const honorsDedup = honors.sort((a, b) => (seasons.findIndex((s) => s.id === a.player_season_id)) - (seasons.findIndex((s) => s.id === b.player_season_id))).filter((h) => { const k = h.text.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  return { player: p, seasons: seasons.map((s) => ({ ...s, program: s.college_programs, college_programs: undefined, stats: agg.find((a) => a.player_season_id === s.id) ?? null, site: site.find((a) => a.player_season_id === s.id) ?? null, splits: splits.filter((x) => x.player_season_id === s.id), ranks: ranks.filter((x) => x.player_season_id === s.id).map((x) => ({ category: x.label ?? x.poll, rank: x.rank, value: x.value, week_of: x.week_of })) })), honors: honorsDedup, career: career.data, transfers, gameLog: truthLog };
}

export interface LeadersFilter { season: number; gender?: string; division?: string; conference?: string; kind?: string; stat?: string; min_minutes?: unknown; limit?: unknown; offset?: unknown; q?: string; members?: boolean }

/** One page of a leaderboard plus the total so callers can page through every player or team. */
export async function leaders(db: Db, o: LeadersFilter) {
  const team = o.kind === 'team';
  const allow = team ? TEAM_STATS : PLAYER_STATS;
  const stat = allow.includes(o.stat ?? '') ? o.stat! : (team ? 'w' : 'goals');
  const limit = clamp(o.limit, 1, 500, 100);
  const offset = clamp(o.offset, 0, 1_000_000, 0);
  const view = team ? 'college_v_team_leaders' : 'college_v_player_leaders';
  const term = (o.q ?? '').trim().replace(/[,()%\\]/g, '').slice(0, 60);
  const filtered = (q: any) => {
    q = q.eq('season', o.season).not(stat, 'is', null);
    if (o.gender) q = q.eq('gender', o.gender);
    if (o.division) q = q.eq('division', o.division);
    if (o.conference) q = q.eq('conference_id', o.conference);
    if (o.members !== false) q = q.eq('ncaa_member', true);
    if (!team) { q = q.eq('suppress', false); const mm = clamp(o.min_minutes, 0, 5000, 0); if (mm) q = q.gte('minutes', mm); }
    // Name search: PostgREST's `or` syntax reserves commas and parentheses, so they are dropped from the term.
    if (term) q = team ? q.ilike('program_name', `%${term}%`) : q.or(`display_name.ilike.%${term}%,program_name.ilike.%${term}%`);
    return q;
  };
  // A unique tiebreaker is what makes offset paging sound. Ordered by the stat alone, tied rows (dozens of players on
  // 6 goals) came back in a different order on each request: paging 60 rows by 5 returned 46 distinct players, 14
  // twice and 14 never.
  const tiebreak = team ? 'program_id' : 'player_season_id';
  const { data, error, count } = await filtered(db.from(view).select('*', { count: 'exact' })).order(stat, { ascending: ASC.has(stat) }).order(tiebreak, { ascending: true }).range(offset, offset + limit - 1);
  if (error) {
    // An offset past the end is an empty page, not an error (PostgREST answers 416).
    if (/range not satisfiable/i.test(error.message)) {
      const { count: total, error: e2 } = await filtered(db.from(view).select('*', { count: 'exact', head: true }));
      if (e2) throw new Error(`leaders: ${e2.message}`);
      return { stat, rows: [], total: total ?? 0, limit, offset };
    }
    throw new Error(`leaders: ${error.message}`);
  }
  return { stat, rows: data ?? [], total: count ?? (data?.length ?? 0), limit, offset };
}

export async function standings(db: Db, o: { season: number; gender?: string; division?: string; conference?: string }) {
  const rows = await selectAll<any>(db, 'college_standings', '*,college_conferences(id,name,ncaa_seo,site_host,points_rule),college_programs!inner(id,name,gender,school_seo,college_schools(logo_svg_url))', (q) => {
    q = q.eq('season', o.season); if (o.division) q = q.eq('division', o.division); if (o.gender) q = q.eq('college_programs.gender', o.gender); if (o.conference) q = q.eq('conference_id', o.conference); return q;
  });
  // One conference reads only its members' checks and stats; the full page reads the season's.
  const scope = (q: any) => (o.conference ? q.in('program_id', rows.map((r) => r.program_id)) : q);
  const checks = rows.length ? await selectAll<any>(db, 'college_standings_checks', 'program_id,field,official,computed', (q) => scope(q.eq('season', o.season))) : [];
  const byProgram = new Map<string, any[]>(); for (const c of checks) byProgram.set(c.program_id, [...(byProgram.get(c.program_id) ?? []), c]);
  const stats = new Map((rows.length ? await selectAll<any>(db, 'college_team_season_stats', 'program_id,w,l,t,conf_w,conf_l,conf_t,gf,ga,gd', (q) => scope(q.eq('season', o.season))) : []).map((x) => [x.program_id, x]));
  const out = rows.map((r) => ({ ...r, checks: byProgram.get(r.program_id) ?? [], computed: stats.get(r.program_id) ?? null }));
  out.sort((a, b) => (a.college_conferences?.name ?? '').localeCompare(b.college_conferences?.name ?? '') || (a.pod ?? '').localeCompare(b.pod ?? '') || (a.rank ?? 99) - (b.rank ?? 99));
  const official = out.filter((r) => r.source === 'conference').length;
  return { source: official ? 'conference' : out.length ? 'computed' : 'none', official, computed: out.length - official, rows: out };
}

export async function rankings(db: Db, o: { season: number; gender?: string; division?: string; poll?: string; week_of?: string }) {
  const polls = await selectAll<any>(db, 'college_rankings', 'poll,week_of,label', (q) => { q = q.eq('season', o.season); if (o.gender) q = q.eq('gender', o.gender); if (o.division) q = q.eq('division', o.division); return q; });
  const pollNames = [...new Set(polls.map((p) => p.poll))].sort((a, b) => (a === 'usc' ? -1 : b === 'usc' ? 1 : a.localeCompare(b)));
  const labelOf = (poll: string) => poll === 'usc' ? 'United Soccer Coaches' : (polls.find((p) => p.poll === poll)?.label ?? poll);
  const poll = o.poll && pollNames.includes(o.poll) ? o.poll : (pollNames.includes('usc') ? 'usc' : pollNames[0]);
  const weekRows = polls.filter((p) => p.poll === poll);
  const weeks = [...new Map(weekRows.map((p) => [p.week_of, { week_of: p.week_of, label: p.poll === 'usc' ? String(p.label ?? '').replace(/ \(RV\)$/, '') : p.week_of }])).values()].sort((a, b) => b.week_of.localeCompare(a.week_of));
  const week = o.week_of && weeks.some((w) => w.week_of === o.week_of) ? o.week_of : weeks[0]?.week_of;
  const rows = poll && week ? await selectAll<any>(db, 'college_rankings', '*,college_programs(id,name,school_seo,college_schools(logo_svg_url)),college_player_seasons(id,player_id,college_players(display_name,suppress))', (q) => { q = q.eq('season', o.season).eq('poll', poll).eq('week_of', week).order('rank'); if (o.gender) q = q.eq('gender', o.gender); if (o.division) q = q.eq('division', o.division); return q; }) : [];
  const [uscUnresolved, uscCheck] = await Promise.all([kvGet<any>(db, `usc:unresolved:${o.season}`), kvGet<any>(db, `usc:ncaa_check:${o.season}`)]);
  return { polls: pollNames.map((p) => ({ poll: p, label: labelOf(p) })), poll, weeks, week, rows, unresolved: uscUnresolved?.by_list ?? {}, ncaaCheck: uscCheck?.lists ?? {} };
}

export async function runs(db: Db, limit = 50) {
  // A plain bounded read, not selectAll: selectAll pages with .range() until a page comes back short, and a
  // .limit() equal to the page size never produces a short page, so this used to walk the whole table
  // (/v1/status answered with every crawl run ever recorded: 281 rows, 294 KB, growing with each scrape).
  const { data, error } = await db.from('college_crawl_runs').select('*').order('created_at', { ascending: false }).limit(limit);
  if (error) throw new Error(`select college_crawl_runs failed: ${error.message}`);
  return (data ?? []) as any[];
}

export async function run(db: Db, id: string) {
  const { data, error } = await db.from('college_crawl_runs').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/** Data-quality checks mirroring scripts/sanity.sql, computed in JS over the season's rows. */
export async function quality(db: Db, season: number) {
  const games = await selectAll<any>(db, 'college_games', 'id,game_date,home_name,away_name,home_program_id,away_program_id,home_score,away_score,status,source_of_truth,overtime', (q) => q.eq('season', season));
  const finals = games.filter((g) => g.status === 'final');
  const gids = finals.map((g) => g.id);
  const team: any[] = []; const players: any[] = [];
  for (let i = 0; i < gids.length; i += 100) {
    const chunk = gids.slice(i, i + 100);
    team.push(...await selectAll<any>(db, 'college_game_team_stats', 'game_id,program_id,source,is_home,goals,shots,yellow_cards,red_cards,saves', (q) => q.in('game_id', chunk)));
    players.push(...await selectAll<any>(db, 'college_game_player_stats', 'game_id,program_id,source,goals,minutes,participated,player_season_id', (q) => q.in('game_id', chunk)));
  }
  const progNames = new Map((await selectAll<any>(db, 'college_programs', 'id,name')).map((p) => [p.id, p.name]));
  const gameById = new Map(games.map((g) => [g.id, g]));
  const label = (g: any) => `${g.game_date} ${progNames.get(g.home_program_id) ?? g.home_name ?? '?'} vs ${progNames.get(g.away_program_id) ?? g.away_name ?? '?'}`;
  const checks: { id: string; title: string; description: string; count: number; sample: unknown[] }[] = [];
  const push = (id: string, title: string, description: string, rows: unknown[]) => checks.push({ id, title, description, count: rows.length, sample: rows.slice(0, 25) });

  push('no_truth', 'Final games without a truth source', 'Every final game should have source_of_truth = site or ncaa.', finals.filter((g) => !g.source_of_truth).map((g) => ({ game: label(g), id: g.id })));
  push('team_rows', 'Truth source missing a team-stat row', 'Exactly two team rows for the truth source.', finals.filter((g) => g.source_of_truth && team.filter((t) => t.game_id === g.id && t.source === g.source_of_truth).length !== 2).map((g) => ({ game: label(g), id: g.id, source: g.source_of_truth })));
  push('score_mismatch', 'Team goals ≠ game score', 'Truth-source team goals must equal the recorded score.', team.filter((t) => { const g = gameById.get(t.game_id); return g && g.status === 'final' && t.source === g.source_of_truth && t.goals != null && t.goals !== (t.is_home ? g.home_score : g.away_score); }).map((t) => ({ game: label(gameById.get(t.game_id)), id: t.game_id, program: progNames.get(t.program_id), goals: t.goals })));
  const pg = new Map<string, number>(); for (const p of players) { const k = `${p.game_id}|${p.program_id}|${p.source}`; pg.set(k, (pg.get(k) ?? 0) + (p.goals ?? 0)); }
  push('player_goals', 'Player goals ≠ team goals', 'Per game and side, player goals must sum to the team goals.', team.filter((t) => { const g = gameById.get(t.game_id); const s = pg.get(`${t.game_id}|${t.program_id}|${t.source}`); return g && g.source_of_truth === t.source && s != null && t.goals != null && s !== t.goals; }).map((t) => ({ game: label(gameById.get(t.game_id)), id: t.game_id, program: progNames.get(t.program_id), team: t.goals, players: pg.get(`${t.game_id}|${t.program_id}|${t.source}`) })));
  // Only sides whose box score actually carries field-player minutes (PrestoSports lists minutes for goalkeepers only).
  const mins = new Map<string, number>(); const minCounts = new Map<string, number>();
  for (const p of players) if (p.source === 'site' && p.participated) { const k = `${p.game_id}|${p.program_id}`; if (p.minutes != null) { mins.set(k, (mins.get(k) ?? 0) + p.minutes); minCounts.set(k, (minCounts.get(k) ?? 0) + 1); } }
  for (const [k, n] of minCounts) if (n < 8) mins.delete(k);
  const redOf = (gameId: string, pid: string) => team.find((t) => t.game_id === gameId && t.program_id === pid && t.source === 'site')?.red_cards ?? 0;
  push('minutes', 'Site minutes far from 11 × 90', 'Sum of participating players\' minutes should be ~990 (±20; OT adds 110; a red card removes the player\'s remaining minutes).', [...mins.entries()].filter(([k, m]) => { const [gid, pid] = k.split('|') as [string, string]; const g = gameById.get(gid); if (!g) return false; const expected = g.overtime ? 1100 : 990; const red = redOf(gid, pid); return m > expected + 20 || m < expected - 20 - 90 * red; }).map(([k, m]) => ({ game: label(gameById.get(k.split('|')[0]!)), id: k.split('|')[0], program: progNames.get(k.split('|')[1]!), minutes: m, red_cards: redOf(k.split('|')[0]!, k.split('|')[1]!) })));
  const disagreements: unknown[] = [];
  for (const s of team.filter((t) => t.source === 'site')) { const n = team.find((t) => t.game_id === s.game_id && t.program_id === s.program_id && t.source === 'ncaa'); if (n && (n.goals !== s.goals || n.yellow_cards !== s.yellow_cards || n.red_cards !== s.red_cards)) disagreements.push({ game: label(gameById.get(s.game_id)), id: s.game_id, program: progNames.get(s.program_id), site: { goals: s.goals, yc: s.yellow_cards, rc: s.red_cards }, ncaa: { goals: n.goals, yc: n.yellow_cards, rc: n.red_cards } }); }
  push('disagree', 'Site vs NCAA disagree (goals/cards)', 'Both sources present but goals or cards differ (shots are known to differ and are ignored).', disagreements);
  push('unresolved', 'Games with an unresolved opponent', 'A side whose program could not be matched to a known program.', games.filter((g) => !g.home_program_id || !g.away_program_id).map((g) => ({ game: label(g), id: g.id, home: g.home_name, away: g.away_name })));
  push('unlinked_players', 'Truth-source player lines not linked to a roster identity', 'Lines that matched nobody and could not be created.', players.filter((p) => { const g = gameById.get(p.game_id); return g && g.source_of_truth === p.source && !p.player_season_id; }).map((p) => ({ game: label(gameById.get(p.game_id)), id: p.game_id, program: progNames.get(p.program_id) })));
  // aggregates vs site cumulative table
  const seasonsRows = await selectAll<any>(db, 'college_player_seasons', 'id,program_id,college_players(display_name)', (q) => q.eq('season', season));
  const psIds = seasonsRows.map((r) => r.id);
  const agg: any[] = []; const site: any[] = [];
  for (let i = 0; i < psIds.length; i += 100) { const chunk = psIds.slice(i, i + 100); agg.push(...await selectAll<any>(db, 'college_player_season_stats', 'player_season_id,gp,minutes,goals,assists', (q) => q.in('player_season_id', chunk))); site.push(...await selectAll<any>(db, 'college_site_season_stats', 'player_season_id,gp,minutes,goals,assists', (q) => q.in('player_season_id', chunk))); }
  const aggMap = new Map(agg.map((a) => [a.player_season_id, a])); const psMap = new Map(seasonsRows.map((r) => [r.id, r]));
  const off = (a: unknown, b: unknown, tol = 0) => a != null && b != null && Math.abs(Number(a) - Number(b)) > tol;
  push('agg_vs_site', 'Computed season stats ≠ school cumulative table', 'goals/assists exact, minutes ±10, GP ±1 (fields the school does not publish are skipped).', site.filter((s) => { const a = aggMap.get(s.player_season_id); return a && (off(a.goals, s.goals) || off(a.assists, s.assists) || off(a.minutes, s.minutes, 10) || off(a.gp, s.gp, 1)); }).map((s) => { const a = aggMap.get(s.player_season_id); const r = psMap.get(s.player_season_id); return { player: r?.college_players?.display_name, program: progNames.get(r?.program_id), computed: a, school: s }; }));
  const noRoster = await selectAll<any>(db, 'college_program_seasons', 'program_id,division,college_programs!inner(name,site_status,college_schools(site_platform))', (q) => q.eq('season', season));
  const withRoster = new Set(seasonsRows.map((r) => r.program_id));
  push('no_roster', 'Program-seasons without any roster rows', 'Programs discovered for the season that have not been synced from their site yet.', noRoster.filter((r) => !withRoster.has(r.program_id)).map((r) => ({ program: r.college_programs?.name, division: r.division, site_status: r.college_programs?.site_status, platform: r.college_programs?.college_schools?.site_platform })));
  const fetches = await selectAll<any>(db, 'college_source_fetches', 'host,status,error,fetched_at', (q) => q.gte('fetched_at', new Date(Date.now() - 7 * 86400000).toISOString()));
  const byHost = new Map<string, { fetches: number; errors: number }>();
  // 404s are expected while probing optional endpoints (roster JSON, stats pages); only network / 5xx / 429 count.
  for (const f of fetches) { const h = byHost.get(f.host) ?? { fetches: 0, errors: 0 }; h.fetches += 1; if (f.error && (!f.status || f.status >= 500 || f.status === 429)) h.errors += 1; byHost.set(f.host, h); }
  // ---- standings / membership / rankings ----
  const stChecks = await selectAll<any>(db, 'college_standings_checks', 'program_id,field,official,computed,checked_at', (q) => q.eq('season', season));
  const stRows = await selectAll<any>(db, 'college_standings', 'program_id,source,college_conferences(name)', (q) => q.eq('season', season));
  const confOf = new Map(stRows.map((r) => [r.program_id, r.college_conferences?.name]));
  push('standings_vs_computed', 'Official standings ≠ our computed record', 'Conference or overall W-L-T on the conference website differs from the record computed from our stored games (missing/duplicate games or a wrong conference flag).', stChecks.filter((c) => c.field === 'conf_record' || c.field === 'overall_record').map((c) => ({ program: progNames.get(c.program_id), conference: confOf.get(c.program_id), field: c.field, official: c.official, computed: c.computed })));
  push('record_vs_ncaa', 'NCAA leaderboard record ≠ our computed record', 'The Won-Lost-Tied leaderboard on NCAA.com lists every member with its official overall record; differences mean missing or extra games on our side.', stChecks.filter((c) => c.field === 'ncaa_record').map((c) => ({ program: progNames.get(c.program_id), conference: confOf.get(c.program_id), official: c.official, computed: c.computed })));
  push('official_lag', 'Official record not yet updated (informational)', 'The official table counts fewer games than we store and every result it lists is also in our record: the source has not posted everything yet, or it leaves out games against lower divisions and non-NCAA opponents.', stChecks.filter((c) => String(c.field).endsWith('_lag')).map((c) => ({ program: progNames.get(c.program_id), conference: confOf.get(c.program_id), field: c.field, official: c.official, ours: c.computed })));
  push('ncaa_duplicate', 'NCAA.com counts a game twice (informational)', 'NCAA.com lists the same game under two contest ids and its leaderboard counts it twice; our record counts it once.', stChecks.filter((c) => c.field === 'ncaa_record_ncaa_duplicate').map((c) => ({ program: progNames.get(c.program_id), conference: confOf.get(c.program_id), ncaa: c.official, ours: c.computed })));
  push('computed_standings', 'Conferences without an official standings source', 'Standings computed from our games (conference site not registered or not server-rendered).', [...new Set(stRows.filter((r) => r.source === 'computed').map((r) => r.college_conferences?.name ?? '?'))].sort().map((name) => ({ conference: name })));
  const members = await selectAll<any>(db, 'college_program_seasons', 'program_id,division,ncaa_member,member_source,official_w,college_programs!inner(name,gender)', (q) => q.eq('season', season));
  push('non_member_programs', 'Programs classed as non-NCAA opponents', 'Appeared on NCAA scoreboards without a conference and are absent from the NCAA leaderboards (NAIA, Canadian, club, …). Hidden from team lists, leaders and standings.', members.filter((m) => m.ncaa_member === false).map((m) => ({ program: m.college_programs?.name, gender: m.college_programs?.gender, division: m.division })));
  push('members_unlisted', 'Members not (yet) on the NCAA leaderboard', 'Have a conference but no NCAA.com record row yet (usually no games played); kept as members.', members.filter((m) => m.ncaa_member && m.member_source === 'conference').map((m) => ({ program: m.college_programs?.name, gender: m.college_programs?.gender, division: m.division })));
  const [stUnres, uscUnres, uscCheck] = await Promise.all([kvGet<any>(db, `standings:unresolved:${season}`), kvGet<any>(db, `usc:unresolved:${season}`), kvGet<any>(db, `usc:ncaa_check:${season}`)]);
  push('standings_unresolved', 'Conference standings rows not matched to a program', 'School names on conference websites that resolve to no program (add an alias in data/team-aliases.json).', (stUnres?.rows ?? []).map((r: string) => ({ row: r })));
  push('usc_unresolved', 'Poll entries not matched to a program', 'United Soccer Coaches school names that resolve to no program.', Object.entries(uscUnres?.by_list ?? {}).flatMap(([list, names]: [string, any]) => [...new Set(names as string[])].map((n) => ({ list, school: n }))));
  push('usc_vs_ncaa', 'USC poll ≠ NCAA.com copy', 'Latest United Soccer Coaches poll compared rank-by-rank with the copy published on ncaa.com (D1).', Object.entries(uscCheck ?? {}).flatMap(([list, c]: [string, any]) => (c.mismatches ?? []).map((m: string) => ({ list, mismatch: m, site_poll: c.site_poll, ncaa_week: c.ncaa_week }))));
  push('fetch_errors', 'Hosts with fetch errors (7 days)', 'Network, 5xx or 429 failures per host (404 probes excluded); expect < 2%.', [...byHost.entries()].filter(([, v]) => v.errors > 0).map(([host, v]) => ({ host, ...v, pct: Math.round(1000 * v.errors / v.fetches) / 10 })).sort((a: any, b: any) => b.pct - a.pct));
  return { season, games: games.length, finals: finals.length, checks };
}


// ---------- matches ----------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** SQL stores form newest-first; readers want the latest result on the right. */
export const formOldestFirst = (f: string | null | undefined): string | null => (f ? [...f].reverse().join('') : null);
const shiftDate = (iso: string, days: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const seasonOfDate = (iso: string) => { const y = Number(iso.slice(0, 4)); return Number(iso.slice(5, 7)) >= 7 ? y : y - 1; };
/** A 'live' row nobody has refreshed for a while (a school site said "live" and never said final) is shown as scheduled. */
const LIVE_STALE_MS = 45 * 60_000;

/** Latest United Soccer Coaches rank per program for a season (every list), RV rows excluded. */
export async function latestUscRanks(db: Db, season: number): Promise<Map<string, { rank: number; week_of: string; label: string | null }>> {
  const weeks = await selectAll<any>(db, 'college_rankings', 'gender,division,week_of', (q) => q.eq('season', season).eq('poll', 'usc').eq('rank', 1));
  const latest = new Map<string, string>();
  for (const w of weeks) { const k = `${w.gender}|${w.division}`; if (!latest.has(k) || latest.get(k)! < w.week_of) latest.set(k, w.week_of); }
  const out = new Map<string, { rank: number; week_of: string; label: string | null }>();
  for (const [k, week] of latest) {
    const [gender, division] = k.split('|');
    const rows = await selectAll<any>(db, 'college_rankings', 'program_id,rank,week_of,label', (q) => q.eq('season', season).eq('poll', 'usc').eq('gender', gender).eq('division', division).eq('week_of', week).not('program_id', 'is', null).not('label', 'like', '%(RV)'));
    for (const r of rows) out.set(r.program_id, { rank: r.rank, week_of: r.week_of, label: r.label });
  }
  return out;
}

export interface MatchSide { program_id: string | null; name: string | null; short_name: string | null; seo: string | null; logo: string | null; conference: { id: string; name: string; short: string | null } | null; division: string | null; rank: number | null; score: number | null }
export interface MatchRow {
  id: string; season: number; game_date: string; start_epoch: number | null; gender: string; division: string | null; status: string;
  home: MatchSide; away: MatchSide; live: { period: string | null; clock: string | null; updated_at: string | null } | null;
  venue: { name: string | null; city: string | null } | null; neutral_site: boolean; conference_game: boolean; tournament: string | null;
  postseason: boolean; forfeit: boolean; overtime: boolean; shootout: boolean; source_of_truth: string | null; ncaa_contest_id: number | null;
}

export function toMatchRow(r: any, ranks?: Map<string, { rank: number }>, now = Date.now()): MatchRow {
  const side = (p: 'home' | 'away'): MatchSide => ({
    program_id: r[`${p}_program_id`], name: r[`${p}_name`], short_name: r[`${p}_short_name`] ?? null, seo: r[`${p}_seo`] ?? null, logo: r[`${p}_logo`] ?? null,
    conference: r[`${p}_conference_id`] ? { id: r[`${p}_conference_id`], name: r[`${p}_conference_name`], short: r[`${p}_conference_short`] ?? null } : null,
    division: r[`${p}_division`] ?? null, rank: (r[`${p}_program_id`] && ranks?.get(r[`${p}_program_id`])?.rank) ?? null, score: r[`${p}_score`],
  });
  const liveFresh = r.status === 'live' && r.live_updated_at && now - Date.parse(r.live_updated_at) < LIVE_STALE_MS;
  const status = r.status === 'live' && !liveFresh ? 'scheduled' : r.status;
  return {
    id: r.id, season: r.season, game_date: r.game_date, start_epoch: r.start_epoch ?? null, gender: r.gender, division: r.division, status,
    home: side('home'), away: side('away'),
    live: status === 'live' ? { period: r.live_period ?? null, clock: r.live_clock ?? null, updated_at: r.live_updated_at ?? null } : null,
    venue: r.venue_name || r.venue_city ? { name: r.venue_name ?? null, city: r.venue_city ?? null } : null,
    neutral_site: !!r.neutral_site, conference_game: !!r.conference_game, tournament: r.tournament ?? null, postseason: !!r.postseason,
    forfeit: !!r.forfeit, overtime: !!r.overtime, shootout: !!r.shootout, source_of_truth: r.source_of_truth ?? null, ncaa_contest_id: r.ncaa_contest_id ?? null,
  };
}

const STATUS_ORDER: Record<string, number> = { live: 0, scheduled: 1, final: 2, postponed: 3, cancelled: 3 };
export function sortMatches(rows: MatchRow[]): MatchRow[] {
  return [...rows].sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || a.game_date.localeCompare(b.game_date)
    || (a.start_epoch ?? Number.MAX_SAFE_INTEGER) - (b.start_epoch ?? Number.MAX_SAFE_INTEGER) || (a.home.name ?? '').localeCompare(b.home.name ?? ''));
}

export interface MatchesFilter { date: string; days?: unknown; gender?: string; division?: string; conference?: string; status?: string; only?: string }

/** Every game in a date range (1–7 days), live first, then by kickoff. */
export async function gamesByDate(db: Db, f: MatchesFilter) {
  if (!ISO_DATE.test(f.date)) throw new Error('date must be YYYY-MM-DD');
  const days = clamp(f.days, 1, 7, 1);
  const from = f.date, to = shiftDate(from, days - 1);
  const season = seasonOfDate(from);
  const [rows, ranks] = await Promise.all([
    selectAll<any>(db, 'college_v_schedule', '*', (q) => {
      q = q.gte('game_date', from).lte('game_date', to).order('game_date').order('start_epoch', { nullsFirst: false }).order('id');
      if (f.gender) q = q.eq('gender', f.gender);
      if (f.division) q = q.eq('division', f.division);
      if (f.status) q = q.eq('status', f.status);
      if (f.conference) q = q.or(`home_conference_id.eq.${f.conference},away_conference_id.eq.${f.conference}`);
      if (f.only === 'conf') q = q.eq('conference_game', true);
      return q;
    }),
    latestUscRanks(db, season),
  ]);
  let games = sortMatches(rows.map((r) => toMatchRow(r, ranks)));
  if (f.only === 'ranked') games = games.filter((g) => g.home.rank || g.away.rank);
  return { from, to, season, live: games.filter((g) => g.status === 'live').length, games, generated_at: new Date().toISOString() };
}

export interface LineupLine { player_id: string | null; player_season_id: string | null; headshot_url: string | null; name: string; jersey: number | null; position: string | null; minutes: number | null; goals: number | null; assists: number | null; shots: number | null; yc: number | null; rc: number | null; is_goalie: boolean; saves: number | null; goals_allowed: number | null; starter: boolean; participated: boolean; suppress: boolean }
export interface Lineup { source: 'site' | 'ncaa'; starters: LineupLine[]; subs: LineupLine[]; dnp: LineupLine[]; keeper: LineupLine | null }

const POS_ORDER: Record<string, number> = { GK: 0, G: 0, D: 1, DEF: 1, M: 2, MF: 2, MID: 2, F: 3, FW: 3, FWD: 3 };
function buildLineup(lines: any[], source: 'site' | 'ncaa'): Lineup {
  const map = (r: any): LineupLine => ({ player_id: r.college_player_seasons?.player_id ?? null, player_season_id: r.player_season_id ?? null, headshot_url: r.college_player_seasons?.headshot_url ?? null, name: `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim(), jersey: r.jersey ?? null, position: r.position ?? null, minutes: r.minutes ?? null, goals: r.goals ?? null, assists: r.assists ?? null, shots: r.shots ?? null, yc: r.yellow_cards ?? null, rc: r.red_cards ?? null, is_goalie: !!r.is_goalie, saves: r.saves ?? null, goals_allowed: r.goals_allowed ?? null, starter: !!r.starter, participated: r.participated !== false, suppress: !!r.college_player_seasons?.college_players?.suppress });
  const all = lines.map(map);
  const byPos = (a: LineupLine, b: LineupLine) => (POS_ORDER[(a.is_goalie ? 'GK' : a.position ?? '').toUpperCase()] ?? 4) - (POS_ORDER[(b.is_goalie ? 'GK' : b.position ?? '').toUpperCase()] ?? 4) || (a.jersey ?? 999) - (b.jersey ?? 999);
  const starters = all.filter((l) => l.starter).sort(byPos);
  const subs = all.filter((l) => !l.starter && l.participated).sort((a, b) => (b.minutes ?? 0) - (a.minutes ?? 0));
  const dnp = all.filter((l) => !l.participated).sort(byPos);
  const keeper = all.filter((l) => l.is_goalie && l.participated).sort((a, b) => (b.minutes ?? 0) - (a.minutes ?? 0))[0] ?? null;
  return { source, starters, subs, dnp, keeper };
}

const LINE_COLS = 'program_id,source,player_season_id,first_name,last_name,jersey,position,starter,participated,minutes,goals,assists,shots,yellow_cards,red_cards,is_goalie,saves,goals_allowed,college_player_seasons(player_id,headshot_url,college_players(suppress))';

/** Everything a coach wants around one match: head-to-head, form, standing, poll rank, key players, lineups. */
export async function matchPreview(db: Db, id: string) {
  const { data: g, error } = await db.from('college_v_schedule').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!g) return null;
  const season: number = g.season; const A = g.home_program_id as string | null; const B = g.away_program_id as string | null;
  const ids = [A, B].filter((x): x is string => !!x);
  const meetings = async () => {
    if (!A || !B) return [] as any[];
    const [x, y] = await Promise.all([
      db.from('college_v_schedule').select('*').eq('home_program_id', A).eq('away_program_id', B).eq('status', 'final').neq('id', id).order('game_date', { ascending: false }).limit(50),
      db.from('college_v_schedule').select('*').eq('home_program_id', B).eq('away_program_id', A).eq('status', 'final').neq('id', id).order('game_date', { ascending: false }).limit(50),
    ]);
    return [...(x.data ?? []), ...(y.data ?? [])].sort((p, q) => String(q.game_date).localeCompare(String(p.game_date)));
  };
  const [ranks, h2hRows, stats, standingRows, leaderRows, lines] = await Promise.all([
    latestUscRanks(db, season),
    meetings(),
    ids.length ? selectAll<any>(db, 'college_team_season_stats', '*', (q) => q.eq('season', season).in('program_id', ids)) : [],
    ids.length ? selectAll<any>(db, 'college_standings', 'program_id,conference_id,rank,pod,source,conf_w,conf_l,conf_t,conf_pts,overall_w,overall_l,overall_t,streak', (q) => q.eq('season', season).in('program_id', ids)) : [],
    ids.length ? selectAll<any>(db, 'college_v_player_leaders', 'player_id,display_name,suppress,program_id,jersey,position,headshot_url,gp,goals,assists,points,minutes,saves,save_pct,gaa,gk_minutes,shutouts', (q) => q.eq('season', season).in('program_id', ids)) : [],
    selectAll<any>(db, 'college_game_player_stats', LINE_COLS, (q) => q.eq('game_id', id)),
  ]);
  // Table sizes for "3rd of 12".
  const sizes = new Map<string, number>();
  for (const st of standingRows) {
    if (!st.conference_id) continue;
    const k = `${st.conference_id}|${st.pod ?? ''}`;
    if (!sizes.has(k)) {
      const { count } = await (st.pod ? db.from('college_standings').select('program_id,college_programs!inner(gender)', { count: 'exact', head: true }).eq('season', season).eq('conference_id', st.conference_id).eq('pod', st.pod).eq('college_programs.gender', g.gender)
        : db.from('college_standings').select('program_id,college_programs!inner(gender)', { count: 'exact', head: true }).eq('season', season).eq('conference_id', st.conference_id).eq('college_programs.gender', g.gender));
      sizes.set(k, count ?? 0);
    }
  }
  const game = toMatchRow(g, ranks);
  const src: 'site' | 'ncaa' | null = g.source_of_truth ?? (lines.some((l) => l.source === 'site') ? 'site' : lines.some((l) => l.source === 'ncaa') ? 'ncaa' : null);
  const sideOf = async (pid: string | null) => {
    if (!pid) return null;
    const st = stats.find((x) => x.program_id === pid) ?? null;
    const sr = standingRows.find((x) => x.program_id === pid) ?? null;
    const mine = leaderRows.filter((x) => x.program_id === pid);
    const scorers = [...mine].sort((a, b) => (b.points ?? 0) - (a.points ?? 0) || (b.goals ?? 0) - (a.goals ?? 0)).filter((x) => (x.points ?? 0) > 0).slice(0, 5);
    const assists = [...mine].sort((a, b) => (b.assists ?? 0) - (a.assists ?? 0)).filter((x) => (x.assists ?? 0) > 0).slice(0, 3);
    const keeper = [...mine].filter((x) => (x.gk_minutes ?? 0) > 0).sort((a, b) => (b.gk_minutes ?? 0) - (a.gk_minutes ?? 0))[0] ?? null;
    let lineup: Lineup | null = src ? buildLineup(lines.filter((l) => l.program_id === pid && l.source === src), src) : null;
    if (lineup && !lineup.starters.length && !lineup.subs.length) lineup = null;
    let last_lineup: (Lineup & { game_id: string; game_date: string; opponent: string | null }) | null = null;
    if (!lineup) {
      const { data: lastG } = await db.from('college_v_schedule').select('id,game_date,source_of_truth,home_program_id,home_name,away_name').or(`home_program_id.eq.${pid},away_program_id.eq.${pid}`).eq('season', season).eq('status', 'final').not('source_of_truth', 'is', null).neq('id', id).order('game_date', { ascending: false }).limit(1);
      const lg = lastG?.[0];
      if (lg) {
        const ll = await selectAll<any>(db, 'college_game_player_stats', LINE_COLS, (q) => q.eq('game_id', lg.id).eq('program_id', pid).eq('source', lg.source_of_truth));
        if (ll.length) last_lineup = { ...buildLineup(ll, lg.source_of_truth), game_id: lg.id, game_date: lg.game_date, opponent: lg.home_program_id === pid ? lg.away_name : lg.home_name };
      }
    }
    return {
      stats: st ? { ...st, form: { last5: formOldestFirst(st.form_last5), streak: st.streak ?? null } } : null,
      standing: sr ? { ...sr, of: sizes.get(`${sr.conference_id}|${sr.pod ?? ''}`) ?? null } : null,
      poll: ranks.get(pid) ?? null,
      leaders: { scorers, assists, keeper },
      lineup, last_lineup,
    };
  };
  const [home, away] = await Promise.all([sideOf(A), sideOf(B)]);
  const h2hGames = h2hRows.map((r) => toMatchRow(r, ranks));
  const h2h = { played: h2hGames.length, home_wins: 0, away_wins: 0, ties: 0, home_goals: 0, away_goals: 0, games: h2hGames.slice(0, 20) };
  for (const m of h2hGames) {
    const hs = m.home.program_id === A ? m.home.score : m.away.score, as = m.home.program_id === A ? m.away.score : m.home.score;
    if (hs == null || as == null) continue;
    h2h.home_goals += hs; h2h.away_goals += as;
    if (hs > as) h2h.home_wins += 1; else if (hs < as) h2h.away_wins += 1; else h2h.ties += 1;
  }
  return { game, head_to_head: h2h, sides: { home, away } };
}

// ---------- conferences ----------

export async function conferences(db: Db, o: { season: number; gender?: string; division?: string }) {
  const [confs, seasons, top] = await Promise.all([
    selectAll<any>(db, 'college_conferences', 'id,ncaa_seo,name,short_name,division,site_host'),
    selectAll<any>(db, 'college_program_seasons', 'program_id,conference_id,division,college_programs!inner(gender)', (q) => { q = q.eq('season', o.season).eq('ncaa_member', true).not('conference_id', 'is', null); if (o.gender) q = q.eq('college_programs.gender', o.gender); if (o.division) q = q.eq('division', o.division); return q; }),
    selectAll<any>(db, 'college_standings', 'conference_id,program_id,rank,pod,source,conf_w,conf_l,conf_t,conf_pts,college_programs!inner(name,gender,school_seo,college_schools(logo_svg_url))', (q) => { q = q.eq('season', o.season).lte('rank', 3); if (o.gender) q = q.eq('college_programs.gender', o.gender); return q; }),
  ]);
  const members = new Map<string, { m: number; w: number; divisions: Set<string> }>();
  for (const s of seasons) { const e = members.get(s.conference_id) ?? { m: 0, w: 0, divisions: new Set<string>() }; e[s.college_programs.gender as 'm' | 'w'] += 1; e.divisions.add(s.division); members.set(s.conference_id, e); }
  const leaders = new Map<string, any[]>();
  for (const t of top) { const k = `${t.conference_id}|${t.college_programs.gender}`; leaders.set(k, [...(leaders.get(k) ?? []), t]); }
  const pick = (k: string) => {
    const rows = leaders.get(k) ?? [];
    const pods = [...new Set(rows.map((r) => r.pod ?? ''))].sort();
    const pod = pods.includes('') ? '' : pods[0] ?? '';
    return rows.filter((r) => (r.pod ?? '') === pod).sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)).slice(0, 3).map((r) => ({ program_id: r.program_id, name: r.college_programs.name, seo: r.college_programs.school_seo, logo: r.college_programs.college_schools?.logo_svg_url ?? null, rank: r.rank, conf_w: r.conf_w, conf_l: r.conf_l, conf_t: r.conf_t, conf_pts: r.conf_pts }));
  };
  const out = confs.filter((c) => members.has(c.id)).map((c) => {
    const m = members.get(c.id)!;
    const genders = o.gender ? [o.gender] : ['m', 'w'];
    const table: Record<string, { top: any[]; source: string }> = {};
    for (const gd of genders) { const rows = leaders.get(`${c.id}|${gd}`) ?? []; table[gd] = { top: pick(`${c.id}|${gd}`), source: rows[0]?.source ?? 'none' }; }
    return { id: c.id, ncaa_seo: c.ncaa_seo, name: c.name, short_name: c.short_name ?? null, division: c.division ?? [...m.divisions][0] ?? null, site_host: c.site_host ?? null, members: { m: m.m, w: m.w }, table };
  }).sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export async function conference(db: Db, id: string, o: { season: number; gender: string }) {
  const { data: c, error } = await db.from('college_conferences').select('id,ncaa_seo,name,short_name,division,site_host,points_rule').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!c) return null;
  const today = eastern().date;
  const monday = shiftDate(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7));
  const [table, memberRows, week, ranks, pts, goals, assists, saves] = await Promise.all([
    standings(db, { season: o.season, gender: o.gender, conference: id }),
    selectAll<any>(db, 'college_program_seasons', 'program_id,division,ncaa_member,official_w,official_l,official_t,college_programs!inner(id,name,short_name,gender,school_seo,college_schools(name,logo_svg_url))', (q) => q.eq('season', o.season).eq('conference_id', id).eq('college_programs.gender', o.gender)),
    gamesByDate(db, { date: monday, days: 7, gender: o.gender, conference: id }),
    latestUscRanks(db, o.season),
    leaders(db, { season: o.season, gender: o.gender, conference: id, kind: 'player', stat: 'points', limit: 5 }),
    leaders(db, { season: o.season, gender: o.gender, conference: id, kind: 'player', stat: 'goals', limit: 5 }),
    leaders(db, { season: o.season, gender: o.gender, conference: id, kind: 'player', stat: 'assists', limit: 5 }),
    leaders(db, { season: o.season, gender: o.gender, conference: id, kind: 'player', stat: 'save_pct', min_minutes: 450, limit: 5 }),
  ]);
  const stats = new Map((await selectAll<any>(db, 'college_team_season_stats', 'program_id,gp,w,l,t,conf_w,conf_l,conf_t,gf,ga,gd,form_last5,streak,ppg', (q) => q.eq('season', o.season).in('program_id', memberRows.map((m) => m.program_id)))).map((x) => [x.program_id, x]));
  const members = memberRows.map((m) => ({ id: m.program_id, name: m.college_programs.name, short_name: m.college_programs.short_name, seo: m.college_programs.school_seo, logo: m.college_programs.college_schools?.logo_svg_url ?? null, division: m.division, member: m.ncaa_member !== false, official: m.official_w != null ? { w: m.official_w, l: m.official_l, t: m.official_t } : null, stats: (() => { const s = stats.get(m.program_id); return s ? { ...s, form: { last5: formOldestFirst(s.form_last5), streak: s.streak } } : null; })(), rank: ranks.get(m.program_id)?.rank ?? null })).sort((a, b) => a.name.localeCompare(b.name));
  return { conference: c, season: o.season, gender: o.gender, standings: table, members, this_week: week, leaders: { points: pts.rows, goals: goals.rows, assists: assists.rows, save_pct: saves.rows }, ranked: members.filter((m) => m.rank).sort((a, b) => a.rank! - b.rank!) };
}
