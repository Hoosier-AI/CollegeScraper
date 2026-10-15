// The home page's college Team of the Week: last finished week's best-rated XI for the scope (D1 by default) as a
// compact list, best player first, with a link to the pitch view.
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '../../lib/api';
import { genderLabel, useHref } from '../../lib/filters';
import { Skeleton, TeamLogo } from '../../components/primitives';
import { RatingBadge } from '../../components/Rating';
import { weekLabel } from '../TeamOfWeek';
import { Panel, type Scope } from './Panel';

export function TotwPanel({ scope }: { scope: Scope }) {
  const href = useHref();
  const q = useQuery({ queryKey: ['college-totw', scope.season, scope.gender, scope.division, '', ''], queryFn: () => api<any>(`/api/team-of-the-week${qs({ season: scope.season, gender: scope.gender, division: scope.division })}`), staleTime: 300_000 });
  const xi: any[] = q.data?.xi ?? [];
  if (q.data && !xi.length) return null;
  const rows = [...xi].sort((a, b) => b.rating - a.rating).slice(0, 6);
  return (
    <Panel title="Team of the week" meta={q.data?.week ? `${scope.division.toUpperCase()} ${genderLabel(scope.gender)}, ${weekLabel(q.data.week)}` : 'College, best-rated XI'}
      footer={{ to: href('/team-of-the-week', { division: scope.division }), label: 'The full XI on the pitch' }}>
      {q.isPending && <div className="space-y-2" aria-busy="true">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-6" />)}</div>}
      <ol className="-mx-2">
        {rows.map((x) => (
          <li key={`${x.player_id ?? x.name}-${x.game_id}`}>
            <Link to={x.player_id ? href(`/players/${x.player_id}`) : href(`/matches/${x.game_id}`)} className="flex min-h-10 items-center gap-2.5 rounded-md px-2 py-1 text-sm hover:bg-field-800">
              <span className="w-4 text-2xs font-semibold text-chalk-500">{x.pos}</span>
              {x.team && <TeamLogo src={x.team.logo} seo={x.team.seo} name={x.team.name} size={20} />}
              <span className="min-w-0 flex-1 truncate font-medium text-chalk-100">{x.name}</span>
              <RatingBadge v={x.rating} />
            </Link>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
