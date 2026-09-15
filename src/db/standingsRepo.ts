import type { Db } from './client.js';
import { upsertChunked, selectAll } from './client.js';

export interface ConferenceRow { id: string; ncaa_seo: string; name: string; division: string | null; site_host: string | null; standings_path_m: string | null; standings_path_w: string | null; points_rule: string; short_name: string | null }

export async function listConferences(db: Db): Promise<ConferenceRow[]> {
  return selectAll<ConferenceRow>(db, 'college_conferences', '*');
}

export async function updateConference(db: Db, id: string, patch: Partial<ConferenceRow>): Promise<void> {
  const { error } = await db.from('college_conferences').update(patch).eq('id', id);
  if (error) throw new Error(`update conference: ${error.message}`);
}

export interface StandingRow {
  season: number; program_id: string; division: string | null; conference_id: string | null;
  conf_w: number | null; conf_l: number | null; conf_t: number | null; conf_pts: number | null;
  overall_w: number | null; overall_l: number | null; overall_t: number | null; rank: number | null;
  source: 'conference' | 'computed'; source_url: string | null; pod: string | null;
  conf_pct: number | null; overall_pct: number | null; conf_gf: number | null; conf_ga: number | null; gf: number | null; ga: number | null;
  streak: string | null; home_record: string | null; away_record: string | null; fetched_at: string; updated_at: string;
}

export async function writeStandings(db: Db, rows: StandingRow[]): Promise<number> {
  return upsertChunked(db, 'college_standings', rows as unknown as Record<string, unknown>[], { onConflict: 'season,program_id' });
}

export interface StandingsCheck { season: number; program_id: string; field: string; official: string | null; computed: string | null; checked_at: string }

/** Replace the check rows for these programs: mismatches are written, matches are deleted. */
export async function writeStandingsChecks(db: Db, season: number, programIds: string[], mismatches: StandingsCheck[]): Promise<void> {
  for (let i = 0; i < programIds.length; i += 100) {
    const { error } = await db.from('college_standings_checks').delete().eq('season', season).in('program_id', programIds.slice(i, i + 100));
    if (error) throw new Error(`clear standings checks: ${error.message}`);
  }
  if (mismatches.length) await upsertChunked(db, 'college_standings_checks', mismatches as unknown as Record<string, unknown>[], { onConflict: 'season,program_id,field' });
}

export function confPoints(rule: string | null | undefined, w: number | null, l: number | null, t: number | null): number | null {
  if (w == null) return null;
  switch (rule) {
    case 'wl-2-1-0': return 2 * w + (t ?? 0);
    case 'pct': { const g = w + (l ?? 0) + (t ?? 0); return g ? Math.round(1000 * (w + 0.5 * (t ?? 0)) / g) / 1000 : null; }
    default: return 3 * w + (t ?? 0);
  }
}
