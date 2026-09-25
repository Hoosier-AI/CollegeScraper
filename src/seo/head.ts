// Pure: page model -> <head> metadata (title, description, canonical, Open Graph, JSON-LD). No I/O.
import type { ConferencePage, HomePage, MatchPage, PlayerPage, RankingsPage, TeamPage, TeamRef, TeamsIndexPage } from './types.js';
import { clip, conferencePath, divisionLabel, esc, genderLower, genderWord, jsonLdText, longDate, matchPath, playerPath, rec, seasonQuery, SITE_NAME, teamPath, trimBase } from './util.js';

export interface HeadContext { baseUrl: string; currentSeason: number }

export interface HeadMeta {
  title: string;
  description: string;
  /** Absolute; null on error pages. */
  canonical: string | null;
  /** e.g. "noindex,follow"; null = indexable. */
  robots: string | null;
  ogType: 'website' | 'profile';
  image: string;
  jsonLd: Record<string, unknown>[];
}

const SUFFIX = ` | ${SITE_NAME}`;
export const NOINDEX = 'noindex,follow';

const abs = (ctx: HeadContext, path: string) => `${trimBase(ctx.baseUrl)}${path}`;
const ogImage = (ctx: HeadContext) => abs(ctx, '/brand/og.png');
const ld = (type: string, body: Record<string, unknown>) => ({ '@context': 'https://schema.org', '@type': type, ...body });

export function breadcrumbs(ctx: HeadContext, items: { name: string; path: string }[]): Record<string, unknown> {
  return ld('BreadcrumbList', { itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: abs(ctx, it.path) })) });
}

/** "Duke Men's Soccer". */
export const teamTitle = (t: { name: string; gender: TeamRef['gender'] }) => `${t.name} ${genderWord(t.gender)} Soccer`;

const teamLd = (ctx: HeadContext, t: TeamRef) => ({ '@type': 'SportsTeam', name: teamTitle(t), sport: 'Soccer', url: abs(ctx, teamPath(t)) });

// ---------- team ----------
export function teamHead(t: TeamPage, ctx: HeadContext): HeadMeta {
  const canonical = abs(ctx, teamPath(t, t.season, ctx.currentSeason));
  const name = teamTitle(t);
  const head = t.coaches.find((c) => c.is_head) ?? null;
  const bits: string[] = [];
  if (t.record) bits.push(`${rec(t.record.w, t.record.l, t.record.t)} overall${t.record.conf && t.conference ? ` (${rec(t.record.conf.w, t.record.conf.l, t.record.conf.t)} ${t.conference.short_name ?? t.conference.name})` : ''}`);
  else if (t.conference) bits.push(`${t.conference.name}${t.division ? `, ${divisionLabel(t.division)}` : ''}`);
  if (t.poll) bits.push(`ranked No. ${t.poll.rank}`);
  if (head) bits.push(`head coach ${head.name}`);
  const description = clip(`${name} ${t.season}${bits.length ? `: ${bits.join(', ')}` : ''}. Full roster with goals, assists and minutes, match results and box scores, standings and polls.`);
  const athletes = t.roster.filter((r) => r.slug).slice(0, 40).map((r) => ({ '@type': 'Person', name: r.name, url: abs(ctx, playerPath(r.slug!)) }));
  const team = ld('SportsTeam', {
    '@id': `${abs(ctx, teamPath(t))}#team`,
    name, sport: 'Soccer', gender: t.gender === 'w' ? 'Female' : 'Male', url: canonical,
    logo: t.logo ?? undefined,
    parentOrganization: t.school_long_name || t.school_name ? { '@type': 'CollegeOrUniversity', name: t.school_long_name ?? t.school_name } : undefined,
    memberOf: t.conference ? { '@type': 'SportsOrganization', name: t.conference.name, url: abs(ctx, conferencePath(t.conference.seo, t.season, ctx.currentSeason)) } : undefined,
    coach: head ? { '@type': 'Person', name: head.name } : undefined,
    athlete: athletes.length ? athletes : undefined,
  });
  return {
    title: `${name} ${t.season}: Roster, Schedule and Stats${SUFFIX}`,
    description, canonical, robots: t.member ? null : NOINDEX, ogType: 'website', image: ogImage(ctx),
    jsonLd: [team, breadcrumbs(ctx, [{ name: SITE_NAME, path: '/' }, { name: 'Teams', path: '/teams' }, { name, path: teamPath(t, t.season, ctx.currentSeason) }])],
  };
}

