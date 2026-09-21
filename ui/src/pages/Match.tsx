// One match: the scoreline masthead, then Summary / Lineups / Stats / Head-to-head / Preview.
import { useMutation, useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { api, fmt, useAdmin } from '../lib/api';
import { useHref } from '../lib/filters';
import { useUrlState } from '../lib/urlState';
import { DataTable, type Column, type Preset } from '../components/DataTable';
import { Badge, EmptyState, ErrorBox, JsonViewer, Note, Section, SegmentedControl, Skeleton, SourceBadge, TabsNav } from '../components/primitives';
import { HeadToHead, KeyPlayers, LineupColumn, MatchMasthead, StatBars, Timeline } from '../components/match/parts';
import { Pitch } from '../components/match/Pitch';

type Src = 'site' | 'ncaa';
type Tab = 'summary' | 'lineups' | 'stats' | 'h2h' | 'preview' | 'raw';
const PLAYER_PRESETS: Preset[] = [
  { id: 'overview', label: 'Overview', columns: ['jersey', 'position', 'starter', 'minutes', 'goals', 'assists', 'shots', 'shots_on_goal', 'fouls', 'yellow_cards', 'red_cards', 'goals_allowed', 'saves'] },
  { id: 'shooting', label: 'Shooting', columns: ['jersey', 'minutes', 'goals', 'assists', 'points', 'shots', 'shots_on_goal', 'shots_off_target', 'pk', 'gwg', 'unassisted_goals', 'first_goals', 'ot_goals', 'tying_goals', 'hat_trick'] },
];

export default function Match() {
  const { id = '' } = useParams();
  const admin = useAdmin();
  const href = useHref();
  const [tabParam] = useUrlState('tab', '', { allow: ['summary', 'lineups', 'stats', 'h2h', 'preview', 'raw'] });
  const [src, setSrc] = useUrlState('src', 'diff', { replace: true, resetPage: false, allow: ['diff', 'site', 'ncaa'] });
  const [preset, setPreset] = useUrlState('cols', 'overview', { replace: true, resetPage: false, allow: PLAYER_PRESETS.map((p) => p.id) });
  const [view, setView] = useUrlState('view', 'pitch', { replace: true, resetPage: false, allow: ['pitch', 'list'] });
  const isLive = (q: any) => q.state.data?.game?.status === 'live';
  const box = useQuery({ queryKey: ['game', id], queryFn: () => api<any>(`/api/games/${id}`), refetchInterval: (q) => (isLive(q) ? 60_000 : false) });
  const preview = useQuery({ queryKey: ['preview', id], queryFn: () => api<any>(`/api/matches/${id}/preview`), refetchInterval: (q) => (isLive(q) ? 60_000 : false) });
  const refetch = useMutation({ mutationFn: () => api(`/api/games/${id}/refetch`, { method: 'POST' }) });
  if (preview.isPending) return <div className="space-y-4" aria-busy="true"><Skeleton className="h-44" /><Skeleton className="h-10 w-96" /><Skeleton className="h-64" /></div>;
  if (preview.error) return <ErrorBox error={preview.error} retry={() => preview.refetch()} />;
  if (!preview.data?.game) return <EmptyState title="No such match" body="The link may be out of date." />;
  const p = preview.data; const g = p.game; const sides = p.sides;
  const played = g.status === 'final' || g.status === 'live';
  // A live match rarely has its box score yet, so it opens on head-to-head; a final opens on the summary.
  const defaultTab: Tab = g.status === 'final' ? 'summary' : g.status === 'live' ? 'h2h' : 'preview';
  const tab: Tab = (tabParam as Tab) || defaultTab;
  const team: any[] = box.data?.team ?? [], players: any[] = box.data?.players ?? [], events: any[] = box.data?.events ?? [], raw: any[] = box.data?.raw ?? [];
  const truth: Src | null = box.data?.game?.source_of_truth ?? g.source_of_truth ?? null;
  const sources: Src[] = (['site', 'ncaa'] as Src[]).filter((s) => team.some((t) => t.source === s));
  const statSrc: Src | null = src === 'site' || src === 'ncaa' ? (src as Src) : truth ?? sources[0] ?? null;
  const teamRow = (pid: string | null, s: Src | null) => (s ? team.find((t) => t.program_id === pid && t.source === s) ?? null : null);
  const evSource = truth ?? (events.some((e) => e.source === 'site') ? 'site' : 'ncaa');
  const tabs = [
    ...(played ? [{ id: 'summary' as Tab, label: 'Summary' }, { id: 'lineups' as Tab, label: 'Lineups' }, { id: 'stats' as Tab, label: 'Stats' }] : []),
    { id: 'h2h' as Tab, label: 'Head-to-head' },
    { id: 'preview' as Tab, label: played ? 'Key players' : 'Preview' },
    ...(played ? [] : [{ id: 'lineups' as Tab, label: 'Last lineups' }]),
    ...(admin ? [{ id: 'raw' as Tab, label: 'Raw' }] : []),
  ];
  const pcols: Column<any>[] = [
    { key: 'jersey', label: '#', num: true, priority: 3 },
    { key: 'name', label: 'Player', primary: true, value: (r) => `${r.first_name} ${r.last_name}`, render: (r) => r.player_id ? <a className="hover:text-pitch-300" href={href(`/players/${r.player_id}`)}>{r.first_name} {r.last_name}</a> : <span>{r.first_name} {r.last_name}</span> },
    { key: 'position', label: 'Pos', priority: 3 }, { key: 'starter', label: 'Start', priority: 3, render: (r) => r.starter ? 'Started' : r.participated ? 'Sub' : '' },
    { key: 'minutes', label: 'Min', num: true, priority: 3 }, { key: 'goals', label: 'G', num: true, priority: 3 }, { key: 'assists', label: 'A', num: true, priority: 3 }, { key: 'points', label: 'Pts', num: true, priority: 3 }, { key: 'shots', label: 'Sh', num: true, priority: 3 }, { key: 'shots_on_goal', label: 'SOG', num: true, priority: 3 }, { key: 'shots_off_target', label: 'Off target', num: true, priority: 3 },
    { key: 'pk', label: 'PK', priority: 3, render: (r) => r.pk_attempts ? `${r.pk_goals ?? 0}–${r.pk_attempts}` : '' }, { key: 'fouls', label: 'Fouls', num: true, priority: 3 }, { key: 'yellow_cards', label: 'YC', num: true, priority: 3 }, { key: 'red_cards', label: 'RC', num: true, priority: 3 },
    { key: 'goals_allowed', label: 'GA', num: true, priority: 3, render: (r) => r.is_goalie ? fmt.num(r.goals_allowed) : '' }, { key: 'saves', label: 'Saves', num: true, priority: 3, render: (r) => r.is_goalie ? fmt.num(r.saves) : '' },
    { key: 'gwg', label: 'GWG', num: true, priority: 3 }, { key: 'unassisted_goals', label: 'Unassisted', num: true, priority: 3 }, { key: 'first_goals', label: 'First goal', num: true, priority: 3 }, { key: 'ot_goals', label: 'OT goals', num: true, priority: 3 }, { key: 'tying_goals', label: 'Tying', num: true, priority: 3 }, { key: 'hat_trick', label: 'Hat trick', priority: 3, render: (r) => r.hat_trick ? 'Yes' : '' },
  ];
  const periodLines = (['site', 'ncaa'] as Src[]).map((s) => ({ s, rows: team.filter((t) => t.source === s && t.period_lines) })).find((x) => x.rows.length);
  return (
    <div className="space-y-5">
      <MatchMasthead g={g} sides={sides} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-chalk-500">
        {truth && <span className="inline-flex items-center gap-1">Box score from <SourceBadge source={truth} /></span>}
        {g.ncaa_contest_id && <a className="inline-flex items-center gap-1 text-pitch-400 hover:text-pitch-300" href={`https://www.ncaa.com/game/${g.ncaa_contest_id}`} target="_blank" rel="noreferrer">NCAA.com <ExternalLink size={12} aria-hidden /></a>}
        {Object.entries(box.data?.game?.site_game_refs ?? {}).map(([host, url]) => (url ? <a key={host} className="inline-flex items-center gap-1 text-pitch-400 hover:text-pitch-300" href={String(url)} target="_blank" rel="noreferrer">{host} <ExternalLink size={12} aria-hidden /></a> : null))}
        {g.status === 'live' && <span>Live scores update every 3 minutes.</span>}
        {admin && <button className="btn-ghost btn-sm" onClick={() => refetch.mutate()} disabled={refetch.isPending || refetch.isSuccess}>{refetch.isSuccess ? 'Re-fetch queued' : 'Re-fetch'}</button>}
      </div>
      <TabsNav label="Match sections" tabs={tabs} value={tab} hrefFor={(x) => href(`/matches/${id}`, { tab: x === defaultTab ? null : x })} />

      {tab === 'summary' && (
        <div className="space-y-6">
          <Section title="Key events">{box.isPending ? <Skeleton className="h-32" /> : <Timeline events={events} homeId={g.home.program_id} homeName={g.home.name} awayName={g.away.name} source={evSource} />}</Section>
          {periodLines && (
            <Section title="By period">
              <table className="frame w-full border-separate border-spacing-0 text-sm"><caption className="sr-only">Score by period</caption>
                <thead><tr><th scope="col" className="th">Team</th>{periodLines.rows[0].period_lines.map((pl: any) => <th key={pl.period} scope="col" className="th text-right">{pl.period > 2 ? `OT${pl.period - 2 > 1 ? pl.period - 2 : ''}` : `${pl.period === 1 ? '1st' : '2nd'} half`}</th>)}<th scope="col" className="th text-right">Final</th></tr></thead>
                <tbody>{periodLines.rows.map((t) => <tr key={t.program_id}><th scope="row" className="td text-left font-medium">{t.program_id === g.home.program_id ? g.home.name : g.away.name}</th>{t.period_lines.map((pl: any) => <td key={pl.period} className="td num">{pl.score ?? '–'}</td>)}<td className="td num font-semibold">{t.goals ?? '–'}</td></tr>)}</tbody>
              </table>
            </Section>
          )}
          {!played && null}
        </div>
      )}

      {tab === 'lineups' && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {!played ? <Note>The match has not kicked off; these are each side's lineups from their last match.</Note> : <Note>Rows follow the box score's positions; players in a row are spread evenly, not placed by role.</Note>}
            <SegmentedControl label="Lineup view" size="sm" value={view as 'pitch' | 'list'} onChange={setView} options={[{ value: 'pitch', label: 'Pitch' }, { value: 'list', label: 'List' }]} />
          </div>
          {(() => {
            const lu = (side: 'home' | 'away') => { const s = sides[side]; return { lineup: s?.lineup ?? s?.last_lineup ?? null, note: s && !s.lineup && s.last_lineup ? `vs ${s.last_lineup.opponent ?? '?'}, ${fmt.day(s.last_lineup.game_date)}` : undefined }; };
            const h = lu('home'), a = lu('away');
            if (view === 'list') return <div className="grid gap-6 lg:grid-cols-2"><LineupColumn title={g.home.name ?? 'Home'} lineup={h.lineup} note={h.note} /><LineupColumn title={g.away.name ?? 'Away'} lineup={a.lineup} note={a.note} /></div>;
            return (
              <div className="grid gap-6 lg:grid-cols-[minmax(0,28rem)_1fr]">
                <Pitch home={h.lineup} away={a.lineup} homeName={g.home.name} awayName={g.away.name} homeCrest={{ src: g.home.logo, seo: g.home.seo }} awayCrest={{ src: g.away.logo, seo: g.away.seo }} />
                <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-1">
                  <LineupColumn title={g.home.name ?? 'Home'} lineup={h.lineup} note={h.note} benchOnly />
                  <LineupColumn title={g.away.name ?? 'Away'} lineup={a.lineup} note={a.note} benchOnly />
                </div>
              </div>
            );
          })()}
          {played && players.length > 0 && (
            <Section title="Full player stats" right={sources.length === 2 ? <SegmentedControl label="Source" size="sm" value={statSrc ?? 'site'} onChange={(v) => setSrc(v)} options={sources.map((s) => ({ value: s, label: s === 'site' ? 'School site' : 'NCAA.com' }))} /> : undefined}>
              {[g.home.program_id, g.away.program_id].map((pid) => (
                <div key={pid} className="space-y-1">
                  <h3 className="text-sm font-semibold text-chalk-100">{pid === g.home.program_id ? g.home.name : g.away.name}</h3>
                  <DataTable rows={players.filter((r) => r.source === statSrc && r.program_id === pid)} columns={pcols} rowKey={(r) => `${r.source}-${r.program_id}-${r.source_key}`} caption="Player stats" presets={PLAYER_PRESETS} preset={preset} onPreset={setPreset} defaultSort={{ key: 'minutes', dir: 'desc' }} dense />
                </div>
              ))}
            </Section>
          )}
        </div>
      )}

      {tab === 'stats' && (
        <Section title="Team stats" right={sources.length === 2 ? <SegmentedControl label="Source" size="sm" value={statSrc ?? 'site'} onChange={(v) => setSrc(v)} options={sources.map((s) => ({ value: s, label: s === 'site' ? 'School site' : 'NCAA.com' }))} /> : undefined}>
          {box.isPending ? <Skeleton className="h-48" /> : <StatBars home={teamRow(g.home.program_id, statSrc)} away={teamRow(g.away.program_id, statSrc)} homeName={g.home.name} awayName={g.away.name} />}
          {sources.length === 2 && <Note>The school's stat crew and NCAA.com count shots differently; goals, cards and saves should agree.</Note>}
        </Section>
      )}

      {tab === 'h2h' && <HeadToHead g={g} h2h={p.head_to_head} sides={sides} />}
      {tab === 'preview' && <KeyPlayers g={g} sides={sides} />}
      {tab === 'raw' && admin && <div className="space-y-2">{raw.map((r) => <JsonViewer key={r.source} title={`${r.source} payload (fetched ${fmt.dt(r.fetched_at)})`} value={r.payload} />)}<JsonViewer title="Game header row" value={box.data?.game} /><Badge>{players.length} player lines</Badge></div>}
    </div>
  );
}
