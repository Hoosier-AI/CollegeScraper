import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowDownCircle, ArrowUpCircle, CircleDot, ExternalLink, Flag, Hand, OctagonAlert, Square, Target, Circle } from 'lucide-react';
import { api, fmt, useAdmin } from '../lib/api';
import { useHref } from '../lib/filters';
import { useUrlState } from '../lib/urlState';
import { DataTable, type Column, type Preset } from '../components/DataTable';
import { Badge, EmptyState, ErrorBox, JsonViewer, Note, Section, SegmentedControl, Skeleton, SourceBadge, TabsNav, TeamLogo } from '../components/primitives';

type Src = 'site' | 'ncaa';
type Tab = 'stats' | 'players' | 'events' | 'raw';
const TEAM_FIELDS: [string, string][] = [['goals', 'Goals'], ['assists', 'Assists'], ['shots', 'Shots'], ['shots_on_goal', 'Shots on goal'], ['shots_off_target', 'Off target'], ['corners', 'Corners'], ['fouls', 'Fouls'], ['offsides', 'Offsides'], ['saves', 'Saves'], ['yellow_cards', 'Yellow cards'], ['red_cards', 'Red cards'], ['pk_goals', 'Penalty goals'], ['pk_attempts', 'Penalty attempts'], ['gk_minutes', 'Keeper minutes'], ['gk_goals_allowed', 'Keeper goals allowed'], ['gk_saves', 'Keeper saves'], ['shutout', 'Shutout']];
const EVENT_ICON: Record<string, { icon: JSX.Element; cls?: string }> = {
  goal: { icon: <CircleDot size={14} />, cls: 'text-win' }, shot: { icon: <Target size={14} /> }, save: { icon: <Hand size={14} /> }, corner: { icon: <Flag size={14} /> }, foul: { icon: <OctagonAlert size={14} /> },
  yellow: { icon: <Square size={14} fill="currentColor" />, cls: 'text-note' }, red: { icon: <Square size={14} fill="currentColor" />, cls: 'text-loss' }, green: { icon: <Square size={14} fill="currentColor" />, cls: 'text-win' },
  sub_in: { icon: <ArrowUpCircle size={14} />, cls: 'text-win' }, sub_out: { icon: <ArrowDownCircle size={14} />, cls: 'text-chalk-400' }, offside: { icon: <Flag size={14} /> }, pk: { icon: <CircleDot size={14} /> }, goalie_change: { icon: <Hand size={14} /> }, other: { icon: <Circle size={10} /> },
};
const PLAYER_PRESETS: Preset[] = [
  { id: 'overview', label: 'Overview', columns: ['jersey', 'position', 'starter', 'minutes', 'goals', 'assists', 'shots', 'shots_on_goal', 'fouls', 'yellow_cards', 'red_cards', 'goals_allowed', 'saves'] },
  { id: 'shooting', label: 'Shooting', columns: ['jersey', 'minutes', 'goals', 'assists', 'points', 'shots', 'shots_on_goal', 'shots_off_target', 'pk', 'gwg', 'unassisted_goals', 'first_goals', 'ot_goals', 'tying_goals', 'hat_trick'] },
  { id: 'gk', label: 'Goalkeeping', columns: ['jersey', 'gk_minutes', 'goals_allowed', 'saves'] },
];

