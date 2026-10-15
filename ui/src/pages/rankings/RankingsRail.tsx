// Beside every Rankings tab: the other two orders' top ten (coaches' poll, live RPI, Plaibook Elo) and, beside the
// poll, this week's biggest moves. The same division as the tab.
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { api, qs } from '../../lib/api';
import { useFilters, useHref } from '../../lib/filters';
import { useUrlState } from '../../lib/urlState';
import { RailCard, RailRow, TeamLogo } from '../../components/primitives';

type Tab = 'polls' | 'rpi' | 'elo';
const teamCell = (p: { name: string; seo?: string | null; logo?: string | null }) => <><TeamLogo src={p.logo} seo={p.seo} name={p.name} size={18} /><span className="truncate">{p.name}</span></>;

export function RankingsRail({ tab }: { tab: Tab }) {
  const f = useFilters();
  const href = useHref();
  const [division] = useUrlState('division', 'd1', { allow: ['d1', 'd2', 'd3'] });
  const [poll] = useUrlState('poll');
  const [week] = useUrlState('week');
  const polls = useQuery({ queryKey: ['rankings', f.season, f.gender, division, poll, week], queryFn: () => api<any>(`/api/rankings${qs({ season: f.season, gender: f.gender, division, poll, week_of: week })}`) });
  const rpi = useQuery({ queryKey: ['college-rpi', f.gender, division, '', 0, 'rail'], queryFn: () => api<{ rows: any[] }>(`/api/rpi${qs({ gender: f.gender, division, limit: 10 })}`), enabled: tab !== 'rpi', staleTime: 60_000 });
  const elo = useQuery({ queryKey: ['college-elo', f.gender, division, '', 0, 'rail'], queryFn: () => api<{ rows: any[] }>(`/api/elo${qs({ gender: f.gender, division, limit: 10 })}`), enabled: tab !== 'elo', staleTime: 300_000 });
  const rows: any[] = (polls.data?.rows ?? []).filter((r: any) => r.college_programs && !String(r.label ?? '').endsWith('(RV)'));
  const movers = rows.filter((r) => r.previous_rank != null && r.previous_rank !== r.rank).sort((a, b) => Math.abs(b.previous_rank - b.rank) - Math.abs(a.previous_rank - a.rank)).slice(0, 5);
  const newIn = rows.filter((r) => r.previous_rank == null && polls.data?.poll === 'usc').slice(0, 3);
  const prog = (r: any) => ({ name: r.college_programs.name, seo: r.college_programs.school_seo, logo: r.college_programs.college_schools?.logo_svg_url });
  return (
    <>
      {tab === 'polls' && (movers.length > 0 || newIn.length > 0) && (
        <RailCard title="Biggest moves">
          <ol className="space-y-0.5">
            {movers.map((r) => { const d = r.previous_rank - r.rank; return (
              <RailRow key={r.college_programs.id} to={href(`/teams/${r.college_programs.id}`)} left={<><span className="w-6 text-right font-semibold text-chalk-100 tnum">{r.rank}</span>{teamCell(prog(r))}</>}
                right={<span className={`inline-flex items-center gap-0.5 ${d > 0 ? 'text-win' : 'text-loss'}`}>{d > 0 ? <ArrowUp size={12} aria-hidden /> : <ArrowDown size={12} aria-hidden />}{Math.abs(d)}<span className="sr-only">{d > 0 ? ' up' : ' down'}</span></span>} />
            ); })}
            {newIn.map((r) => <RailRow key={r.college_programs.id} to={href(`/teams/${r.college_programs.id}`)} left={<><span className="w-6 text-right font-semibold text-chalk-100 tnum">{r.rank}</span>{teamCell(prog(r))}</>} right={<span className="text-note">new</span>} />)}
          </ol>
        </RailCard>
      )}
      {tab !== 'polls' && rows.length > 0 && (
        <RailCard title="Coaches' poll" to={href('/rankings', { tab: null })} toLabel="Full poll">
          <ol className="space-y-0.5">{rows.slice(0, 10).map((r) => <RailRow key={r.college_programs.id} to={href(`/teams/${r.college_programs.id}`)} left={<><span className="w-6 text-right font-semibold text-chalk-100 tnum">{r.rank}</span>{teamCell(prog(r))}</>} right={r.record ?? ''} />)}</ol>
        </RailCard>
      )}
      {tab !== 'rpi' && (rpi.data?.rows.length ?? 0) > 0 && (
        <RailCard title={`Live RPI, ${division.toUpperCase()}`} to={href('/rankings', { tab: 'rpi' })} toLabel="Full table">
          <ol className="space-y-0.5">{rpi.data!.rows.map((r) => <RailRow key={r.program.id} to={href(`/teams/${r.program.id}`)} left={<><span className="w-6 text-right font-semibold text-chalk-100 tnum">{r.rank}</span>{teamCell(r.program)}</>} right={Number(r.rpi).toFixed(4)} />)}</ol>
        </RailCard>
      )}
      {tab !== 'elo' && (elo.data?.rows.length ?? 0) > 0 && (
        <RailCard title={`Plaibook Elo, ${division.toUpperCase()}`} to={href('/rankings', { tab: 'elo' })} toLabel="Full ranking">
          <ol className="space-y-0.5">{elo.data!.rows.map((r) => <RailRow key={r.program.id} to={href(`/teams/${r.program.id}`)} left={<><span className="w-6 text-right font-semibold text-chalk-100 tnum">{r.division_rank ?? r.rank}</span>{teamCell(r.program)}</>} right={r.rating} />)}</ol>
        </RailCard>
      )}
    </>
  );
}
