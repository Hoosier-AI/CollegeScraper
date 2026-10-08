// Pure: API-Football JSON -> rows for the pro_* tables (column names match migration 134). No I/O, so each shape is
// tested against recorded answers in fixtures/apiFootball/.
import { nameKey, stripDiacritics } from '../../normalize/names.js';
import { leagueGender, leagueKind, leaguePriority, teamDisplayName, type Gender } from './leagues.js';

// ---------- provider shapes (only the fields we read) ----------
export interface AfCoverage { fixtures?: { events?: boolean; lineups?: boolean; statistics_fixtures?: boolean; statistics_players?: boolean }; standings?: boolean; players?: boolean; [k: string]: unknown }
export interface AfLeagueItem {
  league: { id: number; name: string; type: string; logo?: string | null };
  country: { name?: string | null; code?: string | null; flag?: string | null };
  seasons: { year: number; start?: string | null; end?: string | null; current?: boolean; coverage?: AfCoverage }[];
}
export interface AfTeamRef { id: number; name: string; logo?: string | null; winner?: boolean | null }
export interface AfFixtureItem {
  fixture: { id: number; referee?: string | null; date: string; timestamp?: number; venue?: { id?: number | null; name?: string | null; city?: string | null }; status: { long?: string; short: string; elapsed?: number | null; extra?: number | null } };
  league: { id: number; name?: string; country?: string; logo?: string | null; flag?: string | null; season: number; round?: string | null };
  teams: { home: AfTeamRef; away: AfTeamRef };
  goals: { home: number | null; away: number | null };
  score?: { halftime?: Side; fulltime?: Side; extratime?: Side; penalty?: Side };
  events?: AfEvent[];
  lineups?: AfLineup[];
  statistics?: { team: { id: number }; statistics: { type: string; value: number | string | null }[] }[];
  players?: { team: { id: number }; players: AfPlayerLine[] }[];
}
interface Side { home: number | null; away: number | null }
export interface AfEvent { time: { elapsed: number | null; extra: number | null }; team: { id: number | null }; player: { id: number | null; name: string | null }; assist: { id: number | null; name: string | null }; type: string; detail: string | null; comments: string | null }
export interface AfLineup { team: { id: number }; coach?: { id?: number | null; name?: string | null }; formation?: string | null; startXI?: { player: AfLineupPlayer }[]; substitutes?: { player: AfLineupPlayer }[] }
interface AfLineupPlayer { id: number | null; name: string | null; number: number | null; pos: string | null; grid: string | null }
export interface AfPlayerLine {
  player: { id: number | null; name: string | null; photo?: string | null };
  statistics: {
    games?: { minutes?: number | null; number?: number | null; position?: string | null; rating?: string | null; captain?: boolean; substitute?: boolean };
    offsides?: number | null; shots?: { total?: number | null; on?: number | null };
    goals?: { total?: number | null; conceded?: number | null; assists?: number | null; saves?: number | null };
    passes?: { total?: number | null; key?: number | null; accuracy?: string | number | null };
    tackles?: { total?: number | null; blocks?: number | null; interceptions?: number | null };
    duels?: { total?: number | null; won?: number | null }; dribbles?: { attempts?: number | null; success?: number | null };
    fouls?: { drawn?: number | null; committed?: number | null }; cards?: { yellow?: number | null; red?: number | null };
    penalty?: { scored?: number | null; missed?: number | null; saved?: number | null };
  }[];
}
export interface AfStandingRow { rank: number; team: { id: number; name: string; logo?: string | null }; points: number; goalsDiff: number; group?: string | null; form?: string | null; description?: string | null; all: { played: number; win: number; draw: number; lose: number; goals: { for: number; against: number } } }
export interface AfStandingsItem { league: { id: number; season: number; standings: AfStandingRow[][] } }
export interface AfProfile { player: { id: number; name: string; firstname?: string | null; lastname?: string | null; birth?: { date?: string | null; place?: string | null; country?: string | null }; nationality?: string | null; height?: string | null; weight?: string | null; position?: string | null; photo?: string | null } }
export interface AfTeamItem { team: { id: number; name: string; code?: string | null; country?: string | null; founded?: number | null; national?: boolean; logo?: string | null }; venue?: { name?: string | null; city?: string | null; capacity?: number | null } }

