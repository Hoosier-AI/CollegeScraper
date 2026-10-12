// Plaibook Stats Pro front door, US first (most visitors are American): today's US matches (MLS, NWSL, USL and the
// leagues below, and the cups US clubs play in), Americans abroad, then the big competitions around the world.
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, fmt, qs } from '../../lib/api';
import { longDay, todayEastern } from '../../lib/dates';
import { proPath, proPaths2, type ProDay, type ProLeagueRef } from '../../lib/pro';
import { ProSearchBox } from '../../components/pro/ProSearchBox';
import { LeagueHeading, ProMatchRow } from '../../components/pro/ProMatchRow';
import { AbroadCard, type AbroadLine } from '../../components/pro/Abroad';
import { EmptyState, ErrorBox, Section, Skeleton, TeamLogo } from '../../components/primitives';
import { useProGender } from '../../lib/proGender';

interface HomeData {
  date: string; matches: ProDay; next_us: ProDay | null; abroad: { lines: AbroadLine[]; at: string | null } | null;
  featured: (ProLeagueRef & { current_season: number | null })[]; counts: { leagues: number; teams: number; players: number; matches: number };
}

function Groups({ groups }: { groups: ProDay['groups'] }) {
  return (
    <div className={`gap-3 ${groups.length > 2 ? 'xl:columns-2' : ''}`}>
      {groups.map((g) => (
        <div key={g.league.id} className="frame mb-3 break-inside-avoid divide-y divide-field-700 overflow-hidden">
          <LeagueHeading league={g.league} />
          {g.matches.map((m) => <ProMatchRow key={m.id} m={m} />)}
        </div>
      ))}
    </div>
  );
}

