// Share cards: the picture a link to a team, player or match shows in a message, a post or a search result
// (og:image). One PNG per page at /og/<page path>.png, 1200x630, drawn from the same data as the page: the crest or
// photo, the name and the few numbers that say most about it. Drawn with satori (layout to SVG) and resvg (SVG to
// PNG); fonts are the site's own (Archivo, IBM Plex Sans). Kept six hours in memory; two drawn at a time.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import type { SeoData, TeamPage, PlayerPage, MatchPage } from './types.js';
import type { ProSeoData } from './pro/data.js';
import type { ProTeamPage, ProPlayerPage, ProMatchPage } from './pro/pages.js';
import { genderFromSegment } from './util.js';
import { LruCache } from './cache.js';

export const OG_W = 1200, OG_H = 630;
const C = { bg: '#0A1628', line: '#1B3154', card: '#10203A', text: '#EEF3F8', soft: '#B9C6D8', mute: '#7F91AA', teal: '#2DD4BF' };

export interface CardStat { value: string; label: string }
export type Card =
  | { kind: 'subject'; context: string; title: string; subtitle: string | null; image: string | null; round: boolean; stats: CardStat[] }
  | { kind: 'match'; context: string; status: string; home: { name: string; logo: string | null; score: number | null }; away: { name: string; logo: string | null; score: number | null }; note: string | null };

// ---------- fonts and images ----------
const require = createRequire(import.meta.url);
let fonts: { name: string; data: Buffer; weight: 400 | 600 | 700 | 800; style: 'normal' }[] | null = null;
function loadFonts() {
  if (fonts) return fonts;
  const f = (pkg: string, file: string) => readFileSync(require.resolve(`${pkg}/files/${file}`));
  fonts = [
    { name: 'Archivo', data: f('@fontsource/archivo', 'archivo-latin-800-normal.woff'), weight: 800, style: 'normal' },
    { name: 'Archivo', data: f('@fontsource/archivo', 'archivo-latin-700-normal.woff'), weight: 700, style: 'normal' },
    { name: 'Plex', data: f('@fontsource/ibm-plex-sans', 'ibm-plex-sans-latin-400-normal.woff'), weight: 400, style: 'normal' },
    { name: 'Plex', data: f('@fontsource/ibm-plex-sans', 'ibm-plex-sans-latin-600-normal.woff'), weight: 600, style: 'normal' },
  ];
  return fonts;
}

/** What the bytes are (headers lie: school sites send WebP as .png), for the three kinds the card can draw. */
export function sniff(buf: Buffer): 'image/png' | 'image/jpeg' | 'image/svg+xml' | null {
  if (buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47) return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  const head = buf.subarray(0, 512).toString('utf8').trimStart();
  return /^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head) ? 'image/svg+xml' : null;
}

/** Sidearm sites (most school headshots) redirect an image to their resizer asking for WebP, which the card cannot
 *  draw; the same resizer gives a 400-wide JPEG of the original when asked. */
async function follow(url: string, fetcher: typeof fetch, signal: AbortSignal): Promise<Response> {
  const res = await fetcher(url, { signal, redirect: 'manual', headers: { accept: 'image/png,image/jpeg,image/svg+xml' } });
  const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
  if (!loc) return res;
  const next = new URL(loc, url);
  if (/(^|\.)sidearmdev\.com$/.test(next.hostname) && next.pathname === '/resize') { next.searchParams.set('type', 'jpeg'); next.searchParams.set('width', '400'); next.searchParams.set('quality', '85'); }
  return fetcher(next.toString(), { signal, headers: { accept: 'image/png,image/jpeg,image/svg+xml' } });
}

/** A crest or photo as a data URI (PNG, JPEG or SVG, under 3 MB, within 5 s), else null and the card does without. */
export async function imageData(url: string | null | undefined, fetcher: typeof fetch = fetch): Promise<string | null> {
  if (!url || !/^https:\/\//.test(url)) return null;
  try {
    const res = await follow(url, fetcher, AbortSignal.timeout(5000));
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > 3_000_000) return null;
    const mime = sniff(buf);
    return mime ? `data:${mime};base64,${buf.toString('base64')}` : null;
  } catch {
    return null;
  }
}

// ---------- layout ----------
type Node = { type: string; props: Record<string, unknown> };
const h = (type: string, style: Record<string, unknown>, ...children: (Node | string | null | false)[]): Node =>
  ({ type, props: { style: { display: 'flex', ...style }, children: children.filter((c) => c != null && c !== false) } });
