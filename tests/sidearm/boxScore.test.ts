import { describe, expect, it } from 'vitest';
import type { SiteContext } from '../../src/model.js';
import { durationMinutes, parseBoxScore, parsePlayText } from '../../src/sources/sites/sidearm/boxScore.js';
import { fixture } from '../helpers/fakeFetcher.js';

const ctx: SiteContext = { host: 'goduke.com', baseUrl: 'https://goduke.com', gender: 'm', season: 2025, sportSlug: 'mens-soccer', sportId: 10, teamSlug: null };
const URL = 'https://goduke.com/sports/mens-soccer/stats/2025/akron/boxscore/24759';

describe('parseBoxScore (Duke at Akron, 2025-11-30, NCAA Tournament)', () => {
  const bs = parseBoxScore(fixture('sidearm/duke-boxscore-24759.html'), URL, ctx);

  it('maps game metadata', () => {
    expect(bs.source).toBe('sidearm');
    expect(bs.sourceUrl).toBe(URL);
    expect(bs.date).toBe('2025-11-30');
    expect(bs.status).toBe('final');
    expect(bs.venueName).toBe('FirstEnergy Stadium');
    expect(bs.venueCity).toBe('Akron, Ohio');
    expect(bs.attendance).toBe(1344);
    expect(bs.officials).toHaveLength(4);
    expect(bs.officials[0]).toEqual({ title: 'Referee', name: 'Lucas Feathers' });
    expect(bs.neutral).toBe(false);
    expect(bs.conferenceGame).toBe(false);
    expect(bs.overtime).toBe(false);
    expect(bs.shootout).toBe(false);
    expect(bs.periods).toBe(2);
    expect(bs.durationMin).toBe(125); // venue.duration "02:05"
    expect(bs.ncaaContestId).toBeNull();
    // Sidearm's venue.start is a 12-hour clock without AM/PM ("04:00" for a 4 p.m. kickoff); passed through raw.
    expect(bs.startTimeLocal).toBe('04:00');
  });

  it('maps home Akron 2 – away Duke 0 with records, ids and totals', () => {
    expect(bs.home).toMatchObject({ name: 'Akron', sourceTeamId: 'AKRON', isHome: true, score: 2, record: '13-4-3, 5-2-1' });
    expect(bs.away).toMatchObject({ name: 'Duke', sourceTeamId: 'DUKE', isHome: false, score: 0, record: '10-4-6, 4-2-2' });
    expect(bs.home.totals).toMatchObject({ goals: 2, assists: 2, shots: 12, sog: 4, shotsOffTarget: 8, fouls: 13, corners: 5, offsides: 1, yellow: 0, red: 0, gkMinutes: 90, gkGoalsAllowed: 0, gkSaves: 0 });
    expect(bs.away.totals).toMatchObject({ goals: 0, shots: 10, sog: 0, fouls: 12, corners: 5, offsides: 3, saves: 2, yellow: 2, red: 0, gkMinutes: 90, gkGoalsAllowed: 2, gkSaves: 2 });
    expect(bs.home.totals.periodLines).toEqual([
      { period: 1, score: 1, shots: 9, saves: 0, fouls: 7, corners: 5, offsides: 1 },
      { period: 2, score: 1, shots: 3, saves: 0, fouls: 6, corners: 0, offsides: 0 },
    ]);
    expect(bs.away.totals.periodLines.map((l) => l.score)).toEqual([0, 0]);
  });

  it('keeps all 30 Duke rows; the 15 participants sum to exactly 990 minutes (11 x 90)', () => {
    expect(bs.away.players).toHaveLength(30);
    const played = bs.away.players.filter((p) => p.participated);
    expect(played).toHaveLength(15);
    expect(bs.away.players.filter((p) => !p.participated)).toHaveLength(15);
    expect(played.reduce((a, p) => a + (p.minutes ?? 0), 0)).toBe(990);
    expect(played.filter((p) => p.starter)).toHaveLength(11);
    const dymora = bs.away.players.find((p) => p.lastName === 'Dymora')!;
    expect(dymora).toMatchObject({ sourceKey: '23224', firstName: 'Eryk', jersey: 1, position: 'GK', isGoalie: true, starter: true, minutes: 90, gkMinutes: 90, goalsAllowed: 2, saves: 2 });
    const bench = bs.away.players.find((p) => !p.participated)!;
    expect(bench.minutes).toBe(0);
    expect(bench.starter).toBe(false);
  });

  it('keys Akron players without rosterPlayerId by last|first|uniform and maps GK Mitch Budler', () => {
    expect(bs.home.players).toHaveLength(30);
    const budler = bs.home.players.find((p) => p.lastName === 'Budler')!;
    expect(budler).toMatchObject({ sourceKey: 'budler|mitch|1', firstName: 'Mitch', jersey: 1, position: 'GK', isGoalie: true, participated: true, minutes: 90, gkMinutes: 90, goalsAllowed: 0, saves: 0 });
    const agunbiade = bs.home.players.find((p) => p.lastName === 'Agunbiade')!;
    expect(agunbiade).toMatchObject({ goals: 2, points: 4, shots: 4, sog: 3, shotsOffTarget: 1, firstGoals: 1 });
    expect(bs.home.players.filter((p) => p.participated).reduce((a, p) => a + (p.minutes ?? 0), 0)).toBe(990);
  });

  it('builds a rich event log from the plays (with names parsed from text)', () => {
    expect(bs.events.length).toBeGreaterThanOrEqual(80);
    expect(bs.events.map((e) => e.seq)).toEqual(bs.events.map((_, i) => i));
    const goals = bs.events.filter((e) => e.type === 'goal');
    expect(goals).toHaveLength(2);
    expect(goals[0]).toMatchObject({ period: 1, clock: '10:26', clockSeconds: 626, side: 'home', playerNameRaw: 'Remi Agunbiade', assistNameRaw: 'Tyler Morck', homeScore: 1, awayScore: 0 });
    expect(goals[1]).toMatchObject({ period: 2, clock: '51:13', side: 'home', playerNameRaw: 'Remi Agunbiade', assistNameRaw: 'Jack Roman', homeScore: 2, awayScore: 0 });
    const yellow = bs.events.filter((e) => e.type === 'yellow');
    expect(yellow).toHaveLength(2);
    expect(yellow[0]).toMatchObject({ period: 1, clock: '09:07', side: 'away', playerNameRaw: 'Jamie Kabussu' });
    expect(bs.events.find((e) => e.type === 'foul')).toMatchObject({ clock: '01:26', side: 'home', playerNameRaw: 'Freddy Kossehasse' });
    expect(bs.events.filter((e) => e.type === 'goalie_change').map((e) => e.playerNameRaw)).toEqual(['Mitch Budler', 'Eryk Dymora']);
    const subs = bs.events.filter((e) => e.type === 'sub_in' || e.type === 'sub_out');
    expect(subs[0]).toMatchObject({ type: 'sub_in', clock: '10:22', side: 'home', playerNameRaw: 'Ignacio Alem' });
    expect(subs[1]).toMatchObject({ type: 'sub_out', clock: '10:22', side: 'home', playerNameRaw: 'Stefan Dobrijevic' });
    expect(bs.events.filter((e) => e.type === 'shot')).toHaveLength(20);
    expect(bs.events.filter((e) => e.type === 'save').map((e) => [e.side, e.playerNameRaw])).toEqual([['away', 'Eryk Dymora'], ['away', 'Eryk Dymora']]);
    expect(bs.events.filter((e) => e.type === 'corner')).toHaveLength(10);
    expect(bs.events.filter((e) => e.type === 'offside')).toHaveLength(4);
    const last = bs.events[bs.events.length - 1]!;
    expect([last.homeScore, last.awayScore]).toEqual([2, 0]);
    expect(bs.events.every((e) => typeof e.text === 'string' && e.text.length > 0)).toBe(true);
  });

  it('falls back to scores[]/penalties[] when plays are missing', () => {
    const html = fixture('sidearm/duke-boxscore-24759.html').replace(/"plays":\d+/, '"plays":-1');
    const noPlays = parseBoxScore(html, URL, ctx);
    const types = noPlays.events.map((e) => e.type);
    expect(types.filter((t) => t === 'goal')).toHaveLength(2);
    expect(types.filter((t) => t === 'yellow')).toHaveLength(2);
    expect(noPlays.events[0]).toMatchObject({ type: 'yellow', clock: '09:07', playerNameRaw: 'Jamie Kabussu', side: 'away' });
    expect(noPlays.events[1]).toMatchObject({ type: 'goal', clock: '10:26', playerNameRaw: 'Remi Agunbiade', assistNameRaw: 'Tyler Morck', homeScore: 1 });
  });

  it('throws when the page has no embedded game', () => {
    expect(() => parseBoxScore('<html></html>', URL, ctx)).toThrow(/no embedded game/);
  });
});

