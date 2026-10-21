import { describe, it, expect } from 'vitest';
import { uniqueChecks, type StandingsCheck } from '../../src/db/standingsRepo.js';

const check = (program_id: string, field: string, official: string): StandingsCheck =>
  ({ season: 2026, program_id, field, official, computed: '1-0-0', checked_at: '2026-10-20T00:00:00Z' });

describe('uniqueChecks', () => {
  it('keeps one check per program and field, the first one', () => {
    const rows = [check('a', 'ncaa_record', '1-1-0'), check('a', 'ncaa_record', '2-0-0'), check('a', 'ncaa_record_lag', '1-1-0'), check('b', 'ncaa_record', '0-1-0')];
    const out = uniqueChecks(rows);
    expect(out).toHaveLength(3);
    expect(out[0]!.official).toBe('1-1-0');
  });
});
