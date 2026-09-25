// Pure head/body/template rendering for the server-rendered public pages.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { conferenceHead, matchHead, notFoundHead, playerHead, renderHead, teamHead } from '../src/seo/head.js';
import { matchBody, playerBody, teamBody, ctaHref } from '../src/seo/body.js';
import { injectPage, plainShell } from '../src/seo/template.js';
import { classLabel, clip, parseSeason } from '../src/seo/util.js';
import { conferenceFixture, CURRENT, matchFixture, playerFixture, teamFixture } from './helpers/seoFixtures.js';

const ctx = { baseUrl: 'https://plaibook-college-scraper.onrender.com/', currentSeason: CURRENT };
const ldOf = (h: { jsonLd: Record<string, unknown>[] }, type: string) => h.jsonLd.find((j) => j['@type'] === type) as any;

describe('teamHead', () => {
  it('builds title, description and an absolute canonical without the current season', () => {
    const h = teamHead(teamFixture(), ctx);
    expect(h.title).toBe("Duke Men's Soccer 2026: Roster, Schedule and Stats | Plaibook Stats");
    expect(h.canonical).toBe('https://plaibook-college-scraper.onrender.com/teams/duke/men');
    expect(h.description).toContain('8-2-1 overall (3-1-0 ACC)');
    expect(h.description).toContain('head coach Kevin Coach');
    expect(h.description.length).toBeLessThanOrEqual(160);
    expect(h.robots).toBeNull();
  });
  it('keeps season in the canonical only when it is not the current one', () => {
    expect(teamHead(teamFixture({ season: 2025 }), ctx).canonical).toBe('https://plaibook-college-scraper.onrender.com/teams/duke/men?season=2025');
  });
  it('emits SportsTeam with sport, conference and coach, plus breadcrumbs', () => {
    const h = teamHead(teamFixture(), ctx);
    const team = ldOf(h, 'SportsTeam');
    expect(team.sport).toBe('Soccer');
    expect(team.gender).toBe('Male');
    expect(team.memberOf).toMatchObject({ '@type': 'SportsOrganization', name: 'Atlantic Coast Conference', url: 'https://plaibook-college-scraper.onrender.com/conferences/acc' });
    expect(team.coach).toEqual({ '@type': 'Person', name: 'Kevin Coach' });
    expect(team.athlete[0]).toMatchObject({ '@type': 'Person', url: 'https://plaibook-college-scraper.onrender.com/players/jane-doe-222222' });
    const bc = ldOf(h, 'BreadcrumbList');
    expect(bc.itemListElement.map((i: any) => i.name)).toEqual(['Plaibook Stats', 'Teams', "Duke Men's Soccer"]);
  });
  it('noindexes programs that are not NCAA members that season', () => {
    expect(teamHead(teamFixture({ member: false }), ctx).robots).toBe('noindex,follow');
  });
});

describe('playerHead', () => {
  it('emits Person with the team affiliation', () => {
    const h = playerHead(playerFixture(), ctx);
    expect(h.title).toBe("Jane Doe - Duke Men's Soccer Stats | Plaibook Stats");
    expect(h.canonical).toBe('https://plaibook-college-scraper.onrender.com/players/jane-doe-222222');
    expect(h.description).toContain('2026: 6 goals, 3 assists in 11 games');
    const p = ldOf(h, 'Person');
    expect(p.affiliation).toMatchObject({ '@type': 'SportsTeam', sport: 'Soccer', url: 'https://plaibook-college-scraper.onrender.com/teams/duke/men' });
    expect(h.robots).toBeNull();
  });
  it('noindexes players without appearances and players who asked', () => {
    const none = playerFixture();
    none.seasons = none.seasons.map((s) => ({ ...s, gp: 0 }));
    expect(playerHead(none, ctx).robots).toBe('noindex,follow');
    expect(playerHead(playerFixture({ noindex: true }), ctx).robots).toBe('noindex,follow');
  });
});

describe('matchHead', () => {
  it('describes a final with SportsEvent competitors, start and location', () => {
    const h = matchHead(matchFixture(), ctx);
    expect(h.title).toBe("Wake Forest 1-2 Duke, Sep 12, 2026: Men's Soccer Box Score | Plaibook Stats");
    expect(h.description).toContain('Goals: Jane Doe 12′');
    const e = ldOf(h, 'SportsEvent');
    expect(e.sport).toBe('Soccer');
    expect(e.startDate).toBe(new Date(1789254000 * 1000).toISOString().replace('.000Z', 'Z'));
    expect(e.competitor).toHaveLength(2);
    expect(e.homeTeam.name).toBe("Duke Men's Soccer");
    expect(e.location).toEqual({ '@type': 'Place', name: 'Koskinen Stadium', address: 'Durham, N.C.' });
    expect(e.description).toBe('Final: Wake Forest 1, Duke 2');
  });
  it('uses the date alone when kickoff is not published, and a preview title before the match', () => {
    const h = matchHead(matchFixture({ status: 'scheduled', kickoff_tbd: true, home: { ...matchFixture().home, score: null }, away: { ...matchFixture().away, score: null } }), ctx);
    expect(ldOf(h, 'SportsEvent').startDate).toBe('2026-09-12');
    expect(h.title).toContain('Wake Forest at Duke, Sep 12, 2026');
    expect(h.title).toContain('Preview');
  });
});

