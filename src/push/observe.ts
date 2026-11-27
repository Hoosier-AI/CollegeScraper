// App alerts, step 1: a crawl job tells us what it just stored for a match, and the change from the last state we
// saw becomes alerts (kick-off, goal, half-time for pro, full time) in push_events. The state and the alerts live
// in the database (migrations 213/214) so two server instances seeing the same change make one alert.
//
// diffMatch() below is the reference for the rules. push_observe_many() in migration 214 applies the same rules
// under a row lock and is what actually runs; the two MUST agree (tests/push/observe.test.ts is the matrix; the
// rules are listed in words at the top of the migration). Change both or neither.
//
// observeMatches() never throws: a crawl job must not fail, or even slow down much, because alerts could not be
// worked out. Failures are logged (not every minute) and counted.
import type { Db } from '../db/client.js';
import { enqueue } from '../jobs/runner.js';
import { log } from '../log.js';

export type PushEventType = 'kickoff' | 'goal' | 'halftime' | 'final';
/** A follow target: the same kinds and ids the site's follows use (src/ui/follows.ts). */
export interface FollowTarget { kind: string; ref: string; name?: string }
export interface MatchSnapshot {
  /** 'c:<college game uuid>' or 'p:<pro fixture id>'. */
  key: string;
  /** As stored by the job. 'live' and 'final' mean that; everything else counts as scheduled. */
  status: string;
  home: number | null;
  away: number | null;
  /** Pro: the provider's short status ('1H', 'HT', '2H', ...). College: NCAA's period text. */
  period?: string | null;
  /** ISO time. */
  kickoff?: string | null;
  /** Minutes played, when the source says (pro). Used for the first-sight rule before kickoff time. */
  elapsed?: number | null;
  /** What the job's own row said before this write: the state to compare with when we hold none yet. */
  prev?: { status: string; home: number | null; away: number | null } | null;
  teams: { home: FollowTarget & { name: string }; away: FollowTarget & { name: string } };
  league?: (FollowTarget & { name: string }) | null;
  /** More follow targets this match belongs to (college: the away side's conference when it is another one). */
  refs?: FollowTarget[];
  /** The match page: '/matches/<id>', '/pro/matches/<slug>' or '/intl/matches/<slug>'. */
  to: string;
  /** Pro goals: the newest goal on file, only when the goals on file add up to the score. */
  scorer?: { name: string | null; player_id: number | null; team_id: number | null; minute: number | null; own_goal: boolean } | null;
}
export interface MatchState { status: 'scheduled' | 'live' | 'final'; home: number | null; away: number | null; gen: number; period: string | null }
export interface DerivedEvent { type: PushEventType; dedupe_key: string; home: number; away: number; gen: number; corrected: boolean }
export interface PushEventRow { id: number; dedupe_key: string; match_key: string; type: PushEventType; payload: MatchSnapshot & { gen?: number; corrected?: boolean }; status: string; created_at: string }

const phaseOf = (status: string | null | undefined): MatchState['status'] => (status === 'live' || status === 'final' ? status : 'scheduled');
const isHalfTime = (period: string | null | undefined) => String(period ?? '').toUpperCase() === 'HT';
const FIRST_SIGHT_MAX_MIN = 5;
const FRESH_MS = 8 * 3600_000;

/**
 * The new state and the alerts that follow from `next`, given the state we held (`prev`, null when none). Pure.
 * See the rules in words in supabase/migrations/214_push_observe_and_claim.sql.
 */
