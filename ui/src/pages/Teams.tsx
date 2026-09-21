import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, qs, fmt, useAdmin } from '../lib/api';
import { useFilters, useHref, genderLabel, divisionLabel } from '../lib/filters';
import { useUrlState, useUrlText, useSortParam } from '../lib/urlState';
import { DataTable, type Column } from '../components/DataTable';
import { Badge, EmptyState, ErrorBox, Field, PageHeader, SegmentedControl, Select, TeamLogo, VerifiedMark } from '../components/primitives';
import { RunProgress } from '../components/RunProgress';

interface ProgramRow { id: string; name: string; gender: string; school_seo: string; site_status: string; division?: string; conference: { id?: string; name: string } | null; member: boolean; member_source: string | null; official: { w: number; l: number; t: number; at?: string | null } | null; ncaa_check: { state: 'mismatch' | 'lag'; official: string; ours: string } | null; school: { logo_svg_url?: string; athletics_host?: string; site_platform?: string } | null; synced: { roster?: string; boxscores?: string; failures: number }; record: { gp: number; w: number; l: number; t: number; gf: number; ga: number } | null; games: { games: number; finals: number; site: number; ncaa: number; truth: number } }

const DIV_OPTIONS = [{ value: '', label: 'All' }, { value: 'd1', label: 'D1' }, { value: 'd2', label: 'D2' }, { value: 'd3', label: 'D3' }];

