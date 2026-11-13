// Stat cards: a picture made to be posted (Opta Analyst style), not a link preview. /card/<page path>.png for a pro
// or college player (1080x1350, portrait: the header, the season rating, eight numbers and the percentile bars) and a
// pro match (1080x1080: the score, the scorers, the key team stats and the player of the match). Same drawing kit as
// the share cards (src/seo/og.ts: satori + resvg, the site's fonts); the page's "Stat card" button links here.
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { C, fit, h, img, imageData, initials, loadFonts, type Node } from './og.js';
import type { SeoData, PlayerPage } from './types.js';
import type { ProSeoData } from './pro/data.js';
import type { ProPlayerPage, ProMatchPage } from './pro/pages.js';

export const PLAYER_W = 1080, PLAYER_H = 1350, MATCH_W = 1080, MATCH_H = 1080;

// The site's rating scale (ui/src/components/Rating.tsx) and percentile bands (primitives PercentileBar).
export const ratingHex = (v: number) => (v >= 9 ? '#38BDF8' : v >= 8 ? '#2DD4BF' : v >= 7 ? '#86EFAC' : v >= 6.5 ? '#FBBF24' : v >= 6 ? '#FB923C' : '#F87171');
export const pctHex = (p: number) => (p > 0.8 ? '#2DD4BF' : p > 0.55 ? '#86EFAC' : p > 0.3 ? '#FBBF24' : '#F87171');
const AWAY = '#7DD3FC';

export interface PlayerCard {
  kind: 'player'; context: string; name: string; subtitle: string | null; photo: string | null; crest: string | null;
  rating: number | null; ratingLabel: string; stats: { value: string; label: string }[];
  bars: { label: string; value: string; pct: number }[]; barsCaption: string | null; asOf: string;
}
export interface MatchCard {
  kind: 'match'; context: string; status: string; asOf: string;
  home: { name: string; logo: string | null; score: number | null; scorers: string[] };
  away: { name: string; logo: string | null; score: number | null; scorers: string[] };
  stats: { label: string; home: number | null; away: number | null; text: [string, string] }[];
  potm: { name: string; team: string; rating: number; photo: string | null; line: string } | null;
}
export type StatCard = PlayerCard | MatchCard;

const day = (d = new Date()) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });
const n = (v: number | null | undefined, d = 0) => (v == null || !Number.isFinite(Number(v)) ? '–' : Number(v).toFixed(d));

// ---------- drawing ----------
const mark = (asOf: string): Node => h('div', { justifyContent: 'space-between', alignItems: 'center', fontFamily: 'Plex, PlexExt', fontSize: 24, color: C.mute },
  h('div', { fontFamily: 'Archivo, ArchivoExt', fontWeight: 800, fontSize: 30, color: C.text, letterSpacing: -0.5 }, 'plaibook', h('span', { color: C.teal }, '.live')),
  h('div', {}, asOf));

const ratingBox = (v: number, label: string, size: number): Node => h('div', { flexDirection: 'column', alignItems: 'center', gap: 8 },
  h('div', { background: ratingHex(v), color: C.bg, borderRadius: 18, padding: '10px 22px', fontFamily: 'Archivo, ArchivoExt', fontWeight: 800, fontSize: size, lineHeight: 1 }, v.toFixed(2)),
  h('div', { fontFamily: 'Plex, PlexExt', fontWeight: 600, fontSize: 22, color: C.soft }, label));

