import { describe, it, expect } from 'vitest';
import { pickDetailCandidates } from '../../src/jobs/liveScoreboard.js';
import { fetchGameDocs, type NcaaGameTransport } from '../../src/sources/ncaa/graphql.js';

const now = Date.parse('2026-09-21T23:00:00Z');
const g = (id: string, status: string, agoMin: number | null) => ({ id, status, live_stats_at: agoMin == null ? null : new Date(now - agoMin * 60_000).toISOString() });

describe('pickDetailCandidates', () => {
  it('takes live games only, never-fetched first, then the stalest, skipping fresh ones, within the budget', () => {
    const picked = pickDetailCandidates([g('fresh', 'live', 1), g('old', 'live', 5), g('never', 'live', null), g('sched', 'scheduled', null), g('older', 'live', 9)], now, { everyMs: 2 * 60_000, budget: 2 });
    expect(picked.map((x) => x.id)).toEqual(['never', 'older']);
  });
  it('a zero budget picks nothing', () => {
    expect(pickDetailCandidates([g('a', 'live', null)], now, { everyMs: 1, budget: 0 })).toEqual([]);
  });
});

describe('fetchGameDocs docs subset', () => {
  it('asks the transport only for the listed documents', async () => {
    const calls: string[] = [];
    const t = (name: string) => async () => { calls.push(name); return { doc: name }; };
    const transport = { boxscore: t('boxscore'), playByPlay: t('pbp'), scoringSummary: t('scoring'), teamStats: t('teamStats'), gamecenter: t('gamecenter') } as unknown as NcaaGameTransport;
    const docs = await fetchGameDocs(transport, '1', { docs: ['boxscore', 'pbp'] });
    expect(calls.sort()).toEqual(['boxscore', 'pbp']);
    expect(docs.scoring).toBeNull(); expect(docs.teamStats).toBeNull(); expect(docs.gamecenter).toBeNull();
    expect(docs.boxscore).toEqual({ doc: 'boxscore' });
  });
});
