import { describe, it, expect, vi } from 'vitest';

// verify-membership has no conference data: a team on the leaderboard that the season copy missed must keep the
// conference it has (2026: 169 NCAA teams lost theirs when this job wrote back `copy?.conference_id ?? null`).
const written: Record<string, unknown>[] = [];
vi.mock('../../src/jobs/fetcher.js', () => ({ makeFetcher: () => ({ get: async (url: string) => ({ text: url }) }) }));
vi.mock('../../src/sources/ncaa/index.js', () => ({
  sportPath: () => 'soccer-women',
  statUrl: () => 'table',
  parseStatCategories: () => ({ team: [{ id: 1, name: 'Won-Lost-Tied Percentage' }] }),
  parseStatTable: () => ({ pages: 1, rows: [{ teamSeo: 'illinois', Team: 'Illinois', Won: '8', Loss: '4', Tied: '3' }, { teamSeo: 'michigan', Team: 'Michigan', Won: '9', Loss: '3', Tied: '2' }] }),
}));
vi.mock('../../src/db/repos.js', () => ({
  listSchools: async () => [{ seo: 'illinois' }, { seo: 'michigan' }, { seo: 'iowa' }],
  listPrograms: async () => [
    { id: 'ill', school_seo: 'illinois', gender: 'w' }, { id: 'mich', school_seo: 'michigan', gender: 'w' }, { id: 'iowa', school_seo: 'iowa', gender: 'w' },
  ],
  // Illinois is missing from the copy (as the unordered reads dropped rows); Iowa is in it but not on the leaderboard.
  listProgramSeasons: async () => [
    { program_id: 'mich', season: 2026, division: 'd1', conference_id: 'big-ten' },
    { program_id: 'iowa', season: 2026, division: 'd1', conference_id: 'big-ten' },
  ],
  upsertProgram: async () => { throw new Error('not expected'); },
  upsertSchools: async () => 0,
  upsertProgramSeasons: async (_db: unknown, rows: Record<string, unknown>[]) => { written.push(...rows); return rows.length; },
}));

describe('verify-membership', () => {
  it('never writes a conference, so a team the season copy missed keeps its own', async () => {
    const { verifyMembership } = await import('../../src/jobs/verifyMembership.js');
    const ctx: any = { db: {}, params: { season: 2026, gender: 'w', division: 'd1' }, inc: () => {}, note: () => {}, heartbeat: async () => {}, cancelled: async () => false };
    await verifyMembership(ctx);
    expect(written.map((r) => r.program_id).sort()).toEqual(['ill', 'iowa', 'mich']);
    expect(written.every((r) => !('conference_id' in r))).toBe(true);
    expect(written.find((r) => r.program_id === 'ill')).toMatchObject({ ncaa_member: true, member_source: 'leaderboard', official_w: 8 });
    expect(written.find((r) => r.program_id === 'iowa')).toMatchObject({ ncaa_member: true, member_source: 'conference' });
  });
});
