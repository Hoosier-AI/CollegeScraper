// One pro match: the score (live minute, half-time, extra time, penalties), events, both elevens on the pitch,
// team stats, lineups with ratings, and earlier meetings.
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import { kickoffLong, proMinute, proPath, type ProMatch as Match } from '../../lib/pro';
import { EventTimeline, LineupList, ProPitch, TeamStatsCompare, type ProEvent, type ProSideDetail } from '../../components/pro/MatchParts';
import { ProMatchRow } from '../../components/pro/ProMatchRow';
import { ErrorBox, Section, Skeleton, TeamLogo } from '../../components/primitives';
import { ProMoved } from './ProMoved';
import { Credit, MatchAdvancedFacts, ShotMap, type AdvMatch } from '../../components/pro/Advanced';

interface MatchData { match: Match & { referee: string | null }; events: ProEvent[]; home: ProSideDetail; away: ProSideDetail; h2h: Match[]; advanced?: AdvMatch | null }

function Scoreline({ m }: { m: MatchData['match'] }) {
  const played = m.status === 'live' || m.status === 'final';
  const side = (s: Match['home'], align: 'left' | 'right') => (
    <Link to={proPath.team(s.slug)} className={`flex min-w-0 flex-1 flex-col items-center gap-2 text-center hover:text-pitch-300 sm:flex-row ${align === 'right' ? 'sm:flex-row-reverse sm:text-right' : 'sm:text-left'}`}>
      <TeamLogo src={s.logo} name={s.name} size={56} />
      <span className="display text-lg leading-tight text-chalk-100 sm:text-2xl">{s.name}</span>
    </Link>
  );
  const status = m.status === 'live' ? proMinute(m) : m.status === 'final' ? (m.status_short === 'AET' ? 'After extra time' : m.status_short === 'PEN' ? 'After penalties' : 'Full time') : m.status === 'scheduled' ? new Date(m.kickoff).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : m.status;
  return (
    <div className="card px-4 py-5">
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
  const q = useQuery({
    queryKey: ['pro-match', slug], queryFn: () => api<MatchData>(`/api/pro/matches/${slug}`),
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 1,
    refetchInterval: (query) => (query.state.data?.match.status === 'live' ? 60_000 : false),
  });
  if (q.error instanceof ApiError && q.error.status === 404) return <ProMoved kind="match" slug={slug} />;
  if (q.error) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  if (q.isPending) return <div className="space-y-4" aria-busy="true"><Skeleton className="h-40" /><Skeleton className="h-96" /></div>;
  const d = q.data!;
  const m = d.match;
  const facts = [m.round, m.venue, m.referee ? `Referee ${m.referee}` : null].filter(Boolean).join(' · ');
  const hasLineups = d.home.starters.length > 0 || d.away.starters.length > 0;
  return (
    <div className="space-y-5">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-xs text-chalk-400">
        <Link to={proPath.home} className="hover:text-chalk-100">Pro</Link><span aria-hidden>/</span>
        <Link to={proPath.league(m.league.slug)} className="flex items-center gap-1 hover:text-chalk-100"><TeamLogo src={m.league.logo} name={m.league.name} size={14} chip={false} fallback="blank" />{m.league.name}</Link>
      </nav>
      <h1 className="sr-only">{m.home.name} vs {m.away.name}, {m.league.name}</h1>
      <Scoreline m={m} />
      <p className="text-center text-xs text-chalk-400">{kickoffLong(m.kickoff)}{facts ? ` · ${facts}` : ''}</p>
      {d.advanced && d.advanced.xg[0] != null && <p className="text-center text-sm tnum text-chalk-300" aria-label={`Expected goals ${d.advanced.xg[0]} to ${d.advanced.xg[1]}`}>xG {d.advanced.xg[0]!.toFixed(2)} – {(d.advanced.xg[1] ?? 0).toFixed(2)}</p>}
      {d.advanced && <div className="flex justify-center"><MatchAdvancedFacts a={d.advanced} /></div>}
      {m.status === 'final' && !m.detail && !d.events.length && <p className="text-center text-sm text-chalk-400">Lineups and match stats arrive shortly after full time.</p>}
      <div className="grid gap-5 lg:grid-cols-12">
        <div className="space-y-5 lg:col-span-7">
          {d.events.length > 0 && <Section title="Match events"><EventTimeline events={d.events} homeName={m.home.name} awayName={m.away.name} /></Section>}
          {d.advanced && d.advanced.shots.length > 0 && <Section title="Shot map"><ShotMap shots={d.advanced.shots} homeName={m.home.name} awayName={m.away.name} /><Credit credit={d.advanced.credit} /></Section>}
          {(d.home.stats || d.away.stats) && <Section title="Team stats"><TeamStatsCompare home={d.home.stats} away={d.away.stats} homeName={m.home.name} awayName={m.away.name} /></Section>}
          {hasLineups && (
            <Section title="Lineups">
              <div className="grid gap-3 md:grid-cols-2">
                <LineupList side={d.home} title={m.home.name} />
                <LineupList side={d.away} title={m.away.name} />
              </div>
            </Section>
          )}
        </div>
        <div className="space-y-5 lg:col-span-5">
          {hasLineups && <Section title="Formations"><ProPitch home={d.home} away={d.away} homeName={m.home.name} awayName={m.away.name} /></Section>}
          {d.h2h.length > 0 && <Section title="Earlier meetings"><div className="frame divide-y divide-field-700">{d.h2h.map((x) => <ProMatchRow key={x.id} m={x} showDate showLeague />)}</div></Section>}
        </div>
      </div>
    </div>
  );
}
