import { describe, it, expect } from 'vitest';
import { buildAliasIndex, resolveName, isPlaceholderOpponent } from '../../src/normalize/aliasIndex.js';
import { teamKey, nameInitials } from '../../src/normalize/teamIdentity.js';

const programs = [
  { id: 'bak', gender: 'm', school_seo: 'bakersfield', name: 'CSU Bakersfield', short_name: 'CSU Bakersfield', name6: 'CSUBAK' },
  { id: 'uncg', gender: 'm', school_seo: 'unc-greensboro', name: 'UNC Greensboro', short_name: 'UNC Greensboro', name6: 'UNC G' },
  { id: 'semo', gender: 'm', school_seo: 'southeast-mo-st', name: 'Southeast Mo. St.', short_name: 'Southeast Mo. St.', name6: 'SEMO' },
  { id: 'hcu', gender: 'm', school_seo: 'houston-christian', name: 'Houston Christian', short_name: 'Houston Christian', name6: 'HOUCHR' },
  { id: 'uiw', gender: 'm', school_seo: 'uiw', name: 'UIW', short_name: 'UIW', name6: 'INCWRD' },
  { id: 'stmn', gender: 'm', school_seo: 'st-thomas-mn', name: 'St. Thomas (MN)', short_name: 'St. Thomas (MN)', name6: 'STTHOM' },
  { id: 'ccsu', gender: 'm', school_seo: 'central-conn-st', name: 'Central Conn. St.', short_name: 'Central Conn. St.', name6: 'C CONN' },
  { id: 'utrgv', gender: 'm', school_seo: 'utrgv', name: 'Texas Rio Grande Valley', short_name: 'UTRGV', name6: 'UTRGV' },
  { id: 'bc', gender: 'm', school_seo: 'boston-college', name: 'Boston College', short_name: 'Boston College', name6: 'BC' },
  { id: 'bu', gender: 'm', school_seo: 'boston-u', name: 'Boston U.', short_name: 'Boston U.', name6: 'BU' },
  { id: 'ncst', gender: 'm', school_seo: 'nc-state', name: 'NC State', short_name: 'NC State', name6: 'NCST' },
  { id: 'unc', gender: 'm', school_seo: 'north-carolina', name: 'North Carolina', short_name: 'North Carolina', name6: 'UNC' },
  { id: 'wash', gender: 'm', school_seo: 'washington', name: 'Washington', short_name: 'Washington', name6: 'WASH' },
  { id: 'umkc', gender: 'm', school_seo: 'umkc', name: 'Kansas City', short_name: 'Kansas City', name6: 'UMKC' },
];
const schools = new Map<string, { seo: string; name: string; long_name: string | null }>([
  ['bakersfield', { seo: 'bakersfield', name: 'CSU Bakersfield', long_name: 'CSU Bakersfield' }],
  ['unc-greensboro', { seo: 'unc-greensboro', name: 'UNC Greensboro', long_name: 'University of North Carolina Greensboro' }],
  ['southeast-mo-st', { seo: 'southeast-mo-st', name: 'Southeast Mo. St.', long_name: 'Southeast Missouri State University' }],
  ['houston-christian', { seo: 'houston-christian', name: 'Houston Christian', long_name: 'Houston Christian University' }],
  ['uiw', { seo: 'uiw', name: 'UIW', long_name: null }],
  ['st-thomas-mn', { seo: 'st-thomas-mn', name: 'St. Thomas (MN)', long_name: 'University of St. Thomas (Minn.)' }],
  ['central-conn-st', { seo: 'central-conn-st', name: 'Central Conn. St.', long_name: 'Central Connecticut State University' }],
  ['utrgv', { seo: 'utrgv', name: 'Texas Rio Grande Valley', long_name: 'University of Texas Rio Grande Valley' }],
  ['boston-college', { seo: 'boston-college', name: 'Boston College', long_name: 'Boston College' }],
  ['boston-u', { seo: 'boston-u', name: 'Boston U.', long_name: 'Boston University' }],
  ['nc-state', { seo: 'nc-state', name: 'NC State', long_name: 'North Carolina State University' }],
  ['north-carolina', { seo: 'north-carolina', name: 'North Carolina', long_name: 'University of North Carolina' }],
  ['washington', { seo: 'washington', name: 'Washington', long_name: 'University of Washington' }],
  ['umkc', { seo: 'umkc', name: 'Kansas City', long_name: 'University of Missouri-Kansas City' }],
]);
const index = buildAliasIndex(programs, schools);
const scope = { gender: 'm', ownDivision: 'd1', ownConference: null, divisionOf: new Map(programs.map((p) => [p.id, 'd1'])), conferenceOf: new Map() };
const r = (name: string) => resolveName(index, scope, name);