function playerNode(c: PlayerCard): Node {
  const stats = c.stats.slice(0, 8);
  const rows = [stats.slice(0, 4), stats.slice(4, 8)].filter((r) => r.length);
  return h('div', { width: PLAYER_W, height: PLAYER_H, background: C.bg, color: C.text, flexDirection: 'column', padding: '56px 64px 48px', boxSizing: 'border-box', justifyContent: 'space-between' },
    h('div', { flexDirection: 'column', gap: 34 },
      h('div', { fontFamily: 'Plex, PlexExt', fontWeight: 600, fontSize: 24, color: C.teal, letterSpacing: 1 }, fit(c.context.toUpperCase(), 60)),
      // Header: photo (club crest on it), name and club, the season rating.
      h('div', { alignItems: 'center', gap: 32 },
        h('div', { position: 'relative', width: 160, height: 160 },
          c.photo ? img(c.photo, 160, true) : initials(c.name, 160),
          c.crest ? h('div', { position: 'absolute', right: -6, bottom: -6, width: 64, height: 64, borderRadius: 32, background: '#FFFFFF', alignItems: 'center', justifyContent: 'center', border: `4px solid ${C.bg}` }, img(c.crest, 44, false)) : null),
        h('div', { flexDirection: 'column', flex: 1, gap: 8 },
          h('div', { fontFamily: 'Archivo, ArchivoExt', fontWeight: 800, fontSize: c.name.length > 18 ? 56 : 68, lineHeight: 1, letterSpacing: -1.5 }, fit(c.name, 30)),
          c.subtitle ? h('div', { fontFamily: 'Plex, PlexExt', fontSize: 30, color: C.soft }, fit(c.subtitle, 44)) : null),
        c.rating != null ? ratingBox(c.rating, c.ratingLabel, 64) : null),
      // Eight numbers in two rows.
      h('div', { flexDirection: 'column', borderRadius: 20, border: `2px solid ${C.line}`, background: C.card },
        ...rows.map((r, i) => h('div', { borderTop: i ? `2px solid ${C.line}` : 'none' },
          ...r.map((s, j) => h('div', { flex: 1, flexDirection: 'column', padding: '18px 22px', borderLeft: j ? `2px solid ${C.line}` : 'none' },
            h('div', { fontFamily: 'Archivo, ArchivoExt', fontWeight: 800, fontSize: 48, lineHeight: 1 }, s.value),
            h('div', { fontFamily: 'Plex, PlexExt', fontWeight: 600, fontSize: 21, color: C.mute, marginTop: 6 }, s.label)))))),
      // Percentile bars.
      c.bars.length ? h('div', { flexDirection: 'column', gap: 12 },
        c.barsCaption ? h('div', { fontFamily: 'Plex, PlexExt', fontSize: 24, color: C.mute }, fit(c.barsCaption, 80)) : null,
        ...c.bars.slice(0, 8).map((b) => h('div', { alignItems: 'center', gap: 24 },
          h('div', { width: 300, flexDirection: 'column' },
            h('div', { fontFamily: 'Plex, PlexExt', fontWeight: 600, fontSize: 25, color: C.text, lineHeight: 1.2 }, b.label),
            h('div', { fontFamily: 'Plex, PlexExt', fontSize: 19, color: C.mute }, b.value)),
          h('div', { flex: 1, height: 20, borderRadius: 10, background: C.line },
            h('div', { width: `${Math.max(3, Math.round(b.pct * 100))}%`, height: 20, borderRadius: 10, background: pctHex(b.pct) })),
          h('div', { width: 64, justifyContent: 'flex-end', fontFamily: 'Archivo, ArchivoExt', fontWeight: 800, fontSize: 34 }, String(Math.round(b.pct * 100)))))) : null),
    mark(c.asOf));
}

