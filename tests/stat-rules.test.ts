// The pure rules behind the 2026-10-14 accuracy work: how the daily stat audit scores agreement, the leaders' minimum
// samples, the follows query, and the share cards' choices (which numbers, which image bytes).
import { describe, expect, it } from 'vitest';
import { agreeWithin, summarize } from '../src/jobs/statAudit.js';
import { PLAYER_MIN_SAMPLE, PLAYER_STATS } from '../src/ui/queries.js';
import { parseFollows } from '../src/ui/follows.js';
import { collegePlayerCard, limiter, proMatchCard, proPlayerCard, sniff } from '../src/seo/og.js';
import { conferencesBody, proCoachHead } from '../src/seo/extra.js';

const ctx = { baseUrl: 'https://stats.example', currentSeason: 2026 };

describe('stat audit', () => {
  it('counts must match exactly, rates within a small tolerance, keeper minutes within 5', () => {
    expect(agreeWithin('Total Goals')).toBe(0.5);
    expect(agreeWithin('Goals Against Average')).toBeCloseTo(0.011);
    expect(agreeWithin('Save Pct')).toBeCloseTo(0.0015);
    expect(agreeWithin('Goalie Minutes Played')).toBe(5.5);
    expect(agreeWithin('Corner Kicks Per Game')).toBeCloseTo(0.011);
  });
  it('a missing value of ours is a disagreement, and the worst differences come first', () => {
    const r = summarize([{ ours: 5, theirs: 5, who: 'a' }, { ours: 3, theirs: 5, who: 'b' }, { ours: null, theirs: 9, who: 'c' }, { ours: 4, theirs: 5, who: 'd' }], 0.5);
    expect(r).toMatchObject({ compared: 4, agree: 1, rate: 0.25 });
    expect(r.worst.map((w) => w.who)).toEqual(['c', 'b', 'd']);
  });
  it('an empty comparison rates 0, not NaN', () => {
    expect(summarize([], 0.5)).toMatchObject({ compared: 0, agree: 0, rate: 0 });
  });
});

describe('leaders minimum samples', () => {
  it('every rate stat with a minimum is a real leaders stat', () => {
    for (const k of Object.keys(PLAYER_MIN_SAMPLE)) expect(PLAYER_STATS).toContain(k);
  });
  it('keeper rates need 450 minutes in goal, per-90s 450 minutes, PPG and PPS five games', () => {
    expect(PLAYER_MIN_SAMPLE.gaa).toMatchObject({ col: 'gk_minutes', n: 450 });
    expect(PLAYER_MIN_SAMPLE.save_pct).toMatchObject({ col: 'gk_minutes', n: 450 });
    expect(PLAYER_MIN_SAMPLE.goals_p90).toMatchObject({ col: 'minutes', n: 450 });
    expect(PLAYER_MIN_SAMPLE.ppg).toMatchObject({ col: 'res_apps', n: 5 });
    expect(PLAYER_MIN_SAMPLE.pps).toMatchObject({ col: 'pps_starts', n: 5 });
  });
});

describe('follows query', () => {
  const uuid = '83f3dee0-45d6-4006-9a89-6ea1e17aa10c';
  it('keeps valid refs and drops unknown kinds and malformed ids', () => {
    expect(parseFollows(`team:${uuid},player:nope,pro-team:18310,pro-player:-42,club:1,pro-team:abc`)).toEqual([
      { kind: 'team', id: uuid }, { kind: 'pro-team', id: '18310' }, { kind: 'pro-player', id: '-42' },
    ]);
  });
  it('reads at most 40', () => {
    expect(parseFollows(Array.from({ length: 60 }, (_, i) => `pro-team:${i + 1}`).join(','))).toHaveLength(40);
  });
  it('nothing for an empty or missing value', () => {
    expect(parseFollows(undefined)).toEqual([]);
    expect(parseFollows('')).toEqual([]);
  });
});

