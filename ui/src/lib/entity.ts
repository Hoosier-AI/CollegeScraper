// Pages are addressed by readable slugs (/teams/duke/men, /players/jane-doe-3f2a9c, /matches/2026-09-12-…) and,
// for older links inside the app, by UUID. The /api routes take UUIDs, so a slug is looked up once and cached.
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from './api';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type EntityKind = 'team' | 'player' | 'match' | 'conference';

/** `key`: a UUID (returned as is), a slug, or "school/men" for a team. */
export function useEntityId(kind: EntityKind, key: string): { id: string; pending: boolean; missing: boolean; error: unknown } {
  const isId = UUID.test(key);
  const q = useQuery({
    queryKey: ['resolve', kind, key],
    queryFn: () => api<{ id: string }>(`/api/resolve?kind=${kind}&key=${encodeURIComponent(key)}`),
    enabled: !!key && !isId,
    staleTime: Infinity,
    retry: false,
  });
  if (isId) return { id: key, pending: false, missing: false, error: null };
  const missing = !key || (q.error instanceof ApiError && q.error.status === 404);
  return { id: q.data?.id ?? '', pending: !!key && q.isPending, missing, error: missing ? null : q.error };
}

/** Removes the server-rendered summary (<section id="ssr">) once the app has content of its own. */
export function removeServerSummary(): void {
  document.getElementById('ssr')?.remove();
}
