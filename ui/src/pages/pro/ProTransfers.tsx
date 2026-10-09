// The latest transfers across every club we follow (/pro/transfers).
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, qs } from '../../lib/api';
import { useUrlNumber } from '../../lib/urlState';
import { TransfersList, type TransferLine } from '../../components/pro/People';
import { ErrorBox, PageHeader, Skeleton } from '../../components/primitives';

interface FeedRow { date: string; type: string | null; player: { id: number; name: string; slug: string | null }; from: { id: number; name: string | null; logo: string | null; slug: string | null }; to: { id: number; name: string | null; logo: string | null; slug: string | null } }
const PAGE = 50;

export default function ProTransfers() {
  const [page, setPage] = useUrlNumber('page', 1, { min: 1 });
  const q = useQuery({ queryKey: ['pro-transfers', page], queryFn: () => api<FeedRow[]>(`/api/pro/transfers${qs({ limit: PAGE, offset: (page - 1) * PAGE })}`), placeholderData: keepPreviousData });
  const rows: TransferLine[] = (q.data ?? []).map((r) => ({ date: r.date, type: r.type, player: r.player, from_team_id: r.from.id, from_name: r.from.name, from_logo: r.from.logo, from_slug: r.from.slug, to_team_id: r.to.id, to_name: r.to.name, to_logo: r.to.logo, to_slug: r.to.slug }));
  return (
    <div className="space-y-4">
      <PageHeader title="Transfers" meta="The latest moves between clubs, newest first. Loans are marked." />
      {q.error && <ErrorBox error={q.error} retry={() => q.refetch()} />}
      {q.isPending ? <Skeleton className="h-96" /> : <div className={q.isPlaceholderData ? 'opacity-60' : ''}><TransfersList rows={rows} showPlayer empty="No transfers collected yet: they arrive as the crawl reaches each club." /></div>}
      <div className="flex justify-between">
        <button className="btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Newer</button>
        <button className="btn-ghost btn-sm" disabled={(q.data?.length ?? 0) < PAGE} onClick={() => setPage(page + 1)}>Older</button>
      </div>
    </div>
  );
}
