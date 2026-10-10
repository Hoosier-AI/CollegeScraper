// Pure: American Soccer Analysis JSON -> rows for the pro_src_* and pro_adv_* tables (migration 138). Rows keep ASA's
// own ids (ext); source-map maps them onto API-Football ids in pro_source_ids. Tested against recorded answers in
// fixtures/asa/.

export const SOURCE = 'asa';

const num = (v: unknown): number | null => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const int = (v: unknown): number | null => { const n = num(v); return n == null ? null : Math.round(n); };
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() && v.trim() !== '0' ? v.trim() : null);
const round = (v: unknown, d = 4): number | null => { const n = num(v); return n == null ? null : Math.round(n * 10 ** d) / 10 ** d; };
/** "2025-12-06 19:30:00 UTC" -> ISO. */
const utc = (v: unknown): string | null => { const s = str(v); if (!s) return null; const t = Date.parse(s.replace(' UTC', 'Z').replace(' ', 'T')); return Number.isFinite(t) ? new Date(t).toISOString() : null; };

// ---------- provider shapes (only the fields we read) ----------
export interface AsaGame { game_id: string; date_time_utc: string; home_score?: number | null; away_score?: number | null; home_team_id: string; away_team_id: string; referee_id?: string | null; stadium_id?: string | null; home_manager_id?: string | null; away_manager_id?: string | null; season_name?: string; matchday?: number | null; attendance?: number | null; knockout_game?: boolean; status?: string }
export interface AsaGameXg { game_id: string; home_team_xgoals?: number | null; away_team_xgoals?: number | null }
export interface AsaTeam { team_id: string; team_name: string; team_short_name?: string | null; team_abbreviation?: string | null }
export interface AsaPlayer { player_id: string; player_name: string; birth_date?: string | null; height_ft?: number | null; height_in?: number | null; weight_lb?: number | null; nationality?: string | null; primary_broad_position?: string | null; primary_general_position?: string | null; season_name?: string[] | Record<string, never> }
export interface AsaStadium { stadium_id: string; stadium_name: string; capacity?: number | null; year_built?: number | null; roof?: boolean | null; turf?: boolean | null; street?: string | null; city?: string | null; province?: string | null; country?: string | null; postal_code?: string | null; latitude?: number | null; longitude?: number | null }
export interface AsaPerson { manager_id?: string; referee_id?: string; manager_name?: string; referee_name?: string; birth_date?: string | null; nationality?: string | null }
export interface AsaGplus { action_type: string; goals_added_raw?: number | null; goals_added_above_avg?: number | null; count_actions?: number | null }
export interface AsaPlayerXg { player_id: string; team_id: string; general_position?: string | null; minutes_played?: number | null; shots?: number | null; shots_on_target?: number | null; goals?: number | null; xgoals?: number | null; xplace?: number | null; key_passes?: number | null; primary_assists?: number | null; xassists?: number | null }
export interface AsaPlayerXpass { player_id: string; team_id: string; minutes_played?: number | null; count_games?: number | null; attempted_passes?: number | null; pass_completion_percentage?: number | null; xpass_completion_percentage?: number | null; passes_completed_over_expected?: number | null }
export interface AsaPlayerGplus { player_id: string; team_id: string; general_position?: string | null; minutes_played?: number | null; data?: AsaGplus[] }
export interface AsaKeeperXg { player_id: string; team_id: string; minutes_played?: number | null; shots_faced?: number | null; goals_conceded?: number | null; saves?: number | null; xgoals_gk_faced?: number | null; goals_minus_xgoals_gk?: number | null }
export interface AsaTeamXg { team_id: string; count_games?: number | null; shots_for?: number | null; shots_against?: number | null; goals_for?: number | null; goals_against?: number | null; xgoals_for?: number | null; xgoals_against?: number | null; points?: number | null; xpoints?: number | null }
export interface AsaTeamXpass { team_id: string; attempted_passes_for?: number | null; pass_completion_percentage_for?: number | null; xpass_completion_percentage_for?: number | null; passes_completed_over_expected_for?: number | null; attempted_passes_against?: number | null; pass_completion_percentage_against?: number | null; xpass_completion_percentage_against?: number | null; passes_completed_over_expected_against?: number | null }
export interface AsaTeamGplus { team_id: string; data?: { action_type: string; num_actions_for?: number | null; goals_added_for?: number | null; num_actions_against?: number | null; goals_added_against?: number | null }[] }
export interface AsaShot { game_id: string; period_id?: number; game_minute?: number | null; team_id?: string; shooter_player_id?: string; shooter_player_name?: string; assist_player_id?: string; shot_location_x?: number | null; shot_location_y?: number | null; shot_end_location_x?: number | null; shot_end_location_y?: number | null; distance_from_goal_yds?: number | null; blocked?: number; goal?: number; own_goal?: number; shot_xg?: number | null; shot_psxg?: number | null; head?: number; pattern_of_play?: string | null; shot_order?: number | null }

