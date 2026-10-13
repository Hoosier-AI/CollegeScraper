import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { classify } from '../../src/news/classify.js';
import { clusterFor, overlap, titleTokens } from '../../src/news/cluster.js';
import { EntityIndex, personCandidates, resolvePeople, type PersonHit } from '../../src/news/entities.js';
import { classicSidearmFeed, isSoccerItem, LEAGUE_RUN, LEAGUE_RUN_PAGE, PUBLISHER_FEEDS, schoolFeedUrl } from '../../src/news/feeds.js';
import { genderOf, prepare, urlHash, type NewsSource } from '../../src/news/ingest.js';
import { cleanUrl, feedLinks, parseFeed, parseGdelt, parseGuardian, plainText } from '../../src/news/rss.js';

const fx = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');

describe('feeds', () => {
  it('reads a Sidearm school feed: headline, link, time, lede, sport', () => {
    const items = parseFeed(fx('sidearm-indiana-msoc.xml'));
    expect(items.length).toBeGreaterThan(5);
    const first = items[0]!;
    expect(first.title).toBe('Oduro Leads Senior Night Scoring Frenzy');
    expect(first.url).toMatch(/^https:\/\/iuhoosiers\.com\/news\/2026\/10\/9\//);
    expect(first.published?.toISOString()).toMatch(/^2026-10-/);
    expect(first.lede).toMatch(/^BLOOMINGTON/);
    expect(first.lede).not.toMatch(/<img|&amp;/);
    expect(first.categories).toEqual(["Men's Soccer"]);
  });
  it('reads BBC and ESPN', () => {
    expect(parseFeed(fx('bbc-womens.xml')).length).toBeGreaterThan(20);
    const espn = parseFeed(fx('espn-soccer.xml'));
    expect(espn.length).toBeGreaterThan(10);
    expect(espn.every((i) => i.url.startsWith('https://'))).toBe(true);
  });
  it('reads Atom, GDELT and the Guardian', () => {
    const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Club signs keeper</title><link rel="alternate" href="https://club.example/news/1?utm_source=rss"/><published>2026-10-12T10:00:00Z</published><summary>&lt;p&gt;He joins from&amp;nbsp;Leeds&lt;/p&gt;</summary></entry></feed>`;
    expect(parseFeed(atom)).toEqual([{ title: 'Club signs keeper', url: 'https://club.example/news/1', published: new Date('2026-10-12T10:00:00Z'), lede: 'He joins from Leeds', categories: [] }]);
    const gd = JSON.stringify({ articles: [{ url: 'https://a.example/x', title: 'USWNT beat Spain', seendate: '20261012T201500Z', domain: 'a.example', language: 'English' }, { url: 'https://b.example/y', title: 'Hola', seendate: '20261012T201500Z', language: 'Spanish' }] });
    expect(parseGdelt(gd)).toEqual([{ title: 'USWNT beat Spain', url: 'https://a.example/x', published: new Date('2026-10-12T20:15:00Z'), lede: '', categories: [] }]);
    expect(parseGdelt('Please limit requests to one every 5 seconds')).toEqual([]);
    const gu = JSON.stringify({ response: { results: [{ webTitle: 'Pulisic scores', webUrl: 'https://www.theguardian.com/football/x', webPublicationDate: '2026-10-12T10:00:00Z', fields: { trailText: '<strong>Milan</strong> win' }, tags: [{ type: 'keyword', webTitle: 'AC Milan' }, { type: 'contributor', webTitle: 'A Writer' }] }] } });
    expect(parseGuardian(gu)[0]).toMatchObject({ title: 'Pulisic scores', lede: 'Milan win', categories: ['AC Milan'] });
  });
  it('finds the feeds a page announces', () => {
    const html = '<head><link rel="alternate" type="application/rss+xml" href="/news/feed"><link rel="alternate" type="application/rss+xml" href="/comments/feed"><link rel="stylesheet" href="/a.css"></head>';
    expect(feedLinks(html, 'https://club.example')).toEqual(['https://club.example/news/feed']);
  });
  it('cleans text and links', () => {
    expect(plainText('<![CDATA[<b>Hi</b> &amp; &#8217;bye]]>')).toBe('Hi & ’bye');
    expect(cleanUrl('javascript:alert(1)')).toBeNull();
    expect(cleanUrl('https://x.example/a?id=2&utm_medium=rss#top')).toBe('https://x.example/a?id=2');
    expect(urlHash('https://www.x.example/a/')).toBe(urlHash('http://x.example/a'));
  });
  it('builds school feed addresses and keeps soccer stories only', () => {
    expect(schoolFeedUrl('sidearm', 'https://goheels.com/', 'm')).toBe('https://goheels.com/api/v2/rss/xml?path=msoc');
    expect(schoolFeedUrl('sidearm', 'https://goheels.com', 'w')).toBe('https://goheels.com/api/v2/rss/xml?path=wsoc');
    expect(schoolFeedUrl('presto', 'https://x.example', 'm')).toBeNull();
    expect(isSoccerItem(["Men's Soccer"], 'x', 'm')).toBe(true);
    expect(isSoccerItem(['Football'], 'Gameday', 'm')).toBe(false);
    expect(isSoccerItem(["Women's Soccer"], 'x', 'm')).toBe(false);
    expect(isSoccerItem(["Women's Soccer, Volleyball, Athletics"], 'x', 'w')).toBe(true);
    expect(isSoccerItem([], 'Field Hockey Loses at Liberty', 'w')).toBe(false);
    expect(isSoccerItem(["General, Men's Soccer, Women's Soccer"], 'x', 'm')).toBe(true);
    expect(isSoccerItem(["Field Hockey, Football, Men's Golf, Men's Soccer, Women's Soccer"], 'Department honor roll', 'm')).toBe(false);
    expect(isSoccerItem(["Men's Golf"], 'x', 'm')).toBe(false);
    expect(classicSidearmFeed('https://sienasaints.com/api/v2/rss/xml?path=msoc')).toBe('https://sienasaints.com/rss.aspx?path=msoc');
  });
  it('ships only feeds whose terms allow headlines and links switched on', () => {
    for (const f of PUBLISHER_FEEDS.filter((x) => x.on)) expect(f.terms).not.toMatch(/review/i);
    for (const f of PUBLISHER_FEEDS.filter((x) => !x.on)) expect(f.terms).toMatch(/review/i);
  });
  it('skips league-run club sites', () => {
    expect(LEAGUE_RUN.test('www.mlssoccer.com')).toBe(true);
    expect(LEAGUE_RUN.test('www.chelseafc.com')).toBe(false);
    expect(LEAGUE_RUN_PAGE.test('<a href="https://www.mlssoccer.com/legal/terms">Terms</a>')).toBe(true);
  });
});

describe('story types', () => {
  const k = (t: string, lede = '') => classify(t, lede);
  it('reads the common headlines', () => {
    expect(k('Arteta confirms Hincapié, Zubimendi injuries')).toEqual(['injury']);
    expect(k('Neuer out for Bayern as Urbig to get start in UCL', 'Manuel Neuer has been ruled out with a calf problem.')).toContain('injury');
    expect(k('Man United eye move for Fulham youngster King')).toEqual(['transfer']);
    expect(k('Defender joins Wrexham on loan')).toEqual(['loan']);
    expect(k('Pulisic signs contract extension through 2029')).toEqual(['contract']);
    expect(k('Indiana announces 2027 signing class')).toEqual(['commitment']);
    expect(k('Club names Jane Doe new head coach')).toEqual(['coaching']);
    expect(k('Manager sacked after five straight defeats')).toContain('coaching');
    expect(k('Seven Hoosiers called up to U-20 camp')).toEqual(['callup']);
    expect(k('Moller-Jensen Features in Hermann Trophy Watch List')).toEqual(['award']);
    expect(k('Russo named England player of the year')).toEqual(['award']);
    expect(k('MLS Power Rankings: Miami back to winning ways')).toEqual(['ranking']);
    expect(k('No. 2 Hoosiers Flip Through No. 4 Terps, 3-1')).toEqual(['report']);
    expect(k('No. 2 Hoosiers Host No. 4 Maryland')).toEqual(['preview']);
    expect(k('Match Central: Indiana at USC')).toEqual(['preview']);
    expect(k('Moller-Jensen Brace Boosts No. 2 Hoosiers to Comeback Win')).toEqual(['milestone', 'report']);
  });
  it('does not read a quote in a lede as a coaching change', () => {
    expect(k('Hoosiers Draw with Trojans', 'Head coach Erin Herzog said the team battled.')).toEqual(['report']);
    expect(k('Do Lionesses lack ruthlessness in front of goal?')).toEqual([]);
  });
});

describe('linking', () => {
  const ix = new EntityIndex().load({
    teams: [
      { id: 49, name: 'Chelsea', display_name: 'Chelsea', gender: 'm', is_national: false, slug: 'chelsea', country: 'England', priority: 20 },
      { id: 1853, name: 'Chelsea W', display_name: 'Chelsea', gender: 'w', is_national: false, slug: 'chelsea-women', country: 'England', priority: 28 },
      { id: 50, name: 'Manchester City', display_name: 'Manchester City', gender: 'm', is_national: false, slug: 'manchester-city', country: 'England', priority: 20 },
      { id: 40, name: 'Liverpool', display_name: 'Liverpool', gender: 'm', is_national: false, slug: 'liverpool', country: 'England', priority: 20 },
      { id: 9001, name: 'Liverpool', display_name: 'Liverpool', gender: 'm', is_national: false, slug: 'liverpool-uruguay', country: 'Uruguay', priority: 120 },
      { id: 777, name: 'Start', display_name: 'Start', gender: 'm', is_national: false, slug: 'start', country: 'Norway', priority: 200 },
      { id: 2384, name: 'USA', display_name: 'USA', gender: 'm', is_national: true, slug: 'usa', country: 'USA', priority: 34 },
      { id: 2385, name: 'USA W', display_name: 'USA', gender: 'w', is_national: true, slug: 'usa-women', country: 'USA', priority: 35 },
    ],
    leagues: [{ id: 253, name: 'Major League Soccer', slug: 'usa-major-league-soccer', priority: 1, country: 'USA' }, { id: 39, name: 'Premier League', slug: 'england-premier-league', priority: 20, country: 'England' }, { id: 330, name: 'Premier League', slug: 'kuwait-premier-league', priority: 500, country: 'Kuwait' }],
    programs: [
      { id: 'p-ind-m', school_seo: 'indiana', gender: 'm', name: 'Indiana' },
      { id: 'p-but-m', school_seo: 'butler', gender: 'm', name: 'Butler' },
      { id: 'p-lib-w', school_seo: 'liberty', gender: 'w', name: 'Liberty' },
      { id: 'p-ucla-m', school_seo: 'ucla', gender: 'm', name: 'UCLA' },
      { id: 'p-ws-m', school_seo: 'wake-forest', gender: 'm', name: 'Wake Forest' },
    ],
    schools: [{ seo: 'indiana', name: 'Indiana' }, { seo: 'butler', name: 'Butler' }, { seo: 'liberty', name: 'Liberty' }, { seo: 'ucla', name: 'UCLA' }, { seo: 'wake-forest', name: 'Wake Forest' }],
    conferences: [{ id: 'c-b1g', ncaa_seo: 'big-ten', name: 'Big Ten', short_name: 'Big Ten' }],
    memberships: [{ program_id: 'p-ind-m', conference_id: 'c-b1g' }, { program_id: 'p-but-m', conference_id: null }, { program_id: 'p-lib-w', conference_id: null }, { program_id: 'p-ucla-m', conference_id: 'c-b1g' }, { program_id: 'p-ws-m', conference_id: null }],
  });
  const labels = (t: string, scope: 'college' | 'pro', g: 'm' | 'w' | null = null) => ix.scan(t, scope, g).map((l) => l.label);
  it('links clubs, the bigger namesake, the right gender, and leagues', () => {
    expect(labels('Man City win at angry Anfield against Liverpool', 'pro')).toEqual(['Manchester City', 'Liverpool']);
    expect(ix.scan('Liverpool beat Chelsea', 'pro', null).map((l) => l.id)).toEqual(['40', '49']);
    expect(ix.scan('Chelsea ease past West Ham', 'pro', 'w').map((l) => l.id)).toEqual(['1853']);
    expect(ix.scan('Premier League table', 'pro', null).map((l) => l.id)).toEqual(['39']);
    expect(labels('MLS Power Rankings', 'pro')).toEqual(['Major League Soccer']);
  });
  it('does not link everyday words or lower-case mentions', () => {
    expect(labels('Hayes wants a fast start from the team', 'pro')).toEqual([]);
    expect(labels('Start of the season', 'pro')).toEqual([]);
  });
  it('links national teams by their nicknames, or in national-team stories only', () => {
    expect(ix.scan('USWNT beat Spain in friendly', 'pro', null).map((l) => l.id)).toEqual(['2385']);
    expect(ix.scan('USMNT camp roster named', 'pro', null).map((l) => l.id)).toEqual(['2384']);
  });
  it('links college opponents only where an opponent goes, longest name first', () => {
    expect(labels('Dominant Second Half Propels Indiana Over Butler', 'college', 'm')).toEqual(['Butler']);
    expect(labels('Field Hockey Loses at Liberty', 'college', 'w')).toEqual(['Liberty']);
    expect(labels('Williams and Liberty are words', 'college', 'w')).toEqual([]);
    expect(labels('Indiana at #10 UCLA', 'college', 'm')).toEqual(['UCLA']);
    expect(labels('Hosts Wake Forest in Big Ten clash', 'college', 'm')).toEqual(['Wake Forest', 'Big Ten']);
  });
  it('finds person names and links them only when unique or on a linked team', () => {
    expect(personCandidates('Christian Pulisic scores as Milan win').map((c) => c.display)).toContain('Christian Pulisic');
    expect(personCandidates('The Hoosiers Win').map((c) => c.display)).not.toContain('The Hoosiers');
    const hit = (id: string, team: string): PersonHit => ({ type: 'pro_player', id, label: id, href: `/pro/players/${id}`, key: 'smith|john', teamIds: [team] });
    const hits = new Map([['smith|john', [hit('a', '1'), hit('b', '2')]], ['doe|jane', [{ ...hit('c', '3'), key: 'doe|jane' }]]]);
    expect(resolvePeople([{ key: 'smith|john' }], hits, new Set())).toEqual([]);
    expect(resolvePeople([{ key: 'smith|john' }], hits, new Set(['2']))[0]).toMatchObject({ id: 'b', method: 'context' });
    expect(resolvePeople([{ key: 'doe|jane' }], hits, new Set())[0]).toMatchObject({ id: 'c', method: 'exact' });
  });
  it('prepares a school story: its own team, opponent, players, kind, importance', async () => {
    const src: NewsSource = { id: 'school:p-ind-m', kind: 'school', name: 'Indiana', scope: 'college', gender: 'm', program_id: 'p-ind-m', pro_team_id: null, link_label: 'Indiana (men)', link_href: '/teams/indiana/men' };
    const people = async () => new Map([['oduro|sam', [{ type: 'college_player' as const, id: 'pl-1', label: 'Sam Oduro', href: '/players/sam-oduro', key: 'oduro|sam', teamIds: ['p-ind-m'] }]]]);
    const [p] = await prepare({} as any, ix, src, [{ title: 'Hoosiers Beat Butler, 3-1', url: 'https://iuhoosiers.com/news/1', published: new Date('2026-10-10T00:00:00Z'), lede: 'Sam Oduro scored twice.', categories: [] }], Date.parse('2026-10-11T00:00:00Z'), people);
    expect(p!.kinds).toEqual(['report']);
    expect(p!.links.map((l) => [l.type, l.id, l.method, l.primary])).toEqual([['program', 'p-ind-m', 'scope', true], ['program', 'p-but-m', 'exact', false], ['college_player', 'pl-1', 'context', false]]);
    expect(p!.scope).toEqual(new Set(['college']));
  });
  it('knows a story is international when a national team is in it', async () => {
    const src: NewsSource = { id: 'feed:espn-soccer', kind: 'publisher', name: 'ESPN', scope: 'pro', gender: null, program_id: null, pro_team_id: null, link_label: null, link_href: null };
    const [p] = await prepare(null, ix, src, [{ title: 'Hayes wants fast start from USWNT in second game against Spain', url: 'https://espn.com/x', published: new Date('2026-10-10T00:00:00Z'), lede: '', categories: [] }], Date.parse('2026-10-11T00:00:00Z'));
    expect([...p!.scope].sort()).toEqual(['international', 'pro']);
    expect(p!.gender).toBe('w');
    expect(p!.links[0]).toMatchObject({ id: '2385', primary: true });
  });
  it('reads the gender from the story', () => {
    expect(genderOf("Indiana women's soccer wins", null)).toBe('w');
    expect(genderOf('MLS: Miami win', null)).toBe('m');
    expect(genderOf('Arsenal win', null)).toBeNull();
    expect(genderOf('Arsenal win', 'w')).toBe('w');
  });
});

describe('same story, several outlets', () => {
  it('groups headlines that share a team and most of their words, within 48 hours', () => {
    const at = Date.parse('2026-10-12T12:00:00Z');
    const recent = [{ id: 7, cluster_id: null, tokens: titleTokens('Arteta confirms Hincapie, Zubimendi injuries'), entities: new Set(['pro_team|42']), at, publisher: 'ESPN' }];
    expect(overlap(titleTokens('Hincapie and Zubimendi injured'), titleTokens('Hincapie, Zubimendi injuries confirmed'))).toBeGreaterThan(0.5);
    expect(clusterFor({ tokens: titleTokens('Arteta confirms injuries to Hincapie and Zubimendi'), entities: new Set(['pro_team|42']), at: at + 3600_000, publisher: 'BBC Sport' }, recent)).toBe(7);
    expect(clusterFor({ tokens: titleTokens('Arteta confirms injuries to Hincapie and Zubimendi'), entities: new Set(['pro_team|42']), at: at + 3 * 86400_000, publisher: 'BBC Sport' }, recent)).toBeNull();
    expect(clusterFor({ tokens: titleTokens('Arsenal sign a new striker from Leeds'), entities: new Set(['pro_team|42']), at, publisher: 'BBC Sport' }, recent)).toBeNull();
  });
});