describe('opponent aliases', () => {
  it('resolves the names that were unresolved in the 2026 crawl', () => {
    expect(r('Cal State Bakersfield')).toBe('bak');
    expect(r('CSUB')).toBe('bak');
    expect(r('UNCG')).toBe('uncg');
    expect(r('UNC Greensboro')).toBe('uncg');
    expect(r('Southeast Missouri')).toBe('semo');
    expect(r('HCU')).toBe('hcu');
    expect(r('Incarnate Word')).toBe('uiw');
    expect(r('University of the Incarnate Word')).toBe('uiw');
    expect(r('St. Thomas')).toBe('stmn');
    expect(r('CCSU')).toBe('ccsu');
    expect(r('Central Connecticut')).toBe('ccsu');
    expect(r('UT Rio Grande Valley')).toBe('utrgv');
    expect(r('vs. Boston College')).toBe('bc');
    expect(r('at Boston University')).toBe('bu');
    expect(r('N.C. State')).toBe('ncst');
    expect(r('#4 North Carolina')).toBe('unc');
    expect(r('University of Washington')).toBe('wash');
    expect(r('UMKC')).toBe('umkc');
  });
  it('does not invent matches', () => {
    expect(r('Bob Jones')).toBeNull();
    expect(r('USC Lancaster')).toBeNull();
    expect(r('Bellarmine Pups at the Pitch')).toBeNull();
  });
  it('keys', () => {
    expect(teamKey('Cal State Bakersfield')).toBe(teamKey('CSU Bakersfield'));
    expect(teamKey('Southeast Mo. St.')).toBe('southeast missouri state');
    expect(nameInitials('University of North Carolina Greensboro')).toBe('uncg');
    expect(nameInitials('University of Missouri-Kansas City')).toBe('umkc');
    expect(nameInitials('Duke University')).toBeNull();
  });
});

describe('placeholders', () => {
  it('flags every placeholder seen in the 2026 schedules', () => {
    for (const n of ['TBD', 'TBA', 'Semifinals', 'Quarterfinals', 'First Round', 'Final', 'Semifinal', 'Championship', 'Patriot League Semifinals', 'NEC Semifinals', 'American Conference', 'Conference USA', 'Horizon League', 'Metro Championship', 'Championship Game', 'MAC Tournament', 'WCC Tournament', 'NCAA College Cup', 'NCAA Tournament', 'NEC Finals', 'Big Sky Conference', 'Pac-12 Championship', 'Finals', 'CAA Championship']) {
      expect(isPlaceholderOpponent(n), n).toBe(true);
    }
  });
  it('keeps real teams', () => {
    for (const n of ['Duke', 'Notre Dame (OH)', 'Cal State Bakersfield', 'USC Lancaster', 'St. Thomas', 'Loyola Marymount', 'Boston College', 'Wake Forest']) expect(isPlaceholderOpponent(n), n).toBe(false);
  });
});