// ---------- our rows ----------
export interface SrcGameRow { source: string; ext_id: string; league_id: number; season: number; kickoff: string; home_ext: string; away_ext: string; home_score: number | null; away_score: number | null; home_xg: number | null; away_xg: number | null; attendance: number | null; stadium_ext: string | null; referee_ext: string | null; home_manager_ext: string | null; away_manager_ext: string | null; matchday: number | null; knockout: boolean; status: 'final' | 'scheduled' | 'other'; updated_at: string }
export interface SrcTeamRow { source: string; ext_id: string; league_id: number; name: string; short_name: string | null; abbr: string | null; updated_at: string; url?: string | null }
export interface SrcPlayerRow { source: string; ext_id: string; name: string; birth_date: string | null; height_cm: number | null; weight_kg: number | null; nationality: string | null; position: string | null; seasons: number[]; updated_at: string }
export interface SrcVenueRow { source: string; ext_id: string; name: string; capacity: number | null; year_built: number | null; roof: boolean | null; turf: boolean | null; street: string | null; city: string | null; province: string | null; country: string | null; postal_code: string | null; lat: number | null; lng: number | null; updated_at: string }
export interface SrcOfficialRow { source: string; ext_id: string; role: 'manager' | 'referee'; name: string | null; birth_date: string | null; nationality: string | null; updated_at: string }
export type GplusByAction = Record<string, { raw: number | null; above_avg: number | null; actions: number | null }>;
export interface AdvPlayerSeasonRow {
  source: string; league_id: number; season: number; player_ext: string; team_ext: string; position: string | null; minutes: number | null; games: number | null;
  shots: number | null; shots_on: number | null; goals: number | null; xg: number | null; xplace: number | null; key_passes: number | null; assists: number | null; xa: number | null;
  passes: number | null; pass_pct: number | null; xpass_pct: number | null; passes_over_expected: number | null;
  g_plus: GplusByAction | null; g_plus_total: number | null;
  gk_shots_faced: number | null; gk_goals_conceded: number | null; gk_saves: number | null; gk_xg_faced: number | null; gk_goals_minus_xg: number | null;
  updated_at: string;
}
export interface AdvTeamSeasonRow {
  source: string; league_id: number; season: number; team_ext: string; games: number | null; shots_for: number | null; shots_against: number | null; goals_for: number | null; goals_against: number | null;
  xg_for: number | null; xg_against: number | null; points: number | null; xpoints: number | null;
  passes_for: number | null; pass_pct_for: number | null; xpass_pct_for: number | null; passes_over_expected_for: number | null;
  passes_against: number | null; pass_pct_against: number | null; xpass_pct_against: number | null; passes_over_expected_against: number | null;
  g_plus: Record<string, { for: number | null; against: number | null; actions_for: number | null; actions_against: number | null }> | null; g_plus_for: number | null; g_plus_against: number | null;
  updated_at: string;
}
export interface ShotRow { source: string; game_ext: string; seq: number; period: number | null; minute: number | null; team_ext: string | null; shooter_ext: string | null; shooter_name: string | null; assist_ext: string | null; x: number | null; y: number | null; end_x: number | null; end_y: number | null; distance_yds: number | null; xg: number | null; psxg: number | null; goal: boolean; own_goal: boolean; blocked: boolean; head: boolean; pattern: string | null }