// ---------- player ----------
export const appearances = (p: PlayerPage): number => p.seasons.reduce((n, s) => n + (s.gp ?? 0), 0);

export function playerHead(p: PlayerPage, ctx: HeadContext): HeadMeta {
  const canonical = abs(ctx, playerPath(p.slug));
  const latest = p.seasons[0] ?? null;
  const team = latest?.team ?? null;
  const isGk = p.seasons.some((s) => (s.saves ?? 0) > 0 || /^g/i.test(s.position ?? ''));
  let line = '';
  if (latest && (latest.gp ?? 0) > 0) {
    line = isGk && latest.saves != null
      ? `${latest.season}: ${latest.saves} saves${latest.shutouts ? `, ${latest.shutouts} shutouts` : ''} in ${latest.gp} games`
      : `${latest.season}: ${latest.goals ?? 0} goals, ${latest.assists ?? 0} assists in ${latest.gp} games`;
  }
  const role = [latest?.position, latest?.class_label].filter(Boolean).join(', ');
  const description = clip(`${p.name}${team ? `, ${role ? `${role} ` : ''}for ${teamTitle(team)}` : ''}${line ? `. ${line}` : ''}. Season-by-season stats, game log and honors.`);
  const person = ld('Person', {
    '@id': `${canonical}#person`, name: p.name, url: canonical,
    image: p.headshot_url && /^https:/.test(p.headshot_url) ? p.headshot_url : undefined,
    description: team ? `College soccer player, ${teamTitle(team)}` : 'College soccer player',
    affiliation: team ? teamLd(ctx, team) : undefined,
  });
  const crumbs = [{ name: SITE_NAME, path: '/' }, { name: 'Teams', path: '/teams' }, ...(team ? [{ name: teamTitle(team), path: teamPath(team) }] : []), { name: p.name, path: playerPath(p.slug) }];
  return {
    title: `${p.name}${team ? ` - ${teamTitle(team)}` : ''} Stats${SUFFIX}`,
    description, canonical,
    robots: p.noindex || appearances(p) === 0 ? NOINDEX : null,
    ogType: 'profile', image: ogImage(ctx),
    jsonLd: [person, breadcrumbs(ctx, crumbs)],
  };
}

// ---------- match ----------
export const isFinal = (m: MatchPage) => m.status === 'final' && m.home.score != null && m.away.score != null;
export const extraTime = (m: MatchPage) => (m.shootout ? ' (PKs)' : m.overtime ? ' (OT)' : '');
export const matchName = (m: MatchPage) => `${m.away.name} at ${m.home.name}`;
export const scoreLine = (m: MatchPage) => `${m.away.name} ${m.away.score}, ${m.home.name} ${m.home.score}${extraTime(m)}`;

const EVENT_STATUS: Record<string, string> = { postponed: 'https://schema.org/EventPostponed', cancelled: 'https://schema.org/EventCancelled' };

export function matchStart(m: MatchPage): string {
  return m.start_epoch && !m.kickoff_tbd ? new Date(m.start_epoch * 1000).toISOString().replace('.000Z', 'Z') : m.date;
}

