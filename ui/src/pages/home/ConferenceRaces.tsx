// Six conference tables at a glance for the scope, the ones with the most conference games played first.
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '../../lib/api';
import { useHref } from '../../lib/filters';
import { Badge, Skeleton, TeamLogo } from '../../components/primitives';
import { Panel, type Scope } from './Panel';

export function ConferenceRaces({ scope, className }: { scope: Scope; className?: string }) {
  const href = useHref();
  // Same cache key as the Standings page, so opening it next is instant.
  const q = useQuery({ queryKey: ['conferences', scope.season, scope.gender, scope.division], queryFn: () => api<any[]>(`/api/conferences${qs({ season: scope.season, gender: scope.gender, division: scope.division })}`) });
  const picked = useMemo(() => {
    const played = (c: any) => (c.table?.[scope.gender]?.top ?? []).reduce((n: number, r: any) => n + (r.conf_w ?? 0) + (r.conf_l ?? 0) + (r.conf_t ?? 0), 0);
    return (q.data ?? []).filter((c) => (c.members?.[scope.gender] ?? 0) > 0).sort((a, b) => played(b) - played(a) || (b.members[scope.gender] ?? 0) - (a.members[scope.gender] ?? 0)).slice(0, 6);
  }, [q.data, scope.gender]);
  return (
    <Panel className={className} title="Conference races" meta={q.data ? `Top three in ${picked.length} of ${q.data.filter((c) => (c.members?.[scope.gender] ?? 0) > 0).length} conferences, most games played first` : undefined}
      footer={{ to: href('/rankings', { view: 'standings', gender: scope.gender, division: scope.division }), label: 'All conference tables' }}>
      {q.isPending && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-32" />)}</div>}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {picked.map((c) => {
          const t = c.table?.[scope.gender] ?? { top: [], source: 'none' };
          return (
            <li key={c.id}>
              <Link to={href('/rankings', { view: 'standings', conference: c.id, gender: scope.gender })} className="frame block h-full p-3 transition-colors duration-150 hover:border-field-600 hover:bg-field-800/60">
                <div className="flex items-start justify-between gap-2">
                  <span className="display text-base text-chalk-100">{c.name}</span>
                  {t.source === 'conference' ? <Badge tone="teal">Official</Badge> : t.source === 'computed' ? <Badge>Computed</Badge> : null}
                </div>
                {t.top.length ? (
                  <ol className="mt-2 space-y-1">
                    {t.top.map((r: any) => (
                      <li key={r.program_id} className="flex items-center gap-2 text-sm">
                        <span className="w-3 text-right text-xs text-chalk-500 tnum">{r.rank}</span>
                        <TeamLogo src={r.logo} seo={r.seo} name={r.name} size={18} />
                        <span className="min-w-0 flex-1 truncate text-chalk-100">{r.name}</span>
                        <span className="text-xs text-chalk-400 tnum">{r.conf_w}-{r.conf_l}-{r.conf_t}</span>
                        <span className="w-6 text-right text-xs text-chalk-300 tnum">{r.conf_pts ?? ''}</span>
                      </li>
                    ))}
                  </ol>
                ) : <p className="mt-2 text-sm text-chalk-500">Conference play has not started.</p>}
              </Link>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
