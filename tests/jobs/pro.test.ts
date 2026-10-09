import { describe, it, expect } from 'vitest';
import { backfillQueue } from '../../src/jobs/pro/backfill.js';
import { scoreboardDays } from '../../src/jobs/pro/scoreboard.js';
import { matchNameAge, matchWikidata, parseWikidata, resolveSchool, schoolIndex, withLabels } from '../../src/jobs/pro/collegeMatch.js';
import type { LeagueInfo } from '../../src/db/proRepo.js';
import { SCHEDULE, clockAt } from '../../src/jobs/scheduler.js';
import { LIVE_DEFAULTS } from '../../src/ops/settings.js';
import { JOB_META, PRO_LANE_JOBS } from '../../src/jobs/catalogue.js';

const L = (id: number, priority: number, current = 2026, enabled = true): [number, LeagueInfo] => [id, { id, gender: 'm', enabled, priority, type: 'league', current_season: current }];

describe('pro backfill order', () => {
  const leagues = new Map([L(253, 1), L(39, 20), L(183, 500), L(256, 900, 2026, false)]);
  const s = (league_id: number, season: number, extra: Partial<Parameters<typeof backfillQueue>[0][number]> = {}) => ({ league_id, season, is_current: season === 2026, coverage: null, fixtures_synced_at: null, teams_synced_at: null, standings_synced_at: null, backfilled_at: null, ...extra });
  it('current seasons first by priority, then older ones, never disabled leagues or beyond the depth', () => {
    const q = backfillQueue([s(183, 2026), s(39, 2025), s(253, 2026), s(39, 2026), s(253, 2025), s(253, 2023), s(256, 2026)], leagues, 3);
    expect(q.map((x) => `${x.league_id}/${x.season}`)).toEqual(['253/2026', '39/2026', '183/2026', '253/2025', '39/2025']);
  });
  it('a finished season is done; the current one comes back weekly for its fixture list', () => {
    const now = Date.parse('2026-10-08T00:00:00Z');
    const q = backfillQueue([
      s(253, 2025, { backfilled_at: '2026-10-01T00:00:00Z' }),
      s(253, 2026, { backfilled_at: '2026-10-07T00:00:00Z', fixtures_synced_at: '2026-10-07T00:00:00Z' }),
      s(39, 2026, { backfilled_at: '2026-09-01T00:00:00Z', fixtures_synced_at: '2026-09-01T00:00:00Z' }),
    ], leagues, 3, now);
    expect(q.map((x) => `${x.league_id}/${x.season}`)).toEqual(['39/2026']);
  });
  it('one league on demand', () => {
    expect(backfillQueue([s(253, 2026), s(39, 2026)], leagues, 3, Date.now(), 39).map((x) => x.league_id)).toEqual([39]);
  });
});

describe('pro scoreboard days', () => {
  it('today every run; yesterday and tomorrow too at the top of the hour', () => {
    expect(scoreboardDays('auto', Date.parse('2026-10-08T14:30:00Z'))).toEqual(['2026-10-08']);
    expect(scoreboardDays('auto', Date.parse('2026-10-08T14:05:00Z'))).toEqual(['2026-10-07', '2026-10-08', '2026-10-09']);
    expect(scoreboardDays('recent', Date.parse('2026-01-01T12:00:00Z'))).toEqual(['2025-12-31', '2026-01-01', '2026-01-02']);
  });
});

describe('pro schedule', () => {
  it('runs all year (not only August to December) and the everyday jobs go to the pro lane', () => {
    const march = clockAt(new Date('2026-03-10T14:10:00Z'), LIVE_DEFAULTS);
    expect(SCHEDULE.find((e) => e.job === 'pro-scoreboard')!.due(march)).toBe(true);
    expect(SCHEDULE.find((e) => e.job === 'hourly')!.due({ ...march, m: 0 })).toBe(false);
    expect(PRO_LANE_JOBS.sort()).toEqual(['pro-final-detail', 'pro-live', 'pro-scoreboard', 'pro-standings']);
    expect(JOB_META['pro-backfill']!.lane).toBe('pro-bulk');
    expect(JOB_META['pro-crawl']!.lane).toBe('pro-bulk');
  });
});

