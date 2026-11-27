// Today's matches on the home page: one list for college, pro and international, grouped by competition, each match
// on one line. A switch narrows it to one area and is remembered. A quiet day shows what is coming next.
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { longDay, todayEastern } from '../../lib/dates';
import { MatchRow, type MatchLike } from '../../components/match/MatchRow';
import { ProMatchRow } from '../../components/pro/ProMatchRow';
import { proPath, type ProDay, type ProMatch } from '../../lib/pro';
import type { IntlHome } from '../../lib/intl';
import { SegmentedControl, Skeleton, TeamLogo } from '../../components/primitives';
import type { CollegeDay, ProHome } from './data';

export type AreaPick = 'all' | 'college' | 'pro' | 'intl';
const KEY = 'plaibook:home-area';
const COLLEGE_ROWS = 10, PRO_GROUPS = 8;

export function useAreaPick(): [AreaPick, (a: AreaPick) => void] {
  const [a, setA] = useState<AreaPick>(() => { try { const v = localStorage.getItem(KEY); return v === 'college' || v === 'pro' || v === 'intl' ? v : 'all'; } catch { return 'all'; } });
  return [a, (v) => { setA(v); try { localStorage.setItem(KEY, v); } catch { /* not remembered in a private window */ } }];
}

export function AreaFilter({ value, onChange }: { value: AreaPick; onChange: (a: AreaPick) => void }) {
  return <SegmentedControl size="sm" label="Which matches" value={value} onChange={onChange} options={[{ value: 'all', label: 'All' }, { value: 'college', label: 'College' }, { value: 'pro', label: 'Pro' }, { value: 'intl', label: 'International' }]} />;
}

function Band({ logo, title, sub, to, right }: { logo?: string | null; title: string; sub?: string | null; to: string; right?: ReactNode }) {
  return (
    <div className="band">
      {logo !== undefined && <TeamLogo src={logo} name={title} size={18} />}
      <Link to={to} className="min-w-0 flex-1 truncate font-semibold text-chalk-100 hover:text-pitch-300">{title}{sub && <span className="font-normal text-chalk-500"> {sub}</span>}</Link>
      {right && <span className="shrink-0 text-xs">{right}</span>}
    </div>
  );
}

const liveTag = (n: number) => (n ? <span className="font-semibold text-live">{n} live</span> : null);
const More = ({ to, children }: { to: string; children: ReactNode }) => <Link to={to} className="block px-3.5 py-2.5 text-sm font-medium text-pitch-400 hover:text-pitch-300">{children}</Link>;

