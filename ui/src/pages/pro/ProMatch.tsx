// One pro match: the score (live minute, half-time, extra time, penalties), then tabs in the order every area uses.
// Played: Summary (events), Lineups (both elevens on the pitch, lineups with ratings), Stats (team stats, shot map),
// Head to head. Before kickoff: Preview, Head to head, Lineups (once announced).
import { ShareButton } from '../../components/PageActions';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import { kickoffLong, proMinute, proPath, type ProMatch as Match } from '../../lib/pro';
import { EventTimeline, LineupList, PlayerOfMatch, ProPitch, TeamStatsCompare, type ProEvent, type ProSideDetail } from '../../components/pro/MatchParts';
import { ProMatchRow } from '../../components/pro/ProMatchRow';
import { EmptyState, ErrorBox, Section, Skeleton, TabsNav, TeamLogo, PageWithRail, RailCard, Note } from '../../components/primitives';
import { Crumbs } from '../../components/shell';
import { useUrlState } from '../../lib/urlState';

type Tab = 'summary' | 'preview' | 'lineups' | 'stats' | 'h2h';
import { ProMoved } from './ProMoved';
import { MoveSection } from '../../components/pro/MoveSection';
import { EloMatchCard } from '../../components/intl/EloMatchCard';
import { WinChances, type EloChances } from '../../components/elo/WinChances';
import { useSection } from '../../lib/section';
import { Credit, MatchAdvancedFacts, ShotMap, type AdvMatch } from '../../components/pro/Advanced';
import { MatchPreview, type ProPreview } from '../../components/pro/MatchPreview';
import { ProRefereeCard } from '../../components/Referee';
import { MatchFlow } from '../../components/match/Flow';
import { PlayerMatchStats } from '../../components/pro/PlayerMatchStats';

interface MatchData { live?: { coverage: { events: boolean; lineups: boolean; stats: boolean }; updated_at: string | null } | null; match: Match & { referee: string | null }; events: ProEvent[]; home: ProSideDetail; away: ProSideDetail; h2h: Match[]; advanced?: AdvMatch | null; preview?: ProPreview | null; elo?: EloChances | null }

function Scoreline({ m }: { m: MatchData['match'] }) {
  const played = m.status === 'live' || m.status === 'final';
  const side = (s: Match['home'], align: 'left' | 'right') => (
    <Link to={proPath.team(s.slug)} className={`flex min-w-0 flex-1 flex-col items-center gap-2 text-center hover:text-pitch-300 sm:flex-row ${align === 'right' ? 'sm:flex-row-reverse sm:text-right' : 'sm:text-left'}`}>
      <TeamLogo src={s.logo} name={s.name} size={48} />
      <span className="display text-lg leading-tight text-chalk-100 sm:text-2xl">{s.name}</span>
    </Link>
  );
  const status = m.status === 'live' ? proMinute(m) : m.status === 'final' ? (m.status_short === 'AET' ? 'After extra time' : m.status_short === 'PEN' ? 'After penalties' : 'Full time') : m.status === 'scheduled' ? new Date(m.kickoff).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : m.status;
  return (
    <div className="card px-3 py-4 sm:px-5">
      <div className="flex items-center gap-3">
        {side(m.home, 'left')}
        <div className="shrink-0 text-center">
          <div className="display text-4xl tnum text-chalk-100 sm:text-5xl" aria-label={played ? `${m.home.score} to ${m.away.score}` : 'not started'}>{played ? `${m.home.score ?? 0} – ${m.away.score ?? 0}` : 'vs'}</div>
          <div className={`mt-1 text-xs ${m.status === 'live' ? 'font-semibold text-win' : 'text-chalk-400'}`}>{status}</div>
          {m.pen[0] != null && m.pen[1] != null && <div className="text-xs text-chalk-300">Penalties {m.pen[0]}–{m.pen[1]}</div>}
          {played && m.ht[0] != null && <div className="text-2xs text-chalk-500">HT {m.ht[0]}–{m.ht[1]}</div>}
        </div>
        {side(m.away, 'right')}
      </div>
    </div>
  );
}

