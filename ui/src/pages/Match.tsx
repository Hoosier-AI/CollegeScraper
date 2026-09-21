// One match: the scoreline masthead, then Summary / Lineups / Stats / Head-to-head / Preview.
import { useMutation, useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { api, fmt, useAdmin } from '../lib/api';
import { useHref } from '../lib/filters';
import { agoShort, useNow } from '../lib/hooks';
import { useUrlState } from '../lib/urlState';
import { DataTable, type Column, type Preset } from '../components/DataTable';
import { Badge, EmptyState, ErrorBox, JsonViewer, Note, Section, SegmentedControl, Skeleton, SourceBadge, TabsNav } from '../components/primitives';
import { HeadToHead, KeyPlayers, LineupColumn, MatchMasthead, StatBars, Timeline, type SideLineup } from '../components/match/parts';
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
  // While live: the scoreboard tick is every minute and the stats snapshot every couple of minutes, so 30 s keeps
  // the page within a tick of the source without hammering the API.
  const box = useQuery({ queryKey: ['game', id], queryFn: () => api<any>(`/api/games/${id}`), refetchInterval: (q) => (isLive(q) ? 30_000 : false) });
  const preview = useQuery({ queryKey: ['preview', id], queryFn: () => api<any>(`/api/matches/${id}/preview`), refetchInterval: (q) => (isLive(q) ? 30_000 : false) });
  const now = useNow(5_000);
  const refetch = useMutation({ mutationFn: () => api(`/api/games/${id}/refetch`, { method: 'POST' }) });
  if (preview.isPending) return <div className="space-y-4" aria-busy="true"><Skeleton className="h-44" /><Skeleton className="h-10 w-96" /><Skeleton className="h-64" /></div>;
  if (preview.error) return <ErrorBox error={preview.error} retry={() => preview.refetch()} />;
  if (!preview.data?.game) return <EmptyState title="No such match" body="The link may be out of date." />;
  const p = preview.data; const g = p.game; const sides = p.sides;
  const played = g.status === 'final' || g.status === 'live';
  const team: any[] = box.data?.team ?? [], players: any[] = box.data?.players ?? [], events: any[] = box.data?.events ?? [], raw: any[] = box.data?.raw ?? [];
  const provisional: boolean = !!box.data?.stats?.provisional;
  // A final opens on the summary; a live match too once its live snapshot has arrived, else on head-to-head.
  const defaultTab: Tab = g.status === 'final' ? 'summary' : g.status === 'live' ? (box.isPending || players.length ? 'summary' : 'h2h') : 'preview';
  const tab: Tab = (tabParam as Tab) || defaultTab;
  const truth: Src | null = box.data?.game?.source_of_truth ?? g.source_of_truth ?? null;
  const sources: Src[] = (['site', 'ncaa'] as Src[]).filter((s) => team.some((t) => t.source === s));
  const statSrc: Src | null = src === 'site' || src === 'ncaa' ? (src as Src) : truth ?? sources[0] ?? null;
  const teamRow = (pid: string | null, s: Src | null) => (s ? team.find((t) => t.program_id === pid && t.source === s) ?? null : null);
  const evSource = truth ?? (events.some((e) => e.source === 'site') ? 'site' : 'ncaa');
  // Each side's lineup is this match's own, or explicitly a past one; the API never swaps one for the other.
  const sideLineup = (side: 'home' | 'away'): SideLineup => {
    const s = sides[side]; const t = g[side];
    const status: SideLineup['status'] = s?.lineup_status ?? (s?.lineup ? (s.lineup.starters?.length ? 'match' : 'no_starters') : s?.last_lineup ? 'past' : 'none');
    return { lineup: status === 'past' ? s.last_lineup : s?.lineup ?? null, status, past: status === 'past' ? { opponent: s.last_lineup.opponent ?? null, game_date: s.last_lineup.game_date } : null, crest: t.logo, crestSeo: t.seo };
  };
  const homeLu = sideLineup('home'), awayLu = sideLineup('away');
  const bothPast = homeLu.status !== 'match' && homeLu.status !== 'no_starters' && awayLu.status !== 'match' && awayLu.status !== 'no_starters' && (homeLu.status === 'past' || awayLu.status === 'past');
  const pastSides = [homeLu.status === 'past' ? g.home.name : null, awayLu.status === 'past' ? g.away.name : null].filter(Boolean) as string[];
  const noStarterSides = [homeLu.status === 'no_starters' ? g.home.name : null, awayLu.status === 'no_starters' ? g.away.name : null].filter(Boolean) as string[];
  const pastNote = (lu: SideLineup, name: string | null) => (lu.status === 'past' && lu.past ? `${name}'s lineup from their last match (vs ${lu.past.opponent ?? '?'}, ${fmt.day(lu.past.game_date)})` : null);
  const tabs = [
    ...(played ? [{ id: 'summary' as Tab, label: 'Summary' }, { id: 'lineups' as Tab, label: bothPast ? 'Past lineups' : 'Lineups' }, { id: 'stats' as Tab, label: 'Stats' }] : []),
    { id: 'h2h' as Tab, label: 'Head-to-head' },
    { id: 'preview' as Tab, label: played ? 'Key players' : 'Preview' },
    ...(played ? [] : [{ id: 'lineups' as Tab, label: 'Past lineups' }]),
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
        {g.status === 'live' && (
          <span className="inline-flex items-center gap-1.5 font-medium text-win"><span aria-hidden className="inline-block h-2 w-2 animate-pulse rounded-full bg-win motion-reduce:animate-none" />Live{(g.live?.period ?? g.live_period) ? ` · ${g.live?.period ?? g.live_period}${(g.live?.clock ?? g.live_clock) ? ` ${g.live?.clock ?? g.live_clock}` : ''}` : ''}{(g.live?.updated_at ?? g.live_updated_at) ? ` · score updated ${agoShort(g.live?.updated_at ?? g.live_updated_at, now)}` : ''}{provisional && box.data?.stats?.live_stats_at ? ` · stats ${agoShort(box.data.stats.live_stats_at, now)}` : ''}</span>
        )}
        {admin && <button className="btn-ghost btn-sm" onClick={() => refetch.mutate()} disabled={refetch.isPending || refetch.isSuccess}>{refetch.isSuccess ? 'Re-fetch queued' : 'Re-fetch'}</button>}
      </div>
      <TabsNav label="Match sections" tabs={tabs} value={tab} hrefFor={(x) => href(`/matches/${id}`, { tab: x === defaultTab ? null : x })} />

      {tab === 'summary' && (
        <div className="space-y-6">
          {g.status === 'live' && provisional && <Note tone="warn">Live stats are provisional: a snapshot of NCAA.com's in-game feed, refreshed about every two minutes and replaced by the final box score after full time.</Note>}
          {g.status === 'live' && !provisional && !box.isPending && <Note>Live stats arrive a few minutes after kickoff, when NCAA.com's in-game feed starts.</Note>}
          <Section title="Key events">{box.isPending ? <Skeleton className="h-32" /> : <Timeline events={events} homeId={g.home.program_id} homeName={g.home.name} awayName={g.away.name} source={evSource} />}</Section>
          {g.status === 'live' && players.length > 0 && (
            <Section title="Match stats so far">
              <StatBars home={teamRow(g.home.program_id, statSrc)} away={teamRow(g.away.program_id, statSrc)} homeName={g.home.name} awayName={g.away.name} />
            </Section>
          )}
          {g.status === 'live' && players.length > 0 && (
            <Section title="On the pitch">
              <div className="grid gap-6 lg:grid-cols-2"><LineupColumn title={g.home.name ?? 'Home'} side={homeLu} /><LineupColumn title={g.away.name ?? 'Away'} side={awayLu} /></div>
            </Section>
          )}
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
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1 space-y-1">
              {pastSides.length > 0 && (
                <Note tone="warn">
                  {played ? `Lineup not published yet for ${pastSides.join(' and ')}.` : 'The match has not kicked off, so no lineup is out yet.'}{' '}
                  Showing {[pastNote(homeLu, g.home.name), pastNote(awayLu, g.away.name)].filter(Boolean).join(' and ')}.
                </Note>
              )}
              {noStarterSides.length > 0 && <Note>The box score does not mark starters for {noStarterSides.join(' or ')}; the players who appeared are listed.</Note>}
              {pastSides.length === 0 && noStarterSides.length === 0 && (homeLu.status === 'match' || awayLu.status === 'match') && <Note>Starting lineups from this match's box score. Rows follow its positions; players in a row are spread evenly, not placed by role.</Note>}
              {homeLu.status === 'none' && awayLu.status === 'none' && <Note>No lineup for this match yet. Lineups arrive with the box score.</Note>}
            </div>
            <SegmentedControl label="Lineup view" size="sm" value={view as 'pitch' | 'list'} onChange={setView} options={[{ value: 'pitch', label: 'Pitch' }, { value: 'list', label: 'List' }]} />
          </div>
          {view === 'list'
            ? <div className="grid gap-6 lg:grid-cols-2"><LineupColumn title={g.home.name ?? 'Home'} side={homeLu} /><LineupColumn title={g.away.name ?? 'Away'} side={awayLu} /></div>
            : (
              <div className="grid gap-6 lg:grid-cols-[minmax(0,28rem)_1fr]">
                <Pitch home={homeLu} away={awayLu} homeName={g.home.name} awayName={g.away.name} />
                <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-1">
                  <LineupColumn title={g.home.name ?? 'Home'} side={homeLu} benchOnly />
                  <LineupColumn title={g.away.name ?? 'Away'} side={awayLu} benchOnly />
                </div>
              </div>
            )}
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