function College({ d, gender }: { d: CollegeDay | undefined; gender: 'm' | 'w' }) {
  const today = todayEastern();
  const games = d?.games ?? [];
  const todays = games.filter((g) => g.game_date.slice(0, 10) === today && !g.result_pending);
  const nextDay = todays.length ? null : games.map((g) => g.game_date.slice(0, 10)).filter((x) => x > today).sort()[0] ?? null;
  const pool = todays.length ? todays : games.filter((g) => g.game_date.slice(0, 10) === nextDay);
  // Live first, then the kickoffs people look for (ranked and seeded sides), then results.
  const weight = (g: MatchLike) => (g.status === 'live' ? 0 : g.status === 'final' ? 2 : 1) * 1e12 + (g.start_epoch ?? 0) + Math.min(g.home.rank ?? 99, g.away.rank ?? 99) * 60;
  const rows = [...pool].sort((a, b) => weight(a) - weight(b)).slice(0, COLLEGE_ROWS);
  const groups = useMemo(() => {
    const m = new Map<string, { title: string; sub: string | null; to: string; games: MatchLike[] }>();
    for (const g of rows) {
      const title = g.tournament ?? 'College';
      const key = `${title}|${g.tournament_round ?? ''}`;
      const grp = m.get(key) ?? { title, sub: g.tournament_round ?? null, to: g.tournament === 'NCAA Tournament' ? '/tournament' : '/matches', games: [] };
      grp.games.push(g); m.set(key, grp);
    }
    return [...m.values()];
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!pool.length) return null;
  const q = gender === 'w' ? '?gender=w' : '';
  return (
    <>
      {groups.map((g) => (
        <section key={`${g.title}${g.sub}`} aria-label={g.title}>
          <Band title={g.title} sub={[g.sub, nextDay ? longDay(nextDay) : null].filter(Boolean).join(', ') || null} to={`${g.to}${q}`} right={liveTag(g.games.filter((x) => x.status === 'live').length)} />
          <div className="rows">{g.games.map((x) => <MatchRow key={x.id} g={x} dense />)}</div>
        </section>
      ))}
      {pool.length > rows.length && <More to={`/matches${q}`}>All {pool.length} college matches</More>}
    </>
  );
}

function ProGroups({ day, gender, max, moreTo, moreLabel }: { day: ProDay | undefined; gender: 'm' | 'w'; max: number; moreTo: string; moreLabel: string }) {
  const all = (day?.groups ?? []).filter((g) => g.league.gender === gender);
  // The US scene first, then the top competitions; a competition with a match in play moves up.
  const lead = [...all.filter((g) => g.league.us), ...all.filter((g) => !g.league.us && g.priority < 100)];
  const live = (g: (typeof all)[number]) => g.matches.filter((m) => m.status === 'live').length;
  const shown = [...lead].sort((a, b) => Number(!!b.league.us) - Number(!!a.league.us) || Number(live(b) > 0) - Number(live(a) > 0)).slice(0, max);
  if (!shown.length) return null;
  const total = all.reduce((n, g) => n + g.matches.length, 0), drawn = shown.reduce((n, g) => n + g.matches.length, 0);
  return (
    <>
      {shown.map((g) => (
        <section key={g.league.id} aria-label={g.league.name}>
          <Band logo={g.league.logo} title={g.league.name} sub={g.league.country && g.league.country !== 'World' ? g.league.country : null} to={proPath.league(g.league.slug, null, null, g.league.scope)} right={liveTag(live(g))} />
          <div className="rows">{g.matches.map((m) => <ProMatchRow key={m.id} m={m} />)}</div>
        </section>
      ))}
      {total > drawn && <More to={moreTo}>{moreLabel.replace('{n}', String(total))}</More>}
    </>
  );
}

function IntlLater({ d, gender }: { d: IntlHome | undefined; gender: 'm' | 'w' }) {
  const list: ProMatch[] = ((d?.upcoming ?? []).filter((m) => m.league.gender === gender).slice(0, 6));
  if (!list.length) return null;
  return (
    <section aria-label="International, coming up">
      <Band title="International" sub="coming up" to="/intl/matches" />
      <div className="rows">{list.map((m) => <ProMatchRow key={m.id} m={m} showDate showLeague />)}</div>
    </section>
  );
}

export function Scores({ area, gender, college, pro, intl, loading }: { area: AreaPick; gender: 'm' | 'w'; college: CollegeDay | undefined; pro: ProHome | undefined; intl: IntlHome | undefined; loading: boolean }) {
  const show = (a: AreaPick) => area === 'all' || area === a;
  const intlToday = (intl?.matches.groups ?? []).some((g) => g.league.gender === gender);
  if (loading) return <div className="space-y-2 px-3.5 py-3" aria-busy="true"><Skeleton className="h-8" /><Skeleton lines={6} /></div>;
  const body = (
    <>
      {show('college') && <College d={college} gender={gender} />}
      {show('pro') && <ProGroups day={pro?.matches} gender={gender} max={area === 'pro' ? 20 : PRO_GROUPS} moreTo="/pro/matches" moreLabel="All {n} pro matches today" />}
      {show('intl') && (intlToday ? <ProGroups day={intl?.matches} gender={gender} max={8} moreTo="/intl/matches" moreLabel="All {n} international matches today" /> : <IntlLater d={intl} gender={gender} />)}
    </>
  );
  return <div className="bleed overflow-hidden sm:rounded-lg">{body}</div>;
}
