import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, qs, fmt } from '../lib/api';
import { useFilters, useHref } from '../lib/filters';
import { Badge, ErrorBox, PageHeader, Spinner } from '../components/primitives';

export default function Quality() {
  const f = useFilters(); const href = useHref();
  const q = useQuery({ queryKey: ['quality', f.season], queryFn: () => api<any>(`/api/quality${qs({ season: f.season })}`) });
  const [open, setOpen] = useState<string | null>(null);
  if (q.isPending) return <Spinner label="Running checks…" />;
  if (q.error) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  const d = q.data;
  return (
    <div className="space-y-4">
      <PageHeader title="Data quality" meta={`${d.season}: ${fmt.num(d.games)} games, ${fmt.num(d.finals)} finals`} />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{d.checks.map((c: any) => (
        <div key={c.id} className={`card ${c.count ? 'border-note/40' : 'border-win/30'}`}>
          <button type="button" className="flex w-full items-start justify-between gap-2 p-3 text-left" aria-expanded={open === c.id} aria-controls={`q-${c.id}`} onClick={() => setOpen(open === c.id ? null : c.id)}>
            <span><span className="block font-semibold text-chalk-100">{c.title}</span><span className="mt-1 block text-xs text-chalk-400">{c.description}</span></span>
            <Badge tone={c.count ? 'amber' : 'green'}>{c.count}</Badge>
          </button>
          {open === c.id && c.sample.length > 0 && <ul id={`q-${c.id}`} className="max-h-72 space-y-1 overflow-auto border-t border-field-700 p-3 text-xs text-chalk-300">{c.sample.map((s: any, i: number) => <li key={i}>{s.id ? <Link className="text-pitch-400 hover:text-pitch-300" to={href(`/matches/${s.id}`)}>{s.game}</Link> : null} {JSON.stringify({ ...s, game: undefined, id: undefined })}</li>)}</ul>}
        </div>
      ))}</div>
    </div>
  );
}
