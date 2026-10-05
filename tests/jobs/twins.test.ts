import { describe, it, expect } from 'vitest';
import { buildAliasIndex, resolveName, realProgramFor, setMembership } from '../../src/normalize/aliasIndex.js';

// The 2026-09 twins: a synthetic x- program created beside a real NCAA.com program of the same name.
const programs = [
  { id: 'nd', gender: 'w', school_seo: 'notre-dame', name: 'Notre Dame', short_name: 'Notre Dame' },
  { id: 'xnd', gender: 'w', school_seo: 'x-notre-dame', name: 'Notre Dame', short_name: 'Notre Dame' },
  { id: 'ndmd', gender: 'w', school_seo: 'notre-dame-md', name: 'Notre Dame (MD)', short_name: 'Notre Dame (MD)' },
  { id: 'cal', gender: 'w', school_seo: 'california', name: 'California', short_name: 'California' },
  { id: 'calpa', gender: 'w', school_seo: 'california-pa', name: 'California (PA)', short_name: 'California (PA)' },
  { id: 'gtm', gender: 'm', school_seo: 'georgetown', name: 'Georgetown', short_name: 'Georgetown' },
];
const schools = new Map([
  ['notre-dame', { seo: 'notre-dame', name: 'Notre Dame', long_name: 'University of Notre Dame' }],
  ['x-notre-dame', { seo: 'x-notre-dame', name: 'Notre Dame', long_name: null }],
  ['notre-dame-md', { seo: 'notre-dame-md', name: 'Notre Dame (MD)', long_name: 'Notre Dame of Maryland University' }],
  ['california', { seo: 'california', name: 'California', long_name: 'University of California, Berkeley' }],
  ['california-pa', { seo: 'california-pa', name: 'California (PA)', long_name: 'Pennsylvania Western University, California' }],
  ['georgetown', { seo: 'georgetown', name: 'Georgetown', long_name: 'Georgetown University' }],
]);
const divisionOf = new Map([['nd', 'd1'], ['xnd', 'd1'], ['ndmd', 'd3'], ['cal', 'd1'], ['calpa', 'd2'], ['gtm', 'd1']]);

describe('synthetic twins', () => {
  setMembership(new Map(programs.map((p) => [p.id, true])));
  const index = buildAliasIndex(programs, schools, []);
  const scope = { gender: 'w', ownDivision: null, ownConference: null, divisionOf, conferenceOf: new Map() };

  it('a poll or table name resolves to the real program, not its x- twin', () => {
    expect(resolveName(index, scope, 'Notre Dame')).toBe('nd');
    expect(resolveName(index, scope, 'University of Notre Dame')).toBe('nd');
  });

  it('realProgramFor finds the one real program and never a synthetic one', () => {
    expect(realProgramFor(programs, schools, 'w', 'Notre Dame')).toBe('nd');
    expect(realProgramFor(programs, schools, 'w', 'Notre Dame (MD)')).toBe('ndmd');
    expect(realProgramFor(programs, schools, 'w', 'California')).toBe('cal');
    expect(realProgramFor(programs, schools, 'w', '#12 California')).toBe('cal');
  });

  it('a synthetic team with a different name is not a twin (bare "Rochester" vs Rochester (NY))', () => {
    const progs = [
      { id: 'ur', gender: 'w', school_seo: 'rochester-ny', name: 'Rochester (NY)', short_name: 'Rochester (NY)' },
      { id: 'rc', gender: 'w', school_seo: 'x-rochester', name: 'Rochester', short_name: 'Rochester' },
    ];
    const sch = new Map([['rochester-ny', { seo: 'rochester-ny', name: 'Rochester (NY)', long_name: 'University of Rochester' }]]);
    expect(realProgramFor(progs, sch, 'w', 'Rochester')).toBeNull();
    const idx = buildAliasIndex(progs, sch, []);
    expect(resolveName(idx, { ...scope, divisionOf: new Map([['ur', 'd3'], ['rc', 'd3']]) }, 'Rochester')).toBeNull();
  });

  it('realProgramFor stays out of genuinely unknown or other-gender names', () => {
    expect(realProgramFor(programs, schools, 'w', 'Georgetown')).toBeNull(); // men only
    expect(realProgramFor(programs, schools, 'w', 'Monroe University')).toBeNull();
  });

  it('a same-name program in another known division is a different school', () => {
    const progs = [{ id: 'nu', gender: 'w', school_seo: 'northwestern', name: 'Northwestern', short_name: 'Northwestern' }];
    const div = new Map([['nu', 'd1']]);
    expect(realProgramFor(progs, null, 'w', 'Northwestern', { division: 'd3', divisionOf: div })).toBeNull();
    expect(realProgramFor(progs, null, 'w', 'Northwestern', { division: 'd1', divisionOf: div })).toBe('nu');
    expect(realProgramFor(progs, null, 'w', 'Northwestern', { division: 'd3', divisionOf: new Map() })).toBe('nu'); // unknown division
  });

  it('several real fits are narrowed by division, else no match', () => {
    const two = [...programs, { id: 'nd2', gender: 'w', school_seo: 'notre-dame-oh', name: 'Notre Dame', short_name: 'Notre Dame' }];
    const div = new Map([...divisionOf, ['nd2', 'd2']]);
    expect(realProgramFor(two, null, 'w', 'Notre Dame')).toBeNull();
    expect(realProgramFor(two, null, 'w', 'Notre Dame', { division: 'd2', divisionOf: div })).toBe('nd2');
  });
});
