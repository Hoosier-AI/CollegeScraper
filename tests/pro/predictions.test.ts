import { describe, it, expect } from 'vitest';
import { predictionDue } from '../../src/jobs/pro/predictions.js';

const H = 3600_000, now = Date.parse('2026-11-27T12:00:00Z');
const at = (h: number) => new Date(now + h * H).toISOString();

describe('when a match prediction is read', () => {
  it('reads a match that has none', () => {
    expect(predictionDue(at(60), null, now)).toBe(true);
    expect(predictionDue(at(2), undefined, now)).toBe(true);
  });
  it('leaves a match more than a day away alone once it has one, however old', () => {
    expect(predictionDue(at(60), at(-13), now)).toBe(false);
    expect(predictionDue(at(25), at(-40), now)).toBe(false);
  });
  it('reads again in the last day before kickoff, once the copy is 12 hours old', () => {
    expect(predictionDue(at(20), at(-13), now)).toBe(true);
    expect(predictionDue(at(20), at(-11), now)).toBe(false);
  });
});