const img = (src: string, size: number, round: boolean): Node => ({ type: 'img', props: { src, width: size, height: size, style: { width: size, height: size, objectFit: round ? 'cover' : 'contain', borderRadius: round ? size / 2 : 0 } } });
const initials = (name: string, size: number): Node => h('div', { width: size, height: size, borderRadius: size / 2, background: C.card, border: `3px solid ${C.line}`, alignItems: 'center', justifyContent: 'center', color: C.soft, fontFamily: 'Archivo', fontWeight: 800, fontSize: size * 0.36 },
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join(''));
const fit = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);
/** Bigger for short names, smaller for long ones, so a name stays on one or two lines. */
const titleSize = (s: string) => (s.length <= 12 ? 96 : s.length <= 18 ? 80 : s.length <= 26 ? 64 : 52);

/** The halfway line and centre circle of a pitch at night: off the right edge behind a team or player, behind the
 *  score on a match. Drawn as an image laid over the background so it takes no room in the layout. */
const pitchMark = (cx: number, r: number, spot = true): Node => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_W}" height="${OG_H}" viewBox="0 0 ${OG_W} ${OG_H}"><circle cx="${cx}" cy="315" r="${r}" fill="none" stroke="${C.line}" stroke-width="4"/><line x1="${cx}" y1="0" x2="${cx}" y2="${OG_H}" stroke="${C.line}" stroke-width="4"/>${spot ? `<circle cx="${cx}" cy="315" r="9" fill="${C.line}"/>` : ''}</svg>`;
  return { type: 'img', props: { src: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`, width: OG_W, height: OG_H, style: { position: 'absolute', left: 0, top: 0, width: OG_W, height: OG_H } } };
};

/** The card: the mark behind, then the content in its own column on top. */
const frame = (mark: Node, ...content: (Node | null)[]): Node => h('div', { position: 'relative', width: OG_W, height: OG_H, background: C.bg, color: C.text },
  mark, h('div', { position: 'absolute', left: 0, top: 0, width: OG_W, height: OG_H, boxSizing: 'border-box', flexDirection: 'column', justifyContent: 'space-between', padding: '56px 64px' }, ...content));

const wordmark = (context: string): Node => h('div', { alignItems: 'center', gap: 18, fontFamily: 'Plex', fontSize: 26 },
  h('div', { fontFamily: 'Archivo', fontWeight: 800, color: C.text, letterSpacing: -0.5 }, 'Plaibook', h('span', { color: C.teal, marginLeft: 8 }, 'Stats')),
  h('div', { width: 2, height: 26, background: C.line }),
  h('div', { color: C.soft }, fit(context, 60)));

function subjectCard(c: Extract<Card, { kind: 'subject' }>): Node {
  const stats = c.stats.slice(0, 4);
  return frame(pitchMark(1190, 230),
    wordmark(c.context),
    h('div', { alignItems: 'center', gap: 40 },
      c.image ? img(c.image, 176, c.round) : initials(c.title, 176),
      h('div', { flexDirection: 'column', maxWidth: 820, gap: 8 },
        h('div', { fontFamily: 'Archivo', fontWeight: 800, fontSize: titleSize(c.title), lineHeight: 1.0, letterSpacing: -1.5 }, fit(c.title, 44)),
        c.subtitle ? h('div', { fontFamily: 'Plex', fontSize: 32, color: C.soft }, fit(c.subtitle, 56)) : null)),
    h('div', { gap: 56 },
      ...stats.map((s) => h('div', { flexDirection: 'column', gap: 2 },
        h('div', { fontFamily: 'Archivo', fontWeight: 800, fontSize: 64, color: C.teal, lineHeight: 1 }, s.value),
        h('div', { fontFamily: 'Plex', fontWeight: 600, fontSize: 24, color: C.mute }, s.label)))));
}

function matchCard(c: Extract<Card, { kind: 'match' }>): Node {
  const side = (s: Extract<Card, { kind: 'match' }>['home']) => h('div', { flexDirection: 'column', alignItems: 'center', gap: 20, width: 340 },
    s.logo ? img(s.logo, 160, false) : initials(s.name, 160),
    h('div', { fontFamily: 'Archivo', fontWeight: 700, fontSize: s.name.length > 18 ? 34 : 42, textAlign: 'center', justifyContent: 'center', lineHeight: 1.1 }, fit(s.name, 30)));
  const score = c.home.score != null && c.away.score != null;
  return frame(pitchMark(OG_W / 2, 200, false),
    wordmark(c.context),
    h('div', { alignItems: 'center', justifyContent: 'space-between' },
      side(c.home),
      h('div', { flexDirection: 'column', alignItems: 'center', gap: 6 },
        h('div', { fontFamily: 'Archivo', fontWeight: 800, fontSize: score ? 140 : 72, lineHeight: 1, letterSpacing: -2 }, score ? `${c.home.score}-${c.away.score}` : 'vs'),
        h('div', { fontFamily: 'Plex', fontWeight: 600, fontSize: 28, color: C.teal }, c.status)),
      side(c.away)),
    h('div', { fontFamily: 'Plex', fontSize: 26, color: C.mute, justifyContent: 'center' }, c.note ?? ''));
}

export async function renderCard(card: Card): Promise<Buffer> {
  const svg = await satori((card.kind === 'match' ? matchCard(card) : subjectCard(card)) as any, { width: OG_W, height: OG_H, fonts: loadFonts() });
  return Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: OG_W } }).render().asPng());
}

// ---------- the cards, from page data ----------
const G = { m: "Men's", w: "Women's" } as const;
const DIV: Record<string, string> = { d1: 'Division I', d2: 'Division II', d3: 'Division III' };
const ord = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][n % 100 >= 11 && n % 100 <= 13 ? 0 : n % 10 > 3 ? 0 : n % 10]}`;
const num = (v: number | null | undefined, d = 0) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v).toFixed(d));
const stats = (...xs: [string | null, string][]): CardStat[] => xs.filter((x): x is [string, string] => x[0] != null).map(([value, label]) => ({ value, label }));
const day = (iso: string) => new Date(iso.length <= 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });

