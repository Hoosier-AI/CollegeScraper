// Read helpers for the stats-viewer API. Service-role reads (internal tool).
import type { Db } from '../db/client.js';
import { selectAll } from '../db/client.js';

export const PLAYER_STATS = ['goals', 'assists', 'points', 'shots', 'sog', 'minutes', 'gp', 'gs', 'gwg', 'hat_tricks', 'goals_p90', 'assists_p90', 'points_p90', 'shots_p90', 'sog_p90', 'shot_accuracy', 'conversion_pct', 'saves', 'save_pct', 'gaa', 'shutouts', 'ga', 'gk_minutes', 'yc', 'rc', 'fouls', 'corners', 'offsides', 'pk_goals', 'pk_att', 'minutes_share'];
export const TEAM_STATS = ['w', 'l', 't', 'gp', 'gf', 'ga', 'gd', 'gf_pg', 'ga_pg', 'shots', 'sog', 'shots_pg', 'sog_pg', 'corners', 'corners_pg', 'fouls', 'offsides', 'saves', 'yc', 'rc', 'clean_sheets', 'avg_attendance', 'conf_w', 'conf_l', 'conf_t'];
const ASC = new Set(['gaa', 'ga', 'ga_pg', 'l']);

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

export interface ProgramFilter { season: number; gender?: string; division?: string; conference?: string; q?: string }

export async function programs(db: Db, f: ProgramFilter) {
  // No `in (...)` id lists: PostgREST URLs blow past 8 KB with 300 UUIDs. Filter by season/gender and join in JS.
  const seasons = await selectAll<any>(db, 'college_program_seasons', 'program_id,season,division,conference_id,roster_synced_at,schedule_synced_at,stats_synced_at,boxscores_synced_at,site_parse_failures',
    (q) => { q = q.eq('season', f.season); if (f.division) q = q.eq('division', f.division); if (f.conference) q = q.eq('conference_id', f.conference); return q; });
  if (!seasons.length) return [];
  const bySeason = new Map(seasons.map((s) => [s.program_id, s]));
  const progs = (await selectAll<any>(db, 'college_programs', 'id,name,short_name,gender,school_seo,site_status,site_sport_slug,college_schools(seo,name,logo_svg_url,athletics_host,site_platform)',
    (q) => (f.gender ? q.eq('gender', f.gender) : q))).filter((p) => bySeason.has(p.id));
  const [stats, games, confRows] = await Promise.all([
    selectAll<any>(db, 'college_team_season_stats', 'program_id,gp,w,l,t,gf,ga,computed_at', (q) => q.eq('season', f.season)),
    selectAll<any>(db, 'college_games', 'id,home_program_id,away_program_id,status,source_of_truth,site_fetched_at,ncaa_fetched_at', (q) => (f.gender ? q.eq('season', f.season).eq('gender', f.gender) : q.eq('season', f.season))),
    selectAll<any>(db, 'college_conferences', 'id,name,ncaa_seo'),
  ]);
  const confs = new Map(confRows.map((c) => [c.id, c]));
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
  const [ps, coaches, tss, standing, rankings, runs, seasonsAvail] = await Promise.all([
    db.from('college_program_seasons').select('*,college_conferences(id,name,ncaa_seo)').eq('program_id', id).eq('season', season).maybeSingle(),
    selectAll<any>(db, 'college_coach_seasons', 'title,is_head,college_coaches(id,name,headshot_url)', (q) => q.eq('program_id', id).eq('season', season)),
    db.from('college_team_season_stats').select('*').eq('program_id', id).eq('season', season).maybeSingle(),
    db.from('college_standings').select('*').eq('program_id', id).eq('season', season).maybeSingle(),
    selectAll<any>(db, 'college_rankings', 'poll,week_of,rank,value', (q) => q.eq('program_id', id).eq('season', season).order('week_of', { ascending: false }).limit(20)),
    selectAll<any>(db, 'college_crawl_runs', 'id,job,status,started_at,finished_at,counters,error,params', (q) => q.contains('params', { program: p.school_seo }).order('created_at', { ascending: false }).limit(5)),
    selectAll<any>(db, 'college_program_seasons', 'season', (q) => q.eq('program_id', id).order('season', { ascending: false })),
  ]);
  return { program: p, season: ps.data, coaches, teamStats: tss.data, standing: standing.data, rankings, runs, seasons: seasonsAvail.map((s) => s.season) };
}

