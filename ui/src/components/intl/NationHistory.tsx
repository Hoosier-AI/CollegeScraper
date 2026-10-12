// A nation's history on its International page: the all-time record, Plaibook Elo over time, results by competition
// and against each opponent, top scorers and most capped players, biggest wins and defeats, the latest results. Open
// sources, credited under every block that uses them.
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError, fmt, qs } from '../../lib/api';
import { proPath } from '../../lib/pro';
import { outcome, winPct, type Credit, type IntlResult, type NationHistory as History, type NationRef } from '../../lib/intl';
import { DataTable, type Column } from '../DataTable';
import { EmptyState, ErrorBox, PlayerAvatar, Section, Skeleton, TeamLogo } from '../primitives';
import { StatTile } from '../pro/Hero';

export function useNationHistory(slug: string, gender?: 'm' | 'w') {
  return useQuery({ queryKey: ['intl-history', slug, gender ?? ''], queryFn: () => api<History>(`/api/intl/teams/${slug}/history${qs({ gender })}`), retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 1, staleTime: 300_000 });
}

export const nationHref = (n: NationRef) => `/intl/teams/${n.slug ?? n.key}`;

export function Credits({ credits }: { credits: Credit[] }) {
  if (!credits.length) return null;
  return <p className="text-2xs text-chalk-500">Sources: {credits.map((c, i) => <span key={c.url}>{i ? '; ' : ''}<a href={c.url} target="_blank" rel="noopener" className="underline hover:text-pitch-300">{c.name}</a> ({c.license})</span>)}.</p>;
}

const TONE = { W: 'bg-win/15 text-win', D: 'bg-field-700 text-chalk-300', L: 'bg-loss/15 text-loss' } as const;

