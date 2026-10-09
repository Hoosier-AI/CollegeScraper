// Pure: API-Football JSON -> rows for the pro_* tables (column names match migration 134). No I/O, so each shape is
// tested against recorded answers in fixtures/apiFootball/.
import { nameKey, stripDiacritics } from '../../normalize/names.js';
import { isUsScene, leagueGender, leagueKind, leaguePriority, teamDisplayName, type Gender } from './leagues.js';

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
    duels?: { total?: number | null; won?: number | null }; dribbles?: { attempts?: number | null; success?: number | null; past?: number | null };
    fouls?: { drawn?: number | null; committed?: number | null }; cards?: { yellow?: number | null; red?: number | null };
    penalty?: { won?: number | null; commited?: number | null; scored?: number | null; missed?: number | null; saved?: number | null };
  }[];
}
export interface AfStandingRow { rank: number; team: { id: number; name: string; logo?: string | null }; points: number; goalsDiff: number; group?: string | null; form?: string | null; description?: string | null; all: { played: number; win: number; draw: number; lose: number; goals: { for: number; against: number } } }
export interface AfStandingsItem { league: { id: number; season: number; standings: AfStandingRow[][] } }
export interface AfProfile { player: { id: number; name: string; firstname?: string | null; lastname?: string | null; birth?: { date?: string | null; place?: string | null; country?: string | null }; nationality?: string | null; height?: string | null; weight?: string | null; position?: string | null; photo?: string | null } }
export interface AfVenue { id?: number | null; name?: string | null; address?: string | null; city?: string | null; country?: string | null; capacity?: number | null; surface?: string | null; image?: string | null }
export interface AfTeamItem { team: { id: number; name: string; code?: string | null; country?: string | null; founded?: number | null; national?: boolean; logo?: string | null }; venue?: AfVenue }

