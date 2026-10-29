import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { classify } from '../../src/news/classify.js';
import { clusterFor, overlap, titleTokens } from '../../src/news/cluster.js';
import { EntityIndex, personCandidates, resolvePeople, suspectTeamLink, withoutDateline, type PersonHit } from '../../src/news/entities.js';
import { classicSidearmFeed, ENGLISH_COUNTRIES, isSoccerItem, YOUTH_STORY, LEAGUE_RUN, LEAGUE_RUN_PAGE, PUBLISHER_FEEDS, schoolFeedUrl } from '../../src/news/feeds.js';
import { genderOf, prepare, urlHash, type NewsSource } from '../../src/news/ingest.js';
import { cleanUrl, feedLinks, imageUrl, parseFeed, parseGdelt, parseGuardian, plainText } from '../../src/news/rss.js';

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
    expect(parseFeed(atom)).toEqual([{ title: 'Club signs keeper', url: 'https://club.example/news/1', published: new Date('2026-10-12T10:00:00Z'), lede: 'He joins from Leeds', categories: [], image: null }]);
    const gd = JSON.stringify({ articles: [{ url: 'https://a.example/x', title: 'USWNT beat Spain', seendate: '20261012T201500Z', domain: 'a.example', language: 'English' }, { url: 'https://b.example/y', title: 'Hola', seendate: '20261012T201500Z', language: 'Spanish' }] });
    expect(parseGdelt(gd)).toEqual([{ title: 'USWNT beat Spain', url: 'https://a.example/x', published: new Date('2026-10-12T20:15:00Z'), lede: '', categories: [], image: null }]);
    expect(parseGdelt('Please limit requests to one every 5 seconds')).toEqual([]);
    const gu = JSON.stringify({ response: { results: [{ webTitle: 'Pulisic scores', webUrl: 'https://www.theguardian.com/football/x', webPublicationDate: '2026-10-12T10:00:00Z', fields: { trailText: '<strong>Milan</strong> win' }, tags: [{ type: 'keyword', webTitle: 'AC Milan' }, { type: 'contributor', webTitle: 'A Writer' }] }] } });
    expect(parseGuardian(gu)[0]).toMatchObject({ title: 'Pulisic scores', lede: 'Milan win', categories: ['AC Milan'] });
  });
  it('keeps the picture a feed supplies, https only', () => {
    expect(parseFeed(fx('sidearm-indiana-msoc.xml')).filter((i) => i.image).length).toBeGreaterThan(3);
    expect(parseFeed(fx('bbc-womens.xml')).every((i) => i.image?.startsWith('https://ichef.bbci.co.uk/') && !i.image.includes('/240/'))).toBe(true);
    const rss = (inner: string) => `<?xml version="1.0"?><rss xmlns:media="http://search.yahoo.com/mrss/" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><item><title>A</title><link>https://p.example/a</link>${inner}</item></channel></rss>`;
    const img = (inner: string) => parseFeed(rss(inner))[0]!.image;
    expect(img('<media:content url="https://p.example/s.jpg" medium="image" width="240"/><media:content url="https://p.example/l.jpg" medium="image" width="960"/>')).toBe('https://p.example/l.jpg');
    expect(img('<media:content url="https://p.example/v.mp4" type="video/mp4"/>')).toBeNull();
    expect(img('<enclosure url="http://p.example/e.jpg" type="image/jpeg" length="1"/>')).toBe('https://p.example/e.jpg');
    expect(img('<description>&lt;p&gt;&lt;img src="/i/x.png" alt=""&gt; Text&lt;/p&gt;</description>')).toBe('https://p.example/i/x.png');
    expect(img('<content:encoded><![CDATA[<p><img class="a" src="https://p.example/c.webp"></p>]]></content:encoded>')).toBe('https://p.example/c.webp');
    expect(img('<description>No picture</description>')).toBeNull();
    expect(imageUrl('data:image/png;base64,AAAA')).toBeNull();
    expect(imageUrl('https://p.example/pixel.gif')).toBeNull();
    expect(imageUrl('https://p.example/logo.svg')).toBeNull();
    expect(imageUrl('ftp://p.example/a.jpg')).toBeNull();
    expect(parseGdelt(JSON.stringify({ articles: [{ url: 'https://a.example/x', title: 'T', seendate: '20261012T201500Z', socialimage: 'https://a.example/og.jpg' }] }))[0]!.image).toBe('https://a.example/og.jpg');
    expect(parseGuardian(JSON.stringify({ response: { results: [{ webTitle: 'T', webUrl: 'https://www.theguardian.com/x', fields: { thumbnail: 'https://media.guim.co.uk/a/500.jpg' } }] } }))[0]!.image).toBe('https://media.guim.co.uk/a/500.jpg');
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
  it('keeps club feeds to first-team stories in English-speaking countries', () => {
    expect(ENGLISH_COUNTRIES.has('England')).toBe(true);
    expect(ENGLISH_COUNTRIES.has('Portugal')).toBe(false);
    expect(YOUTH_STORY.test('Under 16: Lecce 3 – Lazio 3')).toBe(true);
    expect(YOUTH_STORY.test('U21s beat Spurs')).toBe(true);
    expect(YOUTH_STORY.test('Matchday at Turf: Burnley v Charlton Athletic')).toBe(false);
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
      { id: 9568, name: 'Charlotte', display_name: 'Charlotte', gender: 'm', is_national: false, slug: 'charlotte', country: 'USA', priority: 2 },
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
      { id: 'p-clt-w', school_seo: 'charlotte', gender: 'w', name: 'Charlotte' },
      { id: 'p-d3-m', school_seo: 'crown', gender: 'm', name: 'Crown' },
      { id: 'p-nw-m', school_seo: 'northwestern', gender: 'm', name: 'Northwestern' },
      { id: 'p-nwsp-m', school_seo: 'northwestern-st-paul', gender: 'm', name: 'Northwestern-St. Paul' },
    ],
    schools: [{ seo: 'indiana', name: 'Indiana' }, { seo: 'butler', name: 'Butler' }, { seo: 'liberty', name: 'Liberty' }, { seo: 'ucla', name: 'UCLA' }, { seo: 'wake-forest', name: 'Wake Forest' }, { seo: 'charlotte', name: 'Charlotte' }, { seo: 'crown', name: 'Crown' }, { seo: 'northwestern', name: 'Northwestern' }, { seo: 'northwestern-st-paul', name: 'Northwestern-St. Paul' }],
    conferences: [{ id: 'c-b1g', ncaa_seo: 'big-ten', name: 'Big Ten', short_name: 'Big Ten' }],
    memberships: [{ program_id: 'p-ind-m', conference_id: 'c-b1g' }, { program_id: 'p-but-m', conference_id: null, division: 'd1' }, { program_id: 'p-lib-w', conference_id: null }, { program_id: 'p-ucla-m', conference_id: 'c-b1g' }, { program_id: 'p-ws-m', conference_id: null }, { program_id: 'p-clt-w', conference_id: null }, { program_id: 'p-d3-m', conference_id: null, division: 'd3' }, { program_id: 'p-nw-m', conference_id: 'c-b1g', division: 'd1' }, { program_id: 'p-nwsp-m', conference_id: null, division: 'd3' }],
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
  it('does not read a first name as a team', () => {
    // Real stories (2026-10): each linked the Charlotte 49ers or Charlotte FC through a player called Charlotte.
    expect(labels('Mount Olive earned a valuable 1-1 draw on the road against Young Harris, handing the Mountain Lions their first tie of the season with a late equalizer from Charlotte Benson.', 'college', 'w')).toEqual([]);
    expect(labels('A two-goal performance from Charlotte Hansen and a 10-save effort by Grace Stair helped the Davidson College women\'s soccer team secure a 2-2 draw Thursday afternoon against Duquesne.', 'college', 'w')).not.toContain('Charlotte');
    expect(labels('Falkirk kicked off the match slightly nervy looking, and Charlotte Ferguson was immediately called into action with a save as Renfrew made a charge forward.', 'pro')).toEqual([]);
    // A headline capitalises every word: there only a person we know by the name counts.
    expect(labels('Charlotte Hansen Scores Twice', 'college', 'w')).toEqual([]);
    expect(ix.scan('Charlotte Hansen Scores Twice in Win', 'pro', null, new Set(['hansen|charlotte'])).map((l) => l.label)).toEqual([]);
    expect(labels('Charlotte Hansen Scores Twice in Win', 'pro')).toEqual(['Charlotte']);
    // The team itself still links, before a day, in a headline, or after an opponent word.
    expect(labels('Tigers Host Charlotte in Home Regular Season Finale Wednesday', 'college', 'w')).toEqual(['Charlotte']);
    expect(labels('The Tigers host Charlotte Thursday at 7 p.m. in the regular season finale at the stadium.', 'college', 'w')).toEqual(['Charlotte']);
    expect(labels('Inter Miami beat Charlotte on Saturday night to reach the conference semifinals.', 'pro')).toEqual(['Charlotte']);
    // Lists, hyphens and the rest of a club's name are not a surname.
    expect(labels('Real Madrid defender Trent Alexander-Arnold is weighing offers, with Liverpool, Chelsea and others keen.', 'pro')).toEqual(['Liverpool', 'Chelsea']);
    expect(labels('He was battling relegation at Liverpool United before the move to a new club.', 'pro')).toEqual(['Liverpool']);
    expect(labels('Charlotte Brown scored twice for the visitors in the second half of the game.', 'pro')).toEqual([]);
    // A team before its nickname is not a first name before a surname.
    expect(labels('Indiana led 2-0 at the break, but the visiting Butler Bulldogs responded with three goals after intermission.', 'college', 'm')).toEqual(['Butler']);
  });
  it('does not run a name across sentences, or read a school\'s own name as a namesake', async () => {
    expect(labels('Hoosiers Draw Against Butler. Indiana men\'s soccer controlled the match for most of the 90 minutes.', 'college', 'm')).toEqual(['Butler']);
    expect(labels('Indiana Soccer Ranked in the Top 10. Butler beat Liberty on Saturday.', 'college', 'm')).toEqual([]);
    expect(labels('Hoosiers win at No. 10 UCLA. The match was close.', 'college', 'm')).toEqual(['UCLA']);
    expect(labels('Tigers Host Charlotte For Senior Day. The Tigers play host to Charlotte in a conference match at the stadium tonight.', 'college', 'w')).toEqual(['Charlotte']);
    const src: NewsSource = { id: 'school:p-ind2-m', kind: 'school', name: 'Indiana (PA)', scope: 'college', gender: 'm', program_id: 'p-ind2-m', pro_team_id: null, link_label: 'Indiana (PA) (men)', link_href: '/teams/iup/men' };
    const [p] = await prepare(null, ix, src, [{ title: 'Crimson Hawks Fall', url: 'https://iup.example/1', published: new Date('2026-10-10T00:00:00Z'), lede: 'The Crimson Hawks fell 2-0 at Butler on Saturday after hosting Indiana in midweek.', categories: [], image: null }], Date.parse('2026-10-11T00:00:00Z'));
    expect(p!.links.map((l) => l.id)).toEqual(['p-ind2-m', 'p-but-m']);
    const d3: NewsSource = { ...src, id: 'school:p-d3-m', name: 'Crown', program_id: 'p-d3-m', link_label: 'Crown (men)', link_href: '/teams/crown/men' };
    const [q] = await prepare(null, ix, d3, [{ title: 'Polars Earn Huge Road Win at Northwestern', url: 'https://crown.example/1', published: new Date('2026-10-10T00:00:00Z'), lede: '', categories: [], image: null }], Date.parse('2026-10-11T00:00:00Z'));
    expect(q!.links.map((l) => l.id)).toEqual(['p-d3-m']);
    // A name nobody else shares still links across divisions (D1 Omaha does play D3 Nebraska Wesleyan).
    const [r] = await prepare(null, ix, d3, [{ title: 'Polars Fall at Butler', url: 'https://crown.example/2', published: new Date('2026-10-10T00:00:00Z'), lede: '', categories: [], image: null }], Date.parse('2026-10-11T00:00:00Z'));
    expect(r!.links.map((l) => l.id)).toEqual(['p-d3-m', 'p-but-m']);
  });
  it('leaves the dateline out', () => {
    expect(withoutDateline('Colorado Springs, Colo. — UC Davis briefly tied the match')).toBe('UC Davis briefly tied the match');
    expect(withoutDateline('PITTSBURGH, Pa. - A two-goal performance')).toBe('A two-goal performance');
    expect(withoutDateline('CHARLOTTE - The Brevard College women')).toBe('The Brevard College women');
    expect(withoutDateline('WINSTON-SALEM, N.C. – Wake Forest won')).toBe('Wake Forest won');
    expect(withoutDateline('Sam Oduro scored twice - and Indiana won.')).toBe('Sam Oduro scored twice - and Indiana won.');
  });
  it('flags stored team links that read a name or a dateline as the team', () => {
    expect(suspectTeamLink('Trojans Earn Statement Draw', 'Trojans Earn Statement Draw. Mount Olive drew on the road against Young Harris with a late equalizer from Charlotte Benson.', 'Charlotte')).toBe('name');
    expect(suspectTeamLink('MATCH REPORT: FALKIRK 5-1 RENFREW LADIES', 'MATCH REPORT: FALKIRK 5-1 RENFREW LADIES. Falkirk kicked off nervy, and Charlotte Ferguson was immediately called into action.', 'Charlotte', ['Charlotte Ferguson'])).toBe('name');
    expect(suspectTeamLink('BC Falls in Road Action', 'BC Falls in Road Action. CHARLOTTE - The Brevard College women fell 2-0 to Queens on Thursday evening.', 'Charlotte')).toBe('dateline');
    expect(suspectTeamLink('Tigers Host Charlotte in Home Regular Season Finale Wednesday', 'Tigers Host Charlotte in Home Regular Season Finale Wednesday. The Tigers welcome Charlotte to town.', 'Charlotte (women)')).toBeNull();
    expect(suspectTeamLink('Owls Fall to JWU Charlotte, 2-0', 'Owls Fall to JWU Charlotte, 2-0. Warren Wilson lost.', 'JWU Charlotte')).toBeNull();
    expect(suspectTeamLink('Smith Named Goalkeeper of the Week for Shutout vs. Vermont', 'Smith Named Goalkeeper of the Week for Shutout vs. Vermont. NEWARK, NJ -- Kaele Smith recorded a shutout.', 'Vermont')).toBeNull();
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
    const [p] = await prepare({} as any, ix, src, [{ title: 'Hoosiers Beat Butler, 3-1', url: 'https://iuhoosiers.com/news/1', published: new Date('2026-10-10T00:00:00Z'), lede: 'Sam Oduro scored twice.', categories: [], image: null }], Date.parse('2026-10-11T00:00:00Z'), people);
    expect(p!.kinds).toEqual(['report']);
    expect(p!.links.map((l) => [l.type, l.id, l.method, l.primary])).toEqual([['program', 'p-ind-m', 'scope', true], ['program', 'p-but-m', 'exact', false], ['college_player', 'pl-1', 'context', false]]);
    expect(p!.scope).toEqual(new Set(['college']));
  });
  it('knows a story is international when a national team is in it', async () => {
    const src: NewsSource = { id: 'feed:espn-soccer', kind: 'publisher', name: 'ESPN', scope: 'pro', gender: null, program_id: null, pro_team_id: null, link_label: null, link_href: null };
    const [p] = await prepare(null, ix, src, [{ title: 'Hayes wants fast start from USWNT in second game against Spain', url: 'https://espn.com/x', published: new Date('2026-10-10T00:00:00Z'), lede: '', categories: [], image: null }], Date.parse('2026-10-11T00:00:00Z'));
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

import { liveDateOk } from '../../src/db/repos.js';
describe('live status', () => {
  it('is possible only on the game date, a day either side', () => {
    const now = Date.parse('2026-10-14T15:00:00Z');
    expect(liveDateOk('2026-10-14', now)).toBe(true);
    expect(liveDateOk('2026-10-13', now)).toBe(true);
    expect(liveDateOk('2026-10-17', now)).toBe(false);
    expect(liveDateOk('2026-09-19', now)).toBe(false);
  });
});
