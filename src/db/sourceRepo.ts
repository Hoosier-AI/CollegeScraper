// Writes for the source tables (migration 138): another source's own records keyed by its ids, the advanced stats,
// the id map onto API-Football and the checks against it.
import { selectAll, upsertChunked, type Db } from './client.js';
import type { AdvPlayerSeasonRow, AdvTeamSeasonRow, ShotRow, SrcGameRow, SrcOfficialRow, SrcPlayerRow, SrcTeamRow, SrcVenueRow } from '../sources/asa/parse.js';
import type { CheckRow } from '../jobs/sources/checks.js';

type Rows = Record<string, unknown>[];
const rows = <T>(r: T[]) => r as unknown as Rows;

export const upsertSrcGames = (db: Db, r: SrcGameRow[]) => (r.length ? upsertChunked(db, 'pro_src_games', rows(r), { onConflict: 'source,ext_id' }) : Promise.resolve(0));
export const upsertSrcTeams = (db: Db, r: SrcTeamRow[]) => (r.length ? upsertChunked(db, 'pro_src_teams', rows(r), { onConflict: 'source,ext_id' }) : Promise.resolve(0));
export const upsertSrcPlayers = (db: Db, r: SrcPlayerRow[]) => (r.length ? upsertChunked(db, 'pro_src_players', rows(r), { onConflict: 'source,ext_id' }) : Promise.resolve(0));
export const upsertSrcVenues = (db: Db, r: SrcVenueRow[]) => (r.length ? upsertChunked(db, 'pro_src_venues', rows(r), { onConflict: 'source,ext_id' }) : Promise.resolve(0));
export const upsertSrcOfficials = (db: Db, r: SrcOfficialRow[]) => (r.length ? upsertChunked(db, 'pro_src_officials', rows(r), { onConflict: 'source,role,ext_id' }) : Promise.resolve(0));
export const upsertAdvPlayerSeasons = (db: Db, r: AdvPlayerSeasonRow[]) => (r.length ? upsertChunked(db, 'pro_adv_player_seasons', rows(r), { onConflict: 'source,league_id,season,player_ext,team_ext' }) : Promise.resolve(0));
export const upsertAdvTeamSeasons = (db: Db, r: AdvTeamSeasonRow[]) => (r.length ? upsertChunked(db, 'pro_adv_team_seasons', rows(r), { onConflict: 'source,league_id,season,team_ext' }) : Promise.resolve(0));

/** A game's shots are replaced whole, and the game is stamped as read. */
export async function replaceShots(db: Db, source: string, game: string, r: ShotRow[]): Promise<number> {
  const { error } = await db.from('pro_adv_shots').delete().eq('source', source).eq('game_ext', game);
  if (error) throw new Error(`clear shots ${game}: ${error.message}`);
  if (r.length) await upsertChunked(db, 'pro_adv_shots', rows(r), { onConflict: 'source,game_ext,seq' });
  const { error: e2 } = await db.from('pro_src_games').update({ shots_at: new Date().toISOString() }).eq('source', source).eq('ext_id', game);
  if (e2) throw new Error(`stamp shots ${game}: ${e2.message}`);
  return r.length;
}

export async function patchSourceSeason(db: Db, source: string, league: number, season: number, patch: Record<string, unknown>): Promise<void> {
  const { error } = await db.from('pro_source_seasons').upsert({ source, league_id: league, season, ...patch }, { onConflict: 'source,league_id,season' });
  if (error) throw new Error(`source season ${source} ${league}/${season}: ${error.message}`);
}

export interface SourceIdRow { source: string; kind: 'team' | 'player' | 'game'; ext_id: string; pro_id: number | null; method: string; confidence: number; evidence?: Record<string, unknown> | null; updated_at?: string }

/** Rows set by hand (verified or rejected) are never overwritten. */
export async function writeSourceIds(db: Db, source: string, kind: SourceIdRow['kind'], r: SourceIdRow[]): Promise<number> {
  if (!r.length) return 0;
  const locked = new Set((await selectAll<{ ext_id: string }>(db, 'pro_source_ids', 'ext_id', (q) => q.eq('source', source).eq('kind', kind).or('verified.eq.true,rejected.eq.true'))).map((x) => x.ext_id));
  const at = new Date().toISOString();
  const free = r.filter((x) => !locked.has(x.ext_id)).map((x) => ({ ...x, evidence: x.evidence ?? null, updated_at: at }));
  return free.length ? upsertChunked(db, 'pro_source_ids', rows(free), { onConflict: 'source,kind,ext_id' }) : 0;
}

/** ext id -> API-Football id for a source and kind (only matched, not rejected). */
export async function sourceIdMap(db: Db, source: string, kind: SourceIdRow['kind']): Promise<Map<string, number>> {
  const all = await selectAll<{ ext_id: string; pro_id: number | null; rejected: boolean }>(db, 'pro_source_ids', 'ext_id,pro_id,rejected', (q) => q.eq('source', source).eq('kind', kind).not('pro_id', 'is', null));
  return new Map(all.filter((x) => !x.rejected && x.pro_id != null).map((x) => [x.ext_id, Number(x.pro_id)]));
}

/** A league season's checks are replaced whole (rows that no longer apply must not linger). */
export async function replaceChecks(db: Db, source: string, league: number, season: number, r: CheckRow[]): Promise<number> {
  const { error } = await db.from('pro_source_checks').delete().eq('source', source).eq('league_id', league).eq('season', season);
  if (error) throw new Error(`clear checks: ${error.message}`);
  return r.length ? upsertChunked(db, 'pro_source_checks', rows(r), { onConflict: 'source,league_id,season,kind,key,field' }) : 0;
}
