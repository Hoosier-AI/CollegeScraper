// Both starting elevens on one pitch: home in the bottom half attacking upwards, away mirrored above. Rows follow the
// box score's position groups (keeper, defenders, midfielders, forwards); players in a row are spread evenly, so
// 4 defenders, 3 midfielders and 3 forwards read as a 4-3-3 without inventing exact roles.
import { Link } from 'react-router-dom';
import { useHref } from '../../lib/filters';
import { PlayerAvatar } from '../primitives';

type Band = 'gk' | 'd' | 'x' | 'm' | 'f';
const BAND: [Band, RegExp][] = [['gk', /^(GK|G|K)$/i], ['d', /^(D|DEF|CB|LB|RB|WB|FB|B)$/i], ['m', /^(M|MF|MID|CM|DM|AM|CDM|CAM|LM|RM|W|WM)$/i], ['f', /^(F|FW|FWD|ST|CF|A|ATT)$/i]];
// Distance of each band from the goal line, as a fraction of the half.
const DEPTH: Record<Band, number> = { gk: 0.08, d: 0.3, x: 0.45, m: 0.58, f: 0.84 };

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
  for (const [b, list] of rows) {
    const sorted = [...list].sort((a, c) => (a.jersey ?? 99) - (c.jersey ?? 99));
    // A very wide row (7+) is split in two staggered lines so tokens do not overlap.
    const chunks = sorted.length >= 7 ? [sorted.slice(0, Math.ceil(sorted.length / 2)), sorted.slice(Math.ceil(sorted.length / 2))] : [sorted];
    chunks.forEach((chunk, ci) => chunk.forEach((line, i) => out.push({ line, x: (i + 1) / (chunk.length + 1), y: DEPTH[b] + (chunks.length > 1 ? (ci ? 0.08 : -0.08) : 0) })));
  }
  return out;
}

function Token({ line, x, y, top, crest, crestSeo }: { line: any; x: number; y: number; top: boolean; crest?: string | null; crestSeo?: string | null }) {
  const href = useHref();
  const last = String(line.name ?? '').trim().split(/\s+/).slice(-1)[0] ?? '';
  const marks = [line.goals ? { t: `${line.goals} G`, c: 'bg-win text-field-950' } : null, line.assists ? { t: `${line.assists} A`, c: 'bg-chalk-200 text-field-950' } : null, line.rc ? { t: 'RC', c: 'bg-loss text-field-950' } : line.yc ? { t: 'YC', c: 'bg-note text-field-950' } : null].filter(Boolean) as { t: string; c: string }[];
  const body = (
    <>
      <span className="relative block">
        <PlayerAvatar src={line.headshot_url} name={line.name} size={40} crest={crest} crestSeo={crestSeo} />
        <span className="absolute -bottom-1 -right-1 rounded bg-field-950 px-1 text-[10px] font-semibold text-chalk-100 tnum shadow" aria-hidden>{line.jersey ?? ''}</span>
        {marks.length > 0 && <span className="absolute -left-1 -top-1 flex flex-col gap-0.5" aria-hidden>{marks.map((m) => <span key={m.t} className={`rounded px-1 text-[9px] font-semibold leading-3 ${m.c}`}>{m.t}</span>)}</span>}
      </span>
      <span className="mt-1 block max-w-[72px] truncate text-center text-[11px] font-medium text-white drop-shadow">{last}</span>
    </>
  );
  const style = { left: `${x * 100}%`, top: `${(top ? y / 2 : 1 - y / 2) * 100}%` };
  const cls = 'absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center rounded focus-visible:outline-2';
  const label = `${line.jersey ?? ''} ${line.name}${marks.length ? `, ${marks.map((m) => m.t).join(', ')}` : ''}`;
  return line.player_id ? <Link to={href(`/players/${line.player_id}`)} className={cls} style={style} aria-label={label}>{body}</Link> : <span className={cls} style={style} aria-label={label}>{body}</span>;
}

export function Pitch({ home, away, homeName, awayName, homeCrest, awayCrest }: { home: any | null; away: any | null; homeName: string | null; awayName: string | null; homeCrest?: { src?: string | null; seo?: string | null }; awayCrest?: { src?: string | null; seo?: string | null } }) {
  const hs = home ? placeStarters(home.starters) : [];
  const as = away ? placeStarters(away.starters) : [];
  return (
    <figure className="mx-auto w-full max-w-md">
      <div className="relative w-full overflow-hidden rounded-xl border border-field-700" style={{ aspectRatio: '68 / 105', background: '#123b26' }} role="img" aria-label={`Starting lineups: ${awayName ?? 'away'} at the top, ${homeName ?? 'home'} at the bottom`}>
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
        <span className="absolute left-2 top-2 rounded bg-field-950/70 px-1.5 py-0.5 text-[10px] font-medium text-chalk-200">{awayName ?? 'Away'}</span>
        <span className="absolute bottom-2 left-2 rounded bg-field-950/70 px-1.5 py-0.5 text-[10px] font-medium text-chalk-200">{homeName ?? 'Home'}</span>
        {as.map((p) => <Token key={`a-${p.line.jersey}-${p.line.name}`} line={p.line} x={p.x} y={p.y} top crest={awayCrest?.src} crestSeo={awayCrest?.seo} />)}
        {hs.map((p) => <Token key={`h-${p.line.jersey}-${p.line.name}`} line={p.line} x={p.x} y={p.y} top={false} crest={homeCrest?.src} crestSeo={homeCrest?.seo} />)}
        {!home && !away && <span className="absolute inset-0 flex items-center justify-center text-sm text-chalk-200">No lineups yet</span>}
      </div>
    </figure>
  );
}