function CompetitionList({ title, leagues }: { title: string; leagues: ProLeagueRef[] }) {
  if (!leagues.length) return null;
  return (
    <div className="space-y-1">
      <h3 className="text-xs font-medium text-chalk-400">{title}</h3>
      <ul className="frame divide-y divide-field-700/70">
        {leagues.map((l) => (
          <li key={l.id}>
            <Link to={proPath.league(l.slug)} className="flex items-center gap-2 px-2.5 py-1.5 text-sm hover:bg-field-800 coarse:py-2.5" title={l.country && l.country !== 'World' ? l.country : 'Continental club cup'}>
              <TeamLogo src={l.logo} name={l.name} size={18} />
              <span className="min-w-0 truncate text-chalk-100">{l.name}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ProHome() {
  const date = todayEastern();
  const q = useQuery({ queryKey: ['pro-home', date], queryFn: () => api<HomeData>(`/api/pro/home${qs({ date })}`), refetchInterval: (query) => ((query.state.data?.matches.live ?? 0) > 0 ? 60_000 : false) });
  const d = q.data;
  const [gender] = useProGender();
  const ofGender = (d?.matches.groups ?? []).filter((g) => g.league.gender === gender);
  // The US scene in full, then the top competitions elsewhere; the full scoreboard has everything.
  const usGroups = ofGender.filter((g) => g.league.us);
  const nextUs = (d?.next_us?.groups ?? []).filter((g) => g.league.gender === gender);
  const world = ofGender.filter((g) => !g.league.us && g.priority < 100).slice(0, 8);
  const shown = [...usGroups, ...world].reduce((n, g) => n + g.matches.length, 0);
  const more = ofGender.reduce((n, g) => n + g.matches.length, 0) - shown;
  const live = usGroups.reduce((n, g) => n + g.matches.filter((m) => m.status === 'live').length, 0);
  const abroad = (d?.abroad?.lines ?? []).filter((l) => l.match.league.gender === gender).slice(0, 6);
  const featured = (d?.featured ?? []).filter((l) => l.gender === gender);
  const liveDot = (n: number) => (n ? <span className="flex items-center gap-1 text-sm font-normal text-win"><span aria-hidden className="inline-block h-2 w-2 animate-pulse rounded-full bg-win motion-reduce:animate-none" />{n} live</span> : null);
  return (
    <div className="space-y-6 pb-4">
      <section className="flex flex-col gap-4 pt-1 sm:pt-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          <h1 className="display text-2xl leading-tight text-chalk-100 sm:text-3xl">American pro soccer first, then the world</h1>
          <p className="mt-1.5 text-sm text-chalk-300">{gender === 'w' ? 'The NWSL, the USL Super League and the W League' : 'MLS, the USL, MLS NEXT Pro and the leagues below'}: live scores, lineups, tables and player stats, Americans playing abroad, and every big league around the world. Players who came through college link back to their NCAA careers.</p>
          <div className="mt-3"><ProSearchBox examples={gender === 'w' ? ['NWSL', 'Portland Thorns', 'Trinity Rodman', 'FA WSL'] : ['MLS', 'Inter Miami', 'Christian Pulisic', 'Premier League']} /></div>
        </div>
        {d && (
          <dl className="grid shrink-0 grid-cols-4 gap-x-5 gap-y-1 text-sm lg:text-right">
            {[['Competitions', d.counts.leagues], ['Clubs', d.counts.teams], ['Players', d.counts.players], ['Matches', d.counts.matches]].map(([k, v]) => (
              <div key={k as string} className="flex flex-col-reverse"><dt className="text-2xs text-chalk-500">{k}</dt><dd className="display text-lg text-chalk-100 tnum sm:text-xl">{fmt.num(v)}</dd></div>
            ))}
          </dl>
        )}
      </section>

      {q.error && <ErrorBox error={q.error} retry={() => q.refetch()} />}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="space-y-6">
          <Section title={<span className="flex items-center gap-2">In the US today{liveDot(live)}</span>}
            right={<Link to={proPath.matches} className="text-sm text-pitch-300 hover:text-pitch-200">Full scoreboard</Link>}>
            {q.isPending && <div className="space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-28" />)}</div>}
            {d && usGroups.length > 0 && <Groups groups={usGroups} />}
            {d && !usGroups.length && nextUs.length > 0 && d.next_us && (
              <>
                <p className="text-sm text-chalk-400">No US matches today. Next up, {longDay(d.next_us.date)}:</p>
                <Groups groups={nextUs} />
              </>
            )}
            {d && !usGroups.length && !nextUs.length && <EmptyState title="No US matches in the next three weeks" body="The US season may be between rounds. The scoreboard has every competition." action={<Link to={proPath.matches} className="btn-ghost btn-sm">Open the scoreboard</Link>} />}
          </Section>

          {abroad.length > 0 && (
            <Section title="Americans abroad this week" right={<Link to={proPaths2.abroad} className="text-sm text-pitch-300 hover:text-pitch-200">All Americans abroad</Link>}>
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">{abroad.map((l) => <AbroadCard key={`${l.player.id}-${l.match.id}`} l={l} />)}</ul>
            </Section>
          )}

          {world.length > 0 && (
            <Section title="Around the world today">
              <Groups groups={world} />
              {more > 0 && <Link to={proPath.matches} className="btn-ghost btn-sm">{fmt.num(more)} more matches today</Link>}
            </Section>
          )}
        </div>
        <aside className="space-y-3 lg:sticky lg:top-[4.5rem] lg:max-h-[calc(100vh-5.5rem)] lg:self-start lg:overflow-y-auto">
          <div className="flex items-center justify-between"><h2 className="text-base font-semibold text-chalk-100">Competitions</h2><Link to={proPath.leagues} className="text-sm text-pitch-300 hover:text-pitch-200">All</Link></div>
          {q.isPending && <Skeleton lines={8} />}
          <CompetitionList title="United States" leagues={featured.filter((l) => l.us)} />
          <CompetitionList title="Around the world" leagues={featured.filter((l) => !l.us)} />
        </aside>
      </div>
    </div>
  );
}
