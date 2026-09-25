// /conferences/<ncaa_seo> (or an old /conferences/<uuid>): the conference view from Rankings, at its own address.
import { Link, useParams } from 'react-router-dom';
import { useEntityId } from '../lib/entity';
import { EmptyState, ErrorBox, Skeleton } from '../components/primitives';
import { ConferenceDetail } from './rankings/ConferenceDetail';

export default function Conference() {
  const { id: param = '' } = useParams();
  const entity = useEntityId('conference', param);
  if (entity.missing) return <EmptyState title="No such conference" action={<Link className="btn-ghost btn-sm" to="/rankings?view=standings">All conferences</Link>} />;
  if (entity.error) return <ErrorBox error={entity.error} />;
  if (!entity.id) return <div className="space-y-4" aria-busy="true"><Skeleton className="h-24" /><Skeleton className="h-64" /></div>;
  return <ConferenceDetail id={entity.id} />;
}
