import { describe, expect, it } from 'vitest';
import type { SiteContext } from '../../src/model.js';
import { parseScheduleBoxScoreLinks, parseScheduleHtml } from '../../src/sources/sites/sidearm/scheduleHtml.js';
import { fixture } from '../helpers/fakeFetcher.js';

const ctx: SiteContext = { host: 'goduke.com', baseUrl: 'https://goduke.com', gender: 'm', season: 2025, sportSlug: 'mens-soccer', sportId: 10, teamSlug: null };
const html = fixture('sidearm/duke-schedule-2025.html');

describe('parseScheduleBoxScoreLinks', () => {
  it('maps every game id to its pretty box score URL', () => {
    const links = parseScheduleBoxScoreLinks(html, 'https://goduke.com');
    expect(links.size).toBe(20); // 23 games minus 3 exhibitions without box scores
    expect(links.get('24759')).toBe('https://goduke.com/sports/mens-soccer/stats/2025/akron/boxscore/24759');
    expect(links.get('24562')).toBe('https://goduke.com/sports/mens-soccer/stats/2025/california/boxscore/24562');
    expect(links.get('24388')).toBeUndefined();
  });

  it('prefers pretty links over boxscore.aspx links for the same id', () => {
    const mixed = '<a href="/boxscore.aspx?id=1">a</a><a href="/sports/mens-soccer/stats/2025/x/boxscore/1">b</a><a href="/boxscore.aspx?path=msoc&amp;id=2">c</a>';
    const links = parseScheduleBoxScoreLinks(mixed, 'https://x.edu/');
    expect(links.get('1')).toBe('https://x.edu/sports/mens-soccer/stats/2025/x/boxscore/1');
    expect(links.get('2')).toBe('https://x.edu/boxscore.aspx?path=msoc&id=2');
  });
});

describe('parseScheduleHtml (nextgen s-game-card fallback)', () => {
  const entries = parseScheduleHtml(html, ctx);

  it('parses all 23 game cards in order with dates rolled onto the season year', () => {
    expect(entries).toHaveLength(23);
    expect(entries[0]!.date).toBe('2025-08-08');
    expect(entries[22]!.date).toBe('2025-11-30');
  });

  it('parses the Akron NCAA Tournament away loss', () => {
    const akron = entries.find((e) => e.siteGameId === '24759')!;
    expect(akron).toMatchObject({
      date: '2025-11-30', startTimeLocal: '16:00', opponentName: 'Akron', opponentSiteId: '531', homeAway: 'A', location: 'Akron, OH',
      isConference: false, isExhibition: false, tournament: 'NCAA Tournament', state: 'final',
      result: { status: 'L', teamScore: 0, opponentScore: 2 }, boxScoreUrl: 'https://goduke.com/sports/mens-soccer/stats/2025/akron/boxscore/24759', attendance: null,
    });
  });

  it('classifies exhibitions, conference badges and tournaments', () => {
    expect(entries.filter((e) => e.isExhibition).map((e) => e.opponentName)).toEqual(['Coastal Carolina', 'UNC Asheville', 'James Madison']);
    expect(entries.filter((e) => e.isConference)).toHaveLength(8);
    expect(entries.find((e) => e.date === '2025-11-05')).toMatchObject({ opponentName: 'California', homeAway: 'H', tournament: 'ACC Championship', result: { status: 'L', teamScore: 0, opponentScore: 2 } });
    expect(entries.find((e) => e.date === '2025-08-21')).toMatchObject({ opponentName: 'San Diego', homeAway: 'H', startTimeLocal: '20:00', result: { status: 'W', teamScore: 2, opponentScore: 1 } });
  });

  it('parses legacy sidearm-schedule-game markup', () => {
    const legacy = `
      <div class="sidearm-schedule-game sidearm-schedule-game-away">
        <div class="sidearm-schedule-game-opponent-date"><span>Sep 5 (Fri)</span><span>7:30 PM</span></div>
        <div class="sidearm-schedule-game-opponent-name"><a href="http://x">Georgetown</a></div>
        <div class="sidearm-schedule-game-location"><span>Washington, DC</span></div>
        <div class="sidearm-schedule-game-result"><span>T,</span><span>2-2</span></div>
        <div class="sidearm-schedule-game-links"><a href="/boxscore.aspx?id=24394">Box Score</a></div>
      </div>
      <div class="sidearm-schedule-game sidearm-schedule-game-conference">
        <div class="sidearm-schedule-game-opponent-date"><span>Jan 12 (Sun)</span><span>TBA</span></div>
        <div class="sidearm-schedule-game-opponent-name">Syracuse</div>
        <div class="sidearm-schedule-game-result"><span>Postponed</span></div>
      </div>`;
    const out = parseScheduleHtml(legacy, ctx);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ date: '2025-09-05', startTimeLocal: '19:30', opponentName: 'Georgetown', homeAway: 'A', location: 'Washington, DC', state: 'final', result: { status: 'T', teamScore: 2, opponentScore: 2 }, boxScoreUrl: 'https://goduke.com/boxscore.aspx?id=24394', siteGameId: '24394' });
    expect(out[1]).toMatchObject({ date: '2026-01-12', startTimeLocal: null, opponentName: 'Syracuse', homeAway: 'H', isConference: true, state: 'postponed', result: null });
  });
});

describe('legacy template side markers', () => {
  const hp: SiteContext = { host: 'highpointpanthers.com', baseUrl: 'https://highpointpanthers.com', gender: 'm', season: 2026, sportSlug: 'mens-soccer', sportId: null, teamSlug: null };
  const entries = parseScheduleHtml(fixture('sidearm/highpoint-schedule-2026-legacy.html'), hp);
  it('reads <span class="sidearm-schedule-game-away">at</span> as an away game', () => {
    const uva = entries.find((e) => e.opponentName === 'Virginia' && e.date === '2026-08-24');
    expect(uva?.homeAway).toBe('A');
  });
  it('keeps home and away games apart on the same page', () => {
    const sides = new Set(entries.map((e) => e.homeAway));
    expect(sides.has('H')).toBe(true);
    expect(sides.has('A')).toBe(true);
  });
});