// ---------- rows ----------
export type FixtureStatus = 'scheduled' | 'live' | 'final' | 'postponed' | 'cancelled' | 'abandoned';
export interface LeagueRow { id: number; name: string; type: 'league' | 'cup'; country: string | null; country_code: string | null; country_flag: string | null; logo: string | null; gender: Gender; kind: ReturnType<typeof leagueKind>; priority: number; current_season: number | null; enabled: boolean }
export interface SeasonRow { league_id: number; season: number; starts_on: string | null; ends_on: string | null; is_current: boolean; coverage: AfCoverage }
export interface TeamRow { id: number; name: string; display_name: string; logo: string | null; gender: Gender | null }
export interface TeamProfileRow extends TeamRow { code: string | null; country: string | null; founded: number | null; national: boolean; venue_id: number | null; venue_name: string | null; venue_city: string | null; venue_capacity: number | null; profile_synced_at: string }
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
  dribbled_past: number | null; pen_won: number | null; pen_committed: number | null;
}
export interface TeamStatsRow { fixture_id: number; team_id: number; possession: number | null; shots: number | null; shots_on: number | null; shots_off: number | null; shots_blocked: number | null; shots_inside: number | null; shots_outside: number | null; corners: number | null; offsides: number | null; fouls: number | null; yellow: number | null; red: number | null; saves: number | null; passes: number | null; passes_accurate: number | null; pass_pct: number | null; xg: number | null;
  /** Every other stat type the provider sent (free kicks, goals prevented ...), by snake-cased name. */
  extra: Record<string, number | string> | null }
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
/** The provider uses 0 (and sometimes null) for a person it has no id for. */
const realId = (v: unknown): number | null => (Number.isInteger(v) && (v as number) > 0 ? (v as number) : null);

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
      // Crawled when professional and still running (a current season the provider covers with fixtures); the whole US
      // scene is crawled whatever its level.
      enabled: (kind === 'pro' || isUsScene(id, str(it.country?.name))) && !!current,
    });
    // The provider sometimes lists a season year twice for one league; keep one row (the current one if either is).
    const byYear = new Map<number, SeasonRow>();
    for (const s of it.seasons ?? []) {
      if (!Number.isInteger(s.year)) continue;
      const row: SeasonRow = { league_id: id, season: s.year, starts_on: str(s.start), ends_on: str(s.end), is_current: !!s.current, coverage: s.coverage ?? {} };
      const prev = byYear.get(s.year);
      if (!prev || (row.is_current && !prev.is_current)) byYear.set(s.year, row);
    }
    seasons.push(...byYear.values());
  }
  // And the same league twice: last one wins.
  const uniq = new Map(leagues.map((l) => [l.id, l]));
  const seen = new Set<string>();
  return { leagues: [...uniq.values()], seasons: seasons.filter((s) => { const k = `${s.league_id}|${s.season}`; if (seen.has(k)) return false; seen.add(k); return true; }) };
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
    player_id: realId(e.player?.id), player_name: str(e.player?.name), assist_id: realId(e.assist?.id), assist_name: str(e.assist?.name),
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
    for (const p of lines) { const pid = realId(p.player.id); if (pid != null) byId.set(pid, p); if (p.player.name) byName.set(p.player.name, p); }
    const used = new Set<AfPlayerLine>();
    let slot = 0;
    const push = (lp: AfLineupPlayer | null, line: AfPlayerLine | null, starter: boolean) => {
      if (line) used.add(line);
      const st = line?.statistics?.[0] ?? {};
      const id = realId(lp?.id) ?? realId(line?.player.id);
      const name = str(lp?.name) ?? str(line?.player.name) ?? 'Unknown';
      slot += 1;
      players.push({
        fixture_id, team_id, slot, player_id: id, name, number: int(lp?.number ?? st.games?.number), pos: str(lp?.pos) ?? str(st.games?.position), grid: str(lp?.grid),
        // An unused substitute comes back with a 0 rating: no rating, not a bad one.
        starter, substitute: !starter, captain: !!st.games?.captain, minutes: int(st.games?.minutes), rating: num(st.games?.rating) || null,
        goals: int(st.goals?.total), assists: int(st.goals?.assists), conceded: int(st.goals?.conceded), saves: int(st.goals?.saves),
        shots: int(st.shots?.total), shots_on: int(st.shots?.on), passes: int(st.passes?.total), key_passes: int(st.passes?.key), pass_accuracy: int(st.passes?.accuracy),
        tackles: int(st.tackles?.total), blocks: int(st.tackles?.blocks), interceptions: int(st.tackles?.interceptions),
        duels: int(st.duels?.total), duels_won: int(st.duels?.won), dribbles: int(st.dribbles?.attempts), dribbles_won: int(st.dribbles?.success),
        fouls_drawn: int(st.fouls?.drawn), fouls_committed: int(st.fouls?.committed), yellow: int(st.cards?.yellow), red: int(st.cards?.red),
        offsides: int(st.offsides), pen_scored: int(st.penalty?.scored), pen_missed: int(st.penalty?.missed), pen_saved: int(st.penalty?.saved),
        dribbled_past: int(st.dribbles?.past), pen_won: int(st.penalty?.won), pen_committed: int(st.penalty?.commited),
      });
      if (id != null && !stubs.has(id)) stubs.set(id, { id, name, display_name: name, photo: str(line?.player.photo), gender });
    };
    const find = (lp: AfLineupPlayer) => (realId(lp.id) != null ? byId.get(lp.id!) : undefined) ?? (lp.name ? byName.get(lp.name) : undefined) ?? null;
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
    const extra: Record<string, number | string> = {};
    for (const [k, val] of v) {
      if (MAPPED_TEAM_STATS.has(k) || val == null || val === '') continue;
      const n = num(val);
      extra[k.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')] = n ?? String(val);
    }
    teamStats.push({
      fixture_id, team_id: s.team.id, possession: num(v.get('ball possession')),
      shots: g('total shots'), shots_on: g('shots on goal'), shots_off: g('shots off goal'), shots_blocked: g('blocked shots'),
      shots_inside: g('shots insidebox'), shots_outside: g('shots outsidebox'), corners: g('corner kicks'), offsides: g('offsides'), fouls: g('fouls'),
      yellow: g('yellow cards'), red: g('red cards'), saves: g('goalkeeper saves'), passes: g('total passes'), passes_accurate: g('passes accurate'),
      pass_pct: num(v.get('passes %')), xg: num(v.get('expected_goals')), extra: Object.keys(extra).length ? extra : null,
    });
  }
  return { events, lineups, players, teamStats, playerStubs: [...stubs.values()] };
}

