// What "healthy" means for the one Render service that runs the API, both worker lanes and the scheduler.
// Render restarts the service when /health fails, so the thresholds leave room for a slow query or a long
// heartbeat write and only fail on something a restart would fix: a dead lane or a database gone for minutes.
import type { WorkerHeartbeat } from '../jobs/runner.js';

export interface HealthInput {
  now: number;
  startedAt: number;
  dbOk: boolean;
  /** When the database last answered (ms); null before the first success. */
  dbLastOkAt: number | null;
  heartbeats: Record<string, WorkerHeartbeat | null>;
  lanes: string[];
}
export interface Health { ok: boolean; problems: string[]; lanes: Record<string, { alive: boolean; age_s: number | null; job: string | null }>; db: { ok: boolean } }

export const LANE_STALE_MS = 90_000;
export const DB_DOWN_MS = 120_000;
export const BOOT_GRACE_MS = 120_000;

export function evaluateHealth(i: HealthInput): Health {
  const problems: string[] = [];
  const booting = i.now - i.startedAt < BOOT_GRACE_MS;
  const lanes: Health['lanes'] = {};
  for (const lane of i.lanes) {
    const hb = i.heartbeats[lane];
    const age = hb ? i.now - Date.parse(hb.at) : null;
    const alive = age != null && age < LANE_STALE_MS;
    lanes[lane] = { alive, age_s: age == null ? null : Math.round(age / 1000), job: hb?.job ?? null };
    if (!alive && !booting) problems.push(`${lane} worker heartbeat ${age == null ? 'missing' : `${Math.round(age / 1000)}s old`}`);
  }
  if (!i.dbOk && (i.dbLastOkAt == null ? !booting : i.now - i.dbLastOkAt > DB_DOWN_MS)) problems.push('database unreachable');
  return { ok: problems.length === 0, problems, lanes, db: { ok: i.dbOk } };
}
