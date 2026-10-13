// Plaibook Elo through a nation's history, explained. Hover (or touch, or step with the arrow keys) any point: the
// rating after that match, the match, and why it moved: the expected result from the two ratings and the venue, the
// match weight, the goal factor, and the change they make; plus the world rank that month and the year in short.
// Controls: the range, Rating or World rank, and a second nation to compare. Marked: the best world rank, World Cup
// wins, the biggest one-match gain and loss. Data: /api/intl/teams/:slug/elo (src/pro/intl.ts eloSeries).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError, fmt, qs } from '../../lib/api';
import { proPath } from '../../lib/pro';
import { monthLabel, type IntlNation } from '../../lib/intl';
import { SegmentedControl, Select, Skeleton } from '../primitives';

export interface EloPoint {
  date: string; rating: number; delta: number; opponent: { key: string; name: string; slug: string; logo: string | null }; tournament: string | null;
  gf: number | null; ga: number | null; opp_rating: number | null; expected: number | null; k: number | null; goal_factor: number | null; venue: string | null; match_slug: string | null;
}
export interface EloSeries {
  nation: { key: string; name: string; slug: string | null; logo: string | null }; gender: 'm' | 'w'; current: { rating: number; rank: number | null } | null;
  points: EloPoint[]; ranks: { m: string; r: number }[];
  moments: { best_rank: { rank: number; month: string } | null; biggest_gain: string | null; biggest_loss: string | null; titles: { date: string; title: string }[] };
}

const useEloSeries = (slug: string | null, gender?: 'm' | 'w') => useQuery({
  queryKey: ['intl-elo', slug, gender ?? ''], queryFn: () => api<EloSeries>(`/api/intl/teams/${slug}/elo${qs({ gender })}`), enabled: !!slug, staleTime: 600_000,
  retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 1,
});

type Range = 'all' | '1990' | '10y' | '4y';
type Metric = 'rating' | 'rank';
const RANGES: { value: Range; label: string }[] = [{ value: 'all', label: 'All time' }, { value: '1990', label: 'Since 1990' }, { value: '10y', label: '10 years' }, { value: '4y', label: '4 years' }];
const startOf = (r: Range): string => (r === '1990' ? '1990-01-01' : r === '10y' || r === '4y' ? new Date(Date.now() - (r === '10y' ? 10 : 4) * 365.25 * 86400_000).toISOString().slice(0, 10) : '0000');
const ts = (d: string) => Date.parse(`${d.length === 7 ? `${d}-15` : d}T12:00:00Z`);

// ---------- why a rating moved, in words ----------
const WEIGHT: Record<number, string> = { 60: 'World Cup', 50: 'continental championship', 40: 'qualifier or nations league', 30: 'tournament', 20: 'friendly' };
const pct = (v: number) => `${Math.round(v * 100)}%`;
const signed = (v: number, d = 0) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(d)}`;
const resultWord = (p: EloPoint) => (p.gf == null || p.ga == null ? '' : p.gf > p.ga ? 'Won' : p.gf < p.ga ? 'Lost' : 'Drew');
export function eloReason(p: EloPoint): { formula: string | null; words: string } {
  if (p.expected == null || p.k == null || p.goal_factor == null || p.gf == null || p.ga == null) return { formula: null, words: `${signed(p.delta, 1)} after this match.` };
  const w = p.gf > p.ga ? 1 : p.gf < p.ga ? 0 : 0.5, e = p.expected;
  const formula = `${p.k} × ${p.goal_factor % 1 ? p.goal_factor.toFixed(3).replace(/0+$/, '') : p.goal_factor} × (${w} − ${e.toFixed(2)}) = ${signed(p.delta, 1)}`;
  if (Math.abs(p.delta) < 0.05 && Math.abs(w - e) > 0.01) return { formula, words: `No change: ${p.opponent.name} was still provisional (a side's first 15 matches move only its own rating).` };
  // Under 40% expected: the stronger side was the opponent; 40-60%: an even match; over 60%: this side was favoured.
  const words = w === 1
    ? e < 0.4 ? 'Beat a stronger side: a big gain.' : e > 0.6 ? 'Won as expected: a small gain.' : 'Won an even match: a solid gain.'
    : w === 0.5
      ? e > 0.6 ? 'Drew when expected to win: lost points.' : e < 0.4 ? 'Held a stronger side: gained points.' : 'An even draw: little change.'
      : e > 0.6 ? 'Lost when expected to win: a big drop.' : e < 0.4 ? 'Lost to a stronger side: a small drop.' : 'Lost an even match: a solid drop.';
  return { formula, words };
}
const venueWord = (v: string | null) => (v === 'home' ? 'playing at home, +100' : v === 'away' ? 'playing away, −100' : 'neutral ground');
const marginWord = (p: EloPoint) => { const m = Math.abs((p.gf ?? 0) - (p.ga ?? 0)); return m <= 1 ? (m === 1 ? 'one-goal margin' : 'draw') : `${m}-goal margin`; };

