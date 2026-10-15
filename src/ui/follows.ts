// GET /api/follows: what the home page's "Following" panel shows for the teams and players a visitor follows (the
// list lives in their browser, ui/src/lib/follows.ts): each team's last result and next match, each player's latest
// match line. College, Pro and International in one call; at most 40 follows, a few small reads each kind.
import { selectIn, type Db } from '../db/client.js';

export type FollowKind = 'team' | 'player' | 'pro-team' | 'pro-player';
export interface FollowRef { kind: FollowKind; id: string }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "team:<uuid>,pro-player:154,..." into valid refs (unknown kinds and malformed ids dropped, at most 40). */
export function parseFollows(raw: unknown): FollowRef[] {
  const out: FollowRef[] = [];
  for (const part of String(raw ?? '').split(',').slice(0, 40)) {
    const i = part.lastIndexOf(':'); if (i < 0) continue;
    const kind = part.slice(0, i) as FollowKind, id = part.slice(i + 1).trim();
    if ((kind === 'team' || kind === 'player') && UUID.test(id)) out.push({ kind, id });
    else if ((kind === 'pro-team' || kind === 'pro-player') && /^-?\d{1,10}$/.test(id)) out.push({ kind, id });
  }
  return out;
}

interface Game { id: string; slug: string | null; date: string; status: string; home: boolean; opponent: string | null; us: number | null; them: number | null; to: string }
interface Line { game: Game; minutes: number | null; goals: number; assists: number; saves: number | null; started: boolean | null; rating?: number | null }
export interface FollowItem { kind: FollowKind; id: string; last: Game | null; next: Game | null; line: Line | null }

const today = () => new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10);

function collegeGame(g: any, programId: string, names: Map<string, string>): Game {
  const home = g.home_program_id === programId;
  const opp = home ? g.away_program_id : g.home_program_id;
  return { id: g.id, slug: g.slug, date: g.game_date, status: g.status, home, opponent: (opp && names.get(opp)) ?? (home ? g.away_name : g.home_name),
    us: home ? g.home_score : g.away_score, them: home ? g.away_score : g.home_score, to: `/matches/${g.slug ?? g.id}` };
}
function proGame(f: any, teamId: number, names: Map<number, string>): Game {
  const home = Number(f.home_team_id) === teamId;
  return { id: String(f.id), slug: f.slug, date: String(f.kickoff).slice(0, 10), status: f.status, home, opponent: names.get(Number(home ? f.away_team_id : f.home_team_id)) ?? null,
    us: home ? f.home_goals : f.away_goals, them: home ? f.away_goals : f.home_goals, to: `/pro/matches/${f.slug}` };
}

/** Names of the programs in these games (a game row names only an opponent we do not hold). */
async function programNames(db: Db, games: any[]): Promise<Map<string, string>> {
  const ids = [...new Set(games.flatMap((g) => [g.home_program_id, g.away_program_id]).filter(Boolean))] as string[];
  return new Map((ids.length ? await selectIn<any>(db, 'college_programs', 'id,name', 'id', ids) : []).map((p) => [p.id, p.name]));
}

async function collegeTeams(db: Db, ids: string[]): Promise<FollowItem[]> {
  if (!ids.length) return [];
  const from = new Date(Date.now() - 120 * 86400_000).toISOString().slice(0, 10), to = new Date(Date.now() + 120 * 86400_000).toISOString().slice(0, 10);
  const cols = 'id,slug,game_date,status,home_program_id,away_program_id,home_name,away_name,home_score,away_score';
  const [h, a] = await Promise.all([
    selectIn<any>(db, 'college_games', cols, 'home_program_id', ids, (q) => q.gte('game_date', from).lte('game_date', to)),
    selectIn<any>(db, 'college_games', cols, 'away_program_id', ids, (q) => q.gte('game_date', from).lte('game_date', to)),
  ]);
  const t = today(), names = await programNames(db, [...h, ...a]);
  return ids.map((id) => {
    const games = [...h, ...a].filter((g) => g.home_program_id === id || g.away_program_id === id).sort((x, y) => String(x.game_date).localeCompare(String(y.game_date)));
    const last = [...games].reverse().find((g) => g.status === 'final');
    const next = games.find((g) => g.status !== 'final' && g.status !== 'cancelled' && g.status !== 'postponed' && g.game_date >= t);
    return { kind: 'team', id, last: last ? collegeGame(last, id, names) : null, next: next ? collegeGame(next, id, names) : null, line: null };
  });
}

