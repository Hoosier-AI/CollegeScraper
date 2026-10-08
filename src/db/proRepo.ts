// Writes for the pro_* tables (migration 134). Upserts are keyed by the provider's ids, so re-running any step is safe.
import { selectAll, upsertChunked, type Db } from './client.js';
import type { FixtureDetail, FixtureRow, LeagueRow, PlayerProfileRow, PlayerStubRow, SeasonRow, StandingRow, TeamProfileRow, TeamRow } from '../sources/apiFootball/parse.js';
import type { Gender } from '../sources/apiFootball/leagues.js';

export interface LeagueInfo { id: number; gender: Gender; enabled: boolean; priority: number; type: 'league' | 'cup'; current_season: number | null }

/** Every league the catalog knows, by id. */
export async function leagueIndex(db: Db): Promise<Map<number, LeagueInfo>> {
  const rows = await selectAll<LeagueInfo>(db, 'pro_leagues', 'id,gender,enabled,priority,type,current_season');
  return new Map(rows.map((r) => [r.id, r]));
}

/** Catalog upsert. A league whose `enabled` was set by hand (enabled_locked) keeps it. */
export async function upsertLeagues(db: Db, leagues: LeagueRow[]): Promise<number> {
  const locked = new Set((await selectAll<{ id: number }>(db, 'pro_leagues', 'id', (q) => q.eq('enabled_locked', true))).map((r) => r.id));
  const free = leagues.filter((l) => !locked.has(l.id));
  const kept = leagues.filter((l) => locked.has(l.id)).map(({ enabled: _e, ...rest }) => rest);
  let n = 0;
  if (free.length) n += await upsertChunked(db, 'pro_leagues', free as unknown as Record<string, unknown>[], { onConflict: 'id' });
  if (kept.length) n += await upsertChunked(db, 'pro_leagues', kept as unknown as Record<string, unknown>[], { onConflict: 'id' });
  return n;
}

export async function upsertSeasons(db: Db, seasons: SeasonRow[]): Promise<number> {
  return upsertChunked(db, 'pro_seasons', seasons as unknown as Record<string, unknown>[], { onConflict: 'league_id,season' });
}

/** Name and crest from a fixture list; never touches the profile columns /teams fills in. */
export async function upsertTeamStubs(db: Db, teams: TeamRow[]): Promise<number> {
  if (!teams.length) return 0;
  return upsertChunked(db, 'pro_teams', teams as unknown as Record<string, unknown>[], { onConflict: 'id' });
}

export async function upsertTeamProfiles(db: Db, teams: TeamProfileRow[]): Promise<number> {
  if (!teams.length) return 0;
  return upsertChunked(db, 'pro_teams', teams as unknown as Record<string, unknown>[], { onConflict: 'id' });
}

export async function upsertFixtures(db: Db, fixtures: FixtureRow[]): Promise<number> {
  if (!fixtures.length) return 0;
  return upsertChunked(db, 'pro_fixtures', fixtures as unknown as Record<string, unknown>[], { onConflict: 'id', chunk: 250 });
}

/** A first sighting creates the player; an existing row (maybe with a full profile) is left alone. */
export async function insertPlayerStubs(db: Db, players: PlayerStubRow[]): Promise<number> {
  if (!players.length) return 0;
  return upsertChunked(db, 'pro_players', players as unknown as Record<string, unknown>[], { onConflict: 'id', ignoreDuplicates: true });
}

export async function upsertPlayerProfiles(db: Db, players: PlayerProfileRow[]): Promise<number> {
  if (!players.length) return 0;
  return upsertChunked(db, 'pro_players', players as unknown as Record<string, unknown>[], { onConflict: 'id' });
}

/**
 * Replace a batch of fixtures' detail (events, lineups, player lines, team stats) and stamp detail_fetched_at.
 * Players are created first: the season totals only count lines whose player row exists.
 */
