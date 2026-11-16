// NCAA tournament (/tournament). Before selection: the odds (college-sims): the projected field, the top 16 seeds, the
// bubble, every team's chances of the conference title, the automatic bid, a bid and a seed. Once NCAA.com lists the
// field: the real bracket (Bracket), and each team's chance to reach each round with the bracket played out with
// Plaibook Elo. Plus every D1 conference tournament (champion or where it stands). Men's 48, women's 64.
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, fmt, qs } from '../lib/api';
import { genderLabel, useFilters, useHref } from '../lib/filters';
import { useUrlState } from '../lib/urlState';
import { DataTable, type Column } from '../components/DataTable';
import { Bracket, type BracketData, type BracketTeam } from '../components/Bracket';
import { Badge, EmptyState, ErrorBox, PageHeader, PageWithRail, RailCard, Skeleton, TabsNav, TeamLogo } from '../components/primitives';

interface Prog { id: string; name: string; short_name: string | null; seo: string | null; gender: 'm' | 'w'; logo: string | null }
interface Team { program_id: string; program: Prog; conference: { id: string; name: string; short: string | null } | null; reg_title: number; auto_bid: number; bid: number; seed: number; avg_rank: number | null; rpi_rank: number | null; record: { w: number; l: number; t: number } | null; projected_seed?: number | null; how?: 'auto' | 'at-large'; rounds?: number[] | null }
interface Data { season: number; phase?: 'projected' | 'bracket' | 'done'; bracket?: BracketData | null; run_at?: string; sims?: number; field_size?: number; seeds?: number; field: Team[]; last_in?: Team[]; first_out?: Team[]; teams: Team[] }
interface ConfSummary { conference: { id: string; name: string; short: string | null }; name: string; status: 'done' | 'live' | 'upcoming'; first: string; last: string; teams: number; champion: BracketTeam | null; final: { home: BracketTeam | null; away: BracketTeam | null; shootout: boolean; date: string | null } | null }

export const chance = (v: number | null | undefined) => (v == null ? '–' : v >= 0.9995 ? '>99%' : v > 0 && v < 0.005 ? '<1%' : v === 0 ? '0%' : `${Math.round(v * 100)}%`);

function TeamCell({ t, href, sub }: { t: Team; href: (p: string, o?: Record<string, string | number | null | undefined>) => string; sub?: string }) {
  return (
    <Link to={href(`/teams/${t.program.id}`, { gender: t.program.gender })} className="flex min-w-0 items-center gap-2 hover:text-pitch-300">
      <TeamLogo src={t.program.logo} seo={t.program.seo} name={t.program.name} size={20} />
      <span className="min-w-0"><span className="block truncate font-medium text-chalk-100">{t.program.name}</span>{sub && <span className="block truncate text-2xs text-chalk-500">{sub}</span>}</span>
    </Link>
  );
}

type Tab = 'bracket' | 'odds' | 'conferences';

export default function Tournament() {
  const f = useFilters();
  const href = useHref();
  const { pathname } = useLocation();
  const [rawTab] = useUrlState('tab', '', { allow: ['', 'bracket', 'odds', 'conferences'] });
  const q = useQuery({ queryKey: ['tournament', f.season, f.gender], queryFn: () => api<Data>(`/api/tournament${qs({ season: f.season, gender: f.gender })}`) });
  const d = q.data;
  const hasBracket = !!d?.bracket && d.phase !== 'projected';
  const tab: Tab = (rawTab as Tab) || (hasBracket ? 'bracket' : 'odds');
  const tabs = [
    ...(hasBracket ? [{ id: 'bracket' as Tab, label: 'Bracket' }] : []),
    { id: 'odds' as Tab, label: hasBracket ? 'Odds by round' : 'Odds' },
    { id: 'conferences' as Tab, label: 'Conference tournaments' },
  ];
  const sub = d?.phase === 'done' ? 'the tournament is over' : hasBracket
    ? `the field is set; the rest of the bracket played ${d?.sims ? fmt.num(d.sims) : 'thousands of'} times`
    : `the rest of the season played ${d?.sims ? fmt.num(d.sims) : 'thousands of'} times`;
  return (
    <div className="stack">
      <PageHeader title="NCAA tournament" meta={`Division I ${genderLabel(f.gender)}, ${f.season}: ${sub}${d?.run_at ? `, updated ${fmt.agoWords(d.run_at)}` : ''}.`} />
      <TabsNav label="Tournament sections" tabs={tabs} value={tab} hrefFor={(x) => href(pathname, { tab: x === (hasBracket ? 'bracket' : 'odds') ? null : x })} />
      {q.error && <ErrorBox error={q.error} retry={() => q.refetch()} />}
      {q.isPending && <Skeleton className="h-96" />}
      {d && tab === 'bracket' && (hasBracket
        ? <Bracket b={d.bracket!} title={`${f.season} NCAA Division I ${genderLabel(f.gender)}'s tournament`} parts={4} split={4} />
        : <EmptyState title="The bracket is not out yet" body="It appears here when NCAA.com lists the field. Until then, see the odds." />)}
      {d && tab === 'odds' && (hasBracket ? <RoundOdds d={d} href={href} /> : <Projected d={d} href={href} />)}
      {tab === 'conferences' && <ConferenceTournaments />}
    </div>
  );
}