describe('share cards', () => {
  it('reads the bytes, not the headers', () => {
    expect(sniff(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/png');
    expect(sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniff(Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe('image/svg+xml');
    expect(sniff(Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8X'))).toBeNull();
    expect(sniff(Buffer.from('<html><body>moved</body></html>'))).toBeNull();
  });

  const season = (o: Record<string, unknown>) => ({ season: 2026, team: { name: 'Duke', school_seo: 'duke', gender: 'm' as const }, jersey: 1, position: 'F', class_label: 'Jr.', gp: 12, gs: 12, minutes: 900, goals: 7, assists: 3, points: 17, shots: 30, sog: 15, saves: null, ga: null, gaa: null, save_pct: null, shutouts: null, ...o });
  it('a college keeper card shows saves, GAA and shutouts; anyone else goals and assists', () => {
    const base = { id: 'x', slug: 'x', name: 'A Player', noindex: false, headshot_url: null, hometown: null, high_school: null, honors: [], updated_at: null };
    const gk = collegePlayerCard({ ...base, seasons: [season({ position: 'GK', saves: 50, gaa: 0.91, shutouts: 6 })] }, null);
    const fw = collegePlayerCard({ ...base, seasons: [season({})] }, null);
    expect(gk.kind === 'subject' && gk.stats.map((s) => s.label)).toEqual(['Games', 'Saves', 'GAA', 'Shutouts']);
    expect(fw.kind === 'subject' && fw.stats.map((s) => `${s.label} ${s.value}`)).toEqual(['Games 12', 'Goals 7', 'Assists 3', 'Minutes 900']);
  });

  it("a pro player card shows the club's league line, not every competition added up", () => {
    const team = { id: 9, name: 'Inter Miami', slug: 'inter-miami', logo: null };
    const row = (league: string, teamId: number, apps: number, goals: number, source = 'provider') => ({ season: 2026, league: { name: league }, team: { ...team, id: teamId }, source, apps, goals, assists: 1, minutes: apps * 80, rating: 7.5 });
    const p: any = { player: { name: 'L M', position: 'Attacker', nationality: 'Argentina', photo: null }, team,
      seasons: [row('Leagues Cup', 9, 2, 2), row('World Cup', 26, 8, 8), row('Major League Soccer', 9, 25, 23, 'computed'), row('Major League Soccer', 9, 25, 23)] };
    const c = proPlayerCard(p, null);
    expect(c.kind === 'subject' && c.context).toBe('Leagues Cup, 2026');
    expect(c.kind === 'subject' && c.stats.find((s) => s.label === 'Apps')?.value).toBe('2');
  });

  it('a pro shootout shows the kicks beside the score, never in it', () => {
    const m: any = { match: { status: 'final', status_short: 'PEN', elapsed: 120, kickoff: '2025-10-26T20:00:00Z', round: 'Round of 16', venue: null, league: { name: 'MLS' },
      home: { name: 'A', logo: null, score: 2 }, away: { name: 'B', logo: null, score: 2 }, pen: [4, 2] } };
    const c = proMatchCard(m, [null, null]);
    expect(c.kind === 'match' && [c.home.score, c.away.score, c.status]).toEqual([2, 2, 'Full time, 4-2 pens']);
  });

  it('draws at most n at once', async () => {
    const run = limiter(2); let active = 0, peak = 0;
    const job = () => run(async () => { active += 1; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 5)); active -= 1; });
    await Promise.all(Array.from({ length: 6 }, job));
    expect(peak).toBe(2);
  });
});

describe('new search-engine pages', () => {
  it('a conference with no men lists only its women', () => {
    const html = conferencesBody({ season: 2026, conferences: [{ name: 'Big 12', ncaa_seo: 'big-12', division: 'd1', members: { m: 0, w: 16 }, table: { w: { top: [{ name: 'Texas Tech' }] } } }] } as any, ctx);
    expect(html).toContain('16 women&#39;s teams');
    expect(html).not.toMatch(/0 men/);
  });
  it('a coach without trophies does not say "0 trophies"', () => {
    const h = proCoachHead({ coach: { name: 'D. Smith' }, career: [{ team: { name: 'Charlotte', slug: 'charlotte' }, start: '2024-02-01', end: null, current: true }], trophies: [] } as any, 14, ctx);
    expect(h.description).toContain('in charge of Charlotte');
    expect(h.description).not.toMatch(/0 trophies/);
  });
});