function matchNode(c: MatchCard): Node {
  const side = (s: MatchCard['home'], align: 'flex-start' | 'flex-end') => h('div', { flexDirection: 'column', alignItems: 'center', gap: 16, width: 300 },
    s.logo ? img(s.logo, 140, false) : initials(s.name, 140),
    h('div', { fontFamily: 'Archivo, ArchivoExt', fontWeight: 700, fontSize: s.name.length > 16 ? 32 : 40, textAlign: 'center', justifyContent: 'center', lineHeight: 1.1 }, fit(s.name, 26)),
    h('div', { flexDirection: 'column', alignItems: align === 'flex-start' ? 'center' : 'center', gap: 2, fontFamily: 'Plex, PlexExt', fontSize: 22, color: C.soft },
      ...s.scorers.slice(0, 4).map((x) => h('div', {}, fit(x, 28)))));
  const played = c.home.score != null && c.away.score != null;
  const rows = c.stats.filter((s) => s.home != null || s.away != null).slice(0, 5);
  return h('div', { width: MATCH_W, height: MATCH_H, background: C.bg, color: C.text, flexDirection: 'column', padding: '56px 64px', boxSizing: 'border-box', justifyContent: 'space-between' },
    h('div', { fontFamily: 'Plex, PlexExt', fontWeight: 600, fontSize: 24, color: C.teal, letterSpacing: 1, justifyContent: 'center' }, fit(c.context.toUpperCase(), 60)),
    h('div', { alignItems: 'flex-start', justifyContent: 'space-between' },
      side(c.home, 'flex-start'),
      h('div', { flexDirection: 'column', alignItems: 'center', gap: 10, paddingTop: 20 },
        h('div', { fontFamily: 'Archivo, ArchivoExt', fontWeight: 800, fontSize: played ? 132 : 72, lineHeight: 1, letterSpacing: -2 }, played ? `${c.home.score}-${c.away.score}` : 'vs'),
        h('div', { fontFamily: 'Plex, PlexExt', fontWeight: 600, fontSize: 24, color: C.soft, background: C.card, borderRadius: 20, padding: '6px 18px' }, c.status)),
      side(c.away, 'flex-end')),
    rows.length ? h('div', { flexDirection: 'column', gap: 16, background: C.card, borderRadius: 20, border: `2px solid ${C.line}`, padding: '24px 28px' },
      ...rows.map((r) => {
        const total = (r.home ?? 0) + (r.away ?? 0);
        const hs = total ? (r.home ?? 0) / total : 0, as = total ? (r.away ?? 0) / total : 0;
        return h('div', { flexDirection: 'column', gap: 8 },
          h('div', { justifyContent: 'space-between', alignItems: 'center', fontFamily: 'Plex, PlexExt', fontSize: 24 },
            h('div', { fontFamily: 'Archivo, ArchivoExt', fontWeight: 800, color: C.text }, r.text[0]),
            h('div', { color: C.mute }, r.label),
            h('div', { fontFamily: 'Archivo, ArchivoExt', fontWeight: 800, color: C.text }, r.text[1])),
          h('div', { gap: 8 },
            h('div', { flex: 1, height: 12, borderRadius: 6, background: C.line, justifyContent: 'flex-end' }, h('div', { width: `${hs * 100}%`, height: 12, borderRadius: 6, background: C.teal })),
            h('div', { flex: 1, height: 12, borderRadius: 6, background: C.line }, h('div', { width: `${as * 100}%`, height: 12, borderRadius: 6, background: AWAY }))));
      })) : h('div', {}),
    c.potm ? h('div', { alignItems: 'center', gap: 20 },
      c.potm.photo ? img(c.potm.photo, 72, true) : initials(c.potm.name, 72),
      h('div', { flexDirection: 'column', flex: 1 },
        h('div', { fontFamily: 'Plex, PlexExt', fontWeight: 600, fontSize: 20, color: C.mute }, 'PLAYER OF THE MATCH'),
        h('div', { fontFamily: 'Archivo, ArchivoExt', fontWeight: 800, fontSize: 34 }, fit(c.potm.name, 30)),
        h('div', { fontFamily: 'Plex, PlexExt', fontSize: 22, color: C.soft }, fit(c.potm.line, 50))),
      h('div', { background: ratingHex(c.potm.rating), color: C.bg, borderRadius: 14, padding: '8px 16px', fontFamily: 'Archivo, ArchivoExt', fontWeight: 800, fontSize: 44 }, c.potm.rating.toFixed(1))) : h('div', {}),
    mark(c.asOf));
}

