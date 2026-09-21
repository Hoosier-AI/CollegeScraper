import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Minus } from 'lucide-react';
import { api, qs, fmt, useAdmin } from '../../lib/api';
import { useFilters, useHref, genderLabel, divisionLabel } from '../../lib/filters';
import { useUrlPatch, useUrlState } from '../../lib/urlState';
import { DataTable, type Column } from '../../components/DataTable';
import { Badge, Chip, EmptyState, ErrorBox, Field, PageHeader, SegmentedControl, Select, TeamLogo } from '../../components/primitives';

const DIV_OPTIONS = [{ value: 'd1', label: 'D1' }, { value: 'd2', label: 'D2' }, { value: 'd3', label: 'D3' }];

function Movement({ r }: { r: any }) {
  if (r.previous_rank == null) return <span className="inline-flex items-center gap-1 text-xs text-note"><Badge tone="amber">New</Badge></span>;
  const d = r.previous_rank - r.rank;
  if (d > 0) return <span className="inline-flex items-center gap-0.5 text-win tnum" aria-label={`up ${d}`}><ArrowUp size={14} aria-hidden />{d}</span>;
  if (d < 0) return <span className="inline-flex items-center gap-0.5 text-loss tnum" aria-label={`down ${-d}`}><ArrowDown size={14} aria-hidden />{-d}</span>;
  return <span className="text-chalk-500" aria-label="unchanged"><Minus size={14} aria-hidden /></span>;
}