export default function ProMatch() {
  const { slug = '' } = useParams();
  const intl = useSection() === 'intl';
  const { pathname } = useLocation();
  const [tabParam] = useUrlState('tab', '', { allow: ['summary', 'preview', 'lineups', 'stats', 'h2h'] });
  const q = useQuery({
    queryKey: ['pro-match', slug], queryFn: () => api<MatchData>(`/api/pro/matches/${slug}`),
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 1,
    refetchInterval: (query) => (query.state.data?.match.status === 'live' ? 45_000 : false),
  });
  if (q.error instanceof ApiError && q.error.status === 404) return <ProMoved kind="match" slug={slug} />;
  if (q.error) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  if (q.isPending) return <div className="space-y-4" aria-busy="true"><Skeleton className="h-40" /><Skeleton className="h-96" /></div>;
  const d = q.data!;
  if ((d.match.league.scope === 'intl') !== intl) return <MoveSection to={proPath.match(slug, d.match.league.scope ?? 'club')} />;
  const m = d.match;
  const facts = [m.round, m.venue, m.referee ? `Referee ${m.referee}` : null].filter(Boolean).join(' · ');
  const hasLineups = d.home.starters.length > 0 || d.away.starters.length > 0;
  const hasStats = !!(d.home.stats || d.away.stats);
  const hasShots = !!d.advanced && d.advanced.shots.length > 0;
  const played = m.status === 'live' || m.status === 'final';
  const tabs: { id: Tab; label: string; count?: number }[] = played
    ? [{ id: 'summary', label: 'Summary' }, ...(hasLineups ? [{ id: 'lineups' as Tab, label: 'Lineups' }] : []), ...(hasStats || hasShots || hasLineups ? [{ id: 'stats' as Tab, label: 'Stats' }] : []), ...(d.h2h.length ? [{ id: 'h2h' as Tab, label: 'Head to head', count: d.h2h.length }] : [])]
    : [...(d.preview ? [{ id: 'preview' as Tab, label: 'Preview' }] : []), ...(d.h2h.length ? [{ id: 'h2h' as Tab, label: 'Head to head', count: d.h2h.length }] : []), ...(hasLineups ? [{ id: 'lineups' as Tab, label: 'Lineups' }] : [])];
  const defaultTab: Tab = tabs[0]?.id ?? 'summary';
  const tab: Tab = tabs.some((t) => t.id === tabParam) ? (tabParam as Tab) : defaultTab;
  const hasShotsWide = hasShots && !hasStats;
  // Beside the summary and the preview: Plaibook Elo's chances, the key numbers and American Soccer Analysis' facts
  // (they sat in a centred stack above the tabs, with the page's width empty either side).
  const rail = (
    <>
      {intl && <EloMatchCard slug={slug} />}
      {!intl && d.elo && <WinChances elo={d.elo} home={m.home.name} away={m.away.name} rankingsHref="/pro/rankings?scope=world" />}
      {played && <PlayerOfMatch home={d.home} away={d.away} homeName={m.home.name} awayName={m.away.name} homeLogo={m.home.logo} awayLogo={m.away.logo} live={m.status === 'live'} />}
      {played && hasStats && (
        <RailCard title="Match stats" to={`${pathname}?tab=stats`} toLabel="All stats" flush>
          <TeamStatsCompare home={d.home.stats} away={d.away.stats} homeName={m.home.name} awayName={m.away.name} />
        </RailCard>
      )}
      {d.advanced && <RailCard title="From American Soccer Analysis"><MatchAdvancedFacts a={d.advanced} hasVenue={!!m.venue} hasReferee={!!m.referee} /></RailCard>}
      {m.referee && <ProRefereeCard fixtureId={m.id} competition={m.league.name} />}
    </>
  );
  return (
    <div className="space-y-4">
      <Crumbs items={[{ label: m.league.name, to: proPath.league(m.league.slug) }, { label: `${m.home.name} vs ${m.away.name}` }]} />
      <h1 className="sr-only">{m.home.name} vs {m.away.name}, {m.league.name}</h1>
      <Scoreline m={m} />
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-xs text-chalk-400">
        <p>
        {d.advanced && d.advanced.xg[0] != null && <span className="mr-2 font-medium text-chalk-200 tnum" aria-label={`Expected goals ${d.advanced.xg[0]} to ${d.advanced.xg[1]}`}>xG {d.advanced.xg[0]!.toFixed(2)} – {(d.advanced.xg[1] ?? 0).toFixed(2)}.</span>}
        {kickoffLong(m.kickoff)}{facts ? ` · ${facts}` : ''}
        </p>
        <ShareButton title={`${m.home.name} vs ${m.away.name}, ${m.league.name}`} />
      </div>
      {tabs.length > 1 && <TabsNav label="Match sections" tabs={tabs} value={tab} hrefFor={(x) => `${pathname}${x === defaultTab ? '' : `?tab=${x}`}`} />}
      {tab === 'summary' && (
        <PageWithRail label="Match in numbers" rail={rail}>
          {m.status === 'live' && <LiveNote live={d.live ?? null} hasDetail={d.events.length > 0 || hasLineups || hasStats} />}
          {played && <MatchFlow url={`/api/pro/fixtures/${m.id}/flow`} live={m.status === 'live'} home={m.home.name} away={m.away.name} />}
          {d.events.length
            ? <Section title="Events"><EventTimeline events={d.events} homeName={m.home.name} awayName={m.away.name} /></Section>
            : m.status === 'live'
              ? (d.live?.coverage.events === false ? null : <EmptyState title="No goals, cards or substitutions yet" body="Events appear here within a couple of minutes of happening." />)
              : <EmptyState title="No events recorded" body={m.status === 'final' && !m.detail ? 'Lineups and match stats arrive shortly after full time.' : undefined} />}
          {m.status === 'live' && hasLineups && <Section title="On the pitch"><ProPitch home={d.home} away={d.away} homeName={m.home.name} awayName={m.away.name} /></Section>}
        </PageWithRail>
      )}
      {tab === 'preview' && d.preview && <PageWithRail label="Match in numbers" rail={rail}><MatchPreview m={m} p={d.preview} h2h={d.h2h} /></PageWithRail>}
      {tab === 'lineups' && hasLineups && (
        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
          <Section title="Formations"><ProPitch home={d.home} away={d.away} homeName={m.home.name} awayName={m.away.name} /></Section>
          <Section title="Lineups">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <LineupList side={d.home} title={m.home.name} />
              <LineupList side={d.away} title={m.away.name} />
            </div>
          </Section>
        </div>
      )}
      {tab === 'stats' && (
        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
          {hasStats && <Section title="Team stats" className={hasShots ? '' : 'lg:col-span-2'}><TeamStatsCompare home={d.home.stats} away={d.away.stats} homeName={m.home.name} awayName={m.away.name} /></Section>}
          {hasShots && <Section title="Shot map" className={hasShotsWide ? 'lg:col-span-2' : ''}><ShotMap shots={d.advanced!.shots} homeName={m.home.name} awayName={m.away.name} score={[m.home.score ?? null, m.away.score ?? null]} /><Credit credit={d.advanced!.credit} /></Section>}
          {hasLineups && <Section title="Player stats" className="lg:col-span-2"><PlayerMatchStats home={d.home} away={d.away} homeName={m.home.name} awayName={m.away.name} /></Section>}
        </div>
      )}
      {tab === 'h2h' && d.h2h.length > 0 && <Section title="Head to head" right={!intl ? <Link to={`/pro/h2h?a=${m.home.slug}&b=${m.away.slug}`} className="text-xs text-pitch-300 hover:text-pitch-200">Every meeting</Link> : <Link to={`/intl/h2h?a=${m.home.slug}&b=${m.away.slug}`} className="text-xs text-pitch-300 hover:text-pitch-200">Every meeting</Link>}><div className="frame grid grid-cols-1 overflow-hidden [&>*]:-mb-px [&>*]:border-b [&>*]:border-field-700 xl:grid-cols-2">{d.h2h.map((x) => <ProMatchRow key={x.id} m={x} showDate showLeague />)}</div></Section>}
    </div>
  );
}