function Projected({ d, href }: { d: Data; href: ReturnType<typeof useHref> }) {
  const rec = (t: Team) => (t.record ? fmt.rec(t.record.w, t.record.l, t.record.t) : '');
  if (!d.field.length) return <EmptyState title="No simulation yet" body="The odds appear after the first run of the season simulations." />;
  const cols: Column<Team>[] = [
    { key: 'team', label: 'Team', primary: true, value: (t) => t.program.name, render: (t) => <TeamCell t={t} href={href} sub={[t.conference?.short ?? t.conference?.name, rec(t)].filter(Boolean).join(', ')} /> },
    { key: 'rpi_rank', label: 'RPI', title: 'RPI rank now', num: true },
    { key: 'avg_rank', label: 'Proj. RPI', title: 'Average final RPI rank in the simulations', num: true, decimals: 1 },
    { key: 'reg_title', label: 'Conf. title', title: 'Wins the conference regular season (at least first on points and goal difference)', num: true, render: (t) => chance(t.reg_title) },
    { key: 'auto_bid', label: 'Auto bid', title: 'Wins the conference tournament and its automatic bid (the real result once it is played)', num: true, render: (t) => chance(t.auto_bid) },
    { key: 'bid', label: 'NCAA bid', num: true, render: (t) => <span className="font-semibold text-chalk-100">{chance(t.bid)}</span> },
    { key: 'seed', label: 'Seed', title: 'One of the top 16 seeds', num: true, render: (t) => chance(t.seed) },
  ];
  return (
    <PageWithRail label="The bubble" rail={<>
      {(d.last_in?.length ?? 0) > 0 && <RailCard title="Last four in">
        <ol className="space-y-1.5">{d.last_in!.map((t) => <li key={t.program_id} className="flex items-center gap-2"><span className="min-w-0 flex-1"><TeamCell t={t} href={href} sub={`RPI ${t.rpi_rank ?? '–'}, ${rec(t)}`} /></span><span className="text-sm font-semibold text-chalk-100 tnum">{chance(t.bid)}</span></li>)}</ol>
      </RailCard>}
      {(d.first_out?.length ?? 0) > 0 && <RailCard title="First four out">
        <ol className="space-y-1.5">{d.first_out!.map((t) => <li key={t.program_id} className="flex items-center gap-2"><span className="min-w-0 flex-1"><TeamCell t={t} href={href} sub={`RPI ${t.rpi_rank ?? '–'}, ${rec(t)}`} /></span><span className="text-sm font-semibold text-chalk-100 tnum">{chance(t.bid)}</span></li>)}</ol>
      </RailCard>}
      <RailCard title="How this works">
        <p className="text-chalk-300">Every remaining game is played from Plaibook Elo's win, draw and loss chances, again and again. In each run the conference table (regular-season games only) decides the regular-season champion. A conference tournament already played gives its real champion the automatic bid; one under way is played out by the teams still in it; one not started is approximated as a knockout of the table's top four. The RPI is then worked out from the simulated results and the best RPIs not already in take the at-large places; the top 16 RPIs in the field are the seeds.</p>
        <p className="mt-2 text-2xs text-chalk-500">The committee also weighs results and other factors, so treat these as odds, not a bracket.</p>
      </RailCard>
    </>}>
      <section className="min-w-0 space-y-2">
        <h2 className="h-section">Projected field <span className="text-sm font-normal text-chalk-500">{d.field.length} teams, the likeliest champion of each conference and the likeliest at-large teams</span></h2>
        <ol className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {d.field.filter((t) => t.projected_seed).map((t) => (
            <li key={t.program_id} className="frame flex items-center gap-2.5 px-3 py-2">
              <span className="display w-6 text-center text-lg text-chalk-100 tnum">{t.projected_seed}</span>
              <span className="min-w-0 flex-1"><TeamCell t={t} href={href} sub={`${chance(t.seed)} to be seeded`} /></span>
            </li>
          ))}
        </ol>
        <ul className="frame grid grid-cols-1 gap-x-4 px-3 py-2 sm:grid-cols-2 xl:grid-cols-3">
          {d.field.filter((t) => !t.projected_seed).map((t) => (
            <li key={t.program_id} className="flex items-center gap-2 py-1 text-sm">
              <span className="min-w-0 flex-1"><TeamCell t={t} href={href} /></span>
              {t.how === 'auto' && <Badge tone="teal" title={t.auto_bid >= 0.9995 ? `${t.conference?.name ?? 'Conference'} champion` : `Likeliest ${t.conference?.name ?? 'conference'} champion`}>{t.auto_bid >= 0.9995 ? 'Champion' : 'Auto'}</Badge>}
              <span className="w-10 text-right text-xs text-chalk-300 tnum">{chance(t.bid)}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="min-w-0 space-y-2">
        <h2 className="h-section">Every team's chances</h2>
        <DataTable rows={d.teams} columns={cols} rowKey={(t) => t.program_id} caption="NCAA tournament odds" defaultSort={{ key: 'bid', dir: 'desc' }} pageSize={50} noun="teams" />
      </section>
    </PageWithRail>
  );
}

const ROUND_COLS: { key: string; label: string; title: string }[] = [
  { key: 'r2', label: '2nd rd', title: 'Reaches the second round' },
  { key: 'r3', label: '3rd rd', title: 'Reaches the third round' },
  { key: 'qf', label: 'QF', title: 'Reaches the quarterfinals' },
  { key: 'sf', label: 'College Cup', title: 'Reaches the semifinals (the College Cup)' },
  { key: 'f', label: 'Final', title: 'Reaches the final' },
  { key: 'win', label: 'Champion', title: 'Wins the tournament' },
];

function RoundOdds({ d, href }: { d: Data; href: ReturnType<typeof useHref> }) {
  const rows = d.teams.filter((t) => t.rounds);
  if (!rows.length) return <EmptyState title="No bracket odds yet" body="They appear after the next run of the simulations." />;
  const cols: Column<Team>[] = [
    { key: 'team', label: 'Team', primary: true, value: (t) => t.program.name, render: (t) => <TeamCell t={t} href={href} sub={[t.conference?.short ?? t.conference?.name, t.record ? fmt.rec(t.record.w, t.record.l, t.record.t) : null].filter(Boolean).join(', ')} /> },
    ...ROUND_COLS.map((c, i): Column<Team> => ({ key: c.key, label: c.label, title: c.title, num: true, value: (t) => t.rounds?.[i] ?? null,
      render: (t) => <span className={i === 5 ? 'font-semibold text-chalk-100' : ''}>{chance(t.rounds?.[i])}</span> })),
  ];
  return (
    <section className="min-w-0 space-y-2">
      <h2 className="h-section">Chances to go through <span className="text-sm font-normal text-chalk-500">the rest of the bracket played {d.sims ? fmt.num(d.sims) : 'thousands of'} times with Plaibook Elo; seeds host until the College Cup</span></h2>
      <DataTable rows={rows} columns={cols} rowKey={(t) => t.program_id} caption="NCAA tournament chances by round" defaultSort={{ key: 'win', dir: 'desc' }} pageSize={64} noun="teams" />
    </section>
  );
}

function ConferenceTournaments() {
  const f = useFilters();
  const href = useHref();
  const q = useQuery({ queryKey: ['conference-tournaments', f.season, f.gender], queryFn: () => api<{ tournaments: ConfSummary[] }>(`/api/conference-tournaments${qs({ season: f.season, gender: f.gender })}`) });
  if (q.isPending) return <Skeleton className="h-64" />;
  if (q.error) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  const list = q.data?.tournaments ?? [];
  if (!list.length) return <EmptyState title="No conference tournaments yet" body="They show here once they start, usually in late October." />;
  const done = list.filter((t) => t.status === 'done').length;
  return (
    <section className="min-w-0 space-y-2">
      <h2 className="h-section">Conference tournaments <span className="text-sm font-normal text-chalk-500">{done} of {list.length} decided; each champion takes its conference's automatic bid</span></h2>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {list.map((t) => (
          <li key={t.conference.id}>
            <Link to={href(`/conferences/${t.conference.id}`, { tab: 'tournament' })} className="frame flex h-full items-center gap-3 px-3 py-2.5 transition-colors duration-150 hover:bg-field-800">
              {t.champion
                ? <TeamLogo src={t.champion.logo} seo={t.champion.seo} name={t.champion.name} size={28} />
                : <span className="h-7 w-7 shrink-0 rounded-full border border-dashed border-field-600" aria-hidden />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-chalk-100">{t.conference.short ?? t.conference.name}</span>
                <span className="block truncate text-2xs text-chalk-400">
                  {t.champion ? <>Champion: <b className="font-semibold text-chalk-200">{t.champion.name}</b></>
                    : t.status === 'done' ? 'Final decided on penalties'
                    : t.status === 'live' ? `Under way, ${t.teams} teams` : `Starts ${fmt.day(t.first)}`}
                </span>
              </span>
              {t.final && t.status === 'done' && (() => {
                // The final from the champion's side: "3-0 v SMU", "2-2 v Washington, PKs".
                const champHome = !!t.champion && t.final.home?.id === t.champion.id;
                const [us, them] = champHome || !t.champion ? [t.final.home, t.final.away] : [t.final.away, t.final.home];
                return (
                  <span className="max-w-[45%] shrink-0 truncate text-right text-2xs text-chalk-500 tnum" title={`Final: ${t.final.home?.name ?? ''} ${t.final.home?.score ?? ''}-${t.final.away?.score ?? ''} ${t.final.away?.name ?? ''}${t.final.shootout ? ', on penalties' : ''}`}>
                    {us?.score ?? ''}-{them?.score ?? ''} v {them?.name ?? 'TBD'}{t.final.shootout ? ', PKs' : ''}
                  </span>
                );
              })()}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
