import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '../lib/api';
import { useFilters, useKeepQuery } from '../lib/filters';
import { DataTable, ErrorBox, Spinner, TeamLogo, type Column } from '../components/ui';

export default function Rankings() {
  const f = useFilters(); const keep = useKeepQuery();
  const [division, setDivision] = useState('d1');
  const [poll, setPoll] = useState('');
  const [week, setWeek] = useState('');
  const q = useQuery({ queryKey: ['rankings', f.season, f.gender, division, poll, week], queryFn: () => api<any>(`/api/rankings${qs({ season: f.season, gender: f.gender, division, poll, week_of: week })}`) });
  const cols: Column<any>[] = [
    { key: 'rank', label: '#', num: true },
    { key: 'name', label: 'Team', sticky: true, value: (r) => r.college_programs?.name ?? r.subject_name, render: (r) => r.college_programs ? <Link className="flex items-center gap-2 hover:text-teal-400" to={keep(`/teams/${r.college_programs.id}`)}><TeamLogo src={r.college_programs.college_schools?.logo_svg_url} name={r.college_programs.name} size={20} />{r.college_programs.name}</Link> : <span className="text-ink-400">{r.subject_name} <span className="text-xs text-amber-300">(unmatched)</span></span> },
    { key: 'value', label: 'Value', num: true },
  ];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-black">Rankings</h1>
        <select className="input" value={division} onChange={(e) => setDivision(e.target.value)}><option value="d1">D1</option><option value="d2">D2</option><option value="d3">D3</option></select>
        <select className="input" value={q.data?.poll ?? poll} onChange={(e) => setPoll(e.target.value)}>{(q.data?.polls ?? []).map((p: string) => <option key={p} value={p}>{p}</option>)}</select>
        <select className="input" value={q.data?.week ?? week} onChange={(e) => setWeek(e.target.value)}>{(q.data?.weeks ?? []).map((w: string) => <option key={w} value={w}>{w}</option>)}</select>
      </div>
      {q.isLoading && <Spinner />}{q.error && <ErrorBox error={q.error} />}
      {q.data && (q.data.rows.length ? <DataTable rows={q.data.rows} columns={cols} rowKey={(r) => String(r.id)} defaultSort={{ key: 'rank', dir: 'asc' }} dense /> : <p className="text-sm text-ink-500">No rankings stored — run refresh-rankings from the Jobs page.</p>)}
    </div>
  );
}