/** The year around a match: rating at its start and end, the record, its biggest gain and loss. */
function yearSummary(points: EloPoint[], year: string) {
  const inYear = points.filter((p) => p.date.startsWith(year));
  if (!inYear.length) return null;
  const first = inYear[0]!, last = inYear[inYear.length - 1]!;
  const start = first.rating - first.delta;
  let w = 0, d = 0, l = 0;
  for (const p of inYear) { if (p.gf == null || p.ga == null) continue; if (p.gf > p.ga) w++; else if (p.gf < p.ga) l++; else d++; }
  const best = inYear.reduce((a, b) => (b.delta > a.delta ? b : a)), worst = inYear.reduce((a, b) => (b.delta < a.delta ? b : a));
  return { year, start: Math.round(start), end: Math.round(last.rating), change: last.rating - start, w, d, l, matches: inYear.length, best, worst };
}

// ---------- the chart ----------
export function EloChart({ slug, gender, compareSlug: compareProp, allowCompare = true, caption }: { slug: string; gender?: 'm' | 'w'; compareSlug?: string | null; allowCompare?: boolean; caption?: string }) {
  const main = useEloSeries(slug, gender);
  const [range, setRange] = useState<Range>('all');
  const [metric, setMetric] = useState<Metric>('rating');
  const [picked, setPicked] = useState<string>('');
  const compareSlug = compareProp ?? (picked || null);
  const other = useEloSeries(compareSlug, gender);
  const nations = useQuery({ queryKey: ['intl-nations'], queryFn: () => api<IntlNation[]>('/api/intl/nations'), staleTime: 600_000, enabled: allowCompare && !compareProp });
  const [active, setActive] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  // A marked moment the pointer has snapped to: held until the pointer moves well clear of it (and for a beat).
  const lock = useRef<{ idx: number; at: number } | null>(null);

  const d = main.data;
  const from = startOf(range);
  const pts = useMemo(() => (d?.points ?? []).filter((p) => p.date >= from), [d, from]);
  const otherPts = useMemo(() => (other.data?.points ?? []).filter((p) => p.date >= from), [other.data, from]);
  const ranks = useMemo(() => (d?.ranks ?? []).filter((r) => `${r.m}-01` >= from.slice(0, 7)), [d, from]);
  const otherRanks = useMemo(() => (other.data?.ranks ?? []).filter((r) => `${r.m}-01` >= from.slice(0, 7)), [other.data, from]);
  useEffect(() => { setActive(null); lock.current = null; }, [range, metric, slug, compareSlug]);

  // Drawn at the container's own width so the labels stay readable on a phone instead of shrinking with the SVG.
  const [boxW, setBoxW] = useState(720);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => { const w = Math.round(entry?.contentRect.width ?? 0); if (w > 0) setBoxW(w); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [main.isPending]);
  const W = Math.max(300, boxW), H = W < 520 ? 210 : 230, L = 40, R = 12, T = 12, B = 24;
  const geo = useMemo(() => {
    if (!pts.length) return null;
    const t0 = range === 'all' ? ts(pts[0]!.date) : ts(from), t1 = Math.max(ts(pts[pts.length - 1]!.date), otherPts.length ? ts(otherPts[otherPts.length - 1]!.date) : 0, Date.now() - 86400_000);
    const x = (date: string) => L + ((ts(date) - t0) / Math.max(1, t1 - t0)) * (W - L - R);
    if (metric === 'rating') {
      const vals = [...pts.map((p) => p.rating), ...otherPts.map((p) => p.rating)];
      const lo = Math.floor(Math.min(...vals) / 50) * 50, hi = Math.ceil(Math.max(...vals) / 50) * 50;
      const y = (v: number) => H - B - ((v - lo) / Math.max(1, hi - lo)) * (H - T - B);
      const step = hi - lo > 600 ? 200 : hi - lo > 250 ? 100 : 50;
      return { x, y, t0, t1, grid: Array.from({ length: Math.floor((hi - lo) / step) + 1 }, (_, i) => lo + i * step), fmtY: (v: number) => String(v) };
    }
    const maxRank = Math.max(10, ...ranks.map((r) => r.r), ...otherRanks.map((r) => r.r));
    const top = 1, bottom = Math.min(Math.ceil(maxRank / 10) * 10, 220);
    const y = (v: number) => T + ((Math.min(v, bottom) - top) / Math.max(1, bottom - top)) * (H - T - B);
    const step = bottom > 100 ? 50 : bottom > 40 ? 20 : 10;
    return { x, y, t0, t1, grid: [1, ...Array.from({ length: Math.floor(bottom / step) }, (_, i) => (i + 1) * step)], fmtY: (v: number) => `#${v}` };
  }, [pts, otherPts, ranks, otherRanks, metric, range, from, W, H]);

  // A path through points, broken where a rank series has a gap (the side was unranked).
  const ratingPath = useCallback((list: EloPoint[]) => (geo ? list.map((p, i) => `${i ? 'L' : 'M'}${geo.x(p.date).toFixed(1)},${geo.y(p.rating).toFixed(1)}`).join(' ') : ''), [geo]);
  const rankPath = useCallback((list: { m: string; r: number }[]) => {
    if (!geo) return '';
    let out = '', prev: string | null = null;
    for (const r of list) {
      const gap = prev ? (Number(r.m.slice(0, 4)) * 12 + Number(r.m.slice(5))) - (Number(prev.slice(0, 4)) * 12 + Number(prev.slice(5))) > 2 : true;
      out += `${gap ? 'M' : 'L'}${geo.x(r.m).toFixed(1)},${geo.y(r.r).toFixed(1)}`;
      prev = r.m;
    }
    return out;
  }, [geo]);

  const nearest = (clientX: number, clientY: number) => {
    const el = box.current?.querySelector('svg');
    if (!el || !geo || !pts.length) return null;
    const rect = el.getBoundingClientRect();
    const vx = ((clientX - rect.left) / rect.width) * W, vy = ((clientY - rect.top) / rect.height) * H;
    const target = geo.t0 + ((vx - L) / (W - L - R)) * (geo.t1 - geo.t0);
    let lo = 0, hi = pts.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (ts(pts[mid]!.date) < target) lo = mid + 1; else hi = mid; }
    const idx = lo > 0 && Math.abs(ts(pts[lo - 1]!.date) - target) < Math.abs(ts(pts[lo]!.date) - target) ? lo - 1 : lo;
    return { idx, vx, vy };
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (!pts.length) return;
    const last = pts.length - 1;
    if (e.key === 'ArrowLeft') { e.preventDefault(); setActive((a) => Math.max(0, (a ?? last + 1) - 1)); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); setActive((a) => Math.min(last, (a ?? -1) + 1)); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(last); }
    else if (e.key === 'Escape') setActive(null);
  };

  if (main.isPending) return <Skeleton className="h-72" />;
  if (!d || !geo || pts.length < 2) return null;
  const p = active != null ? pts[active] : null;
  const rankAt = (list: { m: string; r: number }[], date: string) => list.find((r) => r.m === date.slice(0, 7))?.r ?? null;
  const otherAt = (date: string) => { let v: EloPoint | null = null; for (const q of other.data?.points ?? []) { if (q.date <= date) v = q; else break; } return v; };
  const titles = d.moments.titles.filter((t) => t.date >= from);
  const bestRank = d.moments.best_rank;
  const markDate = (date: string | null | undefined) => (date ? pts.find((q) => q.date >= date) ?? null : null);
  // The month-end table that gave the best rank came after the month's last match.
  const bestPt = bestRank ? pts.filter((q) => q.date.slice(0, 7) <= bestRank.month).at(-1) ?? pts.find((q) => q.date.slice(0, 7) >= bestRank.month) ?? null : null;
  const gainPt = markDate(d.moments.biggest_gain), lossPt = markDate(d.moments.biggest_loss);
  const yOf = (q: EloPoint) => (metric === 'rating' ? geo.y(q.rating) : rankAt(d.ranks, q.date) != null ? geo.y(rankAt(d.ranks, q.date)!) : null);
  // The marked moments, for snapping and for naming them in the card.
  // `dy`: where the marker is drawn relative to the line (the gain triangle above it, the drop below).
  const markers: { pt: EloPoint; label: string; dy: number }[] = [
    ...(bestPt && bestRank ? [{ pt: bestPt, label: `Best world rank: #${bestRank.rank}, first reached in ${monthLabel(bestRank.month)}`, dy: 0 }] : []),
    ...titles.flatMap((t) => { const q = markDate(t.date); return q ? [{ pt: q, label: `World Cup won, ${t.date.slice(0, 4)}`, dy: 0 }] : []; }),
    ...(gainPt ? [{ pt: gainPt, label: 'Biggest one-match gain', dy: -6 }] : []),
    ...(lossPt ? [{ pt: lossPt, label: 'Biggest one-match drop', dy: 6 }] : []),
  ];
  const SNAP = 16, RELEASE = 32, HOLD_MS = 350;
  const onPointer = (e: React.PointerEvent) => {
    const hit = nearest(e.clientX, e.clientY);
    if (!hit) return;
    const near = markers.map((mk) => { const yy = yOf(mk.pt); return { idx: pts.indexOf(mk.pt), dist: yy == null ? Infinity : Math.hypot(geo.x(mk.pt.date) - hit.vx, yy + mk.dy - hit.vy) }; })
      .filter((c) => c.idx >= 0).sort((a, b) => a.dist - b.dist)[0];
    const held = lock.current;
    if (held) {
      const q = pts[held.idx], yy = q ? yOf(q) : null;
      const dist = q && yy != null ? Math.hypot(geo.x(q.date) - hit.vx, yy - hit.vy) : Infinity;
      if (dist <= RELEASE || Date.now() - held.at < HOLD_MS) { setActive(held.idx); return; }
      lock.current = null;
    }
    if (near && near.dist <= SNAP) { lock.current = { idx: near.idx, at: Date.now() }; setActive(near.idx); return; }
    setActive(hit.idx);
  };
  const moment = p ? markers.filter((mk) => mk.pt === p).map((mk) => mk.label) : [];
  const years = (() => { const a = Number(new Date(geo.t0).getUTCFullYear()), b = Number(new Date(geo.t1).getUTCFullYear()); const span = (b - a) * (720 / W), step = span > 80 ? 20 : span > 30 ? 10 : span > 12 ? 4 : span > 5 ? 2 : 1; const out: number[] = []; for (let yr = Math.ceil(a / step) * step; yr <= b; yr += step) out.push(yr); return out; })();
  const ys = p ? yearSummary(d.points, p.date.slice(0, 4)) : null;
  const reason = p ? eloReason(p) : null;
  const ax = p ? geo.x(p.date) : 0, ay = p ? yOf(p) : null;
  const tipLeft = p ? (ax / W) * 100 : 0;
  const compareName = other.data?.nation.name;
  const options = (nations.data ?? []).filter((n) => n.level === 'senior' && n.gender === d.gender && n.slug !== slug).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <figure className="frame space-y-2 p-3" aria-label={`${d.nation.name}: Plaibook Elo`}>
      <figcaption className="flex flex-wrap items-center justify-between gap-2 text-xs text-chalk-400">
        <span>{caption ?? `${d.nation.name}: Plaibook Elo`}{bestRank ? <span className="ml-2 text-note">best world rank #{bestRank.rank} (first {monthLabel(bestRank.month)})</span> : null}</span>
        <span className="flex flex-wrap items-center gap-2">
          <SegmentedControl label="Rating or world rank" size="sm" value={metric} onChange={setMetric} options={[{ value: 'rating', label: 'Rating' }, { value: 'rank', label: 'World rank' }]} />
          <SegmentedControl label="Range" size="sm" value={range} onChange={setRange} options={RANGES} />
          {allowCompare && !compareProp && <Select aria-label="Compare with" className="h-8 max-w-[11rem] text-xs" value={picked} onChange={setPicked} options={[{ value: '', label: 'Compare with…' }, ...options.map((n) => ({ value: n.slug, label: n.name }))]} />}
        </span>
      </figcaption>
      {compareSlug && compareName && (
        <p className="flex flex-wrap items-center gap-3 text-2xs text-chalk-400">
          <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4 bg-pitch-300" />{d.nation.name}</span>
          <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4 bg-note" />{compareName}</span>
          {!compareProp && <button type="button" className="text-pitch-300 hover:text-pitch-200" onClick={() => setPicked('')}>Clear</button>}
        </p>
      )}
      <div ref={box} className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full touch-pan-y select-none outline-none focus-visible:ring-2 focus-visible:ring-pitch-400/60" tabIndex={0} role="img" onKeyDown={onKey} onBlur={() => setActive(null)}
          aria-label={`${d.nation.name}, Plaibook Elo ${metric === 'rating' ? 'rating' : 'world rank'} from ${pts[0]!.date.slice(0, 4)}: now ${d.current?.rating ?? Math.round(pts[pts.length - 1]!.rating)}${d.current?.rank ? `, rank ${d.current.rank}` : ''}. Use the arrow keys to step through the matches.`}>
          {geo.grid.map((g) => <g key={g}><line x1={L} x2={W - R} y1={geo.y(g)} y2={geo.y(g)} className="stroke-field-700" strokeWidth={1} /><text x={L - 6} y={geo.y(g) + 3.5} textAnchor="end" className="fill-chalk-500 text-[10px]">{geo.fmtY(g)}</text></g>)}
          {years.map((yr) => { const date = `${yr}-01-01`; const xx = geo.x(date); return xx >= L && xx <= W - R ? <text key={yr} x={xx} y={H - 6} textAnchor="middle" className="fill-chalk-500 text-[10px]">{yr}</text> : null; })}
          {metric === 'rating' ? <>
            {otherPts.length > 1 && <path d={ratingPath(otherPts)} className="fill-none stroke-note/80" strokeWidth={1.5} strokeLinejoin="round" />}
            <path d={ratingPath(pts)} className="fill-none stroke-pitch-300" strokeWidth={1.75} strokeLinejoin="round" />
          </> : <>
            {otherRanks.length > 1 && <path d={rankPath(otherRanks)} className="fill-none stroke-note/80" strokeWidth={1.5} strokeLinejoin="round" />}
            <path d={rankPath(ranks)} className="fill-none stroke-pitch-300" strokeWidth={1.75} strokeLinejoin="round" />
          </>}
          {/* Moments: World Cup wins, the biggest one-match gain and loss, the best world rank. */}
          {titles.map((t) => { const q = markDate(t.date); const yy = q ? yOf(q) : null; return q && yy != null ? <g key={t.date}><circle cx={geo.x(q.date)} cy={yy} r={5} className="fill-note stroke-field-900" strokeWidth={1.5} /><text x={geo.x(q.date)} y={yy - 8} textAnchor="middle" className="fill-note text-[9px] font-semibold">{t.date.slice(0, 4)}</text></g> : null; })}
          {gainPt && yOf(gainPt) != null && <path d={`M${geo.x(gainPt.date)},${yOf(gainPt)! - 9} l-4,6 l8,0 z`} className="fill-win" />}
          {lossPt && yOf(lossPt) != null && <path d={`M${geo.x(lossPt.date)},${yOf(lossPt)! + 9} l-4,-6 l8,0 z`} className="fill-loss" />}
          {bestPt && yOf(bestPt) != null && <circle cx={geo.x(bestPt.date)} cy={yOf(bestPt)!} r={p === bestPt ? 8 : 4.5} className="fill-none stroke-note transition-[r] duration-150" strokeWidth={2} />}
          {p && <>
            <line x1={ax} x2={ax} y1={T} y2={H - B} className="stroke-chalk-500" strokeDasharray="3 3" strokeWidth={1} />
            {ay != null && <circle cx={ax} cy={ay} r={4.5} className="fill-pitch-300 stroke-field-900" strokeWidth={2} />}
          </>}
          <rect x={L} y={T} width={W - L - R} height={H - T - B} className="fill-transparent" style={{ cursor: 'crosshair' }}
            onPointerMove={onPointer} onPointerDown={onPointer}
            onPointerLeave={(e) => { lock.current = null; if (e.pointerType === 'mouse') setActive(null); }} />
        </svg>
        {p && reason && (
          <div role="status" aria-live="polite"
            className="z-10 mt-2 w-full rounded-lg border border-field-600 bg-field-900/95 p-3 text-xs text-chalk-300 shadow-xl shadow-black/40 sm:pointer-events-none sm:absolute sm:top-2 sm:mt-0 sm:w-80"
            style={typeof window !== 'undefined' && window.innerWidth >= 640 ? (tipLeft > 55 ? { right: `${100 - tipLeft + 2}%` } : { left: `${tipLeft + 2}%` }) : undefined}>
            {moment.map((label) => <p key={label} className="mb-1.5 rounded border border-note/40 bg-note/10 px-2 py-1 text-2xs font-semibold text-note">{label}</p>)}
            <p className="flex justify-between gap-2 text-2xs text-chalk-500"><span>{fmt.date(p.date)}</span><span className="truncate">{p.tournament}</span></p>
            <p className="mt-1 text-sm font-semibold text-chalk-100">
              {p.gf != null && p.ga != null ? `${resultWord(p)} ${p.gf}–${p.ga} ${p.venue === 'away' ? 'at' : 'vs'} ${p.opponent.name}` : `vs ${p.opponent.name}`}
            </p>
            <p className="mt-1 tnum">Rating {Math.round(p.rating - p.delta)} → <span className="font-semibold text-chalk-100">{Math.round(p.rating)}</span> <span className={p.delta > 0 ? 'text-win' : p.delta < 0 ? 'text-loss' : 'text-chalk-400'}>({signed(p.delta, 1)})</span>
              {rankAt(d.ranks, p.date) ? <span className="ml-2 text-chalk-400">world #{rankAt(d.ranks, p.date)}</span> : null}</p>
            {p.expected != null && (
              <p className="mt-1.5 leading-snug">
                <span className="text-chalk-100">Why:</span> expected to score {pct(p.expected)} (against {p.opponent.name} at {p.opp_rating ?? '?'}, {venueWord(p.venue)}); weight {p.k} ({WEIGHT[p.k ?? 0] ?? 'match'}){(p.goal_factor ?? 1) > 1 ? ` × ${p.goal_factor} for a ${marginWord(p)}` : ''}.
              </p>
            )}
            {reason.formula && <p className="mt-0.5 font-mono text-2xs text-chalk-400">{reason.formula}</p>}
            <p className="mt-1 text-chalk-200">{reason.words}</p>
            {compareSlug && otherAt(p.date) && <p className="mt-1.5 text-chalk-400"><span className="text-note">{compareName}</span> then: {Math.round(otherAt(p.date)!.rating)}{rankAt(other.data?.ranks ?? [], p.date) ? ` (world #${rankAt(other.data?.ranks ?? [], p.date)})` : ''}</p>}
            {ys && (
              <p className="mt-1.5 border-t border-field-700 pt-1.5 text-chalk-400">
                <span className="text-chalk-200">{ys.year}:</span> {ys.start} → {ys.end} (<span className={ys.change > 0 ? 'text-win' : ys.change < 0 ? 'text-loss' : ''}>{signed(ys.change)}</span>), {ys.matches} {ys.matches === 1 ? 'match' : 'matches'}, {ys.w}-{ys.d}-{ys.l}
                {ys.matches > 1 && ys.best.delta > 0 ? `; best ${signed(ys.best.delta, 0)} v ${ys.best.opponent.name}` : ''}{ys.matches > 1 && ys.worst.delta < 0 ? `; worst ${signed(ys.worst.delta, 0)} v ${ys.worst.opponent.name}` : ''}
              </p>
            )}
            {p.match_slug && <Link to={proPath.match(p.match_slug, 'intl')} className="pointer-events-auto mt-1.5 inline-block text-pitch-300 hover:text-pitch-200">Match page</Link>}
          </div>
        )}
      </div>
      <p className="flex flex-wrap gap-x-3 gap-y-1 text-2xs text-chalk-500">
        <span>Hover, tap or use the arrow keys for any match.</span>
        {titles.length > 0 && <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-note" />World Cup won</span>}
        {bestRank && <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full border-2 border-note" />best world rank</span>}
        {gainPt && <span className="flex items-center gap-1"><span className="text-win">▲</span>biggest gain</span>}
        {lossPt && <span className="flex items-center gap-1"><span className="text-loss">▼</span>biggest drop</span>}
        {metric === 'rank' && <span>World rank: month-end tables of established FIFA sides (gaps: not ranked then).</span>}
      </p>
    </figure>
  );
}