// ---------- rows ----------
export type FixtureStatus = 'scheduled' | 'live' | 'final' | 'postponed' | 'cancelled' | 'abandoned';
export interface LeagueRow { id: number; name: string; type: 'league' | 'cup'; country: string | null; country_code: string | null; country_flag: string | null; logo: string | null; gender: Gender; kind: ReturnType<typeof leagueKind>; priority: number; current_season: number | null; enabled: boolean }
export interface SeasonRow { league_id: number; season: number; starts_on: string | null; ends_on: string | null; is_current: boolean; coverage: AfCoverage }
export interface TeamRow { id: number; name: string; display_name: string; logo: string | null; gender: Gender | null }
export interface TeamProfileRow extends TeamRow { code: string | null; country: string | null; founded: number | null; national: boolean; venue_name: string | null; venue_city: string | null; venue_capacity: number | null; profile_synced_at: string }
export interface FixtureRow {
  id: number; league_id: number; season: number; round: string | null; kickoff: string; status: FixtureStatus; status_short: string;
  elapsed: number | null; elapsed_extra: number | null; home_team_id: number; away_team_id: number;
  home_goals: number | null; away_goals: number | null; ht_home: number | null; ht_away: number | null; et_home: number | null; et_away: number | null; pen_home: number | null; pen_away: number | null;
  winner: 'home' | 'away' | 'draw' | null; venue_name: string | null; venue_city: string | null; referee: string | null;
}
export interface EventRow { fixture_id: number; seq: number; minute: number | null; extra: number | null; team_id: number | null; player_id: number | null; player_name: string | null; assist_id: number | null; assist_name: string | null; type: string; detail: string | null; comments: string | null }
export interface LineupRow { fixture_id: number; team_id: number; formation: string | null; coach_id: number | null; coach_name: string | null }
export interface FixturePlayerRow {
  fixture_id: number; team_id: number; slot: number; player_id: number | null; name: string; number: number | null; pos: string | null; grid: string | null;
  starter: boolean; substitute: boolean; captain: boolean; minutes: number | null; rating: number | null;
  goals: number | null; assists: number | null; conceded: number | null; saves: number | null; shots: number | null; shots_on: number | null;
  passes: number | null; key_passes: number | null; pass_accuracy: number | null; tackles: number | null; blocks: number | null; interceptions: number | null;
  duels: number | null; duels_won: number | null; dribbles: number | null; dribbles_won: number | null; fouls_drawn: number | null; fouls_committed: number | null;
  yellow: number | null; red: number | null; offsides: number | null; pen_scored: number | null; pen_missed: number | null; pen_saved: number | null;
}
export interface TeamStatsRow { fixture_id: number; team_id: number; possession: number | null; shots: number | null; shots_on: number | null; shots_off: number | null; shots_blocked: number | null; shots_inside: number | null; shots_outside: number | null; corners: number | null; offsides: number | null; fouls: number | null; yellow: number | null; red: number | null; saves: number | null; passes: number | null; passes_accurate: number | null; pass_pct: number | null; xg: number | null }
export interface PlayerStubRow { id: number; name: string; display_name: string; photo: string | null; gender: Gender | null }
export interface PlayerProfileRow { id: number; name: string; display_name: string; first_name: string | null; last_name: string | null; name_key: string | null; birth_date: string | null; birth_place: string | null; birth_country: string | null; nationality: string | null; height_cm: number | null; weight_kg: number | null; position: string | null; photo: string | null; profile_synced_at: string }
export interface StandingRow { league_id: number; season: number; group_name: string; team_id: number; rank: number | null; points: number | null; played: number | null; win: number | null; draw: number | null; lose: number | null; gf: number | null; ga: number | null; gd: number | null; form: string | null; description: string | null }
export interface FixtureDetail { events: EventRow[]; lineups: LineupRow[]; players: FixturePlayerRow[]; teamStats: TeamStatsRow[]; playerStubs: PlayerStubRow[] }

// ---------- helpers ----------
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'string' ? Number(v.replace('%', '')) : Number(v);
  return Number.isFinite(n) ? n : null;
};
const int = (v: unknown): number | null => { const n = num(v); return n == null ? null : Math.round(n); };
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** The provider's status codes. SUSP/INT (suspended, interrupted) are still in progress as far as a scoreboard goes. */
export function statusOf(short: string): FixtureStatus {
  switch (short) {
    case 'FT': case 'AET': case 'PEN': case 'AWD': case 'WO': return 'final';
    case '1H': case 'HT': case '2H': case 'ET': case 'BT': case 'P': case 'SUSP': case 'INT': case 'LIVE': return 'live';
    case 'PST': return 'postponed';
    case 'CANC': return 'cancelled';
    case 'ABD': return 'abandoned';
    default: return 'scheduled'; // TBD, NS
  }
}