describe('renderHead and body', () => {
  it('escapes text and keeps JSON-LD inert', () => {
    const t = teamFixture({ name: 'A&M "Aggies" </script>' });
    const html = renderHead(teamHead(t, ctx));
    expect(html).toContain('<title>A&amp;M &quot;Aggies&quot; &lt;/script&gt;');
    expect(html).not.toMatch(/<\/script>.*<\/script>.*Aggies/);
    const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) ?? [];
    expect(ld.length).toBe(2);
    for (const block of ld) expect(block.slice(35, -9)).not.toContain('</');
  });
  it('team body: facts, roster links, results and the Tekki link', () => {
    const b = teamBody(teamFixture(), ctx);
    expect(b.startsWith('<section id="ssr">')).toBe(true);
    expect(b).toContain('<h1>Duke Men&#39;s Soccer 2026</h1>');
    expect(b).toContain('<a href="/players/jane-doe-222222">Jane &lt;Doe&gt;</a>');
    expect(b).toContain('<a href="/matches/2026-09-12-wake-forest-at-duke-men">W 2-1</a>');
    expect(b).toContain('<a href="/conferences/acc">Atlantic Coast Conference</a>');
    expect(b).toContain('<a href="/teams/duke/men?season=2025">2025</a>');
    expect(b).toContain(`href="${ctaHref('team').replace(/&/g, '&amp;')}"`);
    expect(ctaHref('team')).toBe('https://www.plaibook.soccer/?utm_source=stats&utm_medium=referral&utm_campaign=team');
    expect(b).not.toMatch(/football/i);
  });
  it('player and match bodies link back to teams and players', () => {
    expect(playerBody(playerFixture())).toContain('<a href="/teams/duke/men">Duke Men&#39;s Soccer</a>');
    const m = matchBody(matchFixture(), ctx);
    expect(m).toContain('<h1>Wake Forest 1, Duke 2</h1>');
    expect(m).toContain('12′ Goal (Duke): Jane Doe');
    expect(m).toContain('<a href="/players/jane-doe-222222">Jane Doe</a>');
  });
  it('conference head names the leaders', () => {
    const h = conferenceHead(conferenceFixture(), ctx);
    expect(h.canonical).toBe('https://plaibook-college-scraper.onrender.com/conferences/acc');
    expect(h.description).toContain("Wake Forest lead the men's table");
  });
  it('not-found head has no canonical and is noindex', () => {
    const h = notFoundHead(ctx);
    expect(h.canonical).toBeNull();
    expect(h.robots).toBe('noindex');
  });
});

describe('template', () => {
  const shell = readFileSync(new URL('../ui/index.html', import.meta.url), 'utf8');
  it('ui/index.html carries both markers and an absolute og:image', () => {
    expect(shell).toContain('<!--ssr-head-->');
    expect(shell).toContain('<!--ssr-body-->');
    expect(shell).toContain('<meta property="og:image" content="https://plaibook-college-scraper.onrender.com/brand/og.png" />');
  });
  it('replaces the generic tags so each appears once, and puts #ssr after #root', () => {
    const html = injectPage(shell, renderHead(teamHead(teamFixture(), ctx)), teamBody(teamFixture(), ctx));
    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(html.match(/name="description"/g)).toHaveLength(1);
    expect(html.match(/property="og:title"/g)).toHaveLength(1);
    expect(html.match(/property="og:image"/g)).toHaveLength(1);
    expect(html).toContain('<meta property="og:site_name" content="Plaibook Stats" />');
    expect(html.indexOf('<div id="root"></div>')).toBeLessThan(html.indexOf('<section id="ssr">'));
    expect(plainShell(shell)).not.toContain('<!--ssr-');
  });
});

describe('util', () => {
  it('parses seasons strictly, clips at a word boundary, labels classes', () => {
    expect(parseSeason('2025')).toBe(2025);
    expect(parseSeason('20x5')).toBeNull();
    expect(parseSeason(undefined)).toBeNull();
    expect(clip('word '.repeat(60), 40).length).toBeLessThanOrEqual(40);
    expect(classLabel(null, 3, true)).toBe('R-Jr.');
    expect(classLabel('Gr.', null)).toBe('Gr.');
  });
});