export function collegeTeamCard(t: TeamPage, logo: string | null): Card {
  const r = t.record;
  return { kind: 'subject', context: [`${G[t.gender]} college soccer`, t.division ? DIV[t.division] : null, String(t.season)].filter(Boolean).join(', '), title: t.name,
    subtitle: [t.conference?.name, t.coaches.find((c) => c.is_head)?.name ? `Head coach ${t.coaches.find((c) => c.is_head)!.name}` : null].filter(Boolean).join(', ') || null,
    image: logo, round: false,
    stats: stats([r ? `${r.w}-${r.l}-${r.t}` : null, 'Record'], [t.poll ? `#${t.poll.rank}` : t.standing?.rank ? ord(t.standing.rank) : null, t.poll ? 'In the poll' : 'In the conference'], [num(r?.gf), 'Goals for'], [num(r?.ga), 'Goals against']) };
}

export function collegePlayerCard(p: PlayerPage, photo: string | null): Card {
  const s = p.seasons[0];
  const keeper = !!s && (s.position ?? '').toUpperCase().startsWith('G') && (s.saves ?? 0) > 0;
  return { kind: 'subject', context: s ? `${G[s.team.gender]} college soccer, ${s.season}` : 'College soccer', title: p.name,
    subtitle: s ? [s.team.name, s.position, s.class_label].filter(Boolean).join(', ') : p.hometown, image: photo, round: true,
    stats: !s ? [] : keeper
      ? stats([num(s.gp), 'Games'], [num(s.saves), 'Saves'], [num(s.gaa, 2), 'GAA'], [num(s.shutouts), 'Shutouts'])
      : stats([num(s.gp), 'Games'], [num(s.goals ?? 0), 'Goals'], [num(s.assists ?? 0), 'Assists'], [num(s.minutes), 'Minutes']) };
}

export function collegeMatchCard(m: MatchPage, logos: [string | null, string | null]): Card {
  const final = m.status === 'final';
  return { kind: 'match', context: [`${G[m.gender]} college soccer`, m.division ? DIV[m.division] : null].filter(Boolean).join(', '),
    status: final ? `Final${m.shootout ? ', pens' : m.overtime ? ', OT' : ''}` : m.status === 'live' || m.status === 'in_progress' ? 'Live' : day(m.date),
    home: { name: m.home.name, logo: logos[0], score: final || m.status === 'live' ? m.home.score : null }, away: { name: m.away.name, logo: logos[1], score: final || m.status === 'live' ? m.away.score : null },
    note: [m.tournament, final ? day(m.date) : null, m.venue_name].filter(Boolean).join(', ') || null };
}

export function proTeamCard(p: ProTeamPage, logo: string | null): Card {
  const comp = p.competitions[0], st = p.standings[0];
  return { kind: 'subject', context: [p.team.national ? 'International' : 'Pro soccer', p.team.country, p.season ? String(p.season) : null].filter(Boolean).join(', '), title: p.team.name,
    subtitle: comp?.league?.name ?? null, image: logo, round: false,
    stats: stats([comp ? `${comp.w}-${comp.d}-${comp.l}` : null, 'W-D-L'], [st?.rank ? ord(st.rank) : null, 'In the table'], [comp ? `${comp.gf}-${comp.ga}` : null, 'Goals']) };
}

