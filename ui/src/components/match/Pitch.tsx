// Both starting elevens on one pitch: home in the bottom half attacking upwards, away mirrored above. Rows follow the
// box score's position groups (keeper, defenders, midfielders, forwards); players in a row are spread evenly, so
// 4 defenders, 3 midfielders and 3 forwards read as a 4-3-3 without inventing exact roles.
import { Link } from 'react-router-dom';
import { useHref } from '../../lib/filters';
import { PlayerAvatar } from '../primitives';
import { LineupChip, type SideLineup } from './parts';

type Band = 'gk' | 'd' | 'x' | 'm' | 'f';
const BAND: [Band, RegExp][] = [['gk', /^(GK|G|K)$/i], ['d', /^(D|DEF|CB|LB|RB|WB|FB|B)$/i], ['m', /^(M|MF|MID|CM|DM|AM|CDM|CAM|LM|RM|W|WM)$/i], ['f', /^(F|FW|FWD|ST|CF|A|ATT)$/i]];
const ORDER: Band[] = ['gk', 'd', 'x', 'm', 'f'];
// The keeper stands near the goal line; the outfield rows present are spread evenly up to the halfway line, so a
// side with an extra row of unrecognised positions still has room between rows.
const depths = (present: Band[]): Map<Band, number> => {
  const out = new Map<Band, number>();
  const outfield = ORDER.filter((b) => b !== 'gk' && present.includes(b));
  if (present.includes('gk')) out.set('gk', 0.08);
  outfield.forEach((b, i) => out.set(b, outfield.length === 1 ? 0.58 : 0.3 + (0.56 * i) / (outfield.length - 1)));
  return out;
};

function bandOf(l: any): Band {
  if (l.is_goalie) return 'gk';
  const p = String(l.position ?? '').trim();
  for (const [b, re] of BAND) if (re.test(p)) return b;
  return 'x';
}

/** Positions for one side's starters within its half, y from that side's goal line (0) to the halfway line (1). */
export function placeStarters(starters: any[]): { line: any; x: number; y: number }[] {
  const rows = new Map<Band, any[]>();
  for (const l of starters) { const b = bandOf(l); rows.set(b, [...(rows.get(b) ?? []), l]); }
  // Only one keeper stands in goal; extra "keepers" (data errors) join the defenders.
  const gk = rows.get('gk') ?? [];
  if (gk.length > 1) { rows.set('gk', gk.slice(0, 1)); rows.set('d', [...gk.slice(1), ...(rows.get('d') ?? [])]); }
  const out: { line: any; x: number; y: number }[] = [];
  const DEPTH = depths([...rows.keys()]);
  for (const [b, list] of rows) {
    const sorted = [...list].sort((a, c) => (a.jersey ?? 99) - (c.jersey ?? 99));
    // A very wide row (7+) is split in two staggered lines so tokens do not overlap.
    const chunks = sorted.length >= 7 ? [sorted.slice(0, Math.ceil(sorted.length / 2)), sorted.slice(Math.ceil(sorted.length / 2))] : [sorted];
    chunks.forEach((chunk, ci) => chunk.forEach((line, i) => out.push({ line, x: (i + 1) / (chunk.length + 1), y: (DEPTH.get(b) ?? 0.58) + (chunks.length > 1 ? (ci ? 0.11 : -0.11) : 0) })));
  }
  return out;
}

function Token({ line, x, y, top, crest, crestSeo, past }: { line: any; x: number; y: number; top: boolean; crest?: string | null; crestSeo?: string | null; past?: boolean }) {
  const href = useHref();
  const last = String(line.name ?? '').trim().split(/\s+/).slice(-1)[0] ?? '';
  const marks = [line.goals ? { t: `${line.goals} G`, c: 'bg-win text-field-950' } : null, line.assists ? { t: `${line.assists} A`, c: 'bg-chalk-200 text-field-950' } : null, line.rc ? { t: 'RC', c: 'bg-loss text-field-950' } : line.yc ? { t: 'YC', c: 'bg-note text-field-950' } : null].filter(Boolean) as { t: string; c: string }[];
  const body = (
    <>
      <span className="relative block">
        <PlayerAvatar src={line.headshot_url} name={line.name} size={40} crest={crest} crestSeo={crestSeo} ring={past ? 'past' : undefined} />
        <span className="absolute -bottom-1 -right-1 rounded bg-field-950 px-1 text-[10px] font-semibold text-chalk-100 tnum shadow" aria-hidden>{line.jersey ?? ''}</span>
        {marks.length > 0 && <span className="absolute -left-1 -top-1 flex flex-col gap-0.5" aria-hidden>{marks.map((m) => <span key={m.t} className={`rounded px-1 text-[9px] font-semibold leading-3 ${m.c}`}>{m.t}</span>)}</span>}
      </span>
      <span className="mt-1 block max-w-[72px] truncate text-center text-[11px] font-medium text-white drop-shadow">{last}</span>
    </>
  );
  const style = { left: `${x * 100}%`, top: `${(top ? y / 2 : 1 - y / 2) * 100}%` };
  const cls = `absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center rounded focus-visible:outline-2 ${past ? 'opacity-75' : ''}`;
  const label = `${line.jersey ?? ''} ${line.name}${marks.length ? `, ${marks.map((m) => m.t).join(', ')}` : ''}`;
  return line.player_id ? <Link to={href(`/players/${line.player_id}`)} className={cls} style={style} aria-label={label}>{body}</Link> : <span className={cls} style={style} aria-label={label}>{body}</span>;
}