export default function Game() {
  const { id = '' } = useParams();
  const admin = useAdmin();
  const href = useHref();
  const [tab] = useUrlState('tab', 'stats', { allow: ['stats', 'players', 'events', 'raw'] });
  const [src, setSrc] = useUrlState('src', 'diff', { replace: true, resetPage: false, allow: ['diff', 'site', 'ncaa'] });
  const [evSrcRaw, setEvSrc] = useUrlState('events', '', { replace: true, resetPage: false, allow: ['site', 'ncaa'] });
  const [preset, setPreset] = useUrlState('cols', 'overview', { replace: true, resetPage: false, allow: PLAYER_PRESETS.map((p) => p.id) });
  const q = useQuery({ queryKey: ['game', id], queryFn: () => api<any>(`/api/games/${id}`) });
  const refetch = useMutation({ mutationFn: () => api(`/api/games/${id}/refetch`, { method: 'POST' }) });
  if (q.isPending) return <div className="space-y-4" aria-busy="true"><Skeleton className="h-40" /><Skeleton className="h-64" /></div>;
  if (q.error) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  if (!q.data?.game) return <EmptyState title="No such game" body="The link may be out of date." />;
  const { game: g, team, players, events, raw } = q.data as { game: any; team: any[]; players: any[]; events: any[]; raw: any[] };
  const sources: Src[] = (['site', 'ncaa'] as Src[]).filter((s) => team.some((t) => t.source === s));
  const truth: Src | null = g.source_of_truth;
  const evSources: Src[] = (['site', 'ncaa'] as Src[]).filter((s) => events.some((e) => e.source === s));
  const activeEv = (evSrcRaw as Src) || truth || evSources[0];
  const side = (pid: string) => (pid === g.home_program_id ? g.home_name : g.away_name);
  const teamRow = (pid: string | null, s: Src) => team.find((t) => t.program_id === pid && t.source === s);
  const show = (v: unknown) => (v == null ? '–' : typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v));
  const cell = (pid: string | null, field: string) => {
    const a = teamRow(pid, 'site')?.[field], b = teamRow(pid, 'ncaa')?.[field];
    if (src === 'site') return show(a);
    if (src === 'ncaa') return show(b);
    const differ = a != null && b != null && a !== b;
    return <span className={differ ? 'rounded bg-note/15 px-1 text-note' : ''}>{show(a ?? b)}{differ && <span className="ml-1 text-2xs text-chalk-500">NCAA {show(b)}</span>}</span>;
  };
  const pcols: Column<any>[] = [
    { key: 'jersey', label: '#', num: true, priority: 3 },
    { key: 'name', label: 'Player', primary: true, value: (r) => `${r.first_name} ${r.last_name}`, render: (r) => r.player_id ? <Link className="hover:text-pitch-300" to={`/players/${r.player_id}`}>{r.first_name} {r.last_name}</Link> : <span>{r.first_name} {r.last_name}{!r.player_season_id && <Badge tone="amber" className="ml-1" title="Not linked to a roster identity">unlinked</Badge>}</span> },
    { key: 'position', label: 'Pos', priority: 3 }, { key: 'starter', label: 'Start', priority: 3, render: (r) => r.starter ? 'Started' : r.participated ? 'Sub' : '' },
    { key: 'minutes', label: 'Min', num: true, priority: 3 }, { key: 'goals', label: 'G', num: true, priority: 3 }, { key: 'assists', label: 'A', num: true, priority: 3 }, { key: 'points', label: 'Pts', num: true, priority: 3 }, { key: 'shots', label: 'Sh', num: true, priority: 3 }, { key: 'shots_on_goal', label: 'SOG', num: true, priority: 3 }, { key: 'shots_off_target', label: 'Off target', num: true, priority: 3 },
    { key: 'pk', label: 'PK', title: 'Penalties scored–taken', priority: 3, render: (r) => r.pk_attempts ? `${r.pk_goals ?? 0}–${r.pk_attempts}` : '' }, { key: 'fouls', label: 'Fouls', num: true, priority: 3 }, { key: 'yellow_cards', label: 'YC', num: true, priority: 3 }, { key: 'red_cards', label: 'RC', num: true, priority: 3 }, { key: 'corners', label: 'CK', num: true, priority: 3 }, { key: 'offsides', label: 'Offside', num: true, priority: 3 },
    { key: 'goals_allowed', label: 'GA', title: 'Goals allowed (keepers)', num: true, priority: 3, render: (r) => r.is_goalie ? fmt.num(r.goals_allowed) : '' }, { key: 'saves', label: 'Saves', num: true, priority: 3, render: (r) => r.is_goalie ? fmt.num(r.saves) : '' }, { key: 'gk_minutes', label: 'GK min', num: true, priority: 3, render: (r) => r.is_goalie ? fmt.num(r.gk_minutes) : '' },
    { key: 'gwg', label: 'GWG', num: true, priority: 3 }, { key: 'unassisted_goals', label: 'Unassisted', num: true, priority: 3 }, { key: 'first_goals', label: 'First goal', num: true, priority: 3 }, { key: 'ot_goals', label: 'OT goals', num: true, priority: 3 }, { key: 'tying_goals', label: 'Tying', num: true, priority: 3 }, { key: 'hat_trick', label: 'Hat trick', priority: 3, render: (r) => r.hat_trick ? 'Yes' : '' },
  ];
  const evCols: Column<any>[] = [
    { key: 'clock', label: 'Time', primary: true, sortable: false, render: (e) => <span className="tnum">{e.period > 2 ? 'OT ' : e.period === 2 ? '2H ' : '1H '}{e.clock ?? ''}</span> },
    { key: 'event_type', label: 'Event', sortable: false, render: (e) => { const ic = EVENT_ICON[e.event_type] ?? EVENT_ICON.other!; return <span className={`inline-flex items-center gap-1.5 ${ic.cls ?? 'text-chalk-300'}`}>{ic.icon}<span className="text-chalk-100">{String(e.event_type).replace(/_/g, ' ')}</span></span>; } },
    { key: 'team', label: 'Team', sortable: false, value: (e) => e.program_id ? side(e.program_id) : '' }, { key: 'player_name_raw', label: 'Player', sortable: false }, { key: 'assist_name_raw', label: 'Assist', sortable: false, priority: 2 },
    { key: 'score', label: 'Score', sortable: false, value: (e) => e.home_score, render: (e) => e.home_score == null ? '' : <span className="tnum">{e.away_score}–{e.home_score}</span> }, { key: 'play_text', label: 'Play', sortable: false, wrap: true, priority: 2, className: 'max-w-[520px] text-chalk-400' },
  ];
  const tabs = [{ id: 'stats' as Tab, label: 'Team stats' }, { id: 'players' as Tab, label: 'Player stats', count: players.length }, { id: 'events' as Tab, label: 'Events', count: events.length }, ...(admin ? [{ id: 'raw' as Tab, label: 'Raw' }] : [])];
  const final = g.status === 'final';
  const teamBlock = (name: string | null, logo: string | null, pid: string | null, label: string, align: 'left' | 'right') => (
    <div className={`flex min-w-0 items-center gap-3 ${align === 'right' ? 'flex-row-reverse text-right' : ''}`}>
      <TeamLogo src={logo} name={name} size={56} />
      <div className="min-w-0">
        {pid ? <Link to={href(`/teams/${pid}`)} className="display block truncate text-xl hover:text-pitch-300 sm:text-2xl">{name ?? 'Unknown'}</Link> : <span className="display block truncate text-xl sm:text-2xl">{name ?? 'Unknown'}</span>}
        <div className="text-xs text-chalk-500">{label}</div>
      </div>
    </div>
  );
  return (
    <div className="space-y-5">
      <header className="card p-4 sm:p-6">
        <div className="grid items-center gap-4 sm:grid-cols-[1fr_auto_1fr]">
          {teamBlock(g.away_name, g.away_logo, g.away_program_id, g.neutral_site ? 'Away (neutral site)' : 'Away', 'left')}
          <div className="text-center">
            <div className="display text-4xl tnum sm:text-5xl">{g.away_score ?? '–'}<span className="mx-2 text-chalk-500">–</span>{g.home_score ?? '–'}</div>
            <div className="mt-1 flex flex-wrap justify-center gap-1.5 text-xs">
              <Badge tone={final ? 'gray' : 'teal'}>{final ? 'Final' : g.status}</Badge>{g.overtime && <Badge tone="amber">Overtime</Badge>}{g.shootout && <Badge tone="amber">Penalties</Badge>}{g.conference_game && <Badge>Conference</Badge>}{g.postseason && <Badge tone="teal">Postseason</Badge>}
            </div>
          </div>
          {teamBlock(g.home_name, g.home_logo, g.home_program_id, 'Home', 'right')}
        </div>
        <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-chalk-400">
          <span>{fmt.weekday(g.game_date)}{g.game_date && `, ${new Date(`${String(g.game_date).slice(0, 10)}T12:00:00Z`).getUTCFullYear()}`}</span>
          {g.venue_name && <span>{g.venue_name}{g.venue_city ? `, ${g.venue_city}` : ''}</span>}{g.attendance != null && <span>{fmt.num(g.attendance)} attended</span>}{g.duration_min && <span>{g.duration_min} minutes</span>}{g.tournament && <span>{g.tournament}</span>}
          {g.officials?.length ? <span>Officials: {g.officials.map((o: any) => `${o.name}${o.title ? ` (${o.title})` : ''}`).join(', ')}</span> : null}
          <span className="inline-flex items-center gap-1">Box score from <SourceBadge source={truth} /></span>
          {g.ncaa_contest_id && <a className="inline-flex items-center gap-1 text-pitch-400 hover:text-pitch-300" href={`https://www.ncaa.com/game/${g.ncaa_contest_id}`} target="_blank" rel="noreferrer">NCAA.com <ExternalLink size={12} aria-hidden /></a>}
          {Object.entries(g.site_game_refs ?? {}).map(([host, url]) => (url ? <a key={host} className="inline-flex items-center gap-1 text-pitch-400 hover:text-pitch-300" href={String(url)} target="_blank" rel="noreferrer">{host} <ExternalLink size={12} aria-hidden /></a> : null))}
          {admin && <button className="btn-ghost btn-sm" onClick={() => refetch.mutate()} disabled={refetch.isPending || refetch.isSuccess}>{refetch.isSuccess ? 'Re-fetch queued' : 'Re-fetch'}</button>}
        </p>
      </header>
      <TabsNav label="Game sections" tabs={tabs} value={tab as Tab} hrefFor={(x) => href(`/games/${id}`, { tab: x === 'stats' ? null : x })} />
      {tab === 'stats' && (
        <Section title="Team stats" right={sources.length === 2 ? <SegmentedControl label="Stat source" size="sm" value={src as 'diff' | 'site' | 'ncaa'} onChange={setSrc} options={[{ value: 'diff', label: 'Compare' }, { value: 'site', label: 'School site' }, { value: 'ncaa', label: 'NCAA.com' }]} /> : undefined}>
          {sources.length === 0 ? <EmptyState title="No box score for this game yet" /> : (
            <div className="frame overflow-x-auto"><table className="w-full border-separate border-spacing-0 text-sm"><caption className="sr-only">Team stats</caption>
              <thead><tr><th scope="col" className="th">Stat</th><th scope="col" className="th text-right">{g.away_name}</th><th scope="col" className="th text-right">{g.home_name}</th></tr></thead>
              <tbody>{TEAM_FIELDS.map(([k, label]) => <tr key={k}><th scope="row" className="td text-left font-normal text-chalk-400">{label}</th><td className="td num">{cell(g.away_program_id, k)}</td><td className="td num">{cell(g.home_program_id, k)}</td></tr>)}</tbody>
            </table></div>
          )}
          {sources.length === 2 && src === 'diff' && <Note>Shaded numbers are where the school's stat crew and NCAA.com disagree. Shots are counted differently by the two; goals, cards and saves should agree.</Note>}
          {(['site', 'ncaa'] as Src[]).map((s) => { const rows = team.filter((t) => t.source === s && t.period_lines); return rows.length ? <p key={s} className="text-xs text-chalk-400">By period ({s === 'site' ? 'school site' : 'NCAA.com'}): {rows.map((t) => `${side(t.program_id)}: ${t.period_lines.map((p: any) => [`P${p.period}`, p.score != null ? `${p.score} goals` : null, p.shots != null ? `${p.shots} shots` : null, p.corners != null ? `${p.corners} corners` : null, p.fouls != null ? `${p.fouls} fouls` : null].filter(Boolean).join(' ')).join('; ')}`).join('. ')}</p> : null; })}
        </Section>
      )}
      {tab === 'players' && (['site', 'ncaa'] as Src[]).filter((s) => players.some((p) => p.source === s)).map((s) => (
        <div key={s} className="space-y-4">
          {[g.away_program_id, g.home_program_id].map((pid) => (
            <Section key={`${s}-${pid}`} title={<span className="inline-flex items-center gap-2">{side(pid)} <SourceBadge source={s} />{truth === s && sources.length === 2 && <Badge tone="green">used for records</Badge>}</span>}>
              <DataTable rows={players.filter((p) => p.source === s && p.program_id === pid)} columns={pcols} rowKey={(r) => `${r.source}-${r.program_id}-${r.source_key}`} caption={`${side(pid)} player stats, ${s}`} presets={PLAYER_PRESETS} preset={preset} onPreset={setPreset} defaultSort={{ key: 'minutes', dir: 'desc' }} dense />
            </Section>
          ))}
        </div>
      ))}
      {tab === 'events' && (
        <Section title="Events" right={evSources.length > 1 ? <SegmentedControl label="Event source" size="sm" value={activeEv ?? 'site'} onChange={(v) => setEvSrc(v)} options={evSources.map((s) => ({ value: s, label: `${s === 'site' ? 'School site' : 'NCAA.com'} (${events.filter((e) => e.source === s).length})` }))} /> : undefined}>
          <DataTable rows={events.filter((e) => e.source === activeEv)} columns={evCols} rowKey={(e) => String(e.id)} caption="Play by play" dense empty={<EmptyState title="No play-by-play for this game" />} />
        </Section>
      )}
      {tab === 'raw' && admin && <div className="space-y-2">{raw.map((r) => <JsonViewer key={r.source} title={`${r.source} payload (fetched ${fmt.dt(r.fetched_at)})`} value={r.payload} />)}<JsonViewer title="Game header row" value={g} /></div>}
    </div>
  );
}
