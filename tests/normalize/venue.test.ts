import { describe, it, expect } from 'vitest';
import { cityLabel, parseVenue, placeCoords, stateCode } from '../../src/normalize/venue.js';

describe('venue', () => {
  it('reads state names, AP abbreviations and postal codes', () => {
    expect(stateCode('N.C.')).toBe('NC'); expect(stateCode('Colorado')).toBe('CO'); expect(stateCode('Pa.')).toBe('PA');
    expect(stateCode('W.Va.')).toBe('WV'); expect(stateCode('D.C.')).toBe('DC'); expect(stateCode('TX')).toBe('TX'); expect(stateCode('Stadium')).toBeNull();
  });
  it('splits ground and city the way school schedules print them', () => {
    expect(parseVenue('Durham, N.C.', 'Freeman Field at Koskinen Stadium')).toEqual({ name: 'Freeman Field at Koskinen Stadium', city: 'Durham', state: 'NC' });
    expect(parseVenue('Freeman Field at Koskinen Stadium, Durham, N.C.')).toEqual({ name: 'Freeman Field at Koskinen Stadium', city: 'Durham', state: 'NC' });
    expect(parseVenue('University Park, Pa.')).toEqual({ name: null, city: 'University Park', state: 'PA' });
    expect(parseVenue('Koskinen Stadium')).toEqual({ name: 'Koskinen Stadium', city: null, state: null });
    expect(parseVenue('Irvine')).toEqual({ name: null, city: 'Irvine', state: null });
    expect(parseVenue('Home')).toEqual({ name: null, city: null, state: null });
    expect(parseVenue('0')).toEqual({ name: null, city: null, state: null });
    expect(cityLabel(parseVenue('St. Paul, Minn.'))).toBe('St. Paul, MN');
  });
  it('places cities with the Census list, including campus names it lacks', () => {
    expect(placeCoords('Durham', 'NC')).toEqual({ lat: 35.9779, lon: -78.8981 });
    expect(placeCoords('St. Paul', 'MN')).not.toBeNull();
    expect(placeCoords('Winston-Salem', 'NC')).not.toBeNull();
    expect(placeCoords('Chestnut Hill', 'MA')).not.toBeNull();
    expect(placeCoords('Nowhere Special', 'NC')).toBeNull();
    expect(placeCoords('Durham', null)).toBeNull();
  });
});