export async function renderStatCard(card: StatCard): Promise<Buffer> {
  const [W, H] = card.kind === 'match' ? [MATCH_W, MATCH_H] : [PLAYER_W, PLAYER_H];
  const svg = await satori((card.kind === 'match' ? matchNode(card) : playerNode(card)) as any, { width: W, height: H, fonts: loadFonts() });
  return Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: W } }).render().asPng());
}

// ---------- from page data ----------
const PCT_LABEL: Record<string, string> = { goals: 'Goals', assists: 'Assists', shots: 'Shots', shots_on: 'On target', key_passes: 'Key passes', passes: 'Passes', pass_accuracy: 'Pass accuracy', tackles: 'Tackles', interceptions: 'Interceptions', duels_won: 'Duels won', dribbles_won: 'Dribbles', saves: 'Saves', rating: 'Match rating' };
const OUTFIELD_BARS = ['goals', 'shots', 'assists', 'key_passes', 'dribbles_won', 'pass_accuracy', 'tackles', 'duels_won'];
const KEEPER_BARS = ['saves', 'pass_accuracy', 'passes', 'rating'];
const POS: Record<string, string> = { G: 'Goalkeeper', D: 'Defender', M: 'Midfielder', F: 'Forward', Goalkeeper: 'Goalkeeper', Defender: 'Defender', Midfielder: 'Midfielder', Attacker: 'Forward' };

/** The club season: the current season's rows for his club team added together (league and cups), as the page's strip. */
export function proPlayerStatCard(p: ProPlayerPage, photo: string | null, crest: string | null, asOf = day()): PlayerCard {
  const club = p.seasons.filter((s) => !s.team?.national);
  const season = club[0]?.season ?? null;
  const rows = club.filter((s) => s.season === season);
  const sum = (k: keyof (typeof rows)[number]) => rows.reduce((t, r) => t + (Number(r[k]) || 0), 0);
  const has = (k: keyof (typeof rows)[number]) => rows.some((r) => r[k] != null);
  let rw = 0, ra = 0, pw = 0, pp = 0;
  for (const r of rows) { if (r.rating != null && r.apps) { rw += r.rating * r.apps; ra += r.apps; } if (r.pass_accuracy != null && r.passes) { pw += Number(r.pass_accuracy) * r.passes; pp += r.passes; } }
  const keeper = /goal/i.test(p.player.position ?? '') || (POS[p.player.position ?? ''] === 'Goalkeeper');
  const minutes = sum('minutes');
  const stats = keeper
    ? [[n(sum('apps')), 'Apps'], [n(minutes), 'Minutes'], [n(sum('clean_sheets')), 'Clean sheets'], [n(sum('saves')), 'Saves'], [n(sum('conceded')), 'Conceded'], [pp ? `${Math.round(pw / pp)}%` : '–', 'Pass accuracy'], [n(sum('passes')), 'Passes'], [n(sum('starts')), 'Starts']]
    : [[n(sum('apps')), 'Apps'], [n(minutes), 'Minutes'], [n(sum('goals')), 'Goals'], [n(sum('assists')), 'Assists'], [has('shots') ? n(sum('shots')) : '–', 'Shots'], [has('key_passes') ? n(sum('key_passes')) : '–', 'Key passes'], [pp ? `${Math.round(pw / pp)}%` : '–', 'Pass accuracy'], [has('dribbles_won') ? n(sum('dribbles_won')) : '–', 'Dribbles']];
  const pr = p.percentiles;
  const byStat = new Map((pr?.rows ?? []).map((r) => [r.stat, r]));
  const bars = (keeper ? KEEPER_BARS : OUTFIELD_BARS).map((k) => byStat.get(k)).filter((r): r is NonNullable<typeof r> => !!r)
    .map((r) => ({ label: PCT_LABEL[r.stat] ?? r.stat, pct: r.pct, value: r.stat === 'pass_accuracy' ? `${Math.round(r.value)}%` : r.stat === 'rating' ? r.value.toFixed(2) : `${r.value.toFixed(2)} per 90` }));
  const pos = POS[p.player.position ?? ''] ?? p.player.position;
  return {
    kind: 'player', context: [season ? `${season} season` : null, rows[0]?.league?.name].filter(Boolean).join(', ') || 'Pro soccer', name: p.player.name,
    subtitle: [p.team?.name, pos, p.player.nationality].filter(Boolean).join(' · ') || null, photo, crest,
    rating: ra ? rw / ra : null, ratingLabel: season ? `${season} rating` : 'Rating', stats: stats.map(([value, label]) => ({ value: value!, label: label! })),
    bars, barsCaption: pr && bars.length ? `Percentiles per 90 against ${pr.rows[0]?.peers ?? 0} ${pos ? `${pos.toLowerCase()}s` : 'players'}, ${pr.league?.name ?? ''} ${pr.season}` : null, asOf,
  };
}

