// "Match flow" on a match page, FotMob style. Three views of the same 90 minutes:
//   Momentum      which side was on top: a wave above the line for the home side, below for the away side;
//   Win chance    each result's chance through the match, three labelled lines on a 0-100% grid;
//   xG            each side's expected goals building up (only where shots carry xG).
// Under every view: the goals and red cards on a minute track, scorers named. Hover or tap for a minute's numbers.
// The chart has a fixed height (the lines stretch, the labels do not) so it reads the same on a phone.
import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { SegmentedControl, TeamLogo } from '../primitives';
import { SoccerBall } from '../icons';

interface Probs { h: number; d: number; a: number }
interface Mark { m: number; side: 'home' | 'away'; type: 'goal' | 'red'; who?: string | null }
export interface Flow {
  length: number; until: number; live: boolean; pre: Probs | null; basis: 'elo' | 'prediction' | null;
  winprob: (Probs & { m: number })[] | null; momentum: { m: number; v: number }[] | null; xg: { m: number; h: number; a: number }[] | null;
  marks: Mark[];
}
type View = 'momentum' | 'winprob' | 'xg';

const HOME_C = '#2DD4BF', AWAY_C = '#7DD3FC', DRAW_C = '#98A9C0';
const pct = (v: number) => `${Math.round(v * 100)}%`;

/** A smooth path through points (Catmull-Rom as cubic Béziers), in the chart's 0-1000 x 0-100 space. */
function smooth(pts: [number, number][]): string {
  if (pts.length < 2) return '';
  let d = `M${pts[0]![0].toFixed(1)},${pts[0]![1].toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!, p1 = pts[i]!, p2 = pts[i + 1]!, p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${c1[0]!.toFixed(1)},${c1[1]!.toFixed(2)} ${c2[0]!.toFixed(1)},${c2[1]!.toFixed(2)} ${p2[0].toFixed(1)},${p2[1].toFixed(2)}`;
  }
  return d;
}

