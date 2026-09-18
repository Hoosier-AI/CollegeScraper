import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, qs, fmt, useAdmin } from '../lib/api';
import { useFilters, useKeepQuery } from '../lib/filters';
import { Badge, DataTable, ErrorBox, Spinner, TeamLogo, type Column } from '../components/ui';

export default function Rankings() {
  const admin = useAdmin();
  const f = useFilters(); const keep = useKeepQuery();
  const [division, setDivision] = useState('d1');
  const [poll, setPoll] = useState('');
  const [week, setWeek] = useState('');
  const q = useQuery({ queryKey: ['rankings', f.season, f.gender, division, poll, week], queryFn: () => api<any>(`/api/rankings${qs({ season: f.season, gender: f.gender, division, poll, week_of: week })}`) });
  const usc = q.data?.poll === 'usc';
  const rows: any[] = q.data?.rows ?? [];
  const top = usc ? rows.filter((r) => !String(r.label ?? '').endsWith('(RV)')) : rows;
  const rv = usc ? rows.filter((r) => String(r.label ?? '').endsWith('(RV)')) : [];
  const move = (r: any) => { if (r.previous_rank == null) return <Badge tone="amber">NR</Badge>; const d = r.previous_rank - r.rank; return d > 0 ? <span className="text-emerald-300">▲{d}</span> : d < 0 ? <span className="text-red-300">▼{-d}</span> : <span className="text-ink-500">–</span>; };
  const team = (r: any) => r.college_programs ? <Link className="flex items-center gap-2 hover:text-teal-400" to={keep(`/teams/${r.college_programs.id}`)}><TeamLogo src={r.college_programs.college_schools?.logo_svg_url} name={r.college_programs.name} size={20} />{r.college_programs.name}</Link> : <span className="text-ink-400">{r.subject_name} <span className="text-xs text-amber-300">(unmatched)</span></span>;
  const cols: Column<any>[] = usc ? [
    { key: 'rank', label: '#', num: true },
    { key: 'name', label: 'Team', sticky: true, value: (r) => r.college_programs?.name ?? r.subject_name, render: team },
    { key: 'move', label: 'Prev', value: (r) => r.previous_rank, render: (r) => <span className="flex items-center gap-2">{r.previous_rank ?? ''} {move(r)}</span> },
    { key: 'record', label: 'Record' },
    { key: 'first_place_votes', label: '1st', num: true },
    { key: 'value', label: 'Points', num: true },
  ] : [
    { key: 'rank', label: '#', num: true },
    { key: 'name', label: q.data?.rows?.[0]?.player_season_id ? 'Player' : 'Team', sticky: true, value: (r) => r.college_player_seasons?.college_players?.display_name ?? r.college_programs?.name ?? r.subject_name, render: (r) => r.college_player_seasons ? <Link className="hover:text-teal-400" to={keep(`/players/${r.college_player_seasons.player_id}`)}>{r.college_player_seasons.college_players?.display_name}</Link> : r.player_season_id === undefined ? team(r) : <span>{String(r.subject_name).split('|')[1]} <span className="text-xs text-amber-300">(unmatched)</span></span> },
    { key: 'team', label: 'Team', value: (r) => r.college_programs?.name, render: (r) => r.college_programs ? team(r) : String(r.subject_name).split('|').pop() },
    { key: 'value', label: 'Value', num: true, render: (r) => fmt.num(r.value, Number(r.value) % 1 ? 2 : 0) },
  ];
  const check = q.data?.ncaaCheck?.[`${f.gender}/${division}`];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-black">Rankings</h1>
        <select className="input" value={division} onChange={(e) => { setDivision(e.target.value); setWeek(''); }}><option value="d1">D1</option><option value="d2">D2</option><option value="d3">D3</option></select>
        <select className="input" value={q.data?.poll ?? poll} onChange={(e) => { setPoll(e.target.value); setWeek(''); }}>{(q.data?.polls ?? []).map((p: any) => <option key={p.poll} value={p.poll}>{p.label}</option>)}</select>
        <select className="input" value={q.data?.week ?? week} onChange={(e) => setWeek(e.target.value)}>{(q.data?.weeks ?? []).map((w: any, i: number) => <option key={w.week_of} value={w.week_of}>{i === 0 ? 'Latest · ' : ''}{w.label} · {fmt.date(w.week_of)}</option>)}</select>
        {q.data?.weeks?.length > 1 && q.data.week !== q.data.weeks[0].week_of && <button className="btn-ghost !py-1" onClick={() => setWeek('')}>Back to latest</button>}
      </div>
      {usc && <p className="text-xs text-ink-500">Source: unitedsoccercoaches.org (every poll of the season; earlier polls stay selectable above). {check && q.data?.week === q.data?.weeks?.[0]?.week_of && (check.mismatches?.length ? <span className="text-amber-300">ncaa.com's copy differs: {check.mismatches.join(', ')}</span> : <span className="text-emerald-300">✓ matches ncaa.com's copy ({check.ncaa_week ?? 'latest'})</span>)}</p>}
      {q.isLoading && <Spinner />}{q.error && <ErrorBox error={q.error} />}
      {q.data && (top.length ? <DataTable rows={top} columns={cols} rowKey={(r) => String(r.id)} defaultSort={{ key: 'rank', dir: 'asc' }} dense /> : <p className="text-sm text-ink-500">No rankings for this poll yet.{admin && ' Run refresh-rankings from the Jobs page.'}</p>)}
      {rv.length > 0 && <p className="text-sm text-ink-400"><b className="text-ink-200">Also receiving votes:</b> {rv.map((r, i) => <span key={r.id}>{i > 0 && ', '}{r.college_programs ? <Link className="hover:text-teal-400" to={keep(`/teams/${r.college_programs.id}`)}>{r.college_programs.name}</Link> : r.subject_name} ({r.value})</span>)}</p>}
    </div>
  );
}