export function Pitch({ home, away, homeName, awayName }: { home: SideLineup; away: SideLineup; homeName: string | null; awayName: string | null }) {
  // Only a lineup with starters is drawn; a box score that lists who played without marking starters keeps its
  // half empty (the list beside the pitch carries the players) rather than guessing an XI.
  const drawn = (s: SideLineup) => (s.lineup && (s.status === 'match' || s.status === 'past') ? placeStarters(s.lineup.starters) : []);
  const hs = drawn(home), as = drawn(away);
  const halfNote = (s: SideLineup) => (s.status === 'none' ? 'No lineup yet' : s.status === 'no_starters' ? 'Starters not marked in the box score' : null);
  const label = (s: SideLineup) => (s.status === 'past' ? 'past lineup' : s.status === 'match' ? 'starting XI' : 'no lineup');
  return (
    <figure className="mx-auto w-full max-w-md">
      <div className="relative w-full overflow-hidden rounded-xl border border-field-700" style={{ aspectRatio: '68 / 105', background: '#123b26' }} role="img" aria-label={`${awayName ?? 'Away'} (${label(away)}) at the top, ${homeName ?? 'home'} (${label(home)}) at the bottom`}>
        <svg viewBox="0 0 68 105" className="absolute inset-0 h-full w-full" aria-hidden>
          <g fill="none" stroke="#2c6b46" strokeWidth="0.6">
            <rect x="1" y="1" width="66" height="103" />
            <line x1="1" y1="52.5" x2="67" y2="52.5" />
            <circle cx="34" cy="52.5" r="9.15" />
            <circle cx="34" cy="52.5" r="0.6" fill="#2c6b46" />
            <rect x="13.84" y="1" width="40.32" height="16.5" /><rect x="24.84" y="1" width="18.32" height="5.5" /><circle cx="34" cy="12" r="0.6" fill="#2c6b46" />
            <rect x="13.84" y="87.5" width="40.32" height="16.5" /><rect x="24.84" y="98.5" width="18.32" height="5.5" /><circle cx="34" cy="93" r="0.6" fill="#2c6b46" />
            <path d="M 26.7 17.5 A 9.15 9.15 0 0 0 41.3 17.5" /><path d="M 26.7 87.5 A 9.15 9.15 0 0 1 41.3 87.5" />
          </g>
          {[8, 20, 32, 44, 56, 68, 80, 92].map((y) => <rect key={y} x="1" y={y} width="66" height="6" fill="#ffffff" opacity="0.025" />)}
        </svg>
        <span className="absolute left-2 top-2 flex items-center gap-1.5 rounded bg-field-950/70 px-1.5 py-0.5 text-[10px] font-medium text-chalk-200">{awayName ?? 'Away'}<LineupChip status={away.status} past={away.past} compact /></span>
        <span className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded bg-field-950/70 px-1.5 py-0.5 text-[10px] font-medium text-chalk-200">{homeName ?? 'Home'}<LineupChip status={home.status} past={home.past} compact /></span>
        {as.map((p) => <Token key={`a-${p.line.jersey}-${p.line.name}`} line={p.line} x={p.x} y={p.y} top crest={away.crest} crestSeo={away.crestSeo} past={away.status === 'past'} />)}
        {hs.map((p) => <Token key={`h-${p.line.jersey}-${p.line.name}`} line={p.line} x={p.x} y={p.y} top={false} crest={home.crest} crestSeo={home.crestSeo} past={home.status === 'past'} />)}
        {halfNote(away) && <span className="absolute inset-x-0 top-0 flex h-1/2 items-center justify-center px-6 text-center text-sm text-chalk-200">{halfNote(away)}</span>}
        {halfNote(home) && <span className="absolute inset-x-0 bottom-0 flex h-1/2 items-center justify-center px-6 text-center text-sm text-chalk-200">{halfNote(home)}</span>}
      </div>
    </figure>
  );
}
