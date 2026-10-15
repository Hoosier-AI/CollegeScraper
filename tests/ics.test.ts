import { describe, expect, it } from 'vitest';
import { icsCalendar } from '../src/calendar/ics.js';

describe('ics', () => {
  it('writes timed and all-day events, escaped and folded', () => {
    const s = icsCalendar('Indiana, men', [
      { uid: 'a@plaibook.live', start: new Date('2026-10-17T23:00:00Z'), date: '2026-10-17', summary: 'Butler at Indiana', location: 'Bloomington, IN', description: 'On B1G+; more, later', url: 'https://www.plaibook.live/matches/a' },
      { uid: 'b@plaibook.live', start: null, date: '2026-10-21', summary: 'Indiana at Ohio St. ' + 'x'.repeat(80) },
    ], new Date('2026-10-15T00:00:00Z'));
    expect(s.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(s).toContain('DTSTART:20261017T230000Z');
    expect(s).toContain('DTEND:20261018T010000Z');
    expect(s).toContain(String.raw`DESCRIPTION:On B1G+\; more\, later`);
    expect(s).toContain('DTSTART;VALUE=DATE:20261021');
    expect(s).toContain('DTEND;VALUE=DATE:20261022');
    expect(s.split('\r\n').every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
    expect(s.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
  });
});