export async function roster(db: Db, id: string, season: number) {
  const rows = await selectAll<any>(db, 'college_player_seasons', '*,college_players(id,first_name,last_name,display_name,hometown_city,hometown_region,hometown_country,headshot_url,bio_url,suppress)', (q) => q.eq('program_id', id).eq('season', season));
  const ids = rows.map((r) => r.id);
  if (!ids.length) return [];
  const [agg, site, honors] = await Promise.all([
    selectAll<any>(db, 'college_player_season_stats', '*', (q) => q.in('player_season_id', ids)),
    selectAll<any>(db, 'college_site_season_stats', '*', (q) => q.in('player_season_id', ids)),
    selectAll<any>(db, 'college_player_honors', 'player_season_id,text', (q) => q.in('player_season_id', ids)),
  ]);
  const a = new Map(agg.map((x) => [x.player_season_id, x])); const s = new Map(site.map((x) => [x.player_season_id, x]));
  const h = new Map<string, string[]>(); for (const x of honors) h.set(x.player_season_id, [...(h.get(x.player_season_id) ?? []), x.text]);
  return rows.map((r) => ({ ...r, player: r.college_players, college_players: undefined, stats: a.get(r.id) ?? null, site: s.get(r.id) ?? null, honors: h.get(r.id) ?? [] }))
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
    selectAll<any>(db, 'college_game_player_stats', '*', (q) => q.eq('game_id', id).order('program_id').order('jersey')),
    selectAll<any>(db, 'college_game_events', '*', (q) => q.eq('game_id', id).order('period').order('seq')),
    selectAll<any>(db, 'college_game_raw', 'source,payload,fetched_at', (q) => q.eq('game_id', id)),
  ]);
  return { game: { ...g, ...(header.data ?? {}) }, team, players, events, raw };
}

