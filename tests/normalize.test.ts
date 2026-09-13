import { describe, it, expect } from 'vitest';
import { splitName, nameKey, looseNameMatch } from '../src/normalize/names.js';
import { parseClassYear } from '../src/normalize/classYear.js';
import { normalizePosition } from '../src/normalize/position.js';
import { heightToCm, heightFromFeetInches } from '../src/normalize/height.js';
import { parseHometown, splitHometownSchool } from '../src/normalize/hometown.js';
import { clockToSeconds, minutesFromClock } from '../src/normalize/clock.js';
import { num, pair, record } from '../src/normalize/num.js';
import { teamKey, hostOf } from '../src/normalize/teamIdentity.js';
import { parseRobots } from '../src/http/robots.js';

describe('names', () => {
  it('splits Last, First and First Last', () => {
    expect(splitName('Hot, Kenan')).toEqual({ firstName: 'Kenan', lastName: 'Hot', suffix: null });
    expect(splitName('Remi Agunbiade')).toEqual({ firstName: 'Remi', lastName: 'Agunbiade', suffix: null });
    expect(splitName('Santiago Marin Gutierrez').lastName).toBe('Marin Gutierrez');
    expect(splitName('John Smith Jr.')).toEqual({ firstName: 'John', lastName: 'Smith', suffix: 'Jr.' });
  });
  it('builds diacritic-free keys', () => {
    expect(nameKey('Herman', 'Toftevåg')).toBe('toftevag|herman');
    expect(nameKey("D'Ambrosio", 'Leonardo')).toBe('leonardo|dambrosio');
  });
  it('loose-matches initials', () => {
    expect(looseNameMatch({ firstName: 'K.', lastName: 'Hot' }, { firstName: 'Kenan', lastName: 'Hot' })).toBe(true);
    expect(looseNameMatch({ firstName: 'Ben', lastName: 'Hot' }, { firstName: 'Kenan', lastName: 'Hot' })).toBe(false);
  });
});

describe('class year', () => {
  it('maps labels', () => {
    expect(parseClassYear('Fr.')).toMatchObject({ year: 1, redshirt: false, grad: false });
    expect(parseClassYear('R-So.')).toMatchObject({ year: 2, redshirt: true });
    expect(parseClassYear('Gr. ')).toMatchObject({ grad: true, year: 5 });
    expect(parseClassYear('Graduate Student')).toMatchObject({ grad: true });
    expect(parseClassYear('5th')).toMatchObject({ year: 5 });
    expect(parseClassYear('Junior')).toMatchObject({ year: 3 });
    expect(parseClassYear('')).toMatchObject({ year: null });
    expect(parseClassYear('4')).toMatchObject({ year: 4, grad: false });
    expect(parseClassYear('5')).toMatchObject({ year: 5, grad: true });
  });
});

describe('position / height / hometown', () => {
  it('normalises positions', () => {
    expect(normalizePosition('GK')).toBe('GK');
    expect(normalizePosition('Goalkeeper')).toBe('GK');
    expect(normalizePosition('def')).toBe('D');
    expect(normalizePosition('Midfielder')).toBe('M');
    expect(normalizePosition('fwd')).toBe('F');
    expect(normalizePosition('')).toBeNull();
  });
  it('converts heights', () => {
    expect(heightToCm('6-1')).toBe(185);
    expect(heightToCm(`5'10"`)).toBe(178);
    expect(heightFromFeetInches(6, 3)).toBe(191);
    expect(heightToCm('x')).toBeNull();
  });
  it('parses hometowns', () => {
    expect(parseHometown('Safety Harbor, Fla.')).toMatchObject({ city: 'Safety Harbor', region: 'Florida', country: 'USA' });
    expect(parseHometown('Woodbridge, VA')).toMatchObject({ region: 'Virginia', country: 'USA' });
    expect(parseHometown('Reykjavik, Iceland')).toMatchObject({ city: 'Reykjavik', country: 'Iceland' });
    expect(parseHometown('Toronto, Ont.')).toMatchObject({ country: 'Canada' });
    expect(splitHometownSchool('New Britain, Conn. / Central HS')).toEqual({ hometown: 'New Britain, Conn.', school: 'Central HS' });
  });
});

describe('clock / numbers / teams', () => {
  it('parses clocks', () => {
    expect(clockToSeconds('88:23')).toBe(5303);
    expect(clockToSeconds('00:00:00')).toBe(0);
    expect(minutesFromClock('90:00')).toBe(90);
    expect(minutesFromClock('24:09')).toBe(24);
    expect(minutesFromClock(1624)).toBe(1624);
  });
  it('parses numbers and pairs', () => {
    expect(num('1,344')).toBe(1344);
    expect(num('-')).toBeNull();
    expect(pair('5-0')).toEqual([5, 0]);
    expect(record('(10-4-6)')).toEqual({ w: 10, l: 4, t: 6 });
  });
  it('team keys collapse variants', () => {
    expect(teamKey('Central Conn. St.')).toBe(teamKey('Central Connecticut State'));
    expect(teamKey('#6 Georgetown')).toBe('georgetown');
    expect(hostOf('https://www.goduke.com/')).toBe('goduke.com');
    expect(teamKey('Boston College')).not.toBe(teamKey('Boston U.'));
    expect(teamKey('North Carolina State University')).not.toBe(teamKey('North Carolina'));
    expect(teamKey('San Diego State')).not.toBe(teamKey('San Diego'));
    expect(teamKey('Pitt')).toBe('pitt');
  });
});

describe('robots', () => {
  it('honours star and specific groups', () => {
    const r = parseRobots('User-agent: *\nDisallow: /admin\nAllow: /admin/public\n\nUser-agent: PlaibookCollegeBot\nDisallow: /private', 'PlaibookCollegeBot/1.0 (+x)');
    expect(r.disallow).toEqual(['/private']);
    const star = parseRobots('User-agent: *\nDisallow: /admin', 'PlaibookCollegeBot/1.0');
    expect(star.disallow).toEqual(['/admin']);
  });
});
