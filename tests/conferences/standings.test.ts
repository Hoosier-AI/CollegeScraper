import { describe, it, expect } from 'vitest';
import { fixture } from '../helpers/fakeFetcher.js';
import { parseSidearmStandings, parseRecord, conferenceStandingsUrl } from '../../src/sources/conferences/sidearmStandings.js';

describe('sidearm conference standings', () => {
  it('parses the ACC table (points, GF-GA, home/away, streak)', () => {
    const st = parseSidearmStandings(fixture('conferences/acc-msoc.html'));
    expect(st.caption).toMatch(/Men's Soccer Standings/);
    expect(st.pods).toHaveLength(1);
    const rows = st.pods[0]!.rows;
    expect(rows.length).toBeGreaterThanOrEqual(14);
    const r = rows[0]!;
    expect(r.school).toBe('Virginia Tech');
    expect(r.conf).toEqual({ w: 1, l: 0, t: 1 });
    expect(r.confPts).toBe(4);
    expect(r.confPct).toBeCloseTo(0.75);
    expect(r.overall).toEqual({ w: 3, l: 2, t: 1 });
    expect(r.overallPct).toBeCloseTo(0.583);
    expect(r.confGf).toBe(3); expect(r.confGa).toBe(2);
    expect(r.home).toBe('3-1'); expect(r.away).toBe('0-1-1'); expect(r.streak).toBe('W1');
    expect(r.scheduleUrl).toContain('schedule.aspx');
    expect(r.logoAlt).toBe('Virginia Tech');
    const nc = rows.find((x) => x.school === 'NC State')!;
    expect(nc.overall).toEqual({ w: 2, l: 1, t: 3 }); expect(nc.confGf).toBe(4);
    for (const x of rows) { expect(x.school).toBeTruthy(); expect(x.overall).not.toBeNull(); expect(x.conf).not.toBeNull(); }
  });
  it('parses the NEC table (blank mobile column, Pct after Overall = overall pct)', () => {
    const st = parseSidearmStandings(fixture('conferences/nec-msoc.html'));
    const rows = st.pods[0]!.rows;
    expect(rows.length).toBeGreaterThanOrEqual(8);
    expect(rows[0]!.school).toBe('FDU');
    expect(rows[0]!.conf).toEqual({ w: 0, l: 0, t: 0 });
    expect(rows[0]!.confPts).toBe(0);
    expect(rows[0]!.overall).toEqual({ w: 5, l: 0, t: 1 });
    expect(rows[0]!.overallPct).toBeCloseTo(0.917);
    expect(rows[0]!.confPct).toBeNull();
    expect(rows[0]!.streak).toBe('W5');
    expect(rows[0]!.home).toBe('2-0-1');
    const lm = rows.find((x) => x.school === 'Le Moyne')!;
    expect(lm.overall).toEqual({ w: 3, l: 1, t: 2 });
  });
  it('splits Sun Belt women into East/West divisions', () => {
    const st = parseSidearmStandings(fixture('conferences/sunbelt-wsoc.html'));
    expect(st.pods.map((p) => p.name)).toEqual(['East Division', 'West Division']);
    const total = st.pods.reduce((a, p) => a + p.rows.length, 0);
    expect(total).toBeGreaterThanOrEqual(14);
    const r = st.pods[0]!.rows[0]!;
    expect(r.conf).not.toBeNull(); expect(r.overall).not.toBeNull(); expect(r.confPts).not.toBeNull();
  });
  it('parses the Summit women page (pod tables + full table, conference and overall GF/GA)', () => {
    const st = parseSidearmStandings(fixture('conferences/summit-wsoc.html'));
    expect(st.pods.map((p) => [p.name, p.rows.length])).toEqual([['Pod 1', 4], ['Pod 2', 4], [expect.any(String), 8]]);
    const rows = st.pods[2]!.rows;
    expect(rows.every((r) => r.overall)).toBe(true);
    const sdsu = rows.find((r) => r.school === 'South Dakota State')!;
    expect(sdsu.gf).toBe(29); expect(sdsu.ga).toBe(8); expect(sdsu.confGf).toBe(0);
    expect(sdsu.overallPct).toBeCloseTo(0.688);
  });
  it('does not read a PF-PA goals column as the overall record (SCIAC)', () => {
    const st = parseSidearmStandings(fixture('conferences/sciac-women-2026.html'));
    const rows = st.pods[0]!.rows;
    const chapman = rows.find((r) => /Chapman/.test(r.school))!;
    expect(chapman.conf).toEqual({ w: 1, l: 0, t: 0 });
    expect(chapman.overall).toEqual({ w: 1, l: 2, t: 1 });
    expect(chapman.confGf).toBe(2); expect(chapman.confGa).toBe(0);
    expect(chapman.gf).toBe(2); expect(chapman.ga).toBe(3);
    expect(chapman.streak).toBe('W1');
    const cal = rows.find((r) => /California Lutheran/.test(r.school))!;
    expect(cal.overall).toEqual({ w: 3, l: 1, t: 2 });
    expect(cal.conf).toEqual({ w: 0, l: 0, t: 1 });
  });
  it('skips the division-record columns on a pod table (Conference Carolinas: DPts, Div, DPct before Conf)', () => {
    const st = parseSidearmStandings(fixture('conferences/conference-carolinas-msoc-2026.html'));
    const rows = st.pods.flatMap((p) => p.rows);
    const ferrum = rows.find((r) => /Ferrum/.test(r.school))!;
    expect(ferrum.conf).toEqual({ w: 2, l: 0, t: 1 });
    expect(ferrum.overall).toEqual({ w: 3, l: 0, t: 2 });
    expect(ferrum.confPts).toBe(6);
    const chowan = rows.find((r) => /Chowan/.test(r.school))!;
    expect(chowan.conf).toEqual({ w: 2, l: 1, t: 0 });
    expect(chowan.gf).toBe(19); expect(chowan.ga).toBe(9);
  });
  it('helpers', () => {
    expect(parseRecord('3-1-2')).toEqual({ w: 3, l: 1, t: 2 });
    expect(parseRecord('4-2')).toEqual({ w: 4, l: 2, t: 0 });
    expect(parseRecord('.750')).toBeNull();
    expect(conferenceStandingsUrl('theacc.com', 'w')).toBe('https://theacc.com/standings.aspx?path=wsoc');
  });
});
