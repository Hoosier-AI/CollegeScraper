import { describe, it, expect } from 'vitest';
import { fixture } from '../helpers/fakeFetcher.js';
import { parsePrestoStandings, prestoSeasonSlug } from '../../src/sources/conferences/prestoStandings.js';

describe('presto conference standings', () => {
  it('parses the MASCAC men table', () => {
    const st = parsePrestoStandings(fixture('conferences/mascac-msoc-presto.html'));
    expect(st.pods).toHaveLength(1);
    const rows = st.pods[0]!.rows;
    expect(rows.length).toBeGreaterThanOrEqual(8);
    const r = rows[0]!;
    expect(r.school).toBe('Framingham St.');
    expect(r.conf).toEqual({ w: 2, l: 0, t: 0 });
    expect(r.confPts).toBe(6);
    expect(r.confPct).toBeCloseTo(1);
    expect(r.overall).toEqual({ w: 3, l: 1, t: 0 });
    expect(r.overallPct).toBeCloseTo(0.75);
    expect(r.scheduleUrl).toContain('schedule?teamId=');
    for (const x of rows) { expect(x.conf).not.toBeNull(); expect(x.overall).not.toBeNull(); }
  });
  it('season slug', () => { expect(prestoSeasonSlug(2026)).toBe('2026-27'); });
});
