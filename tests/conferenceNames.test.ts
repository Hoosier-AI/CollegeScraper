import { describe, it, expect } from 'vitest';
import { conferenceName, curatedConferenceSlugs } from '../src/normalize/conferenceNames.js';

// Every conference slug with teams in 2025 or 2026 (production, 2026-10-26). A new slug from NCAA.com logs
// "conference name not curated"; add it to data/conference-names.json and here.
const IN_USE = ['acc', 'america-east', 'american', 'asun', 'atlantic-10', 'big-12', 'big-east', 'big-sky', 'big-south', 'big-ten', 'big-west', 'caa', 'cusa',
  'di-independent', 'horizon', 'ivy-league', 'mac', 'metro', 'mountain-west', 'mvc', 'nec', 'ovc', 'pac-12', 'patriot', 'sec', 'socon', 'southland',
  'summit-league', 'sun-belt', 'swac', 'uac-', 'wcc', 'cacc', 'ccaa', 'conference-carolinas', 'dii-independent', 'ecc', 'g-mac', 'gac', 'gliac', 'glvc',
  'great-northwest', 'gulf-south', 'lone-star', 'mec', 'mid-america-intercollegiate', 'ne10', 'nsic', 'pacwest', 'peach-belt', 'psac', 'rmac', 'sac',
  'siac', 'sunshine-state', 'amcc', 'american-rivers', 'asc', 'atlantic-east', 'c2c', 'cciw', 'ccs', 'centennial', 'cne', 'cunyac', 'diii-independent',
  'empire-8', 'great-northeast', 'hcac', 'landmark', 'liberty-league', 'little-east', 'mac-commonwealth', 'mac-freedom', 'mascac', 'miac',
  'michigan-intercol. ath. assn.', 'mwc', 'nacc', 'ncac', 'nescac', 'newmac', 'njac', 'north-atlantic', 'nwc', 'oac', 'odac', 'pac', 'saa', 'scac',
  'sciac', 'skyline', 'sliac', 'sunyac', 'uaa', 'umac', 'united-east', 'usa-south', 'wiac'];

describe('conference names', () => {
  it('has a curated name for every conference in use', () => {
    expect(IN_USE.filter((s) => !conferenceName(s))).toEqual([]);
  });
  it('fixes the names the slugs got wrong', () => {
    expect(conferenceName('metro')?.short).toBe('MAAC');
    expect(conferenceName('uac-')?.short).toBe('UAC');
    expect(conferenceName('socon')?.short).toBe('SoCon');
    expect(conferenceName('pac-12')?.short).toBe('Pac-12');
  });
  it('names every entry with a short form and a full name', () => {
    for (const s of curatedConferenceSlugs()) expect(conferenceName(s)).toMatchObject({ name: expect.any(String), short: expect.any(String) });
  });
});
