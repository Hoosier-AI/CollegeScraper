import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, fmt, useAdmin } from '../lib/api';
import { useKeepQuery } from '../lib/filters';
import { Badge, DataTable, ErrorBox, JsonViewer, Section, SourceBadge, Spinner, Tabs, TeamLogo, type Column } from '../components/ui';

type Src = 'site' | 'ncaa';
const TEAM_FIELDS: [string, string][] = [['goals', 'Goals'], ['assists', 'Assists'], ['shots', 'Shots'], ['shots_on_goal', 'SOG'], ['shots_off_target', 'Off target'], ['corners', 'Corners'], ['fouls', 'Fouls'], ['offsides', 'Offsides'], ['saves', 'Saves'], ['yellow_cards', 'Yellow'], ['red_cards', 'Red'], ['pk_goals', 'PK goals'], ['pk_attempts', 'PK att'], ['gk_minutes', 'GK min'], ['gk_goals_allowed', 'GK GA'], ['gk_saves', 'GK saves'], ['shutout', 'Shutout']];
const EVENT_ICON: Record<string, string> = { goal: '⚽', shot: '🎯', save: '🧤', corner: '🚩', foul: '⚠️', yellow: '🟨', red: '🟥', green: '🟩', sub_in: '🔼', sub_out: '🔽', offside: '⛔', pk: '🅿️', goalie_change: '🧤', other: '·' };