// ---------- parsers ----------
const statusOf = (s: unknown): SrcGameRow['status'] => (s === 'FullTime' ? 'final' : s === 'PreGame' || s == null ? 'scheduled' : 'other');

export function parseGames(items: AsaGame[], league: number, season: number, xg: AsaGameXg[] = [], at = new Date().toISOString()): SrcGameRow[] {
  const byGame = new Map(xg.map((x) => [x.game_id, x]));
  const out: SrcGameRow[] = [];
  for (const g of items) {
    const kickoff = utc(g.date_time_utc);
    if (!str(g.game_id) || !kickoff || !str(g.home_team_id) || !str(g.away_team_id)) continue;
    const x = byGame.get(g.game_id);
    const final = statusOf(g.status) === 'final';
    out.push({
      source: SOURCE, ext_id: g.game_id, league_id: league, season, kickoff, home_ext: g.home_team_id, away_ext: g.away_team_id,
      home_score: final ? int(g.home_score) : null, away_score: final ? int(g.away_score) : null,
      home_xg: round(x?.home_team_xgoals), away_xg: round(x?.away_team_xgoals),
      // ASA records 0 when it has no attendance figure.
      attendance: int(g.attendance) || null, stadium_ext: str(g.stadium_id), referee_ext: str(g.referee_id),
      home_manager_ext: str(g.home_manager_id), away_manager_ext: str(g.away_manager_id), matchday: int(g.matchday), knockout: !!g.knockout_game, status: statusOf(g.status), updated_at: at,
    });
  }
  return out;
}

export const parseTeams = (items: AsaTeam[], league: number, at = new Date().toISOString()): SrcTeamRow[] =>
  items.filter((t) => str(t.team_id) && str(t.team_name)).map((t) => ({ source: SOURCE, ext_id: t.team_id, league_id: league, name: t.team_name.trim(), short_name: str(t.team_short_name), abbr: str(t.team_abbreviation), updated_at: at }));

export function parsePlayers(items: AsaPlayer[], at = new Date().toISOString()): SrcPlayerRow[] {
  return items.filter((p) => str(p.player_id) && str(p.player_name)).map((p) => {
    const ft = num(p.height_ft), inch = num(p.height_in), lb = num(p.weight_lb);
    const seasons = Array.isArray(p.season_name) ? p.season_name.map((s) => Number(String(s).slice(0, 4))).filter((n) => Number.isInteger(n)) : [];
    return {
      source: SOURCE, ext_id: p.player_id, name: p.player_name.trim(), birth_date: /^\d{4}-\d{2}-\d{2}$/.test(String(p.birth_date ?? '')) ? p.birth_date! : null,
      height_cm: ft ? Math.round((ft * 12 + (inch ?? 0)) * 2.54) : null, weight_kg: lb ? Math.round(lb * 0.4536) : null,
      nationality: str(p.nationality), position: str(p.primary_general_position) ?? str(p.primary_broad_position), seasons: [...new Set(seasons)].sort(), updated_at: at,
    };
  });
}

export const parseStadia = (items: AsaStadium[], at = new Date().toISOString()): SrcVenueRow[] =>
  items.filter((s) => str(s.stadium_id) && str(s.stadium_name)).map((s) => ({
    source: SOURCE, ext_id: s.stadium_id, name: s.stadium_name.trim(), capacity: int(s.capacity) || null, year_built: int(s.year_built) || null,
    roof: typeof s.roof === 'boolean' ? s.roof : null, turf: typeof s.turf === 'boolean' ? s.turf : null,
    street: str(s.street), city: str(s.city), province: str(s.province), country: str(s.country), postal_code: str(s.postal_code), lat: num(s.latitude), lng: num(s.longitude), updated_at: at,
  }));

