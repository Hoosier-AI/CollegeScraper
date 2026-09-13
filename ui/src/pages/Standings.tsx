import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, qs, fmt } from '../lib/api';
import { useFilters, useKeepQuery } from '../lib/filters';
import { ErrorBox, Spinner, TeamLogo } from '../components/ui';

export default function Standings() {
  const f = useFilters(); const keep = useKeepQuery();
  const [division, setDivision] = useState('d1');
  const q = useQuery({ queryKey: ['standings', f.season, f.gender, division], queryFn: () => api<{ source: string; rows: any[] }>(`/api/standings${qs({ season: f.season, gender: f.gender, division })}`) });
  const groups = new Map<string, any[]>();
  for (const r of q.data?.rows ?? []) { const k = r.college_conferences?.name ?? 'Unknown'; groups.set(k, [...(groups.get(k) ?? []), r]); }
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2"><h1 className="text-xl font-black">Standings</h1><select className="input" value={division} onChange={(e) => setDivision(e.target.value)}><option value="d1">D1</option><option value="d2">D2</option><option value="d3">D3</option></select></div>
      {q.isLoading && <Spinner />}{q.error && <ErrorBox error={q.error} />}
      {q.data && !q.data.rows.length && <p className="text-sm text-ink-500">No standings yet — sync some programs (records are computed from stored games) or run refresh-rankings.</p>}
      {q.data?.source === 'computed' && q.data.rows.length > 0 && <p className="text-xs text-ink-500">Computed from stored game results (conference points = 3W + 1T); only synced programs appear. NCAA.com's published standings are not server-rendered.</p>}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{[...groups.entries()].map(([conf, rows]) => (
        <div key={conf} className="card"><h2 className="mb-2 font-bold">{conf}</h2><table className="w-full text-sm"><thead><tr><th className="th">#</th><th className="th">Team</th><th className="th text-right">Conf</th><th className="th text-right">Pts</th><th className="th text-right">Overall</th></tr></thead><tbody>
          {rows.map((r) => <tr key={r.program_id}><td className="td">{r.rank ?? ''}</td><td className="td"><Link className="flex items-center gap-2 hover:text-teal-400" to={keep(`/teams/${r.program_id}`)}><TeamLogo src={r.college_programs?.college_schools?.logo_svg_url} name={r.college_programs?.name} size={18} />{r.college_programs?.name}</Link></td><td className="td num">{fmt.rec(r.conf_w, r.conf_l, r.conf_t)}</td><td className="td num">{r.conf_pts ?? ''}</td><td className="td num">{fmt.rec(r.overall_w, r.overall_l, r.overall_t)}</td></tr>)}
        </tbody></table></div>
      ))}</div>
    </div>
  );
}
