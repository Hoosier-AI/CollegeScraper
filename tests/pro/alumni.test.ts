import { describe, it, expect } from 'vitest';
import { mergeAlumni } from '../../src/pro/alumni.js';

describe('pro alumni of a school', () => {
  it('lists a player once when two links point at the same school', () => {
    const out = mergeAlumni([
      { id: 1, name: 'Aidan Morris', college_years: [2019, 2019], minutes_recent: 900 },
      { id: 2, name: 'Jack Maher', college_years: [2018, 2019], minutes_recent: 2000 },
      { id: 1, name: 'Aidan Morris', college_years: [2019, 2020], minutes_recent: 900 },
    ]);
    expect(out.map((p) => p.id)).toEqual([2, 1]);
    expect(out.find((p) => p.id === 1)!.college_years).toEqual([2019, 2020]);
  });
  it('keeps a link with no seasons and does not change the input', () => {
    const input = [{ id: 3, college_years: [] as number[], minutes_recent: 0 }, { id: 3, college_years: [2021, 2022], minutes_recent: 0 }];
    expect(mergeAlumni(input)).toEqual([{ id: 3, college_years: [2021, 2022], minutes_recent: 0 }]);
    expect(input[0]!.college_years).toEqual([]);
  });
});