export function parseOfficials(items: AsaPerson[], role: 'manager' | 'referee', at = new Date().toISOString()): SrcOfficialRow[] {
  return items.map((p) => ({ id: str(role === 'manager' ? p.manager_id : p.referee_id), p })).filter((x) => x.id).map(({ id, p }) => ({
    source: SOURCE, ext_id: id!, role, name: str(role === 'manager' ? p.manager_name : p.referee_name), birth_date: /^\d{4}-\d{2}-\d{2}$/.test(String(p.birth_date ?? '')) ? p.birth_date! : null, nationality: str(p.nationality), updated_at: at,
  }));
}

const gplus = (data: AsaGplus[] | undefined): { by: GplusByAction | null; total: number | null } => {
  if (!data?.length) return { by: null, total: null };
  const by: GplusByAction = {};
  let total = 0;
  for (const d of data) {
    if (!str(d.action_type)) continue;
    by[d.action_type] = { raw: round(d.goals_added_raw), above_avg: round(d.goals_added_above_avg), actions: int(d.count_actions) };
    total += num(d.goals_added_above_avg) ?? 0;
  }
  return { by, total: Math.round(total * 10000) / 10000 };
};

/** One row per player and club for a league season: shooting, passing, goals added and (keepers) shot-stopping. */
export function mergePlayerSeasons(parts: { xgoals?: AsaPlayerXg[]; xpass?: AsaPlayerXpass[]; gplus?: AsaPlayerGplus[]; keepers?: AsaKeeperXg[]; keeperGplus?: AsaPlayerGplus[] }, league: number, season: number, at = new Date().toISOString()): AdvPlayerSeasonRow[] {
  const rows = new Map<string, AdvPlayerSeasonRow>();
  const row = (p: { player_id: string; team_id: string }): AdvPlayerSeasonRow | null => {
    if (!str(p.player_id) || !str(p.team_id)) return null;
    const k = `${p.player_id}|${p.team_id}`;
    let r = rows.get(k);
    if (!r) {
      r = { source: SOURCE, league_id: league, season, player_ext: p.player_id, team_ext: p.team_id, position: null, minutes: null, games: null, shots: null, shots_on: null, goals: null, xg: null, xplace: null, key_passes: null, assists: null, xa: null,
        passes: null, pass_pct: null, xpass_pct: null, passes_over_expected: null, g_plus: null, g_plus_total: null, gk_shots_faced: null, gk_goals_conceded: null, gk_saves: null, gk_xg_faced: null, gk_goals_minus_xg: null, updated_at: at };
      rows.set(k, r);
    }
    return r;
  };
  for (const x of parts.xgoals ?? []) {
    const r = row(x); if (!r) continue;
    Object.assign(r, { position: str(x.general_position) ?? r.position, minutes: int(x.minutes_played) ?? r.minutes, shots: int(x.shots), shots_on: int(x.shots_on_target), goals: int(x.goals), xg: round(x.xgoals), xplace: round(x.xplace), key_passes: int(x.key_passes), assists: int(x.primary_assists), xa: round(x.xassists) });
  }
  for (const x of parts.xpass ?? []) {
    const r = row(x); if (!r) continue;
    Object.assign(r, { minutes: r.minutes ?? int(x.minutes_played), games: int(x.count_games), passes: int(x.attempted_passes), pass_pct: round(x.pass_completion_percentage), xpass_pct: round(x.xpass_completion_percentage), passes_over_expected: round(x.passes_completed_over_expected, 2) });
  }
  for (const x of [...(parts.gplus ?? []), ...(parts.keeperGplus ?? [])]) {
    const r = row(x); if (!r) continue;
    const g = gplus(x.data);
    Object.assign(r, { position: r.position ?? str(x.general_position), minutes: r.minutes ?? int(x.minutes_played), g_plus: g.by, g_plus_total: g.total });
  }
  for (const x of parts.keepers ?? []) {
    const r = row(x); if (!r) continue;
    Object.assign(r, { position: r.position ?? 'GK', minutes: r.minutes ?? int(x.minutes_played), gk_shots_faced: int(x.shots_faced), gk_goals_conceded: int(x.goals_conceded), gk_saves: int(x.saves), gk_xg_faced: round(x.xgoals_gk_faced), gk_goals_minus_xg: round(x.goals_minus_xgoals_gk) });
  }
  return [...rows.values()];
}