/** While a match is played: what this page can show live, and how fresh it is. Says plainly when the provider has no
 *  live events or stats for the competition, so an empty page is never a mystery. */
function LiveNote({ live, hasDetail }: { live: MatchData['live']; hasDetail: boolean }) {
  const c = live?.coverage;
  const none = c && !c.events && !c.lineups && !c.stats;
  const updated = live?.updated_at ? new Date(live.updated_at) : null;
  const ago = updated ? Math.max(0, Math.round((Date.now() - updated.getTime()) / 60_000)) : null;
  const fresh = ago == null ? '' : ago < 1 ? ' Updated less than a minute ago.' : ` Updated ${ago} min ago.`;
  if (none) return <Note tone="warn">Live events and stats are not available for this competition: only the score and the minute, refreshed every couple of minutes.{fresh}</Note>;
  const missing = c ? [!c.events && 'events', !c.lineups && 'lineups', !c.stats && 'match stats'].filter(Boolean) as string[] : [];
  if (!hasDetail) return <Note>Live: events, lineups and match stats arrive within a few minutes of kickoff and refresh every couple of minutes.{missing.length ? ` This competition has no ${missing.join(' or ')}.` : ''}{fresh}</Note>;
  return <Note>Live: events, lineups and match stats refresh every couple of minutes; player ratings settle after full time.{missing.length ? ` This competition has no ${missing.join(' or ')}.` : ''}{fresh}</Note>;
}