export default function Game() {
  const { id = '' } = useParams();
  const admin = useAdmin();
  const keep = useKeepQuery();
  const [src, setSrc] = useState<Src | 'diff'>('diff');
  const [evSrc, setEvSrc] = useState<Src | null>(null);
  const [tab, setTab] = useState<'stats' | 'players' | 'events' | 'raw'>('stats');
  const q = useQuery({ queryKey: ['game', id], queryFn: () => api<any>(`/api/games/${id}`) });
  const refetch = useMutation({ mutationFn: () => api(`/api/games/${id}/refetch`, { method: 'POST' }) });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} />;
  const { game: g, team, players, events, raw } = q.data;
  const sources: Src[] = (['site', 'ncaa'] as Src[]).filter((s) => team.some((t: any) => t.source === s));
  const truth: Src | null = g.source_of_truth;
  const evSources: Src[] = (['site', 'ncaa'] as Src[]).filter((s) => events.some((e: any) => e.source === s));
  const activeEv = evSrc ?? truth ?? evSources[0];
  const side = (pid: string) => (pid === g.home_program_id ? g.home_name : g.away_name);
  const teamRow = (pid: string | null, s: Src) => team.find((t: any) => t.program_id === pid && t.source === s);
  const cell = (pid: string | null, field: string) => {
    const a = teamRow(pid, 'site')?.[field], b = teamRow(pid, 'ncaa')?.[field];
    const show = (v: unknown) => (v == null ? '–' : typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v));
    if (src === 'site') return show(a);
    if (src === 'ncaa') return show(b);
    const differ = a != null && b != null && a !== b;
    return <span className={differ ? 'rounded bg-amber-500/20 px-1 text-amber-200' : ''}>{show(a)}{sources.length === 2 && <span className="ml-1 text-[10px] text-ink-500">/ {show(b)}</span>}</span>;
  };
  const pcols = (s: Src): Column<any>[] => [
    { key: 'jersey', label: '#', num: true }, { key: 'name', label: 'Player', sticky: true, value: (r) => `${r.first_name} ${r.last_name}`, render: (r) => r.player_season_id ? <Link className="hover:text-teal-400" to={keep(`/players/by-season/${r.player_season_id}`)}>{r.first_name} {r.last_name}</Link> : <span title="not linked to a roster identity">{r.first_name} {r.last_name} <Badge tone="amber">?</Badge></span> },
    { key: 'position', label: 'Pos' }, { key: 'starter', label: 'GS', render: (r) => r.starter ? '★' : '' }, { key: 'participated', label: 'Played', render: (r) => r.participated ? '✓' : '' },
    { key: 'minutes', label: 'MIN', num: true }, { key: 'goals', label: 'G', num: true }, { key: 'assists', label: 'A', num: true }, { key: 'points', label: 'PTS', num: true }, { key: 'shots', label: 'SH', num: true }, { key: 'shots_on_goal', label: 'SOG', num: true }, { key: 'shots_off_target', label: 'Off', num: true },
    { key: 'pk', label: 'PK', render: (r) => r.pk_attempts ? `${r.pk_goals ?? 0}-${r.pk_attempts}` : '' }, { key: 'fouls', label: 'Fouls', num: true }, { key: 'yellow_cards', label: 'YC', num: true }, { key: 'red_cards', label: 'RC', num: true }, { key: 'corners', label: 'CK', num: true }, { key: 'offsides', label: 'Off', num: true },
    { key: 'goals_allowed', label: 'GA', num: true, render: (r) => r.is_goalie ? fmt.num(r.goals_allowed) : '' }, { key: 'saves', label: 'SV', num: true, render: (r) => r.is_goalie ? fmt.num(r.saves) : '' }, { key: 'gk_minutes', label: 'GK min', num: true, render: (r) => r.is_goalie ? fmt.num(r.gk_minutes) : '' },
    { key: 'gwg', label: 'GWG', num: true }, { key: 'unassisted_goals', label: 'Unasst', num: true }, { key: 'first_goals', label: '1st', num: true }, { key: 'ot_goals', label: 'OT', num: true }, { key: 'tying_goals', label: 'Tying', num: true }, { key: 'hat_trick', label: 'HT', render: (r) => r.hat_trick ? '🎩' : '' },
    { key: 'source', label: 'Src', render: () => <SourceBadge source={s} /> },
  ];
  const evCols: Column<any>[] = [
    { key: 'period', label: 'Per', num: true }, { key: 'clock', label: 'Clock' }, { key: 'event_type', label: 'Event', render: (e) => <span>{EVENT_ICON[e.event_type] ?? '·'} {e.event_type}</span> },
    { key: 'team', label: 'Team', value: (e) => e.program_id ? side(e.program_id) : '' }, { key: 'player_name_raw', label: 'Player' }, { key: 'assist_name_raw', label: 'Assist' },
    { key: 'score', label: 'Score', value: (e) => e.home_score, render: (e) => e.home_score == null ? '' : `${e.home_score}-${e.away_score}` }, { key: 'play_text', label: 'Text', className: 'max-w-[520px] !whitespace-normal text-ink-400' },
  ];
  return (
    <div className="space-y-4">
      <div className="card">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-3"><TeamLogo src={g.away_logo} name={g.away_name} size={48} /><div><Link to={g.away_program_id ? keep(`/teams/${g.away_program_id}`) : '#'} className="text-lg font-bold hover:text-teal-400">{g.away_name ?? 'Unknown'}</Link><div className="text-xs text-ink-500">away</div></div></div>
          <div className="text-3xl font-black tabular-nums">{g.away_score ?? '–'} <span className="text-ink-500">@</span> {g.home_score ?? '–'}</div>
          <div className="flex items-center gap-3"><div className="text-right"><Link to={g.home_program_id ? keep(`/teams/${g.home_program_id}`) : '#'} className="text-lg font-bold hover:text-teal-400">{g.home_name ?? 'Unknown'}</Link><div className="text-xs text-ink-500">home</div></div><TeamLogo src={g.home_logo} name={g.home_name} size={48} /></div>
          <div className="ml-auto flex flex-wrap items-center gap-2 text-sm text-ink-400">
            <Badge>{g.status}</Badge>{g.overtime && <Badge tone="amber">OT</Badge>}{g.shootout && <Badge tone="amber">PK</Badge>}{g.neutral_site && <Badge>neutral</Badge>}{g.conference_game && <Badge>conf</Badge>}{g.postseason && <Badge tone="teal">postseason</Badge>}
            <span>truth <SourceBadge source={truth} /></span>
            {admin && <button className="btn-ghost" onClick={() => refetch.mutate()} disabled={refetch.isPending}>{refetch.isSuccess ? 'Queued' : 'Re-fetch'}</button>}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-400">
          <span>{fmt.date(g.game_date)}</span>{g.venue_name && <span>{g.venue_name}{g.venue_city ? `, ${g.venue_city}` : ''}</span>}{g.attendance != null && <span>att {fmt.num(g.attendance)}</span>}{g.duration_min && <span>{g.duration_min} min</span>}{g.tournament && <span>{g.tournament}</span>}
          {g.officials?.length ? <span>officials: {g.officials.map((o: any) => `${o.name}${o.title ? ` (${o.title})` : ''}`).join(', ')}</span> : null}
          {g.ncaa_contest_id && <a className="text-teal-400 hover:underline" href={`https://www.ncaa.com/game/${g.ncaa_contest_id}`} target="_blank" rel="noreferrer">ncaa.com</a>}
          {Object.entries(g.site_game_refs ?? {}).map(([host, url]) => (url ? <a key={host} className="text-teal-400 hover:underline" href={String(url)} target="_blank" rel="noreferrer">{host}</a> : null))}
        </div>
      </div>
      {/* The raw source payloads stay an operator view; the public API still serves them at /v1/games/{id}?include=raw. */}
      <Tabs tabs={[{ id: 'stats', label: 'Team stats' }, { id: 'players', label: 'Player stats', count: players.length }, { id: 'events', label: 'Events', count: events.length }, ...(admin ? [{ id: 'raw' as const, label: 'Raw' }] : [])]} value={tab} onChange={setTab} />
      {tab === 'stats' && (
        <Section title="Team stats" right={<div className="flex gap-1">{(['diff', 'site', 'ncaa'] as const).map((s) => <button key={s} className={`btn-ghost !py-0.5 ${src === s ? 'border-teal-400 text-teal-400' : ''}`} onClick={() => setSrc(s)}>{s === 'diff' ? 'site / ncaa' : s}</button>)}</div>}>
          {sources.length === 0 ? <p className="text-sm text-ink-500">No box score stored for this game.</p> : (
            <div className="overflow-auto rounded-xl border border-navy-700"><table className="min-w-full"><thead><tr><th className="th">Stat</th><th className="th text-right">{g.away_name}</th><th className="th text-right">{g.home_name}</th></tr></thead><tbody>
              {TEAM_FIELDS.map(([k, label]) => <tr key={k}><td className="td text-ink-400">{label}</td><td className="td num">{cell(g.away_program_id, k)}</td><td className="td num">{cell(g.home_program_id, k)}</td></tr>)}
            </tbody></table></div>
          )}
          {sources.length === 2 && <p className="text-xs text-ink-500">Amber = site and NCAA.com disagree. NCAA.com counts shots differently from school stat crews; goals, cards and saves should agree.</p>}
          {(['site', 'ncaa'] as Src[]).map((s) => { const rows = team.filter((t: any) => t.source === s && t.period_lines); return rows.length ? <div key={s} className="text-xs text-ink-400">Period lines ({s}): {rows.map((t: any) => `${side(t.program_id)}: ${t.period_lines.map((p: any) => [`P${p.period}`, p.score != null ? `${p.score}g` : null, p.shots != null ? `${p.shots}sh` : null, p.corners != null ? `${p.corners}ck` : null, p.fouls != null ? `${p.fouls}f` : null].filter(Boolean).join(' ')).join(' · ')}`).join(' | ')}</div> : null; })}
        </Section>
      )}
      {tab === 'players' && (['site', 'ncaa'] as Src[]).filter((s) => players.some((p: any) => p.source === s)).map((s) => (
        <div key={s} className="space-y-3">
          {[g.away_program_id, g.home_program_id].map((pid) => <Section key={`${s}-${pid}`} title={<span>{side(pid)} <SourceBadge source={s} />{truth === s && <Badge tone="green">truth</Badge>}</span>}><DataTable rows={players.filter((p: any) => p.source === s && p.program_id === pid)} columns={pcols(s)} rowKey={(r) => `${r.source}-${r.program_id}-${r.source_key}`} defaultSort={{ key: 'minutes', dir: 'desc' }} dense /></Section>)}
        </div>
      ))}
      {tab === 'events' && (
        <Section title="Events" right={<div className="flex gap-1">{evSources.map((s) => <button key={s} className={`btn-ghost !py-0.5 ${activeEv === s ? 'border-teal-400 text-teal-400' : ''}`} onClick={() => setEvSrc(s)}>{s} ({events.filter((e: any) => e.source === s).length})</button>)}</div>}>
          <DataTable rows={events.filter((e: any) => e.source === activeEv)} columns={evCols} rowKey={(e) => String(e.id)} dense empty="No events for this source." />
        </Section>
      )}
      {tab === 'raw' && <div className="space-y-2">{raw.map((r: any) => <JsonViewer key={r.source} title={`${r.source} payload (fetched ${fmt.dt(r.fetched_at)})`} value={r.payload} />)}<JsonViewer title="game header row" value={g} /></div>}
    </div>
  );
}