/** The player's league line for their club this season (the first row: the club's league comes first), not every
 *  competition added together. */
export function proPlayerCard(p: ProPlayerPage, photo: string | null): Card {
  const pl = p.player;
  const row = p.seasons.find((s) => p.team && s.team?.id === p.team.id && s.source !== 'computed') ?? p.seasons.find((s) => s.source !== 'computed') ?? p.seasons[0];
  return { kind: 'subject', context: row ? [row.league?.name, String(row.season)].filter(Boolean).join(', ') : 'Pro soccer', title: pl.name,
    subtitle: [p.team?.name, pl.position, pl.nationality].filter(Boolean).join(', ') || null, image: photo, round: true,
    stats: row ? stats([num(row.apps), 'Apps'], [num(row.goals ?? 0), 'Goals'], [num(row.assists ?? 0), 'Assists'], [row.rating != null ? Number(row.rating).toFixed(2) : null, 'Rating']) : [] };
}

export function proMatchCard(p: ProMatchPage, logos: [string | null, string | null]): Card {
  const m = p.match;
  const final = ['FT', 'AET', 'PEN'].includes(m.status_short ?? '') || m.status === 'final';
  const live = !final && m.elapsed != null && m.home.score != null;
  const pens = m.pen[0] != null && m.pen[1] != null ? `, ${m.pen[0]}-${m.pen[1]} pens` : '';
  return { kind: 'match', context: [m.league.name, m.round].filter(Boolean).join(', '),
    status: final ? `Full time${m.status_short === 'AET' ? ', AET' : ''}${pens}` : live ? `Live, ${m.elapsed}'` : day(m.kickoff),
    home: { name: m.home.name, logo: logos[0], score: final || live ? m.home.score : null }, away: { name: m.away.name, logo: logos[1], score: final || live ? m.away.score : null },
    note: [final ? day(m.kickoff) : null, m.venue].filter(Boolean).join(', ') || null };
}

// ---------- the route's lookup ----------
/** The card for a page path (/teams/duke/men, /pro/players/x, ...), or null when there is no such page. */
export async function cardFor(path: string, data: SeoData, pro: ProSeoData | null, fetcher: typeof fetch = fetch): Promise<Card | null> {
  const seg = path.split('/').filter(Boolean).map((s) => decodeURIComponent(s));
  const [a, b, c] = seg;
  if (a === 'teams' && b && c && seg.length === 3) {
    const g = genderFromSegment(c); if (!g) return null;
    const t = await data.team(b, g, null); return t ? collegeTeamCard(t, await imageData(t.logo, fetcher)) : null;
  }
  if (a === 'players' && b && seg.length === 2) { const p = await data.player(b); return p ? collegePlayerCard(p, await imageData(p.headshot_url, fetcher)) : null; }
  if (a === 'matches' && b && seg.length === 2) {
    const m = await data.match(b); if (!m) return null;
    const [hl, al] = await Promise.all([m.home.team ? teamLogo(data, m.home.team.school_seo, m.home.team.gender, fetcher) : null, m.away.team ? teamLogo(data, m.away.team.school_seo, m.away.team.gender, fetcher) : null]);
    return collegeMatchCard(m, [hl, al]);
  }
  if (pro && (a === 'pro' || a === 'intl') && b && c && seg.length === 3) {
    if (b === 'teams') { const t = await pro.team(c, null); return t ? proTeamCard(t, await imageData(t.team.logo, fetcher)) : null; }
    if (b === 'players') { const p = await pro.player(c); return p ? proPlayerCard(p, await imageData(p.player.photo, fetcher)) : null; }
    if (b === 'matches') { const m = await pro.match(c); if (!m) return null; const [hl, al] = await Promise.all([imageData(m.match.home.logo, fetcher), imageData(m.match.away.logo, fetcher)]); return proMatchCard(m, [hl, al]); }
  }
  return null;
}
async function teamLogo(data: SeoData, school: string, g: 'm' | 'w', fetcher: typeof fetch) { const t = await data.team(school, g, null); return imageData(t?.logo, fetcher); }

/** Draws at most `n` cards at once (the server has half a CPU); the rest wait their turn. */
export function limiter(n: number) {
  let active = 0; const queue: (() => void)[] = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= n) await new Promise<void>((r) => queue.push(r));
    active += 1;
    try { return await fn(); } finally { active -= 1; queue.shift()?.(); }
  };
}
export const ogCache = () => new LruCache<Buffer>(800, 6 * 3600_000);
