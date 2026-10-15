// "Match flow" on a match page, FotMob/Sofascore style: attack momentum (bars above the line for the home side, below
// for the away side), win probability through the match, and where shots carry xG the xG race. Goals and red cards
// are marked on every view. Hover or tap a minute for its numbers. Hidden when the match has none of them.
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { SegmentedControl } from '../primitives';

interface Probs { h: number; d: number; a: number }
export interface Flow {
  length: number; until: number; live: boolean; pre: Probs | null; basis: 'elo' | 'prediction' | null;
  winprob: (Probs & { m: number })[] | null; momentum: { m: number; v: number }[] | null; xg: { m: number; h: number; a: number }[] | null;
  marks: { m: number; side: 'home' | 'away'; type: 'goal' | 'red' }[];
}
type View = 'momentum' | 'winprob' | 'xg';

const W = 600, H = 160, PX = 8, TOP = 14, BOT = 10;
const HOME = 'fill-pitch-400', AWAY = 'fill-[#7DD3FC]';
const pct = (v: number) => `${Math.round(v * 100)}%`;

export function MatchFlow({ url, live, home, away }: { url: string; live: boolean; home: string; away: string }) {
  const q = useQuery({ queryKey: ['flow', url], queryFn: () => api<{ flow: Flow | null }>(url), refetchInterval: live ? 60_000 : false, staleTime: live ? 30_000 : 600_000 });
  const f = q.data?.flow;
  const views = useMemo(() => (f ? ([f.momentum && 'momentum', f.winprob && 'winprob', f.xg && 'xg'].filter(Boolean) as View[]) : []), [f]);
  const [pick, setPick] = useState<View | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  if (!f || !views.length) return null;
  const view = pick && views.includes(pick) ? pick : views[0]!;
  const span = Math.max(f.until, f.length);
  const x = (m: number) => PX + (m / span) * (W - PX * 2);
  const mid = TOP + (H - TOP - BOT) / 2, half = (H - TOP - BOT) / 2;
  const at = hover ?? f.until;
  const label: Record<View, string> = { momentum: 'Momentum', winprob: 'Win probability', xg: 'xG' };
  const wp = f.winprob?.[Math.min(at, (f.winprob?.length ?? 1) - 1)];
  const xgAt = f.xg?.[Math.min(at, (f.xg?.length ?? 1) - 1)];
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const m = Math.round(((e.clientX - r.left) / r.width * W - PX) / (W - PX * 2) * span);
    setHover(Math.max(0, Math.min(f.until, m)));
  };
  const summary = view === 'winprob' && f.winprob
    ? `Win probability: before kickoff ${home} ${pct(f.winprob[0]!.h)}, draw ${pct(f.winprob[0]!.d)}, ${away} ${pct(f.winprob[0]!.a)}; ${f.live ? 'now' : 'at the end'} ${home} ${pct(f.winprob.at(-1)!.h)}, draw ${pct(f.winprob.at(-1)!.d)}, ${away} ${pct(f.winprob.at(-1)!.a)}.`
    : view === 'xg' && f.xg ? `Expected goals: ${home} ${f.xg.at(-1)!.h.toFixed(2)}, ${away} ${f.xg.at(-1)!.a.toFixed(2)}.`
    : `Attack momentum by minute, ${home} above the line and ${away} below.`;
  const marks = f.marks.map((k, i) => {
    const up = k.side === 'home';
    const cy = up ? TOP - 7 : H - BOT + 5;
    return k.type === 'goal'
      ? <g key={i}><line x1={x(k.m)} x2={x(k.m)} y1={TOP} y2={H - BOT} className="stroke-chalk-500" strokeWidth={0.6} strokeDasharray="2 3" /><circle cx={x(k.m)} cy={cy} r={4.5} className={up ? HOME : AWAY} /><title>{`${k.m}′ goal, ${up ? home : away}`}</title></g>
      : <g key={i}><rect x={x(k.m) - 2.5} y={cy - 4} width={5} height={8} rx={1} className="fill-loss" /><title>{`${k.m}′ red card, ${up ? home : away}`}</title></g>;
  });
  return (
    <section className="frame bg-field-900/60" aria-label="Match flow">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-field-700/70 px-3 py-2">
        <h2 className="text-sm font-semibold text-chalk-100">Match flow{f.live && <span className="ml-2 text-2xs font-normal text-win">live</span>}</h2>
        {views.length > 1 && <SegmentedControl label="Match flow view" size="sm" value={view} onChange={(v) => setPick(v as View)} options={views.map((v) => ({ value: v, label: label[v] }))} />}
      </header>
      <div className="px-3 pb-2 pt-2">
        <div className="mb-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-chalk-300">
          <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-2.5 rounded-sm bg-pitch-400" />{home}</span>
          <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-2.5 rounded-sm bg-[#7DD3FC]" />{away}</span>
          <span className="ml-auto tnum text-chalk-400">
            {hover != null && <span className="mr-2 text-chalk-200">{hover}′</span>}
            {view === 'winprob' && wp && <>{home} {pct(wp.h)} · draw {pct(wp.d)} · {away} {pct(wp.a)}</>}
            {view === 'xg' && xgAt && <>xG {xgAt.h.toFixed(2)} – {xgAt.a.toFixed(2)}</>}
          </span>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full touch-none select-none" role="img" aria-label={summary} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          <line x1={x(45)} x2={x(45)} y1={TOP} y2={H - BOT} className="stroke-field-700" strokeWidth={1} />
          {f.length > 90 && <line x1={x(90)} x2={x(90)} y1={TOP} y2={H - BOT} className="stroke-field-700" strokeWidth={1} />}
          {view === 'momentum' && f.momentum && <>
            <line x1={PX} x2={W - PX} y1={mid} y2={mid} className="stroke-field-600" strokeWidth={1} />
            {f.momentum.map((p) => p.v === 0 ? null : <rect key={p.m} x={x(p.m) - 2} width={4} y={p.v > 0 ? mid - p.v * half : mid} height={Math.abs(p.v) * half} rx={1} className={p.v > 0 ? HOME : AWAY} opacity={0.9} />)}
          </>}
          {view === 'winprob' && f.winprob && (() => {
            const y = (v: number) => TOP + (1 - v) * (H - TOP - BOT);
            const pts = f.winprob;
            const area = (lo: (p: Probs) => number, hi: (p: Probs) => number) => `M${pts.map((p) => `${x(p.m).toFixed(1)},${y(hi(p)).toFixed(1)}`).join('L')}L${[...pts].reverse().map((p) => `${x(p.m).toFixed(1)},${y(lo(p)).toFixed(1)}`).join('L')}Z`;
            return <>
              <path d={area((p) => 1 - p.h, () => 1)} className={HOME} opacity={0.85} />
              <path d={area((p) => p.a, (p) => 1 - p.h)} className="fill-field-600" opacity={0.9} />
              <path d={area(() => 0, (p) => p.a)} className={AWAY} opacity={0.85} />
              <line x1={PX} x2={W - PX} y1={y(0.5)} y2={y(0.5)} className="stroke-field-950" strokeWidth={0.6} strokeDasharray="3 3" />
            </>;
          })()}
          {view === 'xg' && f.xg && (() => {
            const top = Math.max(1, ...f.xg.map((p) => Math.max(p.h, p.a)));
            const y = (v: number) => H - BOT - (v / top) * (H - TOP - BOT);
            const step = (k: 'h' | 'a') => f.xg!.map((p, i) => `${i ? 'L' : 'M'}${x(p.m).toFixed(1)},${y(p[k]).toFixed(1)}`).join('');
            return <>
              {[0, Math.round(top / 2 * 10) / 10, Math.round(top * 10) / 10].map((g) => <text key={g} x={W - PX} y={y(g) - 2} textAnchor="end" className="fill-chalk-500 text-[9px]">{g.toFixed(1)}</text>)}
              <path d={step('h')} className="fill-none stroke-pitch-400" strokeWidth={2.2} />
              <path d={step('a')} className="fill-none stroke-[#7DD3FC]" strokeWidth={2.2} />
            </>;
          })()}
          {marks}
          {hover != null && <line x1={x(hover)} x2={x(hover)} y1={TOP} y2={H - BOT} className="stroke-chalk-200" strokeWidth={1} />}
        </svg>
        {/* Minutes as text under the chart (inside it they shrink with the drawing on a phone). */}
        <div className="relative h-4 text-2xs text-chalk-500 tnum" aria-hidden>
          {[0, 45, 90, ...(f.length > 90 ? [120] : [])].filter((m) => m <= span).map((m) => (
            <span key={m} className="absolute" style={{ left: `${(x(m) / W) * 100}%`, transform: m === 0 ? 'none' : m === span ? 'translateX(-100%)' : 'translateX(-50%)' }}>{m}′</span>
          ))}
        </div>
        <p className="mt-1 text-2xs text-chalk-500">
          {view === 'momentum' ? 'Attacking pressure minute by minute: shots, shots on target, corners and goals' + (f.xg ? ', weighted by xG' : '') + '.'
            : view === 'winprob' ? `The chance of each result as the match went, from ${f.basis === 'prediction' ? 'the pre-match prediction' : 'Plaibook Elo before kickoff'}, the score, the time left and red cards.`
            : 'Expected goals as they built up, from American Soccer Analysis.'}
        </p>
      </div>
    </section>
  );
}