export function mergeTeamSeasons(parts: { xgoals?: AsaTeamXg[]; xpass?: AsaTeamXpass[]; gplus?: AsaTeamGplus[] }, league: number, season: number, at = new Date().toISOString()): AdvTeamSeasonRow[] {
  const rows = new Map<string, AdvTeamSeasonRow>();
  const row = (id: string): AdvTeamSeasonRow => {
    let r = rows.get(id);
    if (!r) {
      r = { source: SOURCE, league_id: league, season, team_ext: id, games: null, shots_for: null, shots_against: null, goals_for: null, goals_against: null, xg_for: null, xg_against: null, points: null, xpoints: null,
        passes_for: null, pass_pct_for: null, xpass_pct_for: null, passes_over_expected_for: null, passes_against: null, pass_pct_against: null, xpass_pct_against: null, passes_over_expected_against: null,
        g_plus: null, g_plus_for: null, g_plus_against: null, updated_at: at };
      rows.set(id, r);
    }
    return r;
  };
  for (const x of parts.xgoals ?? []) if (str(x.team_id)) Object.assign(row(x.team_id), { games: int(x.count_games), shots_for: int(x.shots_for), shots_against: int(x.shots_against), goals_for: int(x.goals_for), goals_against: int(x.goals_against), xg_for: round(x.xgoals_for), xg_against: round(x.xgoals_against), points: int(x.points), xpoints: round(x.xpoints, 2) });
  for (const x of parts.xpass ?? []) if (str(x.team_id)) Object.assign(row(x.team_id), {
    passes_for: int(x.attempted_passes_for), pass_pct_for: round(x.pass_completion_percentage_for), xpass_pct_for: round(x.xpass_completion_percentage_for), passes_over_expected_for: round(x.passes_completed_over_expected_for, 2),
    passes_against: int(x.attempted_passes_against), pass_pct_against: round(x.pass_completion_percentage_against), xpass_pct_against: round(x.xpass_completion_percentage_against), passes_over_expected_against: round(x.passes_completed_over_expected_against, 2),
  });
  for (const x of parts.gplus ?? []) {
    if (!str(x.team_id) || !x.data?.length) continue;
    const by: NonNullable<AdvTeamSeasonRow['g_plus']> = {};
    let f = 0, a = 0;
    for (const d of x.data) { by[d.action_type] = { for: round(d.goals_added_for), against: round(d.goals_added_against), actions_for: int(d.num_actions_for), actions_against: int(d.num_actions_against) }; f += num(d.goals_added_for) ?? 0; a += num(d.goals_added_against) ?? 0; }
    Object.assign(row(x.team_id), { g_plus: by, g_plus_for: Math.round(f * 10000) / 10000, g_plus_against: Math.round(a * 10000) / 10000 });
  }
  return [...rows.values()];
}

export function parseShots(items: AsaShot[]): ShotRow[] {
  return items.filter((s) => str(s.game_id)).map((s, i) => ({
    source: SOURCE, game_ext: s.game_id, seq: i + 1, period: int(s.period_id), minute: int(s.game_minute), team_ext: str(s.team_id),
    shooter_ext: str(s.shooter_player_id), shooter_name: str(s.shooter_player_name), assist_ext: str(s.assist_player_id),
    x: num(s.shot_location_x), y: num(s.shot_location_y), end_x: num(s.shot_end_location_x), end_y: num(s.shot_end_location_y), distance_yds: round(s.distance_from_goal_yds, 1),
    xg: round(s.shot_xg), psxg: round(s.shot_psxg) || null, goal: !!s.goal, own_goal: !!s.own_goal, blocked: !!s.blocked, head: !!s.head, pattern: str(s.pattern_of_play),
  }));
}
