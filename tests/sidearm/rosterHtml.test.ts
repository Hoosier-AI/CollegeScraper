import { describe, expect, it } from 'vitest';
import type { SiteContext } from '../../src/model.js';
import { parseRosterHtml } from '../../src/sources/sites/sidearm/rosterHtml.js';

const ctx: SiteContext = { host: 'example.edu', baseUrl: 'https://example.edu', gender: 'm', season: 2025, sportSlug: 'mens-soccer', sportId: null, teamSlug: null };

const LEGACY = `
<html><body>
<ul class="sidearm-roster-players">
  <li class="sidearm-roster-player" data-player-id="1234">
    <div class="sidearm-roster-player-image"><img data-src="/images/2024/8/1/Doe_John.jpg" src="/images/blank.png" alt="John Doe"></div>
    <div class="sidearm-roster-player-name">
      <span class="sidearm-roster-player-jersey-number">7</span>
      <h3><a href="/sports/mens-soccer/roster/john-doe/1234">John Doe</a></h3>
    </div>
    <div class="sidearm-roster-player-position">
      <span class="text-bold">M</span>
      <span class="sidearm-roster-player-height">5-10</span>
      <span class="sidearm-roster-player-weight">160 lbs</span>
    </div>
    <div class="sidearm-roster-player-class-hometown">
      <span class="sidearm-roster-player-academic-year">R-So.</span>
      <span class="sidearm-roster-player-hometown">Austin, Texas</span>
      <span class="sidearm-roster-player-highschool">Westlake</span>
      <span class="sidearm-roster-player-previous-school">UCLA</span>
    </div>
  </li>
  <li class="sidearm-roster-player">
    <div class="sidearm-roster-player-name"><span class="sidearm-roster-player-jersey-number">1</span><h3><a href="/sports/mens-soccer/roster/sam-keeper/99">Sam Keeper Jr.</a></h3></div>
    <div class="sidearm-roster-player-position"><span class="text-bold">GK</span><span class="sidearm-roster-player-height">6-3</span></div>
    <div class="sidearm-roster-player-class-hometown"><span class="sidearm-roster-player-academic-year">Fr.</span><span class="sidearm-roster-player-hometown">Reykjavik, Iceland</span></div>
  </li>
</ul>
<div class="sidearm-roster-coaches">
  <div class="sidearm-roster-coach"><div class="sidearm-roster-coach-name"><a href="/sports/mens-soccer/coaches/pat-boss/5">Pat Boss</a></div><div class="sidearm-roster-coach-title">Head Coach</div></div>
  <div class="sidearm-roster-coach"><div class="sidearm-roster-coach-name">Ann Aide</div><div class="sidearm-roster-coach-title">Assistant Head Coach</div></div>
</div>
</body></html>`;

const NEXTGEN = `
<html><body><div class="c-rosterpage"><div class="c-rosterpage__players"><ul>
  <li class="s-person-card s-person-card--vertical">
    <a href="/sports/mens-soccer/roster/jane-roe/555" class="s-person-card__link"><img src="https://cdn.example/roe.png" alt=""></a>
    <div class="s-person-details">
      <span class="s-stamp__text">10</span>
      <h3 class="s-person-details__personal-single-line"><a href="/sports/mens-soccer/roster/jane-roe/555">Jane Roe</a></h3>
      <ul class="s-person-details__bio-stats">
        <li class="s-person-details__bio-stats-item">GK</li>
        <li class="s-person-details__bio-stats-item">5-9</li>
        <li class="s-person-details__bio-stats-item">Sr.</li>
        <li class="s-person-details__bio-stats-item">Boise, Idaho</li>
        <li class="s-person-details__bio-stats-item">Boise High</li>
      </ul>
    </div>
  </li>
  <li class="s-person-card">
    <div class="s-person-details">
      <h3 class="s-person-details__personal-single-line">#4 Max Power</h3>
      <dl><dt>Position:</dt><dd>Defender</dd><dt>Height:</dt><dd>6-1</dd><dt>Weight:</dt><dd>180</dd><dt>Class:</dt><dd>Gr.</dd><dt>Hometown:</dt><dd>Leeds, England</dd><dt>Previous School:</dt><dd>Ohio State</dd></dl>
    </div>
  </li>
</ul></div></div></body></html>`;

describe('parseRosterHtml', () => {
  it('parses legacy sidearm-roster-player markup', () => {
    const r = parseRosterHtml(LEGACY, ctx, 'https://example.edu/sports/mens-soccer/roster');
    expect(r.players).toHaveLength(2);
    const [doe, keeper] = r.players;
    expect(doe).toMatchObject({
      sourceKey: '1234', sitePlayerId: '1234', firstName: 'John', lastName: 'Doe', jersey: 7, positionRaw: 'M', heightRaw: '5-10', weightLb: 160,
      classRaw: 'R-So.', hometownRaw: 'Austin, Texas', highSchool: 'Westlake', previousSchool: 'UCLA',
      headshotUrl: 'https://example.edu/images/2024/8/1/Doe_John.jpg', bioUrl: 'https://example.edu/sports/mens-soccer/roster/john-doe/1234',
    });
    expect(keeper).toMatchObject({ sourceKey: '99', firstName: 'Sam', lastName: 'Keeper', jersey: 1, positionRaw: 'GK', heightRaw: '6-3', weightLb: null, classRaw: 'Fr.', hometownRaw: 'Reykjavik, Iceland' });
    expect(r.coaches).toEqual([
      { name: 'Pat Boss', title: 'Head Coach', isHead: true, headshotUrl: null },
      { name: 'Ann Aide', title: 'Assistant Head Coach', isHead: false, headshotUrl: null },
    ]);
    expect(r.sourceUrl).toBe('https://example.edu/sports/mens-soccer/roster');
  });

  it('parses nextgen s-person-card markup (bio-stats items and dt/dd pairs)', () => {
    const r = parseRosterHtml(NEXTGEN, ctx, 'https://example.edu/sports/mens-soccer/roster/2025');
    expect(r.players).toHaveLength(2);
    const [roe, power] = r.players;
    expect(roe).toMatchObject({
      sourceKey: '555', sitePlayerId: '555', firstName: 'Jane', lastName: 'Roe', jersey: 10, positionRaw: 'GK', heightRaw: '5-9', classRaw: 'Sr.',
      hometownRaw: 'Boise, Idaho', highSchool: 'Boise High', headshotUrl: 'https://cdn.example/roe.png', bioUrl: 'https://example.edu/sports/mens-soccer/roster/jane-roe/555',
    });
    expect(power).toMatchObject({
      sourceKey: 'power|max|4', sitePlayerId: null, firstName: 'Max', lastName: 'Power', jersey: 4, positionRaw: 'Defender', heightRaw: '6-1', weightLb: 180,
      classRaw: 'Gr.', hometownRaw: 'Leeds, England', previousSchool: 'Ohio State', bioUrl: null,
    });
  });

  it('returns an empty roster for unrelated HTML', () => {
    const r = parseRosterHtml('<html><body><p>nothing here</p></body></html>', ctx, 'https://example.edu/x');
    expect(r.players).toEqual([]);
    expect(r.coaches).toEqual([]);
  });
});