// ---------- leagues ----------
export function parseLeagues(items: AfLeagueItem[]): { leagues: LeagueRow[]; seasons: SeasonRow[] } {
  const leagues: LeagueRow[] = []; const seasons: SeasonRow[] = [];
  for (const it of items) {
    const id = it.league?.id; if (!Number.isInteger(id)) continue;
    const name = it.league.name?.trim() || `League ${id}`;
    const type = String(it.league.type).toLowerCase() === 'cup' ? 'cup' : 'league';
    const kind = leagueKind(id, name);
    const current = (it.seasons ?? []).find((s) => s.current) ?? null;
    leagues.push({
      id, name, type, country: str(it.country?.name), country_code: str(it.country?.code), country_flag: str(it.country?.flag), logo: str(it.league.logo),
      gender: leagueGender(id, name), kind, priority: leaguePriority(id, type, kind), current_season: current?.year ?? null,
      // Crawled when professional and still running (a current season the provider covers with fixtures).
      enabled: kind === 'pro' && !!current,
    });
    for (const s of it.seasons ?? []) {
      if (!Number.isInteger(s.year)) continue;
      seasons.push({ league_id: id, season: s.year, starts_on: str(s.start), ends_on: str(s.end), is_current: !!s.current, coverage: s.coverage ?? {} });
    }
  }
  return { leagues, seasons };
}

// ---------- fixtures ----------
export function parseFixture(it: AfFixtureItem): FixtureRow {
  const f = it.fixture; const s = it.score ?? {};
  const status = statusOf(f.status?.short ?? 'NS');
  const hg = num(it.goals?.home), ag = num(it.goals?.away);
  let winner: FixtureRow['winner'] = null;
  if (status === 'final') {
    if (it.teams.home.winner === true) winner = 'home';
    else if (it.teams.away.winner === true) winner = 'away';
    else if (hg != null && ag != null) winner = hg > ag ? 'home' : hg < ag ? 'away' : 'draw';
  }
  return {
    id: f.id, league_id: it.league.id, season: it.league.season, round: str(it.league.round),
    kickoff: new Date(f.timestamp ? f.timestamp * 1000 : Date.parse(f.date)).toISOString(),
    status, status_short: f.status?.short ?? 'NS', elapsed: int(f.status?.elapsed), elapsed_extra: int(f.status?.extra),
    home_team_id: it.teams.home.id, away_team_id: it.teams.away.id,
    // The provider fills goals with 0-0 before kickoff on some feeds; a score only means something once play started.
    home_goals: status === 'scheduled' || status === 'postponed' || status === 'cancelled' ? null : hg,
    away_goals: status === 'scheduled' || status === 'postponed' || status === 'cancelled' ? null : ag,
    ht_home: int(s.halftime?.home), ht_away: int(s.halftime?.away), et_home: int(s.extratime?.home), et_away: int(s.extratime?.away),
    pen_home: int(s.penalty?.home), pen_away: int(s.penalty?.away), winner,
    venue_name: str(f.venue?.name), venue_city: str(f.venue?.city), referee: str(f.referee),
  };
}

/** Both sides of every fixture as team rows (name and crest only; the profile comes from /teams). */
export function teamsOf(items: AfFixtureItem[], genderOf: (leagueId: number) => Gender | null): TeamRow[] {
  const out = new Map<number, TeamRow>();
  for (const it of items) for (const t of [it.teams.home, it.teams.away]) {
    if (!Number.isInteger(t?.id) || out.has(t.id)) continue;
    out.set(t.id, { id: t.id, name: t.name, display_name: teamDisplayName(t.name), logo: str(t.logo), gender: genderOf(it.league.id) });
  }
  return [...out.values()];
}

// ---------- fixture detail (events, lineups, player lines, team stats) ----------
const EVENT_TYPE: Record<string, string> = { goal: 'goal', card: 'card', subst: 'subst', var: 'var' };