const MAPPED_TEAM_STATS = new Set(['ball possession', 'total shots', 'shots on goal', 'shots off goal', 'blocked shots', 'shots insidebox', 'shots outsidebox',
  'corner kicks', 'offsides', 'fouls', 'yellow cards', 'red cards', 'goalkeeper saves', 'total passes', 'passes accurate', 'passes %', 'expected_goals']);

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
  const legal = full && l ? full : fallback;
  return commonName(fallback, first, last, legal);
}

const INITIALS = /^(\p{Lu}\p{L}?\.\s*)+/u;
/**
 * The name people use (same rule as pro_common_name in migration 142): the provider's short name "L. Messi" gives the
 * surname ("Lionel Messi", "Virgil van Dijk"); a short name of one or two words without initials ("Neymar") is used
 * as it is; otherwise the full name.
 */
export function commonName(short: string | null | undefined, first: string | null | undefined, last: string | null | undefined, display: string): string {
  const s = (short ?? '').trim();
  const f = (first ?? '').trim();
  if (INITIALS.test(s) && f) {
    const surname = s.replace(INITIALS, '').trim();
    if (surname && `${last ?? ''} ${display}`.toLowerCase().includes(surname.toLowerCase())) return `${f.split(/\s+/)[0]} ${surname}`;
  }
  if (s && !s.includes('.') && s.length > 1 && s.split(/\s+/).length <= 2) return s;
  return display;
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
    code: str(t.team.code), country: str(t.team.country), founded: int(t.team.founded), national: !!t.team.national, venue_id: realId(t.venue?.id),
    venue_name: str(t.venue?.name), venue_city: str(t.venue?.city), venue_capacity: int(t.venue?.capacity), profile_synced_at: at,
  }));
}

/** Loose key for matching people across sources: ASCII, lower case, letters only. */
export const looseKey = (s: string): string => stripDiacritics(s).toLowerCase().replace(/[^a-z]/g, '');

// ---------- v2: the bulk crawl (every club, player, squad, transfer, coach, trophy, injury) ----------
export interface AfCountry { name: string; code?: string | null; flag?: string | null }
export interface AfLeaguePlayer { player: AfProfile['player'] & { injured?: boolean }; statistics: AfSeasonStat[] }
export interface AfSeasonStat {
  team: { id: number | null; name?: string | null; logo?: string | null };
  league: { id: number | null; season: number | null };
  games?: { appearences?: number | null; lineups?: number | null; minutes?: number | null; number?: number | null; position?: string | null; rating?: string | number | null; captain?: boolean | null };
  substitutes?: { in?: number | null; out?: number | null; bench?: number | null };
  shots?: { total?: number | null; on?: number | null };
  goals?: { total?: number | null; conceded?: number | null; assists?: number | null; saves?: number | null };
  passes?: { total?: number | null; key?: number | null; accuracy?: number | string | null };
  tackles?: { total?: number | null; blocks?: number | null; interceptions?: number | null };
  duels?: { total?: number | null; won?: number | null };
  dribbles?: { attempts?: number | null; success?: number | null; past?: number | null };
  fouls?: { drawn?: number | null; committed?: number | null };
  cards?: { yellow?: number | null; yellowred?: number | null; red?: number | null };
  penalty?: { won?: number | null; commited?: number | null; scored?: number | null; missed?: number | null; saved?: number | null };
}
export interface AfSquad { team: { id: number; name?: string }; players: { id: number | null; name: string | null; age?: number | null; number?: number | null; position?: string | null; photo?: string | null }[] }
interface AfTransferTeam { id: number | null; name?: string | null; logo?: string | null }
export interface AfTransferItem { player: { id: number | null; name?: string | null }; transfers: { date?: string | null; type?: string | null; teams: { in?: AfTransferTeam | null; out?: AfTransferTeam | null } }[] }
export interface AfCoach { id: number; name: string; firstname?: string | null; lastname?: string | null; birth?: { date?: string | null; country?: string | null }; nationality?: string | null; photo?: string | null; team?: { id?: number | null } | null; career?: { team: AfTransferTeam; start?: string | null; end?: string | null }[] }
export interface AfTrophy { league?: string | null; country?: string | null; season?: string | null; place?: string | null }
export interface AfInjury { player: { id: number | null; name?: string | null; type?: string | null; reason?: string | null }; team: { id: number | null }; fixture?: { id?: number | null; date?: string | null; timestamp?: number | null }; league: { id: number; season: number } }