export function collegePlayerStatCard(p: PlayerPage, photo: string | null, asOf = day()): PlayerCard {
  const s = p.seasons[0];
  const keeper = !!s && (s.position ?? '').toUpperCase().startsWith('G') && (s.saves ?? 0) > 0;
  const stats = !s ? [] : keeper
    ? [[n(s.gp), 'Games'], [n(s.minutes), 'Minutes'], [n(s.saves), 'Saves'], [n(s.ga), 'Conceded'], [n(s.gaa, 2), 'GAA'], [s.save_pct != null ? `${Math.round(Number(s.save_pct) * (Number(s.save_pct) <= 1 ? 100 : 1))}%` : '–', 'Save %'], [n(s.shutouts), 'Shutouts'], [n(s.gs), 'Starts']]
    : [[n(s.gp), 'Games'], [n(s.minutes), 'Minutes'], [n(s.goals), 'Goals'], [n(s.assists), 'Assists'], [n(s.points), 'Points'], [n(s.shots), 'Shots'], [n(s.sog), 'On goal'], [n(s.gs), 'Starts']];
  return {
    kind: 'player', context: s ? `${s.season} college season` : 'College soccer', name: p.name,
    subtitle: s ? [s.team.name, s.position, s.class_label].filter(Boolean).join(' · ') : p.hometown, photo, crest: null,
    rating: null, ratingLabel: '', stats: stats.map(([value, label]) => ({ value: value!, label: label! })), bars: [], barsCaption: null, asOf,
  };
}