export function MatchFlow({ url, live, home, away, homeLogo, awayLogo, homeSeo, awaySeo }: { url: string; live: boolean; home: string; away: string; homeLogo?: string | null; awayLogo?: string | null; homeSeo?: string | null; awaySeo?: string | null }) {
  const q = useQuery({ queryKey: ['flow', url], queryFn: () => api<{ flow: Flow | null }>(url), refetchInterval: live ? 60_000 : false, staleTime: live ? 30_000 : 600_000 });
  const f = q.data?.flow;
  const views = useMemo(() => (f ? ([f.momentum && 'momentum', f.winprob && 'winprob', f.xg && 'xg'].filter(Boolean) as View[]) : []), [f]);
  const [pick, setPick] = useState<View | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  if (!f || !views.length) return null;
  const view = pick && views.includes(pick) ? pick : views[0]!;
  const span = Math.max(f.until, f.length);
  const X = (m: number) => (m / span) * 1000;
  const left = (m: number) => `${(m / span) * 100}%`;
  const at = hover ?? f.until;
  const onMove = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    setHover(Math.max(0, Math.min(f.until, Math.round(((e.clientX - r.left) / r.width) * span))));
  };
  const label: Record<View, string> = { momentum: 'Momentum', winprob: 'Win chance', xg: 'xG' };
  const ticks = [0, 15, 30, 45, 60, 75, 90, ...(f.length > 90 ? [105, 120] : [])].filter((m) => m <= span);

  // The readout above the chart: what the hovered (or latest) minute says.
  const wp = f.winprob?.[Math.min(at, f.winprob.length - 1)];
  const xgAt = f.xg?.[Math.min(at, f.xg.length - 1)];
  const chip = (color: string, name: string, value: string, strong = false) => (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-field-800/80 px-2 py-1 text-xs">
      <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: color }} />
      <span className="max-w-[9rem] truncate text-chalk-300">{name}</span>
      <span className={`tnum ${strong ? 'font-semibold text-chalk-100' : 'text-chalk-200'}`}>{value}</span>
    </span>
  );
  const readout = view === 'winprob' && wp ? <>{chip(HOME_C, home, pct(wp.h), wp.h >= wp.a && wp.h >= wp.d)}{chip(DRAW_C, 'Draw', pct(wp.d), wp.d > wp.h && wp.d > wp.a)}{chip(AWAY_C, away, pct(wp.a), wp.a > wp.h && wp.a >= wp.d)}</>
    : view === 'xg' && xgAt ? <>{chip(HOME_C, home, xgAt.h.toFixed(2))}{chip(AWAY_C, away, xgAt.a.toFixed(2))}</>
    : view === 'momentum' && f.momentum ? (() => {
      const v = hover != null ? f.momentum[Math.min(hover, f.momentum.length - 1)]!.v : null;
      const lead = v == null ? null : v > 0.08 ? 'home' : v < -0.08 ? 'away' : 'even';
      const key = (side: 'home' | 'away') => (
        <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs ${lead === side ? 'bg-field-700 text-chalk-100' : 'bg-field-800/80 text-chalk-300'}`}>
          <span aria-hidden className="text-[10px]" style={{ color: side === 'home' ? HOME_C : AWAY_C }}>{side === 'home' ? '▲' : '▼'}</span>
          <TeamLogo src={side === 'home' ? homeLogo : awayLogo} seo={side === 'home' ? homeSeo : awaySeo} name={side === 'home' ? home : away} size={14} />
          <span className="max-w-[9rem] truncate">{side === 'home' ? home : away}</span>
          {lead === side && <span className="font-semibold">on top</span>}
        </span>
      );
      return <>{key('home')}{key('away')}{lead === 'even' && <span className="text-xs text-chalk-400">evenly matched</span>}</>;
    })()
    : null;

  // The chart body (0-1000 wide, 0-100 tall, stretched to the box).
  let body: React.ReactNode = null, overlay: React.ReactNode = null, aria = '';
  if (view === 'momentum' && f.momentum) {
    // A little extra smoothing so the wave reads as spells of pressure rather than spikes.
    const raw = f.momentum.map((p) => p.v);
    const v = raw.map((_, i) => { const w = raw.slice(Math.max(0, i - 1), i + 2); return w.reduce((s, x) => s + x, 0) / w.length; });
    const pts = v.map((y, i) => [X(i), 50 - y * 46] as [number, number]);
    const up = `${smooth(pts.map(([x, y]) => [x, Math.min(50, y)]))}L${X(v.length - 1)},50L0,50Z`;
    const down = `${smooth(pts.map(([x, y]) => [x, Math.max(50, y)]))}L${X(v.length - 1)},50L0,50Z`;
    body = <>
      <path d={up} fill={HOME_C} fillOpacity={0.85} />
      <path d={down} fill={AWAY_C} fillOpacity={0.85} />
      <line x1={0} x2={1000} y1={50} y2={50} stroke="#33497A" strokeWidth={1} vectorEffect="non-scaling-stroke" />
    </>;
    const share = v.reduce((s, x) => s + x, 0) / Math.max(1, v.length);
    aria = `Attack momentum: ${share > 0.05 ? `${home} had the upper hand overall` : share < -0.05 ? `${away} had the upper hand overall` : 'evenly shared'}.`;
  } else if (view === 'winprob' && f.winprob) {
    const pts = (k: keyof Probs) => f.winprob!.map((p) => [X(p.m), 96 - p[k] * 92] as [number, number]);
    // Straight segments: a goal really is a jump, and a smoothed curve would wobble either side of it.
    const line = (k: keyof Probs, c: string, dash?: string) => <path d={pts(k).map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(2)}`).join('')} fill="none" stroke={c} strokeWidth={k === 'd' ? 1.75 : 2.5} strokeDasharray={dash} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />;
    body = <>
      {[0, 0.5, 1].map((g) => <line key={g} x1={0} x2={1000} y1={96 - g * 92} y2={96 - g * 92} stroke="#24395F" strokeWidth={1} strokeDasharray={g === 0.5 ? '4 4' : undefined} vectorEffect="non-scaling-stroke" />)}
      {line('d', DRAW_C, '5 4')}{line('a', AWAY_C)}{line('h', HOME_C)}
    </>;
    overlay = <>{[1, 0.5, 0].map((g) => <span key={g} className="pointer-events-none absolute left-full ml-1.5 -translate-y-1/2 text-[10px] text-chalk-500 tnum" style={{ top: `${96 - g * 92}%` }}>{pct(g)}</span>)}</>;
    const s = f.winprob[0]!, e = f.winprob.at(-1)!;
    aria = `Win chance before kickoff: ${home} ${pct(s.h)}, draw ${pct(s.d)}, ${away} ${pct(s.a)}. ${f.live ? 'Now' : 'At the end'}: ${home} ${pct(e.h)}, draw ${pct(e.d)}, ${away} ${pct(e.a)}.`;
  } else if (view === 'xg' && f.xg) {
    const top = Math.max(1, ...f.xg.map((p) => Math.max(p.h, p.a))) * 1.1;
    const Y = (v: number) => 96 - (v / top) * 90;
    const step = (k: 'h' | 'a') => f.xg!.map((p, i) => `${i ? 'L' : 'M'}${X(p.m).toFixed(1)},${Y(p[k]).toFixed(2)}`).join('');
    body = <>
      {[0, top / 2, top].map((g, i) => <line key={i} x1={0} x2={1000} y1={Y(g)} y2={Y(g)} stroke="#24395F" strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
      <path d={step('a')} fill="none" stroke={AWAY_C} strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
      <path d={step('h')} fill="none" stroke={HOME_C} strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
    </>;
    overlay = <>{[top, top / 2, 0].map((g, i) => <span key={i} className="pointer-events-none absolute left-full ml-1.5 -translate-y-1/2 text-[10px] text-chalk-500 tnum" style={{ top: `${Y(g)}%` }}>{g.toFixed(1)}</span>)}</>;
    const e = f.xg.at(-1)!;
    aria = `Expected goals: ${home} ${e.h.toFixed(2)}, ${away} ${e.a.toFixed(2)}.`;
  }

  const goals = f.marks.filter((k) => k.type === 'goal'), reds = f.marks.filter((k) => k.type === 'red');
  const explain: Record<View, string> = {
    momentum: `Who was on top, minute by minute: above the line ${home} were pressing, below it ${away}. From shots, shots on target, corners and goals${f.xg ? ', weighted by chance quality' : ''}.`,
    winprob: `Each result's chance as the match went, starting from ${f.basis === 'prediction' ? 'the pre-match prediction' : 'Plaibook Elo before kickoff'} and updated for the score, the time left and red cards.`,
    xg: 'Expected goals as they built up: the quality of each side’s chances, from American Soccer Analysis.',
  };

  return (
    <section className="frame bg-field-900/60" aria-label="Match flow">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-field-700/70 px-3 py-2">
        <h2 className="text-sm font-semibold text-chalk-100">Match flow{f.live && <span className="ml-2 text-2xs font-normal text-win">live</span>}</h2>
        {views.length > 1 && <SegmentedControl label="Match flow view" size="sm" value={view} onChange={(v) => { setPick(v as View); setHover(null); }} options={views.map((v) => ({ value: v, label: label[v] }))} />}
      </header>
      <div className="space-y-2 px-3 pb-3 pt-2.5">
        {readout && (
          <div className="flex min-h-7 flex-wrap items-center gap-1.5">
            <span className="w-10 text-xs font-semibold text-chalk-100 tnum">{hover != null ? `${hover}′` : f.live ? 'Now' : 'FT'}</span>
            {readout}
          </div>
        )}
        <div className="pr-9 pt-2.5">
        <div ref={box} className="relative h-40 touch-none select-none sm:h-48" onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)}>
          <svg viewBox="0 0 1000 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" role="img" aria-label={aria}>
            <line x1={X(45)} x2={X(45)} y1={0} y2={100} stroke="#24395F" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
            {f.length > 90 && <line x1={X(90)} x2={X(90)} y1={0} y2={100} stroke="#24395F" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
            {goals.map((k, i) => <line key={i} x1={X(k.m)} x2={X(k.m)} y1={0} y2={100} stroke={k.side === 'home' ? HOME_C : AWAY_C} strokeOpacity={0.35} strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
            {body}
            {hover != null && <line x1={X(hover)} x2={X(hover)} y1={0} y2={100} stroke="#EEF3F8" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
          </svg>
          {overlay}
          {/* Goals and red cards on the chart's edges: the home side's along the top, the away side's along the bottom. */}
          {[...goals, ...reds].map((k, i) => {
            const up = k.side === 'home';
            const text = `${k.m}′ ${k.type === 'goal' ? 'goal' : 'red card'}, ${up ? home : away}${k.who ? `: ${k.who}` : ''}`;
            return (
              <span key={i} title={text} role="img" aria-label={text} className={`absolute z-10 -translate-x-1/2 ${up ? '-top-2.5' : '-bottom-2.5'}`} style={{ left: left(k.m) }}>
                {k.type === 'goal'
                  ? <span className="grid h-5 w-5 place-items-center rounded-full bg-chalk-100 text-field-950" style={{ boxShadow: `0 0 0 2px ${up ? HOME_C : AWAY_C}` }}><SoccerBall size={13} /></span>
                  : <span className="block h-4 w-3 rounded-sm bg-loss ring-2 ring-field-900" />}
              </span>
            );
          })}
        </div>
        <div className="relative mt-3.5 h-4 text-[10px] text-chalk-500 tnum" aria-hidden>
          {ticks.map((m) => <span key={m} className="absolute" style={{ left: left(m), transform: m === 0 ? 'none' : m === span ? 'translateX(-100%)' : 'translateX(-50%)' }}>{m === 45 ? 'HT' : `${m}′`}</span>)}
        </div>
        </div>
        {f.marks.length > 0 && (
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-chalk-300">
            {f.marks.map((g, i) => (
              <li key={i} className="inline-flex items-center gap-1.5">
                {g.type === 'goal' ? <SoccerBall size={12} className={g.side === 'home' ? 'text-pitch-400' : 'text-[#7DD3FC]'} /> : <span aria-hidden className="h-3 w-2 rounded-sm bg-loss" />}
                <span className="tnum text-chalk-500">{g.m}′</span>{g.who ?? (g.side === 'home' ? home : away)}{g.who && <span className="text-chalk-500">({g.side === 'home' ? home : away})</span>}
              </li>
            ))}
          </ul>
        )}
        <p className="text-2xs leading-relaxed text-chalk-500">{explain[view]}</p>
      </div>
    </section>
  );
}
