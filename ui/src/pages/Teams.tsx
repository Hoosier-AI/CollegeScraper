import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, qs, fmt, useAdmin } from '../lib/api';
import { useFilters, useKeepQuery } from '../lib/filters';
import { Badge, DataTable, ErrorBox, Spinner, TeamLogo, type Column } from '../components/ui';
import { RunProgress } from '../components/RunProgress';

interface ProgramRow { id: string; name: string; gender: string; school_seo: string; site_status: string; division?: string; conference: { name: string } | null; member: boolean; member_source: string | null; official: { w: number; l: number; t: number } | null; school: { logo_svg_url?: string; athletics_host?: string; site_platform?: string } | null; synced: { roster?: string; boxscores?: string; failures: number }; record: { gp: number; w: number; l: number; t: number; gf: number; ga: number } | null; games: { games: number; finals: number; site: number; ncaa: number; truth: number } }

export default function Teams() {
  const f = useFilters();
  const admin = useAdmin();
  const nav = useNavigate();
  const keep = useKeepQuery();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [division, setDivision] = useState('');
  const [conference, setConference] = useState('');
  const [running, setRunning] = useState<Record<string, string>>({});
  const [members, setMembers] = useState(true);
  const meta = useQuery({ queryKey: ['meta'], queryFn: () => api<{ conferences: { id: string; name: string; division: string | null }[] }>('/api/meta') });
  const list = useQuery({ queryKey: ['programs', f.season, f.gender, division, conference, members], queryFn: () => api<ProgramRow[]>(`/api/programs${qs({ season: f.season, gender: f.gender, division, conference, members: members ? '' : 'all' })}`) });
  const sync = useMutation({
    mutationFn: (id: string) => api<{ id: string }>(`/api/programs/${id}/sync`, { method: 'POST', body: JSON.stringify({ season: f.season }) }),
    onSuccess: (r, id) => setRunning((m) => ({ ...m, [id]: r.id })),
  });
  const rows = (list.data ?? []).filter((p) => !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.school_seo.includes(search.toLowerCase()));
  // What a visitor came for. Crawl plumbing — which site platform, how many box scores, when we last synced —
  // is operator detail and only appears when signed in.
  const cols: Column<ProgramRow>[] = [
    { key: 'name', label: 'Program', sticky: true, render: (p) => <span className="flex items-center gap-2"><TeamLogo src={p.school?.logo_svg_url} name={p.name} /><span className="font-semibold">{p.name}</span></span> },
    { key: 'division', label: 'Div', value: (p) => p.division ?? '' , render: (p) => (p.division ?? '').toUpperCase() },
    { key: 'conference', label: 'Conference', value: (p) => p.conference?.name ?? '' },
    { key: 'record', label: 'W-L-T', value: (p) => p.record?.w ?? null, render: (p) => { const ours = fmt.rec(p.record?.w, p.record?.l, p.record?.t); const off = p.official ? fmt.rec(p.official.w, p.official.l, p.official.t) : null; return <span title={off ? `NCAA.com: ${off}` : 'no NCAA record yet'} className={off && p.record && off !== ours ? 'rounded bg-amber-500/20 px-1 text-amber-200' : ''}>{ours}{off && p.record && off !== ours && <span className="ml-1 text-[10px] text-amber-400">({off})</span>}</span>; } },
    { key: 'gf', label: 'GF', num: true, value: (p) => p.record?.gf ?? null },
    { key: 'ga', label: 'GA', num: true, value: (p) => p.record?.ga ?? null },
    { key: 'gd', label: 'GD', num: true, value: (p) => (p.record ? (p.record.gf ?? 0) - (p.record.ga ?? 0) : null) },
    { key: 'games', label: 'Games', num: true, value: (p) => p.games.games },
  ];
  if (admin) cols.push(
    { key: 'platform', label: 'Site', value: (p) => p.school?.site_platform ?? '', render: (p) => <span className="flex items-center gap-1"><Badge tone={p.school?.site_platform === 'sidearm' ? 'teal' : p.school?.site_platform === 'presto' ? 'blue' : 'gray'}>{p.school?.site_platform ?? 'unknown'}</Badge>{p.site_status !== 'ok' && <Badge tone="amber">{p.site_status}</Badge>}</span> },
    { key: 'member', label: 'NCAA', value: (p) => p.member ? 1 : 0, render: (p) => p.member ? <span className="text-emerald-300" title={`member (${p.member_source ?? 'conference'})`}>✓</span> : <Badge tone="amber" title="not an NCAA member (opponent only)">non-NCAA</Badge> },
    { key: 'finals', label: 'Finals', num: true, value: (p) => p.games.finals },
    { key: 'site', label: 'Site box', num: true, value: (p) => p.games.site, title: 'Games with a school-site box score stored' },
    { key: 'ncaa', label: 'NCAA box', num: true, value: (p) => p.games.ncaa },
    { key: 'synced', label: 'Roster synced', value: (p) => p.synced.roster ?? '', render: (p) => <span className={p.synced.roster ? 'text-ink-300' : 'text-ink-500'}>{fmt.ago(p.synced.roster)}</span> },
    { key: 'sync', label: '', render: (p) => running[p.id]
      ? <RunProgress runId={running[p.id]!} compact onDone={() => { setRunning((m) => { const n = { ...m }; delete n[p.id]; return n; }); qc.invalidateQueries({ queryKey: ['programs'] }); }} />
      : <button className="btn-primary !py-1" onClick={(e) => { e.stopPropagation(); sync.mutate(p.id); }}>Sync</button> },
  );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-black">Teams <span className="text-sm font-normal text-ink-500">{rows.length} programs · {f.season} · {f.gender === 'm' ? "men's" : "women's"}</span></h1>
        <input className="input ml-auto w-56" placeholder="Search school…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input" value={division} onChange={(e) => setDivision(e.target.value)}><option value="">All divisions</option><option value="d1">D1</option><option value="d2">D2</option><option value="d3">D3</option></select>
        <select className="input" value={conference} onChange={(e) => setConference(e.target.value)}><option value="">All conferences</option>{(meta.data?.conferences ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        {admin && <label className="flex items-center gap-1 text-sm text-ink-400"><input type="checkbox" checked={!members} onChange={(e) => setMembers(!e.target.checked)} /> show non-NCAA opponents</label>}
      </div>
      <p className="text-sm text-ink-400">
        Click a program to open its roster, results and season stats.
        {admin && <> <b className="text-ink-200">Sync</b> pulls that team's roster, schedule, season stats, box scores and bios from its athletics site, then the NCAA.com box scores, and recomputes aggregates (about 1–2 minutes).</>}
      </p>
      {list.isLoading && <Spinner />}
      {list.error && <ErrorBox error={list.error} />}
      {list.data && <DataTable rows={rows} columns={cols} rowKey={(p) => p.id} onRow={(p) => nav(keep(`/teams/${p.id}`))} rowHref={(p) => keep(`/teams/${p.id}`)} defaultSort={{ key: 'name', dir: 'asc' }} empty={admin ? 'No programs for this season yet — run discover-teams from the Jobs page.' : 'No programs for this season yet.'} dense />}
    </div>
  );
}