export function proMatchStatCard(p: ProMatchPage, logos: [string | null, string | null], potmPhoto: string | null, asOf = day()): MatchCard {
  const m = p.match;
  const final = m.status === 'final', live = m.status === 'live';
  const min = (e: { minute: number | null; extra: number | null }) => (e.minute == null ? '' : `${e.minute}${e.extra ? `+${e.extra}` : ''}'`);
  // An own goal counts for the other side (the event carries the scorer's own club).
  const goals = p.events.filter((e) => e.type === 'goal' && e.comments !== 'Penalty Shootout' && e.detail !== 'Missed Penalty');
  const scorers = (side: 'home' | 'away') => {
    const by = new Map<string, string[]>();
    for (const e of goals) {
      const own = e.detail === 'Own Goal';
      const forSide = own ? (e.side === 'home' ? 'away' : 'home') : e.side;
      if (forSide !== side) continue;
      const name = `${(e.player_name ?? 'Goal').split(' ').slice(-1)[0]}${own ? ' (OG)' : e.detail === 'Penalty' ? ' (P)' : ''}`;
      by.set(name, [...(by.get(name) ?? []), min(e)]);
    }
    return [...by].map(([name, mins]) => `${name} ${mins.join(', ')}`);
  };
  const st = (k: string) => [p.home.stats?.[k] ?? null, p.away.stats?.[k] ?? null].map((v) => (v == null ? null : Number(v))) as [number | null, number | null];
  const row = (k: string, label: string, f: (v: number | null) => string) => { const [a, b] = st(k); return { label, home: a, away: b, text: [f(a), f(b)] as [string, string] }; };
  const int = (v: number | null) => (v == null ? '–' : String(v));
  const all = [...p.home.starters, ...p.home.bench].map((l) => ({ l, team: m.home.name })).concat([...p.away.starters, ...p.away.bench].map((l) => ({ l, team: m.away.name })))
    .filter((x) => x.l.rating != null && Number(x.l.rating) > 0);
  const long = all.filter((x) => (x.l.minutes ?? 0) >= 45);
  const best = (long.length ? long : all).sort((a, b) => Number(b.l.rating) - Number(a.l.rating))[0];
  return {
    kind: 'match', context: [m.league.name, m.round?.replace(/^Regular Season - /, 'Round ')].filter(Boolean).join(' · '),
    status: final ? (m.status_short === 'AET' ? 'After extra time' : m.status_short === 'PEN' ? `Penalties ${m.pen[0]}-${m.pen[1]}` : 'Full time') : live ? `Live ${m.elapsed ?? ''}'` : new Date(m.kickoff).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' }),
    asOf: final ? day(new Date(m.kickoff)) : asOf,
    home: { name: m.home.name, logo: logos[0], score: final || live ? m.home.score : null, scorers: scorers('home') },
    away: { name: m.away.name, logo: logos[1], score: final || live ? m.away.score : null, scorers: scorers('away') },
    stats: [row('possession', 'Possession', (v) => (v == null ? '–' : `${Math.round(v)}%`)), row('xg', 'Expected goals', (v) => (v == null ? '–' : v.toFixed(2))), row('shots', 'Shots', int), row('shots_on', 'On target', int), row('corners', 'Corners', int)],
    potm: best ? { name: best.l.display ?? best.l.name, team: best.team, rating: Number(best.l.rating), photo: potmPhoto, line: [best.team, best.l.goals ? `${best.l.goals} goal${best.l.goals > 1 ? 's' : ''}` : null, best.l.assists ? `${best.l.assists} assist${best.l.assists > 1 ? 's' : ''}` : null, best.l.minutes != null ? `${best.l.minutes} min` : null].filter(Boolean).join(', ') } : null,
  };
}

/** The best-rated player's photo URL (for the match card), before the card is built. */
const potmPhotoUrl = (p: ProMatchPage): string | null => {
  const all = [...p.home.starters, ...p.home.bench, ...p.away.starters, ...p.away.bench].filter((l) => l.rating != null && Number(l.rating) > 0);
  const long = all.filter((l) => (l.minutes ?? 0) >= 45);
  const best = (long.length ? long : all).sort((a, b) => Number(b.rating) - Number(a.rating))[0];
  return (best as { photo?: string | null } | undefined)?.photo ?? null;
};

/** The stat card for a page path, or null when that page has none. */
export async function statCardFor(path: string, data: SeoData, pro: ProSeoData | null, fetcher: typeof fetch = fetch): Promise<StatCard | null> {
  const seg = path.split('/').filter(Boolean).map((s) => decodeURIComponent(s));
  const [a, b, c] = seg;
  if (a === 'players' && b && seg.length === 2) { const p = await data.player(b); return p ? collegePlayerStatCard(p, await imageData(p.headshot_url, fetcher)) : null; }
  if (pro && (a === 'pro' || a === 'intl') && b && c && seg.length === 3) {
    if (b === 'players') {
      const p = await pro.player(c);
      if (!p || 'minor' in p) return null;
      const [photo, crest] = await Promise.all([imageData(p.player.photo, fetcher), imageData(p.team?.logo, fetcher)]);
      return proPlayerStatCard(p, photo, crest);
    }
    if (b === 'matches') {
      const m = await pro.match(c);
      if (!m) return null;
      const [hl, al, ph] = await Promise.all([imageData(m.match.home.logo, fetcher), imageData(m.match.away.logo, fetcher), imageData(potmPhotoUrl(m), fetcher)]);
      return proMatchStatCard(m, [hl, al], ph);
    }
  }
  return null;
}
