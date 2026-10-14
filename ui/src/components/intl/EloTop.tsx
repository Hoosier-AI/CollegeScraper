// The Plaibook Elo top of the table (International rankings): rank, nation, rating, linked to each nation.
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '../../lib/api';
import type { IntlRankings } from '../../lib/intl';
import { Skeleton, TeamLogo } from '../primitives';
import { nationHref } from './NationHistory';

export function EloTop({ gender, n = 10 }: { gender: 'm' | 'w'; n?: number }) {
  const rank = useQuery({ queryKey: ['intl-rankings', gender], queryFn: () => api<IntlRankings>(`/api/intl/rankings${qs({ gender })}`), staleTime: 600_000 });
  if (rank.isPending) return <Skeleton lines={6} />;
  if (!rank.data?.rows.length) return <p className="text-sm text-chalk-400">Ratings appear after the first results sync.</p>;
  return (
    <ol className="-mx-2 text-sm">
      {rank.data.rows.slice(0, n).map((r) => (
        <li key={r.nation.key}><Link to={nationHref(r.nation)} className="flex min-h-9 items-center gap-2.5 rounded-md px-2 py-1 hover:bg-field-800">
          <span className="display w-5 text-right text-base tnum text-chalk-300">{r.rank}</span><TeamLogo src={r.nation.logo} name={r.nation.name} size={20} />
          <span className="min-w-0 flex-1 truncate font-medium text-chalk-100">{r.nation.name}</span><span className="tnum text-chalk-300">{r.rating}</span>
        </Link></li>
      ))}
    </ol>
  );
}