export function matchHead(m: MatchPage, ctx: HeadContext): HeadMeta {
  const canonical = abs(ctx, matchPath(m.slug));
  const final = isFinal(m);
  const g = genderWord(m.gender);
  const when = longDate(m.date);
  const title = final
    ? `${m.away.name} ${m.away.score}-${m.home.score} ${m.home.name}${extraTime(m)}, ${when}: ${g} Soccer Box Score${SUFFIX}`
    : `${matchName(m)}, ${when}: ${g} Soccer${m.status === 'scheduled' ? ' Preview' : ''}${SUFFIX}`;
  const scorers = m.events.filter((e) => e.type === 'goal' && e.player).map((e) => `${e.player}${e.minute ? ` ${e.minute}` : ''}`).slice(0, 6);
  const where = [m.venue_name, m.venue_city].filter(Boolean).join(', ');
  const description = clip(final
    ? `${scoreLine(m)}, ${when}${where ? ` at ${where}` : ''}. ${scorers.length ? `Goals: ${scorers.join('; ')}. ` : ''}Box score, lineups and team stats.`
    : `${matchName(m)}, ${genderLower(m.gender)} college soccer, ${when}${where ? ` at ${where}` : ''}. Form, head-to-head and key players.`);
  const side = (s: MatchPage['home']) => (s.team ? teamLd(ctx, s.team) : { '@type': 'SportsTeam', name: s.name, sport: 'Soccer' });
  const event = ld('SportsEvent', {
    '@id': `${canonical}#event`,
    name: `${matchName(m)} (${g} Soccer)`, sport: 'Soccer', url: canonical,
    startDate: matchStart(m),
    eventStatus: EVENT_STATUS[m.status] ?? 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: m.venue_name || m.venue_city ? { '@type': 'Place', name: m.venue_name ?? m.venue_city, address: m.venue_city ?? undefined } : undefined,
    homeTeam: side(m.home), awayTeam: side(m.away), competitor: [side(m.home), side(m.away)],
    description: final ? `Final: ${scoreLine(m)}` : undefined,
    superEvent: m.tournament ? { '@type': 'SportsEvent', name: m.tournament } : undefined,
  });
  const crumbs = [{ name: SITE_NAME, path: '/' }, ...(m.home.team ? [{ name: teamTitle(m.home.team), path: teamPath(m.home.team) }] : []), { name: matchName(m), path: matchPath(m.slug) }];
  return { title, description, canonical, robots: null, ogType: 'website', image: ogImage(ctx), jsonLd: [event, breadcrumbs(ctx, crumbs)] };
}

// ---------- conference ----------
export function conferenceHead(c: ConferencePage, ctx: HeadContext): HeadMeta {
  const path = conferencePath(c.seo, c.season, ctx.currentSeason);
  const leaders = c.tables.map((t) => { const top = t.rows.find((r) => r.rank === 1); return top ? `${top.team.name} lead the ${genderLower(t.gender)} table` : null; }).filter(Boolean);
  const description = clip(`${c.name} ${c.season} soccer standings${c.division ? `, ${divisionLabel(c.division)}` : ''}.${leaders.length ? ` ${leaders.join('; ')}.` : ''} Men's and women's tables with conference and overall records, points and goals.`);
  const org = ld('SportsOrganization', {
    '@id': `${abs(ctx, conferencePath(c.seo))}#conference`, name: c.name, sport: 'Soccer', url: abs(ctx, path),
    member: c.tables.flatMap((t) => (t.rows.length ? t.rows.map((r) => r.team) : t.members)).slice(0, 60).map((t) => teamLd(ctx, t)),
  });
  return {
    title: `${c.name} Soccer Standings ${c.season}${SUFFIX}`,
    description, canonical: abs(ctx, path), robots: null, ogType: 'website', image: ogImage(ctx),
    jsonLd: [org, breadcrumbs(ctx, [{ name: SITE_NAME, path: '/' }, { name: 'Rankings', path: '/rankings' }, { name: c.name, path }])],
  };
}