describe('college links', () => {
  const schools = schoolIndex([
    { seo: 'north-carolina', name: 'North Carolina', long_name: 'University of North Carolina' },
    { seo: 'nc-state', name: 'NC State', long_name: 'North Carolina State University' },
    { seo: 'stanford', name: 'Stanford', long_name: 'Stanford University' },
    { seo: 'boston-college', name: 'Boston College', long_name: 'Boston College' },
    // Listed first and with no long name: must not take "Georgetown University".
    { seo: 'georgetown-ky', name: 'Georgetown (KY)', long_name: null },
    { seo: 'georgetown', name: 'Georgetown', long_name: 'Georgetown University' },
  ]);
  it('maps Wikidata college names to our schools, campus suffixes included', () => {
    expect(resolveSchool(schools, 'University of North Carolina at Chapel Hill')).toBe('north-carolina');
    expect(resolveSchool(schools, 'North Carolina State University')).toBe('nc-state');
    expect(resolveSchool(schools, 'Stanford University')).toBe('stanford');
    expect(resolveSchool(schools, 'Boston College')).toBe('boston-college');
    expect(resolveSchool(schools, 'Georgetown University')).toBe('georgetown');
    // No exact name for it here: no school rather than the wrong one.
    expect(resolveSchool(schools, 'Georgetown College')).toBeNull();
    expect(resolveSchool(schools, 'Some High School')).toBeNull();
  });
  it('Wikidata: birth date plus family name, one candidate only, colleges not high schools', () => {
    const raw = parseWikidata({ results: { bindings: [
      { p: { value: 'http://www.wikidata.org/entity/Q1' }, dob: { value: '2000-08-10T00:00:00Z' }, sex: { value: 'http://www.wikidata.org/entity/Q6581072' }, college: { value: 'http://www.wikidata.org/entity/Q41506' }, start: { value: '2018-01-01T00:00:00Z' }, end: { value: '2020-01-01T00:00:00Z' } },
      { p: { value: 'http://www.wikidata.org/entity/Q1' }, dob: { value: '2000-08-10T00:00:00Z' }, college: { value: 'http://www.wikidata.org/entity/Q5' } },
      { p: { value: 'http://www.wikidata.org/entity/Q2' }, dob: { value: '1999-01-01T00:00:00Z' }, college: { value: 'http://www.wikidata.org/entity/Q12345' } },
    ] } });
    expect(raw).toHaveLength(3);
    // A college with no English label (Q12345) drops out.
    const rows = withLabels(raw, new Map([['Q1', 'Sophia Smith'], ['Q2', 'John Doe'], ['Q41506', 'Stanford University'], ['Q5', 'Fort Collins High School']]));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ qid: 'Q1', gender: 'w', start: 2018, end: 2020, dob: '2000-08-10' });
    const pros = [{ id: 7, last_name: 'Smith', birth_date: '2000-08-10', gender: 'w' as const }, { id: 8, last_name: 'Smith', birth_date: '2001-08-10', gender: 'w' as const }];
    const links = matchWikidata(rows, pros, schools);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ pro_player_id: 7, school_seo: 'stanford', confidence: 0.95, method: 'wikidata', first_season: 2018, last_season: 2020 });
  });
  it('name and age: one college player of that name and gender, finishing 0-4 years before the first pro season', () => {
    const college = [
      { player_id: 'c1', name_key: 'doe|jane', gender: 'w' as const, seasons: [2023, 2024, 2025], school_seo: 'stanford', school_name: 'Stanford University' },
      { player_id: 'c2', name_key: 'doe|jane', gender: 'm' as const, seasons: [2025], school_seo: 'stanford', school_name: 'Stanford University' },
    ];
    const [link] = matchNameAge([{ id: 1, name_key: 'doe|jane', birth_date: '2004-03-01', gender: 'w', first_season: 2026 }], college);
    expect(link).toMatchObject({ pro_player_id: 1, college_player_id: 'c1', confidence: 0.85, first_season: 2023, last_season: 2025 });
    // Too old to have played those seasons, or a first pro season before college ended: no link.
    expect(matchNameAge([{ id: 1, name_key: 'doe|jane', birth_date: '1990-03-01', gender: 'w', first_season: 2026 }], college)).toHaveLength(0);
    expect(matchNameAge([{ id: 1, name_key: 'doe|jane', birth_date: '2004-03-01', gender: 'w', first_season: 2024 }], college)).toHaveLength(0);
    // Two college players share the name: proposed for review only.
    const two = matchNameAge([{ id: 1, name_key: 'doe|jane', birth_date: null, gender: 'w', first_season: 2026 }], [...college, { ...college[0]!, player_id: 'c3', school_seo: 'north-carolina' }]);
    expect(two.every((l) => l.confidence < 0.85)).toBe(true);
  });
});
