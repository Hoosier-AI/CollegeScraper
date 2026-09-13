import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '../lib/api';
import { useFilters, useKeepQuery } from '../lib/filters';
import { Badge, ErrorBox, Spinner } from '../components/ui';

export default function Quality() {
  const f = useFilters(); const keep = useKeepQuery();
  const q = useQuery({ queryKey: ['quality', f.season], queryFn: () => api<any>(`/api/quality${qs({ season: f.season })}`) });
  const [open, setOpen] = useState<string | null>(null);
  if (q.isLoading) return <Spinner label="Running checks…" />;
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data;
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-black">Data quality <span className="text-sm font-normal text-ink-500">{d.season} · {d.games} games · {d.finals} finals</span></h1>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{d.checks.map((c: any) => (
        <div key={c.id} className={`card cursor-pointer ${c.count ? 'border-amber-500/40' : 'border-emerald-500/30'}`} onClick={() => setOpen(open === c.id ? null : c.id)}>
          <div className="flex items-center justify-between"><h2 className="font-bold">{c.title}</h2><Badge tone={c.count ? 'amber' : 'green'}>{c.count}</Badge></div>
          <p className="mt-1 text-xs text-ink-400">{c.description}</p>
          {open === c.id && c.sample.length > 0 && <ul className="mt-2 max-h-72 space-y-1 overflow-auto text-xs text-ink-300">{c.sample.map((s: any, i: number) => <li key={i}>{s.id ? <Link className="text-teal-400 hover:underline" to={keep(`/games/${s.id}`)}>{s.game}</Link> : null} {JSON.stringify({ ...s, game: undefined, id: undefined })}</li>)}</ul>}
        </div>
      ))}</div>
    </div>
  );
}
