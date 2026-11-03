// Pro finals to Plaibook (2026-11-02): when a US-scene match ends, and again when its detail settles (ratings and late
// events land a little after the whistle), Plaibook is told at once (`pro_games` on the same signed webhook as the
// college finals) and syncs the clubs linked to either team, instead of waiting for its 10-minute run. What does not
// go through waits in its own outbox (college_kv) and rides the next pro-live run; Plaibook's runs are the backstop.
import type { Db } from '../../db/client.js';
import { kvGet, kvSet, selectIn } from '../../db/client.js';
import { isUsScene } from '../../sources/apiFootball/leagues.js';
import type { LeagueInfo } from '../../db/proRepo.js';
import { postSigned } from '../finalDetail.js';

export interface ProNotice { fixture_id: number; home_team_id: number; away_team_id: number; league_id: number; final_at: string | null; settled: boolean }
interface Outbox { games: Array<ProNotice & { tries: number; first: string }> }

export const PRO_OUTBOX_KEY = 'plaibook:pro_final_outbox';
const OUTBOX_MAX_AGE_MS = 2 * 86400_000, OUTBOX_MAX_TRIES = 30, OUTBOX_MAX = 500;
/** Plaibook reads at most 40 per request. */
export const PER_POST = 40;

type FinalRow = { id: number; league_id: number; home_team_id: number; away_team_id: number; final_at: string | null; status: string; detail_fetched_at: string | null };
/** The finals Plaibook cares about: the US scene (its pro clubs are linked there). Settled = the detail's final pass
 *  ran (detail_fetched_at); the full-time copy is provisional. */
export function usFinals(rows: FinalRow[], leagues: Map<number, LeagueInfo>): ProNotice[] {
  return rows.filter((r) => r.status === 'final' && isUsScene(r.league_id, leagues.get(r.league_id)?.country))
    .map((r) => ({ fixture_id: r.id, home_team_id: r.home_team_id, away_team_id: r.away_team_id, league_id: r.league_id, final_at: r.final_at ?? null, settled: !!r.detail_fetched_at }));
}

/** The fixtures behind these ids as notices (status, final time and detail read back after they were written). */
export async function noticesFor(db: Db, ids: number[], leagues: Map<number, LeagueInfo>): Promise<ProNotice[]> {
  if (!ids.length) return [];
  const rows = await selectIn<FinalRow>(db, 'pro_fixtures', 'id,league_id,home_team_id,away_team_id,final_at,status,detail_fetched_at', 'id', ids);
  return usFinals(rows, leagues);
}

/** Send these notices with any still waiting; keep what could not be sent. 'skipped' when Plaibook is not configured
 *  or there is nothing to send. A refused request (4xx) is dropped: resending it would be refused too. */
export async function notifyPlaibookPro(fresh: ProNotice[], db: Db | null, env = process.env, doFetch: typeof fetch = fetch, sleep?: (ms: number) => Promise<void>): Promise<'sent' | 'skipped' | 'failed' | 'refused'> {
  if (!env.PLAIBOOK_FINAL_WEBHOOK_URL || !env.PLAIBOOK_FINAL_WEBHOOK_SECRET) return 'skipped';
  const box: Outbox = (db ? await kvGet<Outbox>(db, PRO_OUTBOX_KEY).catch(() => null) : null) ?? { games: [] };
  const now = Date.now();
  const key = (n: ProNotice) => `${n.fixture_id}:${n.settled}`;
  const freshKeys = new Set(fresh.map(key));
  const waiting = box.games.filter((g) => g.tries < OUTBOX_MAX_TRIES && now - Date.parse(g.first) < OUTBOX_MAX_AGE_MS && !freshKeys.has(key(g)));
  const all: ProNotice[] = [...fresh, ...waiting.map(({ tries: _t, first: _f, ...n }) => n)];
  if (!all.length) { if (db && box.games.length) await kvSet(db, PRO_OUTBOX_KEY, { games: [] }).catch(() => {}); return 'skipped'; }
  let out: 'sent' | 'failed' | 'refused' | 'skipped' = 'sent';
  const failed: ProNotice[] = [];
  for (let i = 0; i < all.length; i += PER_POST) {
    const part = all.slice(i, i + PER_POST);
    const r = await postSigned({ pro_games: part }, env, doFetch, sleep);
    if (r === 'failed') { failed.push(...part); out = 'failed'; } else if (r === 'refused' && out === 'sent') out = 'refused';
  }
  if (db) {
    const keep: Outbox['games'] = failed.map((n) => {
      const was = waiting.find((g) => key(g) === key(n));
      return was ? { ...was, tries: was.tries + 1 } : { ...n, tries: 1, first: new Date(now).toISOString() };
    }).slice(0, OUTBOX_MAX);
    if (keep.length || box.games.length) await kvSet(db, PRO_OUTBOX_KEY, { games: keep }).catch(() => {});
  }
  return out;
}
