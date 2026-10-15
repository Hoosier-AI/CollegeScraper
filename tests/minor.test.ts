import { describe, expect, it } from 'vitest';
import { isMinor } from '../src/pro/minor.js';
import { publicBio } from '../src/ui/queries.js';

describe('isMinor', () => {
  const now = new Date('2026-10-15T12:00:00Z');
  it('is under 18 until the 18th birthday', () => {
    expect(isMinor('2008-10-16', now)).toBe(true);
    expect(isMinor('2008-10-15', now)).toBe(false);
    expect(isMinor('1995-01-01', now)).toBe(false);
  });
  it('treats an unknown or bad birth date as not known to be a minor', () => {
    expect(isMinor(null, now)).toBe(false);
    expect(isMinor('', now)).toBe(false);
    expect(isMinor('not a date', now)).toBe(false);
  });
  it('accepts timestamps', () => expect(isMinor('2010-03-01T00:00:00+00:00', now)).toBe(true));
});

describe('publicBio', () => {
  it('drops weight, major and high school and keeps the rest', () => {
    const r = publicBio({ id: 1, weight_lb: 170, major: 'Biology', high_school: 'Central', hometown_raw: 'Austin, Texas', previous_school: 'SMU', height_cm: 180 });
    expect(r).toEqual({ id: 1, hometown_raw: 'Austin, Texas', previous_school: 'SMU', height_cm: 180 });
  });
  it('passes null through', () => expect(publicBio(null)).toBeNull());
});