export default function Teams() {
  const f = useFilters();
  const admin = useAdmin();
  const href = useHref();
  const qc = useQueryClient();
  const [division, setDivision] = useUrlState('division', '', { allow: ['d1', 'd2', 'd3'] });
  const [conference, setConference] = useUrlState('conference');
  const search = useUrlText('q');
  const [sort, setSort] = useSortParam('sort', { key: 'name', dir: 'asc' });
  const [members, setMembers] = useState(true);
  const [running, setRunning] = useState<Record<string, string>>({});
  const meta = useQuery({ queryKey: ['meta'], queryFn: () => api<{ conferences: { id: string; name: string; division: string | null }[] }>('/api/meta') });
  const list = useQuery({ queryKey: ['programs', f.season, f.gender, division, conference, members], queryFn: () => api<ProgramRow[]>(`/api/programs${qs({ season: f.season, gender: f.gender, division, conference, members: members ? '' : 'all' })}`) });
  const sync = useMutation({
    mutationFn: (id: string) => api<{ id: string }>(`/api/programs/${id}/sync`, { method: 'POST', body: JSON.stringify({ season: f.season }) }),
    onSuccess: (r, id) => setRunning((m) => ({ ...m, [id]: r.id })),
  });
  const term = search.value.toLowerCase();
  const rows = useMemo(() => (list.data ?? []).filter((p) => !term || p.name.toLowerCase().includes(term) || p.school_seo.includes(term) || (p.conference?.name ?? '').toLowerCase().includes(term)), [list.data, term]);
  const confOptions = useMemo(() => [{ value: '', label: 'All conferences' }, ...(meta.data?.conferences ?? []).filter((c) => !division || c.division === division).map((c) => ({ value: c.id, label: c.name }))], [meta.data, division]);

  const cols: Column<ProgramRow>[] = [
    { key: 'name', label: 'Program', primary: true, render: (p) => <span className="flex items-center gap-2"><TeamLogo src={p.school?.logo_svg_url} seo={p.school_seo} name={p.name} size={22} /><span>{p.name}</span>{!p.member && <Badge tone="amber" title="Not an NCAA member: appears only as an opponent">non-NCAA</Badge>}</span> },
    { key: 'division', label: 'Div', value: (p) => p.division ?? '', render: (p) => (p.division ?? '').toUpperCase() },
    { key: 'conference', label: 'Conference', value: (p) => p.conference?.name ?? '', priority: 2 },
    { key: 'record', label: 'W-L-T', title: 'Wins, losses, ties from stored results', value: (p) => p.record?.w ?? null, render: (p) => {
      const ours = fmt.rec(p.record?.w, p.record?.l, p.record?.t); const off = p.official ? fmt.rec(p.official.w, p.official.l, p.official.t) : null;
      if (!off || !p.record) return <span className="tnum">{ours}</span>;
      // Same record: verified. Otherwise the standings check says whether NCAA.com is merely behind or really differs;
      // without a check yet, a leaderboard that lists no result we lack is treated as behind.
      const o = p.official!; const r = p.record;
      const behind = o.w <= r.w && o.l <= r.l && o.t <= r.t;
      const state = off === ours ? 'ok' : p.ncaa_check?.state ?? (behind ? 'lag' : 'mismatch');
      return <span className="inline-flex items-center gap-2 tnum">{ours}<VerifiedMark compact state={state} details={state === 'ok' ? undefined : [{ field: `NCAA.com record${p.official?.at ? ` (${fmt.agoWords(p.official.at)})` : ''}`, official: off, ours }]} /></span>;
    } },
    { key: 'gf', label: 'GF', title: 'Goals for', num: true, value: (p) => p.record?.gf ?? null, priority: 2 },
    { key: 'ga', label: 'GA', title: 'Goals against', num: true, value: (p) => p.record?.ga ?? null, priority: 2 },
    { key: 'gd', label: 'GD', title: 'Goal difference', num: true, value: (p) => (p.record ? (p.record.gf ?? 0) - (p.record.ga ?? 0) : null), render: (p) => { const v = p.record ? (p.record.gf ?? 0) - (p.record.ga ?? 0) : null; return v == null ? '–' : v > 0 ? `+${v}` : String(v); } },
    { key: 'games', label: 'Games', num: true, value: (p) => p.games.games, priority: 2 },
  ];
  if (admin) cols.push(
    { key: 'platform', label: 'Site', value: (p) => p.school?.site_platform ?? '', priority: 3, render: (p) => <span className="flex items-center gap-1"><Badge tone={p.school?.site_platform === 'sidearm' ? 'teal' : p.school?.site_platform === 'presto' ? 'blue' : 'gray'}>{p.school?.site_platform ?? 'unknown'}</Badge>{p.site_status !== 'ok' && <Badge tone="amber">{p.site_status}</Badge>}</span> },
    { key: 'finals', label: 'Finals', num: true, value: (p) => p.games.finals, priority: 3 },
    { key: 'site', label: 'Site box', num: true, value: (p) => p.games.site, title: 'Games with a school-site box score stored', priority: 3 },
    { key: 'ncaa', label: 'NCAA box', num: true, value: (p) => p.games.ncaa, priority: 3 },
    { key: 'synced', label: 'Roster synced', value: (p) => p.synced.roster ?? '', priority: 3, render: (p) => <span className={p.synced.roster ? 'text-chalk-300' : 'text-chalk-500'}>{fmt.ago(p.synced.roster)}</span> },
    { key: 'sync', label: '', sortable: false, priority: 3, render: (p) => running[p.id]
      ? <RunProgress runId={running[p.id]!} compact onDone={() => { setRunning((m) => { const n = { ...m }; delete n[p.id]; return n; }); qc.invalidateQueries({ queryKey: ['programs'] }); }} />
      : <button className="btn-primary btn-sm" onClick={() => sync.mutate(p.id)}>Sync</button> },
  );
  const scope = [division ? divisionLabel(division) : 'all divisions', genderLabel(f.gender), String(f.season)].join(', ');
  return (
    <div className="space-y-4">
      <PageHeader title="Teams" meta={list.data ? `${fmt.num(rows.length)} programs, ${scope}` : scope}>
        <Field label="Division">{() => <SegmentedControl label="Division" size="sm" value={division} onChange={setDivision} options={DIV_OPTIONS} />}</Field>
        <Field label="Conference">{(id) => <Select id={id} value={conference} onChange={setConference} options={confOptions} className="max-w-[220px]" />}</Field>
        <Field label="Find">{(id) => <input id={id} type="search" className="input w-44" placeholder="School or conference" value={search.draft} onChange={(e) => search.setDraft(e.target.value)} />}</Field>
        {admin && <label className="flex items-center gap-1.5 self-end pb-2 text-xs text-chalk-400"><input type="checkbox" checked={!members} onChange={(e) => setMembers(!e.target.checked)} /> include non-NCAA opponents</label>}
      </PageHeader>
      {list.error && <ErrorBox error={list.error} retry={() => list.refetch()} />}
      <DataTable rows={rows} columns={cols} rowKey={(p) => p.id} caption={`Programs, ${scope}`} rowHref={(p) => href(`/teams/${p.id}`)} sort={sort} onSort={setSort}
        loading={list.isPending} dense
        empty={<EmptyState title={term ? `No programs match “${search.value}”` : 'No programs for this season yet'} body={term ? 'Try the school name without "University" or "State".' : admin ? 'Run discover-teams from the Jobs page.' : undefined} action={term ? <button className="btn-ghost btn-sm" onClick={search.clear}>Clear search</button> : undefined} />} />
    </div>
  );
}