export async function player(db: Db, id: string) {
  const { data: p, error } = await db.from('college_players').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!p) return null;
  const seasons = await selectAll<any>(db, 'college_player_seasons', '*,college_programs(id,name,gender,school_seo,college_schools(logo_svg_url,name))', (q) => q.eq('player_id', id).order('season', { ascending: false }));
  const ids = seasons.map((s) => s.id);
  const [agg, site, honors, career, transfers, log] = await Promise.all([
    ids.length ? selectAll<any>(db, 'college_player_season_stats', '*', (q) => q.in('player_season_id', ids)) : [],
    ids.length ? selectAll<any>(db, 'college_site_season_stats', '*', (q) => q.in('player_season_id', ids)) : [],
    ids.length ? selectAll<any>(db, 'college_player_honors', '*', (q) => q.in('player_season_id', ids)) : [],
    db.from('college_v_player_career').select('*').eq('player_id', id).maybeSingle(),
    selectAll<any>(db, 'college_transfers', '*', (q) => q.eq('player_id', id)),
    ids.length ? selectAll<any>(db, 'college_game_player_stats', '*,college_games!inner(id,game_date,season,home_program_id,away_program_id,home_name,away_name,home_score,away_score,source_of_truth)', (q) => q.in('player_season_id', ids)) : [],
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
  return { player: p, seasons: seasons.map((s) => ({ ...s, program: s.college_programs, college_programs: undefined, stats: agg.find((a) => a.player_season_id === s.id) ?? null, site: site.find((a) => a.player_season_id === s.id) ?? null })), honors: honorsDedup, career: career.data, transfers, gameLog: truthLog };
}

export async function leaders(db: Db, o: { season: number; gender?: string; division?: string; conference?: string; kind?: string; stat?: string; min_minutes?: unknown; limit?: unknown }) {
  const team = o.kind === 'team';
  const allow = team ? TEAM_STATS : PLAYER_STATS;
  const stat = allow.includes(o.stat ?? '') ? o.stat! : (team ? 'w' : 'goals');
  const limit = clamp(o.limit, 1, 500, 100);
  const view = team ? 'college_v_team_leaders' : 'college_v_player_leaders';
  let q = db.from(view).select('*').eq('season', o.season).not(stat, 'is', null).order(stat, { ascending: ASC.has(stat) }).limit(limit);
  if (o.gender) q = q.eq('gender', o.gender);
  if (o.division) q = q.eq('division', o.division);
  if (o.conference) q = q.eq('conference_id', o.conference);
  if (!team) { q = q.eq('suppress', false); const mm = clamp(o.min_minutes, 0, 5000, 0); if (mm) q = q.gte('minutes', mm); }
  const { data, error } = await q;
  if (error) throw new Error(`leaders: ${error.message}`);
  return data ?? [];
}

export async function standings(db: Db, o: { season: number; gender?: string; division?: string }) {
  const rows = await selectAll<any>(db, 'college_standings', '*,college_conferences(id,name),college_programs!inner(id,name,gender,school_seo,college_schools(logo_svg_url))', (q) => {
    q = q.eq('season', o.season); if (o.division) q = q.eq('division', o.division); if (o.gender) q = q.eq('college_programs.gender', o.gender); return q;
  });
  if (rows.length) return { source: 'ncaa', rows: rows.sort((a, b) => (a.college_conferences?.name ?? '').localeCompare(b.college_conferences?.name ?? '') || (a.rank ?? 99) - (b.rank ?? 99)) };
  // No published standings stored (NCAA.com renders them client-side): derive from our own computed season records.
  const seasons = await selectAll<any>(db, 'college_program_seasons', 'program_id,division,conference_id,college_conferences(id,name),college_programs!inner(id,name,gender,school_seo,college_schools(logo_svg_url))', (q) => {
    q = q.eq('season', o.season); if (o.division) q = q.eq('division', o.division); if (o.gender) q = q.eq('college_programs.gender', o.gender); return q;
  });
  const stats = new Map((await selectAll<any>(db, 'college_team_season_stats', 'program_id,w,l,t,conf_w,conf_l,conf_t,gf,ga,gd', (q) => q.eq('season', o.season))).map((x) => [x.program_id, x]));
  const derived = seasons.filter((s) => stats.has(s.program_id)).map((s) => { const st = stats.get(s.program_id)!; return {
    season: o.season, program_id: s.program_id, division: s.division, conference_id: s.conference_id, college_conferences: s.college_conferences, college_programs: s.college_programs,
    conf_w: st.conf_w, conf_l: st.conf_l, conf_t: st.conf_t, conf_pts: st.conf_w * 3 + st.conf_t, overall_w: st.w, overall_l: st.l, overall_t: st.t, gd: st.gd, rank: null as number | null, fetched_at: null };
  });
  derived.sort((a, b) => (a.college_conferences?.name ?? '').localeCompare(b.college_conferences?.name ?? '') || b.conf_pts - a.conf_pts || (b.gd ?? 0) - (a.gd ?? 0));
  let conf = ''; let n = 0;
  for (const r of derived) { if (r.college_conferences?.name !== conf) { conf = r.college_conferences?.name ?? ''; n = 0; } r.rank = ++n; }
  return { source: 'computed', rows: derived };
}

export async function rankings(db: Db, o: { season: number; gender?: string; division?: string; poll?: string; week_of?: string }) {
  const polls = await selectAll<any>(db, 'college_rankings', 'poll,week_of', (q) => { q = q.eq('season', o.season); if (o.gender) q = q.eq('gender', o.gender); if (o.division) q = q.eq('division', o.division); return q; });
  const pollNames = [...new Set(polls.map((p) => p.poll))].sort();
  const poll = o.poll && pollNames.includes(o.poll) ? o.poll : (pollNames.includes('usc') ? 'usc' : pollNames[0]);
  const weeks = [...new Set(polls.filter((p) => p.poll === poll).map((p) => p.week_of))].sort().reverse();
  const week = o.week_of && weeks.includes(o.week_of) ? o.week_of : weeks[0];
  const rows = poll && week ? await selectAll<any>(db, 'college_rankings', '*,college_programs(id,name,school_seo,college_schools(logo_svg_url))', (q) => { q = q.eq('season', o.season).eq('poll', poll).eq('week_of', week).order('rank'); if (o.gender) q = q.eq('gender', o.gender); if (o.division) q = q.eq('division', o.division); return q; }) : [];
  return { polls: pollNames, poll, weeks, week, rows };
}

export async function runs(db: Db, limit = 50) {
  return selectAll<any>(db, 'college_crawl_runs', '*', (q) => q.order('created_at', { ascending: false }).limit(limit), limit);
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
  push('fetch_errors', 'Hosts with fetch errors (7 days)', 'Network, 5xx or 429 failures per host (404 probes excluded); expect < 2%.', [...byHost.entries()].filter(([, v]) => v.errors > 0).map(([host, v]) => ({ host, ...v, pct: Math.round(1000 * v.errors / v.fetches) / 10 })).sort((a: any, b: any) => b.pct - a.pct));
  return { season, games: games.length, finals: finals.length, checks };
}