describe('conference member matching', async () => {
  const { matchAmongMembers, prefixSubsequence, memberTokens } = await import('../../src/normalize/aliasIndex.js');
  const members = [
    { id: 'uwec', names: ['Wis.-Eau Claire', 'University of Wisconsin-Eau Claire'] },
    { id: 'uwsp', names: ['Wis.-Stevens Point'] },
    { id: 'geneseo', names: ['SUNY Geneseo'] },
    { id: 'poly', names: ['SUNY Poly', 'SUNY Polytechnic Institute'] },
    { id: 'cms', names: ['Claremont-M-S'] },
    { id: 'wj', names: ['Wash. & Jeff.', 'Washington & Jefferson College'] },
    { id: 'esu', names: ['East Stroudsburg'] },
    { id: 'msm', names: ['Mt. St. Mary (NY)', 'Mount Saint Mary College'] },
    { id: 'sjb', names: ["St. Joseph's (Brkln)", "St. Joseph's University (Brooklyn)"] },
    { id: 'sjli', names: ["St. Joseph's (L.I.)", "St. Joseph's University (Long Island)"] },
  ];
  it('matches short conference-site spellings to the right member', () => {
    expect(matchAmongMembers('UW-Eau Claire', members)).toBe('uwec');
    expect(matchAmongMembers('UW-Stevens Point', members)).toBe('uwsp');
    expect(matchAmongMembers('Geneseo', members)).toBe('geneseo');
    expect(matchAmongMembers('Poly', members)).toBe('poly');
    expect(matchAmongMembers('Claremont-Mudd-Scripps', members)).toBe('cms');
    expect(matchAmongMembers('W&J', members)).toBe('wj');
    expect(matchAmongMembers('E. Stroudsburg', members)).toBe('esu');
    expect(matchAmongMembers('Mount Saint Mary', members)).toBe('msm');
    expect(matchAmongMembers("St. Joseph's-Brooklyn", members)).toBe('sjb');
  });
  it('refuses ambiguous matches', () => {
    expect(matchAmongMembers("St. Joseph's", members)).toBeNull();
    expect(matchAmongMembers('Wisconsin', members)).toBeNull();
  });
  it('helpers', () => {
    expect(prefixSubsequence(['e', 'stroudsburg'], ['east', 'stroudsburg'])).toBe(true);
    expect(prefixSubsequence(['stroudsburg', 'east'], ['east', 'stroudsburg'])).toBe(false);
    expect(memberTokens('UW-La Crosse')).toEqual(['wisconsin', 'la', 'crosse']);
  });
});

describe('opponent name cleanup', async () => {
  const m = await import('../../src/normalize/aliasIndex.js');
  it('strips poll markers', () => {
    expect(m.cleanOpponentName('#T19 South Carolina')).toBe('South Carolina');
    expect(m.cleanOpponentName('NR/#20 North Carolina')).toBe('North Carolina');
    expect(m.cleanOpponentName('[RV] Xavier')).toBe('Xavier');
    expect(m.cleanOpponentName('RV St. Mary\'s')).toBe("St. Mary's");
    expect(m.cleanOpponentName('vs. No. 12 Elon')).toBe('Elon');
    expect(m.cleanOpponentName('#2/5 Duke')).toBe('Duke');
    expect(m.cleanOpponentName('Rider')).toBe('Rider');
  });
  it('flags exhibitions', () => {
    expect(m.isExhibitionName('Drake (Exh.)')).toBe(true);
    expect(m.isExhibitionName('Hawkeye (Exhibition)')).toBe(true);
    expect(m.isExhibitionName('Exeter')).toBe(false);
  });
  it('treats a conference name that is also a team as a team', () => {
    m.setKnownConferences(['American', 'Big East']);
    const progs = [{ id: 'au', gender: 'm', school_seo: 'american', name: 'American', short_name: 'American', name6: 'AMER' }];
    m.buildAliasIndex(progs, new Map([['american', { seo: 'american', name: 'American', long_name: 'American University' }]]), []);
    expect(m.isPlaceholderOpponent('American')).toBe(false);
    expect(m.isPlaceholderOpponent('Big East')).toBe(true);
  });
  it('prefers NCAA members for ambiguous names', () => {
    const progs = [
      { id: 'mn', gender: 'm', school_seo: 'st-thomas-mn', name: 'St. Thomas (MN)', short_name: null, name6: null },
      { id: 'fl', gender: 'm', school_seo: 'st-thomas-fl', name: 'St. Thomas (FL)', short_name: null, name6: null },
    ];
    const idx = m.buildAliasIndex(progs, new Map(), []);
    const scope = { gender: 'm', ownDivision: 'd1', ownConference: null, divisionOf: new Map([['mn', 'd1'], ['fl', 'd1']]), conferenceOf: new Map() };
    m.setMembership(new Map([['mn', true], ['fl', false]]));
    expect(m.resolveName(idx, scope, 'St. Thomas')).toBe('mn');
    expect(m.resolveName(idx, scope, 'St. Thomas University (Fla.) 77\' (F) - Lightning')).toBe('fl');
  });
});

