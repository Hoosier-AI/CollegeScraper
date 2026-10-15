// Corrections and removal requests from the public form (/corrections): read, reply by email, then close with a note.
// Acting on one is done where the data lives (a player's suppress switch, a correction in the data); this list is the
// inbox and the record of what was done.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, fmt } from '../../lib/api';
import { Badge, EmptyState, ErrorBox, SegmentedControl, Skeleton } from '../../components/primitives';

interface Req { id: number; kind: string; name: string | null; email: string; relation: string | null; page_url: string | null; details: string; status: string; note: string | null; created_at: string; closed_at: string | null }
const KIND: Record<string, string> = { correction: 'Correction', removal: 'Removal', privacy: 'Privacy', copyright: 'Copyright', other: 'Other' };

export default function RequestsTab() {
  const [status, setStatus] = useState('open');
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['console-requests', status], queryFn: () => api<{ open: number; rows: Req[] }>(`/api/console/requests?status=${status}`) });
  const close = useMutation({
    mutationFn: (v: { id: number; status: string; note: string }) => api(`/api/console/requests/${v.id}`, { method: 'PUT', body: JSON.stringify(v) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['console-requests'] }),
  });
  const [notes, setNotes] = useState<Record<number, string>>({});
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-chalk-300">{q.data ? `${q.data.open} open` : ''} Requests from the form on /corrections. Reply by email, act on the data, then close with a note. Closed requests are deleted after 12 months.</p>
        <SegmentedControl label="Show" size="sm" value={status} onChange={setStatus} options={[{ value: 'open', label: 'Open' }, { value: 'all', label: 'All' }]} />
      </div>
      {q.error && <ErrorBox error={q.error} retry={() => q.refetch()} />}
      {q.isPending && <Skeleton className="h-48" />}
      {q.data && !q.data.rows.length && <EmptyState title={status === 'open' ? 'No open requests' : 'No requests yet'} />}
      <ul className="space-y-2">
        {q.data?.rows.map((r) => (
          <li key={r.id} className="frame space-y-2 px-3 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={r.kind === 'removal' || r.kind === 'privacy' ? 'red' : r.kind === 'copyright' ? 'amber' : 'blue'}>{KIND[r.kind] ?? r.kind}</Badge>
              {r.status !== 'open' && <Badge tone="gray">{r.status}</Badge>}
              <a href={`mailto:${r.email}?subject=${encodeURIComponent(`Your Plaibook Stats request (${KIND[r.kind] ?? r.kind})`)}`} className="font-medium text-pitch-300 hover:text-pitch-200">{r.name ? `${r.name} <${r.email}>` : r.email}</a>
              {r.relation && <span className="text-xs text-chalk-400">{r.relation}</span>}
              <span className="ml-auto text-xs text-chalk-500" title={r.created_at}>{fmt.ago(r.created_at)}</span>
            </div>
            {r.page_url && <a href={r.page_url} target="_blank" rel="noreferrer" className="block truncate text-xs text-pitch-300 hover:text-pitch-200">{r.page_url}</a>}
            <p className="whitespace-pre-wrap text-chalk-200">{r.details}</p>
            {r.status === 'open' ? (
              <div className="flex flex-wrap items-center gap-2">
                <input aria-label="What was done" className="input min-w-0 flex-1" placeholder="What was done (kept with the request)" value={notes[r.id] ?? ''} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} />
                <button className="btn-primary btn-sm" disabled={close.isPending} onClick={() => close.mutate({ id: r.id, status: 'done', note: notes[r.id] ?? '' })}>Done</button>
                <button className="btn-ghost btn-sm" disabled={close.isPending} onClick={() => close.mutate({ id: r.id, status: 'declined', note: notes[r.id] ?? '' })}>Decline</button>
                <button className="btn-ghost btn-sm" disabled={close.isPending} onClick={() => close.mutate({ id: r.id, status: 'spam', note: '' })}>Spam</button>
              </div>
            ) : r.note && <p className="text-xs text-chalk-400">Done: {r.note}{r.closed_at ? ` (${fmt.date(r.closed_at)})` : ''}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