export function PollsView(props: { conference?: string; embedded?: boolean } = {}) {
  const admin = useAdmin();
  const f = useFilters();
  const href = useHref();
  const patch = useUrlPatch();
  const [division] = useUrlState('division', 'd1', { allow: ['d1', 'd2', 'd3'] });
  const [poll] = useUrlState('poll');
  const [week] = useUrlState('week');
  const q = useQuery({ queryKey: ['rankings', f.season, f.gender, division, poll, week], queryFn: () => api<any>(`/api/rankings${qs({ season: f.season, gender: f.gender, division, poll, week_of: week })}`) });
  const usc = q.data?.poll === 'usc';
  const rows: any[] = q.data?.rows ?? [];
  const top = usc ? rows.filter((r) => !String(r.label ?? '').endsWith('(RV)')) : rows;
  const rv = usc ? rows.filter((r) => String(r.label ?? '').endsWith('(RV)')) : [];
  const weeks: { week_of: string; label: string }[] = q.data?.weeks ?? [];
  const current = q.data?.week as string | undefined;
  const wi = weeks.findIndex((w) => w.week_of === current);
  const latest = wi <= 0;
  const setWeek = (w: string | null) => patch({ week: w && w !== weeks[0]?.week_of ? w : null });
  const team = (r: any) => r.college_programs
    ? <Link className="flex items-center gap-2 font-medium hover:text-pitch-300" to={href(`/teams/${r.college_programs.id}`)}><TeamLogo src={r.college_programs.college_schools?.logo_svg_url} seo={r.college_programs.school_seo} name={r.college_programs.name} size={20} />{r.college_programs.name}</Link>
    : <span className="text-chalk-200">{String(r.subject_name).split('|').pop()}{admin && <Badge tone="amber" className="ml-1">unmatched</Badge>}</span>;
  const isPlayerPoll = !usc && rows[0]?.player_season_id !== undefined;
  const cols: Column<any>[] = usc ? [
    { key: 'name', label: 'Team', primary: true, value: (r) => r.rank, render: (r) => <span className="flex items-center gap-3"><span className="display w-6 text-right text-base text-chalk-100 tnum">{r.rank}</span>{team(r)}</span> },
    { key: 'move', label: 'Change', title: 'Movement since the previous poll', value: (r) => (r.previous_rank == null ? -999 : r.previous_rank - r.rank), render: (r) => <span className="inline-flex items-center gap-2"><Movement r={r} />{r.previous_rank != null && <span className="text-xs text-chalk-500">from {r.previous_rank}</span>}</span> },
    { key: 'record', label: 'Record', title: 'Record at the time of the poll' },
    { key: 'first_place_votes', label: '1st', title: 'First-place votes', num: true, priority: 2 },
    { key: 'value', label: 'Points', num: true },
  ] : [
    { key: 'name', label: isPlayerPoll ? 'Player' : 'Team', primary: true, value: (r) => r.rank,
      render: (r) => <span className="flex items-center gap-3"><span className="display w-6 text-right text-base text-chalk-100 tnum">{r.rank}</span>{r.college_player_seasons ? <span className="font-medium">{r.college_player_seasons.college_players?.display_name}</span> : r.player_season_id === undefined ? team(r) : <span className="font-medium text-chalk-200">{String(r.subject_name).split('|')[1]}{admin && <Badge tone="amber" className="ml-1">unlinked</Badge>}</span>}</span> },
    ...(isPlayerPoll ? [{ key: 'team', label: 'Team', value: (r: any) => r.college_programs?.name, render: (r: any) => r.college_programs ? team(r) : String(r.subject_name).split('|').pop() } as Column<any>] : []),
    { key: 'value', label: 'Value', num: true, render: (r) => fmt.num(r.value, Number(r.value) % 1 ? 2 : 0) },
  ];
  const check = q.data?.ncaaCheck?.[`${f.gender}/${division}`];
  const pollOptions = (q.data?.polls ?? []).map((p: any) => ({ value: p.poll, label: p.label, group: p.poll === 'usc' ? undefined : 'NCAA.com statistical leaders' }));
  const scope = `${divisionLabel(division)} ${genderLabel(f.gender)}, ${f.season}`;
  const weekLabel = weeks[wi]?.label ?? '';
  return (
    <div className="space-y-4">
      <PageHeader as="h2" title="Polls" meta={usc ? `United Soccer Coaches poll, ${scope}` : scope}>
        <Field label="Division">{() => <SegmentedControl label="Division" size="sm" value={division} onChange={(v) => patch({ division: v === 'd1' ? null : v, week: null })} options={DIV_OPTIONS} />}</Field>
        <Field label="Poll">{(id) => <Select id={id} value={q.data?.poll ?? poll} onChange={(v) => patch({ poll: v === 'usc' ? null : v, week: null })} options={pollOptions.length ? pollOptions : [{ value: poll || 'usc', label: 'United Soccer Coaches' }]} className="max-w-[240px]" />}</Field>
      </PageHeader>
      {weeks.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Poll week">
          <button className="btn-ghost btn-icon" aria-label="Earlier poll" disabled={wi >= weeks.length - 1} onClick={() => setWeek(weeks[wi + 1]?.week_of ?? null)}><ChevronLeft size={16} /></button>
          <Select aria-label="Poll week" value={current ?? ''} onChange={(v) => setWeek(v)} options={weeks.map((w, i) => ({ value: w.week_of, label: `${w.label}, ${fmt.date(w.week_of)}${i === 0 ? ' (latest)' : ''}` }))} className="max-w-[260px]" />
          <button className="btn-ghost btn-icon" aria-label="Later poll" disabled={latest} onClick={() => setWeek(weeks[wi - 1]?.week_of ?? null)}><ChevronRight size={16} /></button>
          {latest ? <Chip on>Latest</Chip> : <Chip onClick={() => setWeek(null)}>Back to latest</Chip>}
          {usc && latest && check && (check.mismatches?.length
            ? <span className="text-xs text-note">ncaa.com's copy differs: {check.mismatches.join(', ')}</span>
            : <span className="text-xs text-chalk-400">Matches ncaa.com's copy{check.ncaa_week ? ` (${check.ncaa_week})` : ''}</span>)}
        </div>
      )}
      {q.error && <ErrorBox error={q.error} retry={() => q.refetch()} />}
      <DataTable rows={top} columns={cols} rowKey={(r) => String(r.id)} caption={`${usc ? 'United Soccer Coaches poll' : q.data?.polls?.find((p: any) => p.poll === q.data.poll)?.label ?? 'Rankings'}${weekLabel ? `, ${weekLabel}` : ''}, ${scope}`} loading={q.isPending} defaultSort={{ key: 'name', dir: 'asc' }} dense
        rowHref={(r) => (r.college_player_seasons ? `/players/${r.college_player_seasons.player_id}` : r.college_programs ? href(`/teams/${r.college_programs.id}`) : null)}
        empty={<EmptyState title={`No poll for ${scope} yet`} body={admin ? 'Run refresh-rankings from the Jobs page.' : 'The first poll of the season has not been published, or it is still being collected.'} />} />
      {rv.length > 0 && (
        <div className="text-sm text-chalk-400">
          <span className="mr-2 font-medium text-chalk-300">Also receiving votes</span>
          <span className="inline-flex flex-wrap gap-1.5 align-middle">{rv.map((r) => <Chip key={r.id} to={r.college_programs ? href(`/teams/${r.college_programs.id}`) : undefined}>{r.college_programs?.name ?? r.subject_name} <span className="text-chalk-500 tnum">{r.value}</span></Chip>)}</span>
        </div>
      )}
      {usc && <p className="text-xs text-chalk-500">Source: unitedsoccercoaches.org. Every poll of the season is kept; use the arrows to move between weeks.</p>}
    </div>
  );
}