export function diffMatch(prev: MatchState | null, next: MatchSnapshot, now: number): { state: MatchState; events: DerivedEvent[] } {
  const phase = phaseOf(next.status);
  const h = next.home ?? 0, a = next.away ?? 0;
  const period = next.period ?? null;
  const ko = next.kickoff ? Date.parse(next.kickoff) : NaN;
  const mins = next.elapsed != null ? next.elapsed : Number.isFinite(ko) ? (now - ko) / 60_000 : null;
  const fresh = !Number.isFinite(ko) || now - ko <= FRESH_MS;
  const base: MatchState | null = prev ?? (next.prev ? { status: phaseOf(next.prev.status), home: next.prev.home, away: next.prev.away, gen: 0, period: null } : null);
  let gen = base?.gen ?? 0;
  let corrected = false;
  const types: PushEventType[] = [];
  if (!base) {
    if (phase === 'live' && mins != null && mins <= FIRST_SIGHT_MAX_MIN) types.push('kickoff');
  } else {
    const was = phaseOf(base.status), ph = base.home ?? 0, pa = base.away ?? 0;
    if (phase === 'live') {
      if (was === 'scheduled') types.push('kickoff');
      else if (was === 'final') gen += 1;
      else if (h < ph || a < pa) gen += 1;
      else if (h > ph || a > pa) types.push('goal');
      if (next.key.startsWith('p:') && isHalfTime(period) && !(was === 'live' && isHalfTime(base.period))) types.push('halftime');
    } else if (phase === 'final') {
      if (was !== 'final') { if (fresh) types.push('final'); }
      else if (h !== ph || a !== pa) { gen += 1; corrected = true; if (fresh) types.push('final'); }
    }
  }
  const events = types.map((type): DerivedEvent => ({
    type, home: h, away: a, gen, corrected: corrected && type === 'final',
    dedupe_key: `${next.key}:${type}:${gen}${type === 'goal' ? `:${h}-${a}` : ''}`,
  }));
  return { state: { status: phase, home: next.home ?? null, away: next.away ?? null, gen, period }, events };
}

/** Counters since the process started (the console can read them; tests reset them). */
export const observeStats = { calls: 0, snapshots: 0, events: 0, failures: 0, skipped: 0 };
let lastWarnAt = 0;
let pausedUntil = 0;
/** After a failure nothing is sent for this long: before migration 214 is applied every call would fail. */
const PAUSE_AFTER_FAILURE_MS = 5 * 60_000;
const WARN_EVERY_MS = 10 * 60_000;
const CHUNK = 200;

/** Tests: forget the pause after a failure. */
export function resetObserve(): void { pausedUntil = 0; lastWarnAt = 0; observeStats.calls = observeStats.snapshots = observeStats.events = observeStats.failures = observeStats.skipped = 0; }

/** True for a few minutes after a failure: callers skip their own reads too. */
export function observePaused(): boolean { return Date.now() < pausedUntil; }

function failed(err: unknown, n: number): void {
  observeStats.failures += 1;
  pausedUntil = Date.now() + PAUSE_AFTER_FAILURE_MS;
  if (Date.now() - lastWarnAt > WARN_EVERY_MS) {
    lastWarnAt = Date.now();
    log.warn({ err: err instanceof Error ? err.message : String(err), snapshots: n, failures: observeStats.failures }, 'push observe failed (alerts for these changes are skipped)');
  }
}

/**
 * Record these snapshots and return the alerts the database created from them. NEVER throws and never rejects:
 * on any failure it logs, counts and returns []. A later observation of the same match still compares with the
 * last state that was stored, so a missed tick loses at most the alerts of that tick.
 */
export async function observeMatches(db: Db, snapshots: MatchSnapshot[]): Promise<PushEventRow[]> {
  try {
    const valid = snapshots.filter((s) => s && typeof s.key === 'string' && /^[cp]:[A-Za-z0-9-]{1,40}$/.test(s.key));
    if (!valid.length) return [];
    if (Date.now() < pausedUntil) { observeStats.skipped += valid.length; return []; }
    observeStats.calls += 1; observeStats.snapshots += valid.length;
    const out: PushEventRow[] = [];
    for (let i = 0; i < valid.length; i += CHUNK) {
      const { data, error } = await db.rpc('push_observe_many', { snapshots: valid.slice(i, i + CHUNK) });
      if (error) { failed(error.message, valid.length); return out; }
      out.push(...((data ?? []) as PushEventRow[]));
    }
    observeStats.events += out.length;
    return out;
  } catch (err) {
    failed(err, snapshots?.length ?? 0);
    return [];
  }
}

/**
 * observeMatches, then the sender is queued when alerts were created. The run is keyed by the newest alert so it is
 * queued even while an earlier send is running (enqueue() only skips an identical queued or running run). Never throws.
 */
export async function observeAndQueue(db: Db, snapshots: MatchSnapshot[]): Promise<number> {
  const events = await observeMatches(db, snapshots);
  if (!events.length) return 0;
  try {
    await enqueue(db, 'push-send', { upto: Math.max(...events.map((e) => Number(e.id) || 0)) });
  } catch (err) {
    // The scheduler's every-minute check picks waiting alerts up.
    log.warn({ err: err instanceof Error ? err.message : String(err) }, 'push-send could not be queued');
  }
  return events.length;
}
