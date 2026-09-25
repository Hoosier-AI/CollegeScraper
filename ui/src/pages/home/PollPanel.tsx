// The latest United Soccer Coaches poll for the scope: top ten with record and movement since last week.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { api, fmt, qs } from '../../lib/api';
import { useHref, divisionLabel, genderLabel } from '../../lib/filters';
import { Skeleton, TeamLogo } from '../../components/primitives';
import { Panel, type Scope } from './Panel';

export function usePoll(scope: Scope) {
  return useQuery({ queryKey: ['home-poll', scope.season, scope.gender, scope.division], queryFn: () => api<any>(`/api/rankings${qs({ season: scope.season, gender: scope.gender, division: scope.division })}`) });
}

function Move({ rank, prev }: { rank: number; prev: number | null }) {
  if (prev == null) return <span className="text-2xs font-medium text-note">new</span>;
  const d = prev - rank;
  if (d > 0) return <span className="inline-flex items-center text-xs text-win tnum" aria-label={`up ${d}`}><ArrowUp size={12} aria-hidden />{d}</span>;
  if (d < 0) return <span className="inline-flex items-center text-xs text-loss tnum" aria-label={`down ${-d}`}><ArrowDown size={12} aria-hidden />{-d}</span>;
  return <span className="text-xs text-chalk-500" aria-label="no change">–</span>;
}

export function PollPanel({ scope, className }: { scope: Scope; className?: string }) {
  const href = useHref();
  const q = usePoll(scope);
  const [more, setMore] = useState(false);
  const rows: any[] = (q.data?.rows ?? []).filter((r: any) => r.program_id && !String(r.label ?? '').endsWith('(RV)')).slice(0, 10);
  const week = q.data?.weeks?.find((w: any) => w.week_of === q.data?.week);
  return (
    <Panel className={className} title="Coaches' poll" meta={week ? `United Soccer Coaches, ${week.label}, ${fmt.day(week.week_of)}` : 'United Soccer Coaches'}
      footer={{ to: href('/rankings', { view: 'polls', gender: scope.gender, division: scope.division }), label: 'Full poll and past weeks' }}>
      {q.isPending && <div className="space-y-2" aria-busy="true">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-6" />)}</div>}
      {q.data && !rows.length && <p className="text-sm text-chalk-500">No poll published yet for {divisionLabel(scope.division)} {genderLabel(scope.gender)}.</p>}
      <ol className="-mx-2">
        {rows.map((r, i) => (
          <li key={r.id} className={i >= 5 && !more ? 'hidden sm:block' : ''}>
            <Link to={href(`/teams/${r.program_id}`, { gender: scope.gender })} className="flex min-h-10 items-center gap-2.5 rounded-md px-2 py-1 text-sm hover:bg-field-800">
              <span className="display w-6 text-right text-base text-chalk-100 tnum">{r.rank}</span>
              <TeamLogo src={r.college_programs?.college_schools?.logo_svg_url} seo={r.college_programs?.school_seo} name={r.college_programs?.name} size={22} />
              <span className="min-w-0 flex-1 truncate font-medium text-chalk-100">{r.college_programs?.name ?? r.subject_name}</span>
              <span className="text-xs text-chalk-400 tnum">{r.record}</span>
              <span className="w-8 text-right"><Move rank={r.rank} prev={r.previous_rank} /></span>
            </Link>
          </li>
        ))}
      </ol>
      {rows.length > 5 && !more && <button type="button" className="btn-quiet btn-sm mt-1 sm:hidden" onClick={() => setMore(true)}>Show top 10</button>}
    </Panel>
  );
}
