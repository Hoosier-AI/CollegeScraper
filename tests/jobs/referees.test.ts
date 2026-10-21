import { describe, it, expect } from 'vitest';
import { refereeProblem } from '../../src/jobs/referees.js';

const now = Date.parse('2026-10-22T11:10:00Z');
const ok = (start: string) => ({ status: 'succeeded', start_time: start, end_time: start, message: '1 row' });

describe('refereeProblem', () => {
  it('is fine when both rebuilt today', () => {
    expect(refereeProblem({ 'pro-referees': ok('2026-10-22T10:40:00Z'), 'college-referees': ok('2026-10-22T10:55:00Z') }, now)).toBeNull();
  });
  it('names a failed rebuild with its message', () => {
    const p = refereeProblem({ 'pro-referees': ok('2026-10-22T10:40:00Z'), 'college-referees': { status: 'failed', start_time: '2026-10-22T10:55:00Z', end_time: null, message: 'canceling statement' } }, now);
    expect(p).toBe('college-referees: canceling statement');
  });
  it('flags a missing or overdue rebuild', () => {
    expect(refereeProblem({ 'pro-referees': ok('2026-10-20T10:40:00Z') }, now)).toMatch(/pro-referees: last run.*college-referees: no run on record/);
  });
});