export interface CountryRow { name: string; code: string | null; flag: string | null }
export interface SeasonStatRow {
  player_id: number; league_id: number; season: number; team_id: number; source: 'provider';
  apps: number; starts: number; lineups: number | null; minutes: number; goals: number; assists: number;
  sub_in: number | null; sub_out: number | null; bench: number | null; captain: boolean | null; number: number | null; position: string | null; rating: number | null;
  shots: number | null; shots_on: number | null; passes: number | null; key_passes: number | null; pass_accuracy: number | null;
  tackles: number | null; blocks: number | null; interceptions: number | null; duels: number | null; duels_won: number | null;
  dribbles: number | null; dribbles_won: number | null; dribbled_past: number | null; fouls_drawn: number | null; fouls_committed: number | null;
  yellow: number; yellowred: number | null; red: number; saves: number | null; conceded: number | null;
  pen_won: number | null; pen_committed: number | null; pen_scored: number | null; pen_missed: number | null; pen_saved: number | null; computed_at: string;
}
export interface SquadRow { team_id: number; player_id: number; number: number | null; position: string | null; updated_at: string }
export interface TransferRow { player_id: number; date: string; from_team_id: number; to_team_id: number; type: string | null; player_name: string | null; from_name: string | null; from_logo: string | null; to_name: string | null; to_logo: string | null; updated_at: string }
export interface CoachRow { id: number; name: string; display_name: string; first_name: string | null; last_name: string | null; birth_date: string | null; birth_country: string | null; nationality: string | null; photo: string | null; team_id: number | null; updated_at: string }
export interface CoachCareerRow { coach_id: number; team_id: number; start: string; end: string | null; team_name: string | null; team_logo: string | null }
export interface TrophyRow { subject: 'player' | 'coach'; subject_id: number; league: string; country: string; season: string; place: string }
export interface InjuryRow { league_id: number; season: number; player_id: number; fixture_id: number; team_id: number | null; type: string | null; reason: string | null; date: string | null }

const isoDate = (v: unknown): string | null => { const s = str(v); return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null; };

export const parseCountries = (items: AfCountry[]): CountryRow[] => items.filter((c) => str(c.name)).map((c) => ({ name: c.name.trim(), code: str(c.code), flag: str(c.flag) }));

/** Clubs from teams?country=: the provider marks women's sides with a trailing " W". */
export function parseCountryTeams(items: AfTeamItem[], at = new Date().toISOString()): TeamProfileRow[] {
  return parseTeams(items, null, at).map((t) => ({ ...t, gender: /\sW$/.test(t.name) ? 'w' : 'm' }));
}

/** players/profiles?page=: a page of profiles (250), the same shape as one profile. */
export const parseProfilesPage = (items: AfProfile[], at = new Date().toISOString()): PlayerProfileRow[] =>
  items.filter((p) => Number.isInteger(p.player?.id) && p.player.id > 0 && str(p.player.name)).map((p) => parseProfile(p, at));

/**
 * players?league&season: each player's profile plus one season row per club in that competition. Rows with no
 * appearance are dropped (a squad listing is not a season played), as are other competitions the answer may carry.
 */
