// A nation the provider never had a side for (Yugoslavia, Czechoslovakia, the German DR, or a minnow it does not
// cover): its International page is its history alone, from the open sources.
import { Link } from 'react-router-dom';
import { ApiError } from '../../lib/api';
import { NationHistoryView, useNationHistory } from '../../components/intl/NationHistory';
import { EmptyState, ErrorBox, Skeleton, TeamLogo } from '../../components/primitives';
import { ProHero } from '../../components/pro/Hero';

export function IntlNation({ slug }: { slug: string }) {
  const q = useNationHistory(slug);
  if (q.error instanceof ApiError && q.error.status === 404) return <EmptyState title="Not found" body="There is no national team at this address." action={<Link className="btn-ghost btn-sm" to="/intl/teams">Every national team</Link>} />;
  if (q.error) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  if (q.isPending) return <div className="space-y-4" aria-busy="true"><Skeleton className="h-24" /><Skeleton className="h-96" /></div>;
  const h = q.data!;
  return (
    <div className="space-y-5">
      <ProHero image={<span className="grid h-14 w-14 place-items-center rounded-lg bg-field-800 sm:h-[4.5rem] sm:w-[4.5rem]"><TeamLogo src={h.nation.logo} name={h.nation.name} size={44} /></span>} title={`${h.nation.name}${h.gender === 'w' ? " women's" : ''}`}
        line={<>{h.nation.confederation && <span>{h.nation.confederation}</span>}{h.nation.fifa_code && <span>{h.nation.fifa_code}</span>}</>}
        chips={[h.first_match ? `First match ${h.first_match.slice(0, 4)}` : null, h.nation.fifa ? null : 'Outside FIFA']} />
      <NationHistoryView h={h} slug={slug} />
    </div>
  );
}
