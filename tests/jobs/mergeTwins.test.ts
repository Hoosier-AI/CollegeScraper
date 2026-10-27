import { describe, it, expect } from 'vitest';
import { findConferenceTwins } from '../../src/jobs/mergeTwins.js';

const prog = (id: string, school_seo: string, name: string, gender = 'w') => ({ id, school_seo, gender, name });
const schools = new Map<string, { seo: string; name?: string | null; long_name?: string | null }>();

describe('findConferenceTwins', () => {
  const programs = [
    prog('mia-fl', 'miami-fl', 'Miami (FL)'), prog('mia-oh', 'miami-oh', 'Miami (OH)'), prog('duke', 'duke', 'Duke'), prog('x-mia', 'x-miami', 'Miami'),
    prog('x-shaw', 'x-shawnee-state', 'Shawnee State'), prog('wv', 'wheeling', 'Wheeling'),
  ];
  const seasons = [
    { program_id: 'mia-fl', conference_id: 'acc' }, { program_id: 'duke', conference_id: 'acc' }, { program_id: 'x-mia', conference_id: 'acc' },
    { program_id: 'mia-oh', conference_id: 'mac' }, { program_id: 'x-shaw', conference_id: 'mec' }, { program_id: 'wv', conference_id: 'mec' },
  ];
  it('pairs a twin with the one real member of its conference it names', () => {
    expect(findConferenceTwins(programs, schools, seasons, new Set()).map((t) => `${t.fromSeo}->${t.toSeo}`)).toEqual(['x-miami->miami-fl']);
  });
  it('leaves a twin with no real counterpart in its conference, and skips ones already paired', () => {
    expect(findConferenceTwins(programs, schools, seasons, new Set(['x-mia']))).toEqual([]);
  });
});