// ---------- index pages ----------
export function rankingsHead(r: RankingsPage, ctx: HeadContext): HeadMeta {
  const path = `/rankings${seasonQuery(r.season, ctx.currentSeason)}`;
  const tops = r.polls.filter((p) => p.division === 'd1').map((p) => { const top = p.rows[0]; return top ? `${top.name} No. 1 in D1 ${genderLower(p.gender)}` : null; }).filter(Boolean);
  return {
    title: `College Soccer Rankings ${r.season}: United Soccer Coaches Polls${SUFFIX}`,
    description: clip(`The ${r.season} United Soccer Coaches polls for NCAA Division I, II and III men's and women's soccer, with points, records and movement.${tops.length ? ` ${tops.join('; ')}.` : ''}`),
    canonical: abs(ctx, path), robots: null, ogType: 'website', image: ogImage(ctx),
    jsonLd: [breadcrumbs(ctx, [{ name: SITE_NAME, path: '/' }, { name: 'Rankings', path }])],
  };
}

export function teamsHead(t: TeamsIndexPage, ctx: HeadContext): HeadMeta {
  const path = `/teams${seasonQuery(t.season, ctx.currentSeason)}`;
  return {
    title: `NCAA Soccer Teams ${t.season}: Men's and Women's Programs${SUFFIX}`,
    description: clip(`All ${t.teams.length} NCAA Division I, II and III men's and women's soccer programs in ${t.season}, by conference, with rosters, results and season stats.`),
    canonical: abs(ctx, path), robots: null, ogType: 'website', image: ogImage(ctx),
    jsonLd: [breadcrumbs(ctx, [{ name: SITE_NAME, path: '/' }, { name: 'Teams', path }])],
  };
}

export function homeHead(h: HomePage, ctx: HeadContext): HeadMeta {
  const url = abs(ctx, '/');
  return {
    title: `${SITE_NAME}: NCAA College Soccer Stats, Rosters, Standings and Rankings`,
    description: clip(`Every NCAA soccer program, Division I to III, men's and women's: rosters, box scores, season stats, conference standings and polls for ${h.season}. Free, with an open API.`),
    canonical: url, robots: null, ogType: 'website', image: ogImage(ctx),
    jsonLd: [ld('WebSite', { '@id': `${url}#website`, name: SITE_NAME, url, description: 'NCAA college soccer data: rosters, box scores, season stats, standings and polls.', publisher: { '@type': 'Organization', name: 'Plaibook', url: 'https://www.plaibook.soccer/' } })],
  };
}

export function notFoundHead(ctx: HeadContext): HeadMeta {
  return { title: `Page not found${SUFFIX}`, description: 'There is no page at this address.', canonical: null, robots: 'noindex', ogType: 'website', image: ogImage(ctx), jsonLd: [] };
}

/** HeadMeta -> the tags injected at <!--ssr-head-->. */
export function renderHead(m: HeadMeta): string {
  const tags = [
    `<title>${esc(m.title)}</title>`,
    `<meta name="description" content="${esc(m.description)}" />`,
    m.canonical ? `<link rel="canonical" href="${esc(m.canonical)}" />` : '',
    m.robots ? `<meta name="robots" content="${esc(m.robots)}" />` : '',
    `<meta property="og:type" content="${m.ogType}" />`,
    `<meta property="og:title" content="${esc(m.title.replace(SUFFIX, ''))}" />`,
    `<meta property="og:description" content="${esc(m.description)}" />`,
    m.canonical ? `<meta property="og:url" content="${esc(m.canonical)}" />` : '',
    `<meta property="og:image" content="${esc(m.image)}" />`,
    `<meta name="twitter:title" content="${esc(m.title.replace(SUFFIX, ''))}" />`,
    `<meta name="twitter:description" content="${esc(m.description)}" />`,
    ...m.jsonLd.map((j) => `<script type="application/ld+json">${jsonLdText(j)}</script>`),
  ];
  return tags.filter(Boolean).join('\n    ');
}
