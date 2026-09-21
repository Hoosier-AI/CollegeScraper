import { describe, it, expect } from 'vitest';
import { SCHEDULE, clockAt, nextFire } from '../../src/jobs/scheduler.js';
import { LIVE_DEFAULTS } from '../../src/ops/settings.js';

const entry = (job: string) => SCHEDULE.find((e) => e.job === job)!;
const at = (iso: string) => new Date(iso);

describe('schedule table', () => {
  it('hourly fires at :00 and :30 in season only', () => {
    expect(entry('hourly').due(clockAt(at('2026-09-21T15:30:00Z'), LIVE_DEFAULTS))).toBe(true);
    expect(entry('hourly').due(clockAt(at('2026-09-21T15:31:00Z'), LIVE_DEFAULTS))).toBe(false);
    expect(entry('hourly').due(clockAt(at('2026-03-21T15:30:00Z'), LIVE_DEFAULTS))).toBe(false);
  });
  it('standings every 3 h at :15, nightly 08:15 UTC, weekly Tuesday 15:00 UTC', () => {
    expect(entry('standings').due(clockAt(at('2026-09-21T15:15:00Z'), LIVE_DEFAULTS))).toBe(true);
    expect(entry('standings').due(clockAt(at('2026-09-21T16:15:00Z'), LIVE_DEFAULTS))).toBe(false);
    expect(entry('nightly').due(clockAt(at('2026-09-21T08:15:00Z'), LIVE_DEFAULTS))).toBe(true);
    expect(entry('weekly').due(clockAt(at('2026-09-22T15:00:00Z'), LIVE_DEFAULTS))).toBe(true); // Tuesday
    expect(entry('weekly').due(clockAt(at('2026-09-21T15:00:00Z'), LIVE_DEFAULTS))).toBe(false);
  });
  it('live follows the settings cadence inside the Eastern game window', () => {
    const inWindow = at('2026-09-21T23:07:00Z'); // 19:07 ET
    expect(entry('live').due(clockAt(inWindow, LIVE_DEFAULTS))).toBe(true);
    expect(entry('live').due(clockAt(inWindow, { ...LIVE_DEFAULTS, scoreboard_every_min: 3 }))).toBe(false);
    expect(entry('live').due(clockAt(at('2026-09-21T23:09:00Z'), { ...LIVE_DEFAULTS, scoreboard_every_min: 3 }))).toBe(true);
    expect(entry('live').due(clockAt(at('2026-09-21T12:00:00Z'), LIVE_DEFAULTS))).toBe(false); // 08:00 ET
  });
  it('nextFire finds the next slot', () => {
    expect(nextFire(entry('hourly'), at('2026-09-21T15:31:00Z'), LIVE_DEFAULTS)?.toISOString()).toBe('2026-09-21T16:00:00.000Z');
    expect(nextFire(entry('weekly'), at('2026-09-21T15:31:00Z'), LIVE_DEFAULTS)?.toISOString()).toBe('2026-09-22T15:00:00.000Z');
  });
});