export function parseFixtureDetail(it: AfFixtureItem, gender: Gender | null): FixtureDetail {
  const fixture_id = it.fixture.id;
  const events: EventRow[] = (it.events ?? []).map((e, i) => ({
    fixture_id, seq: i + 1, minute: int(e.time?.elapsed), extra: int(e.time?.extra), team_id: e.team?.id ?? null,
    player_id: e.player?.id ?? null, player_name: str(e.player?.name), assist_id: e.assist?.id ?? null, assist_name: str(e.assist?.name),
    type: EVENT_TYPE[String(e.type).toLowerCase()] ?? String(e.type).toLowerCase(), detail: str(e.detail), comments: str(e.comments),
  }));

  const lineups: LineupRow[] = (it.lineups ?? []).map((l) => ({ fixture_id, team_id: l.team.id, formation: str(l.formation), coach_id: l.coach?.id ?? null, coach_name: str(l.coach?.name) }));

  // One line per player per side: the lineup gives order, shirt, position and grid; the player block gives the stats.
  // Matched by id, else by printed name (the provider lists some lineup players without an id).
  const players: FixturePlayerRow[] = []; const stubs = new Map<number, PlayerStubRow>();
  const sides = new Set<number>([...(it.lineups ?? []).map((l) => l.team.id), ...(it.players ?? []).map((p) => p.team.id)]);
  for (const team_id of sides) {
    const lineup = (it.lineups ?? []).find((l) => l.team.id === team_id);
    const lines = (it.players ?? []).find((p) => p.team.id === team_id)?.players ?? [];
    const byId = new Map<number, AfPlayerLine>(); const byName = new Map<string, AfPlayerLine>();
    for (const p of lines) { if (p.player.id != null) byId.set(p.player.id, p); if (p.player.name) byName.set(p.player.name, p); }
    const used = new Set<AfPlayerLine>();
    let slot = 0;
    const push = (lp: AfLineupPlayer | null, line: AfPlayerLine | null, starter: boolean) => {
      if (line) used.add(line);
      const st = line?.statistics?.[0] ?? {};
      const id = lp?.id ?? line?.player.id ?? null;
      const name = str(lp?.name) ?? str(line?.player.name) ?? 'Unknown';
      slot += 1;
      players.push({
        fixture_id, team_id, slot, player_id: id, name, number: int(lp?.number ?? st.games?.number), pos: str(lp?.pos) ?? str(st.games?.position), grid: str(lp?.grid),
        starter, substitute: !starter, captain: !!st.games?.captain, minutes: int(st.games?.minutes), rating: num(st.games?.rating),
        goals: int(st.goals?.total), assists: int(st.goals?.assists), conceded: int(st.goals?.conceded), saves: int(st.goals?.saves),
        shots: int(st.shots?.total), shots_on: int(st.shots?.on), passes: int(st.passes?.total), key_passes: int(st.passes?.key), pass_accuracy: int(st.passes?.accuracy),
        tackles: int(st.tackles?.total), blocks: int(st.tackles?.blocks), interceptions: int(st.tackles?.interceptions),
        duels: int(st.duels?.total), duels_won: int(st.duels?.won), dribbles: int(st.dribbles?.attempts), dribbles_won: int(st.dribbles?.success),
        fouls_drawn: int(st.fouls?.drawn), fouls_committed: int(st.fouls?.committed), yellow: int(st.cards?.yellow), red: int(st.cards?.red),
        offsides: int(st.offsides), pen_scored: int(st.penalty?.scored), pen_missed: int(st.penalty?.missed), pen_saved: int(st.penalty?.saved),
      });
      if (id != null && !stubs.has(id)) stubs.set(id, { id, name, display_name: name, photo: str(line?.player.photo), gender });
    };
    const find = (lp: AfLineupPlayer) => (lp.id != null ? byId.get(lp.id) : undefined) ?? (lp.name ? byName.get(lp.name) : undefined) ?? null;
    for (const s of lineup?.startXI ?? []) push(s.player, find(s.player), true);
    for (const s of lineup?.substitutes ?? []) push(s.player, find(s.player), false);
    // No lineup (smaller competitions): the player block alone, starters being those not flagged as substitutes.
    for (const p of lines) if (!used.has(p)) push(null, p, !lineup && p.statistics?.[0]?.games?.substitute === false);
  }

  const teamStats: TeamStatsRow[] = [];
  for (const s of it.statistics ?? []) {
    if (!s.statistics?.length) continue;
    const v = new Map(s.statistics.map((x) => [x.type.toLowerCase(), x.value]));
    const g = (k: string) => int(v.get(k));
    teamStats.push({
      fixture_id, team_id: s.team.id, possession: num(v.get('ball possession')),
      shots: g('total shots'), shots_on: g('shots on goal'), shots_off: g('shots off goal'), shots_blocked: g('blocked shots'),
      shots_inside: g('shots insidebox'), shots_outside: g('shots outsidebox'), corners: g('corner kicks'), offsides: g('offsides'), fouls: g('fouls'),
      yellow: g('yellow cards'), red: g('red cards'), saves: g('goalkeeper saves'), passes: g('total passes'), passes_accurate: g('passes accurate'),
      pass_pct: num(v.get('passes %')), xg: num(v.get('expected_goals')),
    });
  }
  return { events, lineups, players, teamStats, playerStubs: [...stubs.values()] };
}

