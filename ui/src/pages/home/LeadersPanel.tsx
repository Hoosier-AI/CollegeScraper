// Who is scoring: the season's top five by points or goals for the scope.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, fmt, qs } from '../../lib/api';
import { useHref } from '../../lib/filters';
import { PlayerAvatar, SegmentedControl, Skeleton } from '../../components/primitives';
import { Panel, type Scope } from './Panel';

type Stat = 'points' | 'goals' | 'assists';

export function LeadersPanel({ scope, className }: { scope: Scope; className?: string }) {
  const href = useHref();
  const [stat, setStat] = useState<Stat>('points');
  const q = useQuery({ queryKey: ['home-leaders', scope.season, scope.gender, scope.division, stat], queryFn: () => api<any>(`/api/leaders${qs({ season: scope.season, gender: scope.gender, division: scope.division, stat, limit: 5 })}`) });
  const rows: any[] = (q.data?.rows ?? []).filter((r: any) => !r.suppress).slice(0, 5);
  const label = stat === 'points' ? 'pts' : stat === 'goals' ? 'goals' : 'assists';
  return (
    <Panel className={className} title="Scoring leaders" meta="Season totals from box scores"
      action={<SegmentedControl label="Leaders by" size="sm" value={stat} onChange={setStat} options={[{ value: 'points', label: 'Points' }, { value: 'goals', label: 'Goals' }, { value: 'assists', label: 'Assists' }]} />}
      footer={{ to: href('/rankings', { view: 'leaders', gender: scope.gender, division: scope.division, stat }), label: 'All leaders' }}>
      {q.isPending && <div className="space-y-2" aria-busy="true">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10" />)}</div>}
      {q.data && !rows.length && <p className="text-sm text-chalk-500">No stats recorded yet.</p>}
      <ol className="-mx-2">
        {rows.map((r, i) => (
          <li key={r.player_season_id ?? r.player_id}>
            <Link to={href(`/players/${r.player_id}`, { gender: scope.gender })} className="flex min-h-12 items-center gap-3 rounded-md px-2 py-1.5 hover:bg-field-800">
              <span className="w-4 text-right text-xs text-chalk-500 tnum">{i + 1}</span>
              <PlayerAvatar src={r.headshot_url} name={r.display_name} size={36} crest={r.logo_svg_url} crestSeo={r.school_seo} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-chalk-100">{r.display_name}</span>
                <span className="block truncate text-xs text-chalk-400">{r.program_name}{r.position ? `, ${r.position}` : ''}{r.gp ? `, ${r.gp} games` : ''}</span>
              </span>
              <span className="text-right"><span className="display block text-xl leading-none text-chalk-100 tnum">{fmt.num(r[stat])}</span><span className="text-2xs text-chalk-500">{label}</span></span>
            </Link>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