/** Results as lines: date, the two sides, the score (a link when the match has its own page), the competition. */
export function ResultList({ rows, nation, empty = 'No results.' }: { rows: IntlResult[]; nation?: string; empty?: string }) {
  if (!rows.length) return <p className="text-sm text-chalk-400">{empty}</p>;
  return (
    <ul className="frame divide-y divide-field-700 text-sm">
      {rows.map((r) => {
        const o = nation ? outcome(r, nation) : null;
        const score = r.home_score == null ? 'v' : `${r.home_score}–${r.away_score}`;
        const extra = r.shootout_winner && r.pen[0] != null ? ` (${r.pen[0]}–${r.pen[1]} pens)` : r.shootout_winner ? ' (pens)' : r.aet ? ' aet' : '';
        return (
          <li key={`${r.date}-${r.home.key}-${r.away.key}`} className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 px-3 py-1.5 sm:grid-cols-[6rem_minmax(0,1fr)_4.5rem_minmax(0,1fr)_minmax(0,11rem)]">
            <span className="text-xs tnum text-chalk-500">{fmt.date(r.date)}</span>
            <span className="flex min-w-0 items-center gap-1.5 sm:justify-end"><Link to={nationHref(r.home)} className="truncate hover:text-pitch-300">{r.home.name}</Link><span className="hidden sm:inline"><TeamLogo src={r.home.logo} name={r.home.name} size={16} /></span><span className="text-chalk-500 sm:hidden">v</span><Link to={nationHref(r.away)} className="truncate hover:text-pitch-300 sm:hidden">{r.away.name}</Link></span>
            <span className={`display rounded px-1.5 text-center tnum ${o ? TONE[o] : ''}`}>{r.match_slug ? <Link to={proPath.match(r.match_slug, 'intl')} className="hover:underline">{score}</Link> : score}<span className="text-2xs font-normal">{extra}</span></span>
            <span className="hidden min-w-0 items-center gap-1.5 sm:flex"><TeamLogo src={r.away.logo} name={r.away.name} size={16} /><Link to={nationHref(r.away)} className="truncate hover:text-pitch-300">{r.away.name}</Link></span>
            <span className="col-span-3 truncate text-2xs text-chalk-500 sm:col-span-1 sm:text-right">{r.tournament}{r.stage ? `, ${r.stage}` : ''}{r.city ? ` · ${r.city}` : ''}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Plaibook Elo through the years: one point a month, the best rating marked. */
export function EloLine({ series, caption }: { series: { date: string; rating: number }[]; caption: string }) {
  if (series.length < 3) return null;
  const W = 640, H = 160, PAD = 28;
  const t = (d: string) => Date.parse(`${d}T00:00:00Z`);
  const t0 = t(series[0]!.date), t1 = t(series[series.length - 1]!.date);
  const lo = Math.floor(Math.min(...series.map((p) => p.rating)) / 100) * 100, hi = Math.ceil(Math.max(...series.map((p) => p.rating)) / 100) * 100;
  const x = (d: string) => PAD + ((t(d) - t0) / Math.max(1, t1 - t0)) * (W - PAD * 2);
  const y = (v: number) => H - PAD - ((v - lo) / Math.max(1, hi - lo)) * (H - PAD * 2);
  const path = series.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.rating).toFixed(1)}`).join(' ');
  const best = series.reduce((a, b) => (b.rating > a.rating ? b : a));
  const years = Array.from(new Set(series.map((p) => Math.floor(Number(p.date.slice(0, 4)) / 20) * 20))).filter((yr) => yr >= Number(series[0]!.date.slice(0, 4)));
  const grid = Array.from({ length: Math.round((hi - lo) / 100) + 1 }, (_, i) => lo + i * 100).filter((_, i, a) => a.length <= 6 || i % 2 === 0);
  return (
    <figure className="frame p-3">
      <figcaption className="mb-1 flex flex-wrap justify-between gap-2 text-xs text-chalk-400"><span>{caption}</span><span className="tnum">best {Math.round(best.rating)} ({best.date.slice(0, 4)})</span></figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${caption}: from ${Math.round(series[0]!.rating)} in ${series[0]!.date.slice(0, 4)} to ${Math.round(series[series.length - 1]!.rating)} now, best ${Math.round(best.rating)} in ${best.date.slice(0, 4)}`}>
        {grid.map((g) => <g key={g}><line x1={PAD} x2={W - PAD} y1={y(g)} y2={y(g)} className="stroke-field-700" strokeWidth={1} /><text x={2} y={y(g) + 4} className="fill-chalk-500 text-[10px]">{g}</text></g>)}
        {years.map((yr) => { const d = `${yr}-01-01`; return t(d) >= t0 ? <text key={yr} x={x(d)} y={H - 8} textAnchor="middle" className="fill-chalk-500 text-[10px]">{yr}</text> : null; })}
        <path d={path} className="fill-none stroke-pitch-300" strokeWidth={1.75} strokeLinejoin="round" />
        <circle cx={x(best.date)} cy={y(best.rating)} r={4} className="fill-note stroke-field-900" strokeWidth={2}><title>{`Best: ${Math.round(best.rating)} on ${best.date}`}</title></circle>
      </svg>
    </figure>
  );
}

type OppRow = History['opponents'][number];
type CompRow = History['competitions'][number];

export function NationHistoryView({ h, slug }: { h: History; slug: string }) {
  const key = h.nation.key;
  const r = h.record;
  const oppCols: Column<OppRow>[] = [
    { key: 'nation', label: 'Opponent', primary: true, value: (o) => o.nation.name, render: (o) => <span className="flex items-center gap-2"><TeamLogo src={o.nation.logo} name={o.nation.name} size={18} /><span className="truncate">{o.nation.name}</span></span> },
    { key: 'played', label: 'P', num: true, value: (o) => o.played },
    { key: 'w', label: 'W', num: true, value: (o) => o.w }, { key: 'd', label: 'D', num: true, value: (o) => o.d }, { key: 'l', label: 'L', num: true, value: (o) => o.l },
    { key: 'goals', label: 'Goals', value: (o) => o.gf - o.ga, render: (o) => `${o.gf}:${o.ga}` },
    { key: 'last', label: 'Last', priority: 2, value: (o) => o.last, render: (o) => o.last.slice(0, 4) },
  ];
  const compCols: Column<CompRow>[] = [
    { key: 'name', label: 'Competition', primary: true, value: (c) => c.name },
    { key: 'played', label: 'P', num: true, value: (c) => c.played },
    { key: 'w', label: 'W', num: true, value: (c) => c.w }, { key: 'd', label: 'D', num: true, value: (c) => c.d }, { key: 'l', label: 'L', num: true, value: (c) => c.l },
    { key: 'goals', label: 'Goals', value: (c) => c.gf - c.ga, render: (c) => `${c.gf}:${c.ga}` },
    { key: 'years', label: 'Years', priority: 2, value: (c) => c.first, render: (c) => `${c.first.slice(0, 4)}–${c.last.slice(0, 4)}` },
  ];
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label={`Since ${h.first_match?.slice(0, 4) ?? '–'}`} value={fmt.num(r.played)} sub={`matches · ${r.w}-${r.d}-${r.l}`} />
        <StatTile label="Won" value={`${winPct(r)}%`} sub={`${fmt.num(r.gf)} goals for, ${fmt.num(r.ga)} against`} accent />
        {h.elo ? <StatTile label="Plaibook Elo" value={Math.round(h.elo.rating)} sub={`${h.elo.rank ? `rank ${h.elo.rank}` : 'unranked'}${h.elo.change_1y != null ? ` · ${h.elo.change_1y > 0 ? '+' : ''}${Math.round(h.elo.change_1y)} in a year` : ''}`} accent /> : <StatTile label="Plaibook Elo" value="–" sub="not rated yet" />}
        <StatTile label="World Cups" value={h.world_cups.editions || '–'} sub={h.world_cups.years.length ? `last ${h.world_cups.years[0]}` : 'squads from the World Cup database'} />
      </div>
      {h.elo && <EloLine series={h.elo.series} caption={`${h.nation.name}${h.gender === 'w' ? " women" : ''}: Plaibook Elo since ${h.elo.series[0]?.date.slice(0, 4) ?? ''}`} />}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Section title="Top scorers">
          {h.scorers.length ? <ol className="frame divide-y divide-field-700 text-sm">{h.scorers.slice(0, 15).map((s, i) => (
            <li key={s.name} className="flex items-center gap-2 px-3 py-1.5"><span className="w-5 text-right text-xs tnum text-chalk-500">{i + 1}</span>
              {s.slug ? <Link to={proPath.player(s.slug)} className="min-w-0 flex-1 truncate font-medium text-chalk-100 hover:text-pitch-300">{s.name}</Link> : <span className="min-w-0 flex-1 truncate font-medium text-chalk-100">{s.name}</span>}
              <span className="text-2xs tnum text-chalk-500">{s.first.slice(0, 4)}–{s.last.slice(0, 4)}</span><span className="display w-8 text-right tnum text-chalk-100">{s.goals}</span></li>
          ))}</ol> : <p className="text-sm text-chalk-400">No scorers on record yet.</p>}
          {h.scorers.length > 0 && <p className="text-2xs text-chalk-500">Goals in the matches our sources name scorers for: every World Cup and most competitive matches, fewer friendlies. Most caps has each player's full total.</p>}
        </Section>
        <Section title="Most caps">
          {h.caps.length ? <ol className="frame divide-y divide-field-700 text-sm">{h.caps.slice(0, 15).map((c, i) => (
            <li key={`${c.name}-${i}`} className="flex items-center gap-2 px-3 py-1.5"><span className="w-5 text-right text-xs tnum text-chalk-500">{i + 1}</span><PlayerAvatar src={c.photo} name={c.name} size={22} />
              {c.slug ? <Link to={proPath.player(c.slug)} className="min-w-0 flex-1 truncate font-medium text-chalk-100 hover:text-pitch-300">{c.name}</Link> : <span className="min-w-0 flex-1 truncate font-medium text-chalk-100">{c.name}</span>}
              <span className="text-2xs tnum text-chalk-500">{c.goals != null ? `${c.goals} goals` : ''}</span><span className="display w-8 text-right tnum text-chalk-100">{c.caps}</span></li>
          ))}</ol> : <p className="text-sm text-chalk-400">Caps come from players' Wikipedia careers as the people crawl reads them.</p>}
        </Section>
      </div>
      <Section title="Latest results"><ResultList rows={h.recent} nation={key} /></Section>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Section title="Biggest wins"><ResultList rows={h.biggest_wins} nation={key} empty="None yet." /></Section>
        <Section title="Heaviest defeats"><ResultList rows={h.worst_defeats} nation={key} empty="None yet." /></Section>
      </div>
      <Section title="By competition"><DataTable rows={h.competitions} columns={compCols} rowKey={(c) => c.name} caption={`${h.nation.name} by competition`} dense /></Section>
      <Section title="Against each opponent" right={<Link to={`/intl/h2h${qs({ a: slug })}`} className="text-xs text-pitch-300 hover:text-pitch-200">Head to head</Link>}>
        <DataTable rows={h.opponents} columns={oppCols} rowKey={(o) => o.nation.key} caption={`${h.nation.name} against each opponent`} rowHref={(o) => `/intl/h2h${qs({ a: slug, b: o.nation.slug ?? o.nation.key })}`} dense />
      </Section>
      <Credits credits={h.credits} />
    </div>
  );
}

/** The history tab of a national team, loading its own data. */
export function NationHistoryTab({ slug }: { slug: string }) {
  const q = useNationHistory(slug);
  if (q.error instanceof ApiError && q.error.status === 404) return <EmptyState title="No history yet" body="This side's past results arrive with the international sources' next sync." />;
  if (q.error) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  if (q.isPending) return <div className="space-y-3" aria-busy="true"><Skeleton className="h-24" /><Skeleton className="h-64" /></div>;
  return <NationHistoryView h={q.data!} slug={slug} />;
}