/** True when the answer carries any detail at all (some competitions have none: the score is all there is). */
export const hasDetail = (d: FixtureDetail): boolean => d.events.length > 0 || d.players.length > 0 || d.teamStats.length > 0;

// ---------- standings ----------
export function parseStandings(items: AfStandingsItem[]): StandingRow[] {
  const out: StandingRow[] = [];
  for (const it of items) {
    const groups = it.league?.standings ?? [];
    const multi = groups.length > 1;
    for (const rows of groups) for (const r of rows) {
      out.push({
        league_id: it.league.id, season: it.league.season,
        // Single-table leagues: no group name, so the key does not change when the provider renames the table.
        group_name: multi ? str(r.group) ?? '' : '', team_id: r.team.id, rank: int(r.rank), points: int(r.points),
        played: int(r.all?.played), win: int(r.all?.win), draw: int(r.all?.draw), lose: int(r.all?.lose),
        gf: int(r.all?.goals?.for), ga: int(r.all?.goals?.against), gd: int(r.goalsDiff), form: str(r.form), description: str(r.description),
      });
    }
  }
  // The same team twice in one group (provider glitch) would break the primary key: keep the first.
  const seen = new Set<string>();
  return out.filter((r) => { const k = `${r.league_id}|${r.season}|${r.group_name}|${r.team_id}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

// ---------- people and clubs ----------
/** "Mackenzie Elizabeth" + "Arnold" -> "Mackenzie Arnold": first given name and the family name, as people say it. */
export function personDisplayName(first: string | null | undefined, last: string | null | undefined, fallback: string): string {
  const f = (first ?? '').trim().split(/\s+/)[0] ?? '';
  const l = (last ?? '').trim();
  const full = `${f} ${l}`.trim();
  return full && l ? full : fallback;
}

export function parseProfile(it: AfProfile, at = new Date().toISOString()): PlayerProfileRow {
  const p = it.player;
  const first = str(p.firstname), last = str(p.lastname);
  const display = personDisplayName(first, last, p.name);
  const given = (first ?? '').split(/\s+/)[0] ?? '';
  return {
    id: p.id, name: p.name, display_name: display, first_name: first, last_name: last,
    name_key: last ? nameKey(given, last) : null,
    birth_date: str(p.birth?.date), birth_place: str(p.birth?.place), birth_country: str(p.birth?.country), nationality: str(p.nationality),
    height_cm: int(p.height), weight_kg: int(p.weight), position: str(p.position), photo: str(p.photo), profile_synced_at: at,
  };
}

export function parseTeams(items: AfTeamItem[], gender: Gender | null, at = new Date().toISOString()): TeamProfileRow[] {
  return items.filter((t) => Number.isInteger(t.team?.id)).map((t) => ({
    id: t.team.id, name: t.team.name, display_name: teamDisplayName(t.team.name), logo: str(t.team.logo), gender,
    code: str(t.team.code), country: str(t.team.country), founded: int(t.team.founded), national: !!t.team.national,
    venue_name: str(t.venue?.name), venue_city: str(t.venue?.city), venue_capacity: int(t.venue?.capacity), profile_synced_at: at,
  }));
}

/** Loose key for matching people across sources: ASCII, lower case, letters only. */
export const looseKey = (s: string): string => stripDiacritics(s).toLowerCase().replace(/[^a-z]/g, '');