async function collegePlayers(db: Db, ids: string[]): Promise<FollowItem[]> {
  if (!ids.length) return [];
  const seasons = await selectIn<any>(db, 'college_player_seasons', 'id,player_id,season', 'player_id', ids);
  const latest = new Map<string, any>();
  for (const s of seasons) if (!latest.has(s.player_id) || s.season > latest.get(s.player_id).season) latest.set(s.player_id, s);
  const psIds = [...latest.values()].map((s) => s.id);
  const lines = psIds.length ? await selectIn<any>(db, 'college_game_player_stats', 'game_id,program_id,source,player_season_id,starter,participated,minutes,goals,assists,saves', 'player_season_id', psIds) : [];
  const games = new Map((lines.length ? await selectIn<any>(db, 'college_games', 'id,slug,game_date,status,home_program_id,away_program_id,home_name,away_name,home_score,away_score,source_of_truth', 'id', [...new Set(lines.map((l) => l.game_id))], (q) => q.eq('status', 'final')) : []).map((g) => [g.id, g]));
  const names = await programNames(db, [...games.values()]);
  return ids.map((id) => {
    const ps = latest.get(id);
    // The game's own source of truth, else whichever source has the line; newest game first.
    const mine = lines.filter((l) => ps && l.player_season_id === ps.id && games.has(l.game_id) && l.participated !== false)
      .sort((x, y) => String(games.get(y.game_id).game_date).localeCompare(String(games.get(x.game_id).game_date)) || Number(y.source === games.get(y.game_id).source_of_truth) - Number(x.source === games.get(x.game_id).source_of_truth));
    const l = mine[0];
    if (!l) return { kind: 'player', id, last: null, next: null, line: null };
    const g = games.get(l.game_id);
    return { kind: 'player', id, last: null, next: null, line: { game: collegeGame(g, l.program_id, names), minutes: l.minutes, goals: l.goals ?? 0, assists: l.assists ?? 0, saves: l.saves, started: l.starter } };
  });
}

async function teamNames(db: Db, ids: number[]): Promise<Map<number, string>> {
  return new Map((ids.length ? await selectIn<any>(db, 'pro_teams', 'id,name', 'id', [...new Set(ids)]) : []).map((t) => [Number(t.id), t.name]));
}

async function proTeams(db: Db, ids: number[]): Promise<FollowItem[]> {
  if (!ids.length) return [];
  const from = new Date(Date.now() - 120 * 86400_000).toISOString(), to = new Date(Date.now() + 120 * 86400_000).toISOString();
  const cols = 'id,slug,kickoff,status,home_team_id,away_team_id,home_goals,away_goals';
  const [h, a] = await Promise.all([
    selectIn<any>(db, 'pro_fixtures', cols, 'home_team_id', ids, (q) => q.gte('kickoff', from).lte('kickoff', to)),
    selectIn<any>(db, 'pro_fixtures', cols, 'away_team_id', ids, (q) => q.gte('kickoff', from).lte('kickoff', to)),
  ]);
  const all = [...h, ...a];
  const names = await teamNames(db, all.flatMap((f) => [Number(f.home_team_id), Number(f.away_team_id)]));
  const now = new Date().toISOString();
  return ids.map((id) => {
    const fx = all.filter((f) => Number(f.home_team_id) === id || Number(f.away_team_id) === id).sort((x, y) => String(x.kickoff).localeCompare(String(y.kickoff)));
    const last = [...fx].reverse().find((f) => f.status === 'final');
    const next = fx.find((f) => f.status === 'scheduled' && f.kickoff >= now) ?? fx.find((f) => f.status === 'live');
    return { kind: 'pro-team', id: String(id), last: last ? proGame(last, id, names) : null, next: next ? proGame(next, id, names) : null, line: null };
  });
}

async function proPlayers(db: Db, ids: number[]): Promise<FollowItem[]> {
  if (!ids.length) return [];
  // Each player's lines of the last 120 days; the newest final is the one shown.
  const lines = await selectIn<any>(db, 'pro_fixture_players', 'fixture_id,team_id,player_id,starter,minutes,rating,goals,assists,saves', 'player_id', ids, (q) => q.gt('minutes', 0));
  const fixtures = new Map((lines.length ? await selectIn<any>(db, 'pro_fixtures', 'id,slug,kickoff,status,home_team_id,away_team_id,home_goals,away_goals', 'id', [...new Set(lines.map((l) => l.fixture_id))], (q) => q.eq('status', 'final').gte('kickoff', new Date(Date.now() - 120 * 86400_000).toISOString())) : []).map((f) => [f.id, f]));
  const names = await teamNames(db, [...fixtures.values()].flatMap((f) => [Number(f.home_team_id), Number(f.away_team_id)]));
  return ids.map((id) => {
    const l = lines.filter((x) => Number(x.player_id) === id && fixtures.has(x.fixture_id)).sort((x, y) => String(fixtures.get(y.fixture_id).kickoff).localeCompare(String(fixtures.get(x.fixture_id).kickoff)))[0];
    if (!l) return { kind: 'pro-player', id: String(id), last: null, next: null, line: null };
    return { kind: 'pro-player', id: String(id), last: null, next: null, line: { game: proGame(fixtures.get(l.fixture_id), Number(l.team_id), names), minutes: l.minutes, goals: l.goals ?? 0, assists: l.assists ?? 0, saves: l.saves, started: l.starter, rating: l.rating == null ? null : Number(l.rating) } };
  });
}

export async function follows(db: Db, refs: FollowRef[]): Promise<FollowItem[]> {
  const of = (k: FollowKind) => refs.filter((r) => r.kind === k).map((r) => r.id);
  const parts = await Promise.all([collegeTeams(db, of('team')), collegePlayers(db, of('player')), proTeams(db, of('pro-team').map(Number)), proPlayers(db, of('pro-player').map(Number))]);
  return parts.flat();
}