describe('parsePlayText / durationMinutes', () => {
  const codes = ['DUKE', 'AKRON'];
  it('extracts names from the Sidearm/StatCrew text vocabulary', () => {
    expect(parsePlayText('shot', 'Shot by AKRON Agunbiade, Remi, bottom center, saved by Dymora, Eryk.', codes)).toMatchObject({ player: 'Agunbiade, Remi', saver: 'Dymora, Eryk' });
    expect(parsePlayText('shot', 'Shot by DUKE Bull Jorgensen, Nikolai.', codes).player).toBe('Bull Jorgensen, Nikolai');
    expect(parsePlayText('goal', 'GOAL by AKRON Agunbiade, Remi Assist by Morck, Tyler.', codes)).toMatchObject({ player: 'Agunbiade, Remi', assist: 'Morck, Tyler' });
    expect(parsePlayText('goal', 'GOAL by DUKE Hot, Kenan (Assist by Kerr, Drew and Arlotti, Alessandro).', codes)).toMatchObject({ player: 'Hot, Kenan', assist: 'Kerr, Drew', secondary: 'Arlotti, Alessandro' });
    expect(parsePlayText('foul', 'Foul on Kossehasse, Freddy.', codes).player).toBe('Kossehasse, Freddy');
    expect(parsePlayText('yellow', 'Yellow card on DUKE Kabussu, Jamie.', codes).player).toBe('Kabussu, Jamie');
    expect(parsePlayText('sub_in', 'DUKE substitution: Racaj, Aridon for Arlotti, Alessandro.', codes)).toMatchObject({ player: 'Racaj, Aridon', outPlayer: 'Arlotti, Alessandro' });
    expect(parsePlayText('sub_in', 'Sub in DUKE Hot, Kenan.', codes).player).toBe('Hot, Kenan');
    expect(parsePlayText('sub_out', 'Sub out DUKE Kerr, Drew.', codes).outPlayer).toBe('Kerr, Drew');
    expect(parsePlayText('goalie_change', 'Budler, Mitch at goalie for Akron', codes).player).toBe('Budler, Mitch');
    expect(parsePlayText('corner', 'Corner kick by DUKE Hot, Kenan [10:01].', codes).player).toBe('Hot, Kenan');
    expect(parsePlayText('corner', 'Corner kick [10:01].', codes).player).toBeNull();
    expect(parsePlayText('save', 'Save by AKRON Budler, Mitch.', codes).player).toBe('Budler, Mitch');
  });
  it('parses hh:mm durations', () => {
    expect(durationMinutes('02:05')).toBe(125);
    expect(durationMinutes('1:48')).toBe(108);
    expect(durationMinutes('125')).toBe(125);
    expect(durationMinutes(null)).toBeNull();
  });
});