describe('opponent records', async () => {
  const m = await import('../../src/normalize/aliasIndex.js');
  it('accepts clean school names only', () => {
    expect(m.isCleanOpponentName('Monroe University')).toBe(true);
    expect(m.isCleanOpponentName('Shawnee State ')).toBe(true);
    expect(m.isCleanOpponentName('Andrew (GA)')).toBe(true);
    expect(m.isCleanOpponentName('Long Beach Purple-Out')).toBe(false);
    expect(m.isCleanOpponentName("Miami Kid's Game | Triple Points in FIU Sports App")).toBe(false);
    expect(m.isCleanOpponentName("St. Thomas University (Fla.) 77' (F) - Lightning")).toBe(false);
    expect(m.isCleanOpponentName('NEC Tournament')).toBe(false);
    expect(m.isCleanOpponentName('Drake (Exh.)')).toBe(false);
  });
  it('makes stable synthetic slugs', () => {
    expect(m.opponentSeo('Monroe University')).toBe('x-monroe');
    expect(m.opponentSeo('#12 Shawnee State')).toBe('x-shawnee-state');
  });
  it('prefix matches stay inside the division', () => {
    const progs = [{ id: 'tct', gender: 'm', school_seo: 'trinity-ct', name: 'Trinity (CT)', short_name: null, name6: null }];
    const idx = m.buildAliasIndex(progs, new Map([['trinity-ct', { seo: 'trinity-ct', name: 'Trinity (CT)', long_name: 'Trinity College' }]]), []);
    const scope = { gender: 'm', ownDivision: 'd1', ownConference: null, divisionOf: new Map([['tct', 'd3']]), conferenceOf: new Map() };
    m.setMembership(new Map());
    expect(m.resolveName(idx, scope, 'Trinity College of Jacksonville International Celebration Night')).toBeNull();
    expect(m.resolveName(idx, { ...scope, ownDivision: 'd3' }, 'Trinity College Senior Day')).toBe('tct');
  });
});

describe('shared stems', async () => {
  const m = await import('../../src/normalize/aliasIndex.js');
  it('"Loyola" is ambiguous and resolved by conference', () => {
    const progs = [
      { id: 'luc', gender: 'm', school_seo: 'loyola-chicago', name: 'Loyola Chicago', short_name: null, name6: null },
      { id: 'lmd', gender: 'm', school_seo: 'loyola-maryland', name: 'Loyola Maryland', short_name: null, name6: null },
      { id: 'lmu', gender: 'm', school_seo: 'loyola-marymount', name: 'LMU (CA)', short_name: null, name6: null },
    ];
    const schools = new Map([
      ['loyola-chicago', { seo: 'loyola-chicago', name: 'Loyola (IL)', long_name: 'Loyola University Chicago' }],
      ['loyola-maryland', { seo: 'loyola-maryland', name: 'Loyola Maryland', long_name: 'Loyola University Maryland' }],
      ['loyola-marymount', { seo: 'loyola-marymount', name: 'Loyola Marymount', long_name: 'Loyola Marymount University' }],
    ]);
    const idx = m.buildAliasIndex(progs, schools, []);
    m.setMembership(new Map());
    const divisionOf = new Map([['luc', 'd1'], ['lmd', 'd1'], ['lmu', 'd1']]);
    const conferenceOf = new Map([['luc', 'a10'], ['lmd', 'patriot'], ['lmu', 'wcc']]);
    expect(m.resolveName(idx, { gender: 'm', ownDivision: 'd1', ownConference: 'patriot', divisionOf, conferenceOf }, 'Loyola')).toBe('lmd');
    expect(m.resolveName(idx, { gender: 'm', ownDivision: 'd1', ownConference: 'nec', divisionOf, conferenceOf }, 'at Loyola')).toBeNull();
    expect(m.resolveName(idx, { gender: 'm', ownDivision: 'd1', ownConference: 'nec', divisionOf, conferenceOf }, 'Loyola Chicago')).toBe('luc');
  });
});
