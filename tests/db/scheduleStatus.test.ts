import { describe, it, expect } from 'vitest';
import { isOthersFixture, scheduleStatusPatch } from '../../src/db/repos.js';

describe('scheduleStatusPatch', () => {
  const g = (status: string, score: number | null = null) => ({ status, home_score: score, away_score: score });
  it('a school that has not posted the result never undoes a final, live or postponed game', () => {
    expect(scheduleStatusPatch(g('final', 1), 'scheduled', false)).toBeNull();
    expect(scheduleStatusPatch(g('live', 1), 'scheduled', false)).toBeNull();
    expect(scheduleStatusPatch(g('postponed'), 'scheduled', false)).toBeNull();
  });
  it('a result or a real state change still lands', () => {
    expect(scheduleStatusPatch(g('scheduled'), 'final', true)).toBe('final');
    expect(scheduleStatusPatch(g('scheduled'), 'postponed', false)).toBe('postponed');
    expect(scheduleStatusPatch(g('scheduled'), 'cancelled', false)).toBe('cancelled');
  });
  it('postponed or cancelled never overrides a game that has a score', () => {
    expect(scheduleStatusPatch(g('scheduled', 1), 'postponed', false)).toBeNull();
    expect(scheduleStatusPatch(g('scheduled'), 'cancelled', true)).toBeNull();
  });
  it('a final is never changed', () => {
    expect(scheduleStatusPatch(g('final', 2), 'cancelled', false)).toBeNull();
  });
});

describe('isOthersFixture', () => {
  it('spots two other teams copied from a tournament page', () => {
    expect(isOthersFixture('Stanislaus State vs. Concordia University Irvine')).toBe(true);
    expect(isOthersFixture('Fort Hays State Vs. William Jewell')).toBe(true);
    expect(isOthersFixture('Emory vs McMurry')).toBe(true);
    expect(isOthersFixture('Green vs Black')).toBe(true);
  });
  it('leaves real opponents alone', () => {
    expect(isOthersFixture('Duke')).toBe(false);
    expect(isOthersFixture('vs. Duke')).toBe(false);
    expect(isOthersFixture('Nevada-Las Vegas')).toBe(false);
    expect(isOthersFixture('Vassar')).toBe(false);
  });
});
