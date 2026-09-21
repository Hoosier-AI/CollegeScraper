import { describe, it, expect } from 'vitest';
import { registerAllJobs } from '../../src/jobs/index.js';
import { jobNames } from '../../src/jobs/runner.js';
import { JOB_META } from '../../src/jobs/catalogue.js';
import { SCHEDULE } from '../../src/jobs/scheduler.js';

describe('job catalogue', () => {
  registerAllJobs();
  it('describes every registered job, with well-formed params', () => {
    for (const name of jobNames()) {
      const m = JOB_META[name];
      expect(m, `${name} has no catalogue entry`).toBeTruthy();
      expect(m!.description.length).toBeGreaterThan(10);
      for (const p of m!.params) { expect(p.name).toMatch(/^[a-z_]+$/); expect(p.label).toBeTruthy(); if (p.type === 'enum') expect(p.options?.length).toBeGreaterThan(0); }
    }
  });
  it('every scheduled entry is a registered job', () => {
    for (const e of SCHEDULE) expect(jobNames()).toContain(e.job);
  });
});