/** league null: every competition in the answer (players?id&season: one player's whole season). */
export function parseLeaguePlayers(items: AfLeaguePlayer[], league: number | null, season: number, at = new Date().toISOString()): { profiles: PlayerProfileRow[]; stats: SeasonStatRow[] } {
  const profiles: PlayerProfileRow[] = []; const stats: SeasonStatRow[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    const id = it.player?.id;
    if (!Number.isInteger(id) || id <= 0 || !str(it.player.name)) continue;
    profiles.push(parseProfile({ player: it.player }, at));
    for (const s of it.statistics ?? []) {
      const lid = s.league?.id;
      if (!Number.isInteger(lid) || (league != null && lid !== league) || Number(s.league?.season) !== season || !Number.isInteger(s.team?.id)) continue;
      const apps = int(s.games?.appearences) ?? 0, minutes = int(s.games?.minutes) ?? 0;
      if (apps <= 0 && minutes <= 0) continue;
      const key = `${id}|${lid}|${s.team.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      stats.push({
        player_id: id, league_id: lid!, season, team_id: s.team.id!, source: 'provider',
        apps, starts: int(s.games?.lineups) ?? 0, lineups: int(s.games?.lineups), minutes, goals: int(s.goals?.total) ?? 0, assists: int(s.goals?.assists) ?? 0,
        sub_in: int(s.substitutes?.in), sub_out: int(s.substitutes?.out), bench: int(s.substitutes?.bench), captain: s.games?.captain ?? null,
        number: int(s.games?.number), position: str(s.games?.position), rating: num(s.games?.rating) ? Math.round(num(s.games?.rating)! * 100) / 100 : null,
        shots: int(s.shots?.total), shots_on: int(s.shots?.on), passes: int(s.passes?.total), key_passes: int(s.passes?.key), pass_accuracy: int(s.passes?.accuracy),
        tackles: int(s.tackles?.total), blocks: int(s.tackles?.blocks), interceptions: int(s.tackles?.interceptions), duels: int(s.duels?.total), duels_won: int(s.duels?.won),
        dribbles: int(s.dribbles?.attempts), dribbles_won: int(s.dribbles?.success), dribbled_past: int(s.dribbles?.past), fouls_drawn: int(s.fouls?.drawn), fouls_committed: int(s.fouls?.committed),
        yellow: int(s.cards?.yellow) ?? 0, yellowred: int(s.cards?.yellowred), red: int(s.cards?.red) ?? 0,
        saves: int(s.goals?.saves), conceded: int(s.goals?.conceded),
        pen_won: int(s.penalty?.won), pen_committed: int(s.penalty?.commited), pen_scored: int(s.penalty?.scored), pen_missed: int(s.penalty?.missed), pen_saved: int(s.penalty?.saved),
        computed_at: at,
      });
    }
  }
  return { profiles, stats };
}

/** players/squads?team: the current squad (the provider lists some players with id 0: skipped). */
export function parseSquad(items: AfSquad[], at = new Date().toISOString()): { squad: SquadRow[]; stubs: PlayerStubRow[] } {
  const squad: SquadRow[] = []; const stubs: PlayerStubRow[] = []; const seen = new Set<string>();
  for (const it of items) for (const p of it.players ?? []) {
    if (!Number.isInteger(p.id) || (p.id as number) <= 0 || !str(p.name)) continue;
    const k = `${it.team.id}|${p.id}`; if (seen.has(k)) continue; seen.add(k);
    squad.push({ team_id: it.team.id, player_id: p.id as number, number: int(p.number), position: str(p.position), updated_at: at });
    stubs.push({ id: p.id as number, name: p.name!.trim(), display_name: p.name!.trim(), photo: str(p.photo), gender: null });
  }
  return { squad, stubs };
}

/** transfers?team (or ?player): every move of every player listed, one row per move. Undated moves are skipped. */
export function parseTransfers(items: AfTransferItem[], at = new Date().toISOString()): TransferRow[] {
  const out = new Map<string, TransferRow>();
  for (const it of items) {
    const pid = it.player?.id;
    if (!Number.isInteger(pid) || (pid as number) <= 0) continue;
    for (const t of it.transfers ?? []) {
      const date = isoDate(t.date);
      if (!date) continue;
      const to = t.teams?.in ?? null, from = t.teams?.out ?? null;
      const row: TransferRow = { player_id: pid as number, date, from_team_id: from?.id ?? 0, to_team_id: to?.id ?? 0, type: str(t.type) && !/^(n\/a|-)$/i.test(t.type!) ? t.type!.trim() : null,
        player_name: str(it.player.name), from_name: str(from?.name), from_logo: str(from?.logo), to_name: str(to?.name), to_logo: str(to?.logo), updated_at: at };
      out.set(`${row.player_id}|${row.date}|${row.from_team_id}|${row.to_team_id}`, row);
    }
  }
  return [...out.values()];
}

export function parseCoaches(items: AfCoach[], at = new Date().toISOString()): { coaches: CoachRow[]; career: CoachCareerRow[] } {
  const coaches: CoachRow[] = []; const career: CoachCareerRow[] = [];
  for (const c of items) {
    if (!Number.isInteger(c.id) || !str(c.name)) continue;
    coaches.push({ id: c.id, name: c.name, display_name: personDisplayName(c.firstname, c.lastname, c.name), first_name: str(c.firstname), last_name: str(c.lastname),
      birth_date: isoDate(c.birth?.date), birth_country: str(c.birth?.country), nationality: str(c.nationality), photo: str(c.photo), team_id: c.team?.id ?? null, updated_at: at });
    const seen = new Set<string>();
    for (const j of c.career ?? []) {
      if (!Number.isInteger(j.team?.id)) continue;
      const start = isoDate(j.start) ?? '1900-01-01';
      const k = `${j.team.id}|${start}`; if (seen.has(k)) continue; seen.add(k);
      career.push({ coach_id: c.id, team_id: j.team.id!, start, end: isoDate(j.end), team_name: str(j.team.name), team_logo: str(j.team.logo) });
    }
  }
  return { coaches, career };
}

export function parseTrophies(items: AfTrophy[], subject: 'player' | 'coach', id: number): TrophyRow[] {
  const out = new Map<string, TrophyRow>();
  for (const t of items) {
    const league = str(t.league); if (!league) continue;
    const row: TrophyRow = { subject, subject_id: id, league, country: str(t.country) ?? '', season: str(t.season) ?? '', place: str(t.place) ?? '' };
    out.set(`${row.league}|${row.country}|${row.season}|${row.place}`, row);
  }
  return [...out.values()];
}

export function parseInjuries(items: AfInjury[]): InjuryRow[] {
  const out = new Map<string, InjuryRow>();
  for (const i of items) {
    const pid = i.player?.id;
    if (!Number.isInteger(pid) || (pid as number) <= 0 || !Number.isInteger(i.league?.id)) continue;
    const ts = i.fixture?.timestamp ? new Date(i.fixture.timestamp * 1000).toISOString().slice(0, 10) : isoDate(i.fixture?.date);
    const row: InjuryRow = { league_id: i.league.id, season: i.league.season, player_id: pid as number, fixture_id: i.fixture?.id ?? 0, team_id: i.team?.id ?? null, type: str(i.player.type), reason: str(i.player.reason), date: ts };
    out.set(`${row.player_id}|${row.fixture_id}`, row);
  }
  return [...out.values()];
}

// ---------- v3: club season stats, grounds, injury history ----------
export type Split = { home: number | null; away: number | null; total: number | null };
export type Minutes = Record<string, number | null>;
export interface AfTeamStatistics {
  league?: { id?: number; season?: number }; team?: { id?: number }; form?: string | null;
  fixtures?: Record<string, { home?: number | null; away?: number | null; total?: number | null }>;
  goals?: Record<'for' | 'against', { total?: Record<string, number | null>; average?: Record<string, string | number | null>; minute?: Record<string, { total?: number | null }>; under_over?: Record<string, { over?: number | null; under?: number | null }> }>;
  biggest?: { streak?: Record<string, number | null>; wins?: Record<string, string | null>; loses?: Record<string, string | null>; goals?: Record<string, Record<string, number | null>> };
  clean_sheet?: Record<string, number | null>; failed_to_score?: Record<string, number | null>;
  penalty?: { scored?: { total?: number | null }; missed?: { total?: number | null }; total?: number | null };
  lineups?: { formation?: string | null; played?: number | null }[];
  cards?: Record<string, Record<string, { total?: number | null }>>;
}
export interface TeamSeasonDetailRow {
  team_id: number; league_id: number; season: number; form: string | null;
  fixtures: Record<string, Split> | null; goals: Record<'for' | 'against', { total: Split; average: Record<string, number | null>; minute: Minutes; under_over: Record<string, { over: number | null; under: number | null }> }> | null;
  biggest: { streak: Record<string, number | null>; wins: Record<string, string | null>; loses: Record<string, string | null>; goals: Record<string, Record<string, number | null>> } | null;
  clean_sheet: Split | null; failed_to_score: Split | null; penalty: { scored: number | null; missed: number | null; total: number | null } | null;
  lineups: { formation: string; played: number }[]; cards: Record<string, Minutes> | null; updated_at: string;
}
export interface VenueRow { id: number; name: string; address: string | null; city: string | null; country: string | null; capacity: number | null; surface: string | null; image: string | null; updated_at: string }
export interface SidelinedRow { player_id: number; start: string; type: string; end: string | null; updated_at: string }

const split = (o: { home?: unknown; away?: unknown; total?: unknown } | null | undefined): Split | null =>
  o ? { home: int(o.home), away: int(o.away), total: int(o.total) } : null;
const minutes = (o: Record<string, { total?: number | null }> | null | undefined): Minutes => {
  const out: Minutes = {};
  for (const [k, v] of Object.entries(o ?? {})) out[k] = int(v?.total);
  return out;
};
const mapValues = <A, B>(o: Record<string, A> | null | undefined, f: (a: A) => B): Record<string, B> => Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [k, f(v)]));

/**
 * teams/statistics: one club's season in one competition. Null when the provider has nothing for it (an empty
 * answer, or a club that played no match).
 */
export function parseTeamStatistics(r: AfTeamStatistics | null | undefined, team: number, league: number, season: number, at = new Date().toISOString()): TeamSeasonDetailRow | null {
  if (!r || Array.isArray(r) || !r.fixtures) return null;
  const played = int(r.fixtures.played?.total);
  if (!played) return null;
  const goals = r.goals ? Object.fromEntries((['for', 'against'] as const).map((side) => {
    const g = r.goals![side] ?? {};
    return [side, { total: split(g.total as never) ?? { home: null, away: null, total: null }, average: mapValues(g.average, (v) => num(v)), minute: minutes(g.minute), under_over: mapValues(g.under_over, (v) => ({ over: int(v?.over), under: int(v?.under) })) }];
  })) as TeamSeasonDetailRow['goals'] : null;
  const b = r.biggest;
  return {
    team_id: team, league_id: league, season, form: str(r.form),
    fixtures: mapValues(r.fixtures, (v) => split(v)!),
    goals,
    biggest: b ? { streak: mapValues(b.streak, (v) => int(v)), wins: mapValues(b.wins, (v) => str(v)), loses: mapValues(b.loses, (v) => str(v)), goals: mapValues(b.goals, (side) => mapValues(side, (v) => int(v))) } : null,
    clean_sheet: split(r.clean_sheet), failed_to_score: split(r.failed_to_score),
    penalty: r.penalty ? { scored: int(r.penalty.scored?.total), missed: int(r.penalty.missed?.total), total: int(r.penalty.total) } : null,
    lineups: (r.lineups ?? []).filter((l) => str(l.formation) && int(l.played)).map((l) => ({ formation: str(l.formation)!, played: int(l.played)! })),
    cards: r.cards ? mapValues(r.cards, (m) => minutes(m)) : null,
    updated_at: at,
  };
}

export function parseVenue(v: AfVenue | null | undefined, at = new Date().toISOString()): VenueRow | null {
  const id = realId(v?.id); const name = str(v?.name);
  if (id == null || !name) return null;
  return { id, name, address: str(v!.address), city: str(v!.city), country: str(v!.country), capacity: int(v!.capacity) || null, surface: str(v!.surface), image: str(v!.image), updated_at: at };
}

/** venues?country= and the grounds teams?country= carries: one row per ground. */
export function parseVenues(items: AfVenue[], at = new Date().toISOString()): VenueRow[] {
  const out = new Map<number, VenueRow>();
  for (const v of items) { const row = parseVenue(v, at); if (row) out.set(row.id, row); }
  return [...out.values()];
}

/**
 * A several-id answer (sidelined?players=a-b-c, trophies?players= / coachs=) split by person. Each entry must name one
 * of the requested people and carry its list under `listKey`; anything else (a flat list nobody can be told apart in)
 * gives null, and the caller goes back to one request per person. Requested people with no entry have nothing.
 */
export function splitByPerson(items: unknown[], ids: number[], listKey: string): Map<number, unknown[]> | null {
  const want = new Set(ids);
  const out = new Map<number, unknown[]>(ids.map((id) => [id, []]));
  for (const it of items as Record<string, any>[]) {
    const id = realId(it?.id) ?? realId(it?.player?.id) ?? realId(it?.coach?.id) ?? realId(it?.player) ?? realId(it?.coach);
    const list = it?.[listKey];
    if (id == null || !want.has(id) || !Array.isArray(list)) return null;
    out.get(id)!.push(...list);
  }
  return out;
}

/** sidelined?player=: every spell out (injury, illness, suspension), with its dates. */
export function parseSidelined(items: { type?: string | null; start?: string | null; end?: string | null }[], player: number, at = new Date().toISOString()): SidelinedRow[] {
  const out = new Map<string, SidelinedRow>();
  for (const i of items) {
    const start = isoDate(i.start); const type = str(i.type);
    if (!start || !type) continue;
    out.set(`${start}|${type}`, { player_id: player, start, type, end: isoDate(i.end), updated_at: at });
  }
  return [...out.values()];
}