export async function writeFixtureDetails(db: Db, details: { fixtureId: number; detail: FixtureDetail }[], at: string | null = new Date().toISOString()): Promise<void> {
  if (!details.length) return;
  const ids = details.map((d) => d.fixtureId);
  const all = <K extends keyof FixtureDetail>(k: K): FixtureDetail[K] => details.flatMap((d) => d.detail[k] as unknown[]) as FixtureDetail[K];
  await insertPlayerStubs(db, dedupeById(all('playerStubs')));
  for (const table of ['pro_fixture_events', 'pro_fixture_lineups', 'pro_fixture_players', 'pro_fixture_team_stats']) {
    const { error } = await db.from(table).delete().in('fixture_id', ids);
    if (error) throw new Error(`clear ${table}: ${error.message}`);
  }
  await upsertChunked(db, 'pro_fixture_events', all('events') as unknown as Record<string, unknown>[], { onConflict: 'fixture_id,seq' });
  await upsertChunked(db, 'pro_fixture_lineups', all('lineups') as unknown as Record<string, unknown>[], { onConflict: 'fixture_id,team_id' });
  await upsertChunked(db, 'pro_fixture_players', all('players') as unknown as Record<string, unknown>[], { onConflict: 'fixture_id,team_id,slot' });
  await upsertChunked(db, 'pro_fixture_team_stats', all('teamStats') as unknown as Record<string, unknown>[], { onConflict: 'fixture_id,team_id' });
  // at = null: provisional (read at full time); the detail job reads it again once ratings have settled.
  if (at == null) return;
  const { error } = await db.from('pro_fixtures').update({ detail_fetched_at: at }).in('id', ids);
  if (error) throw new Error(`stamp detail: ${error.message}`);
}

/** A detail fetch that came back empty: count the attempt; after `giveUpAfter` attempts there is nothing to wait for. */
export async function noteEmptyDetail(db: Db, fixtureIds: number[], giveUpAfter = 4, at = new Date().toISOString()): Promise<void> {
  if (!fixtureIds.length) return;
  const rows = await selectAll<{ id: number; detail_attempts: number }>(db, 'pro_fixtures', 'id,detail_attempts', (q) => q.in('id', fixtureIds));
  for (const r of rows) {
    const attempts = (r.detail_attempts ?? 0) + 1;
    const patch: Record<string, unknown> = { detail_attempts: attempts };
    if (attempts >= giveUpAfter) patch.detail_fetched_at = at;
    const { error } = await db.from('pro_fixtures').update(patch).eq('id', r.id);
    if (error) throw new Error(`note empty detail: ${error.message}`);
  }
}

/** Mark finals done without a request: the competition's coverage says the provider has no detail for it. */
export async function markNoDetail(db: Db, leagueId: number, season: number, at = new Date().toISOString()): Promise<number> {
  const { data, error } = await db.from('pro_fixtures').update({ detail_fetched_at: at }).eq('league_id', leagueId).eq('season', season).eq('status', 'final').is('detail_fetched_at', null).select('id');
  if (error) throw new Error(`mark no detail: ${error.message}`);
  return data?.length ?? 0;
}

export async function upsertStandings(db: Db, rows: StandingRow[], at = new Date().toISOString()): Promise<number> {
  if (!rows.length) return 0;
  // A table is replaced whole: a team relegated mid-season or moved between groups must not linger.
  const pairs = [...new Set(rows.map((r) => `${r.league_id}|${r.season}`))];
  for (const p of pairs) {
    const [league, season] = p.split('|').map(Number);
    const { error } = await db.from('pro_standings').delete().eq('league_id', league!).eq('season', season!);
    if (error) throw new Error(`clear standings: ${error.message}`);
  }
  return upsertChunked(db, 'pro_standings', rows.map((r) => ({ ...r, updated_at: at })), { onConflict: 'league_id,season,group_name,team_id' });
}

export async function patchSeason(db: Db, leagueId: number, season: number, patch: Record<string, unknown>): Promise<void> {
  const { error } = await db.from('pro_seasons').upsert({ league_id: leagueId, season, ...patch }, { onConflict: 'league_id,season' });
  if (error) throw new Error(`patch season ${leagueId}/${season}: ${error.message}`);
}

export async function refreshAggregates(db: Db, leagueId: number, season: number): Promise<void> {
  const { error } = await db.rpc('pro_refresh_season_aggregates', { p_league: leagueId, p_season: season });
  if (error) throw new Error(`aggregates ${leagueId}/${season}: ${error.message}`);
}

function dedupeById<T extends { id: number }>(rows: T[]): T[] {
  const m = new Map<number, T>();
  for (const r of rows) if (!m.has(r.id)) m.set(r.id, r);
  return [...m.values()];
}
