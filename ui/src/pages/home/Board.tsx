// Today's board: every level of American soccer on one surface, three lanes divided like touchlines on a pitch.
// College (live first, then the day's biggest kickoffs, then results), Pro (the US scene first, then the top
// competitions abroad) and International. A quiet lane shows the next match day instead. On phones the lanes stack,
// the ones with live matches first.
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { genderLabel } from '../../lib/filters';
import { longDay, todayEastern } from '../../lib/dates';
import { liveMinute, type MatchLike } from '../../components/match/MatchRow';
import { proPath, proWhen, type ProDay, type ProMatch } from '../../lib/pro';
import type { IntlHome } from '../../lib/intl';
import { LiveDot, Skeleton, TeamLogo } from '../../components/primitives';
import type { CollegeDay, ProHome } from './data';

const ROWS = 5;

interface Side { name: string; logo: string | null; seo?: string | null; score: number | null; rank?: number | null }
interface BoardMatch { key: string; href: string; when: string; day?: string; live: boolean; final: boolean; home: Side; away: Side; caption?: { name: string; logo: string | null } }
interface Lane { id: 'college' | 'pro' | 'intl'; title: string; sub: string; live: number; today: number; rows: BoardMatch[]; note: string | null; more: { to: string; label: string }; loading: boolean; failed: boolean }

const time = (epoch: number | null) => (epoch ? new Date(epoch * 1000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : 'TBA');
const shortDay = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' });

function fromCollege(g: CollegeDay['games'][number], withDay: boolean): BoardMatch {
  const live = g.status === 'live', final = g.status === 'final';
  const when = live ? liveMinute(g.live) || 'Live' : final ? 'FT' : g.kickoff_tbd ? 'TBA' : time(g.start_epoch);
  const side = (s: MatchLike['home']): Side => ({ name: s.short_name || s.name || 'TBD', logo: s.logo, seo: s.seo, score: s.score, rank: s.rank });
  return { key: `c${g.id}`, href: `/matches/${g.id}`, when, day: withDay && !live && !final ? shortDay(g.game_date) : undefined, live, final, home: side(g.home), away: side(g.away) };
}

function fromPro(m: ProMatch, withDay: boolean): BoardMatch {
  const live = m.status === 'live', final = m.status === 'final';
  const when = proWhen(m);
  return {
    key: `p${m.id}`, href: proPath.match(m.slug, m.league.scope ?? (m.home.national ? 'intl' : 'club')), live, final,
    when, day: withDay && !live && !final ? shortDay(m.kickoff) : undefined,
    home: { name: m.home.name, logo: m.home.logo, score: m.home.score }, away: { name: m.away.name, logo: m.away.logo, score: m.away.score },
    caption: { name: m.league.name, logo: m.league.logo },
  };
}

/** Live first, then the next kickoffs (soonest first), then results (latest first). */
const byMoment = <T extends { live: boolean; final: boolean }>(rows: T[], start: (r: T) => number) =>
  [...rows].sort((a, b) => Number(b.live) - Number(a.live) || Number(a.final) - Number(b.final) || (a.final ? start(b) - start(a) : start(a) - start(b)));

export function collegeLane(d: CollegeDay | undefined, gender: 'm' | 'w', loading: boolean, failed: boolean): Lane {
  const today = todayEastern();
  const games = d?.games ?? [];
  const todays = games.filter((g) => g.game_date.slice(0, 10) === today && !g.result_pending);
  const nextDay = todays.length ? null : games.map((g) => g.game_date.slice(0, 10)).filter((x) => x > today).sort()[0] ?? null;
  const pool = todays.length ? todays : games.filter((g) => g.game_date.slice(0, 10) === nextDay);
  // Ranked meetings first among the kickoffs: the matches people are looking for.
  const rank = (g: MatchLike) => Math.min(g.home.rank ?? 99, g.away.rank ?? 99);
  const sorted = byMoment(pool.map((g) => ({ g, live: g.status === 'live', final: g.status === 'final' })), (r) => (r.g.start_epoch ?? 0) + rank(r.g) * 60);
  const live = todays.filter((g) => g.status === 'live').length;
  return {
    id: 'college', title: 'College', sub: `NCAA ${genderLabel(gender)}, every division`, live, today: todays.length, loading, failed,
    rows: sorted.slice(0, ROWS).map((r) => fromCollege(r.g, !todays.length)),
    note: todays.length ? null : nextDay ? `No college matches today. Next: ${longDay(nextDay)}.` : 'No college matches in the next few days.',
    more: { to: `/matches${gender === 'w' ? '?gender=w' : ''}`, label: 'All college matches' },
  };
}

export function proLane(d: ProHome | undefined, gender: 'm' | 'w', loading: boolean, failed: boolean): Lane {
  const ofGender = (day: ProDay | null | undefined) => (day?.groups ?? []).filter((g) => g.league.gender === gender);
  const groups = ofGender(d?.matches);
  // The US scene first (in competition order), then the top competitions abroad.
  const us = groups.filter((g) => g.league.us).flatMap((g) => g.matches);
  const world = groups.filter((g) => !g.league.us && g.priority < 100).flatMap((g) => g.matches);
  const nextUs = us.length ? [] : ofGender(d?.next_us).flatMap((g) => g.matches);
  const pick = [...byMoment(us.map((m) => ({ m, live: m.status === 'live', final: m.status === 'final' })), (r) => Date.parse(r.m.kickoff)), ...byMoment(world.map((m) => ({ m, live: m.status === 'live', final: m.status === 'final' })), (r) => Date.parse(r.m.kickoff))];
  // Live anywhere outranks a finished US match.
  const ordered = [...pick.filter((r) => r.live), ...pick.filter((r) => !r.live)];
  const rows = ordered.length ? ordered.slice(0, ROWS).map((r) => fromPro(r.m, false)) : nextUs.slice(0, ROWS).map((m) => fromPro(m, true));
  // The counts cover what the lane draws on (the US scene and the top competitions), so "6 live" means six of these.
  const pool = [...us, ...world];
  return {
    id: 'pro', title: 'Pro', sub: gender === 'w' ? 'NWSL first, then the world' : 'MLS and the US first, then the world', loading, failed,
    live: pool.filter((m) => m.status === 'live').length, today: pool.length, rows,
    note: ordered.length ? null : nextUs.length ? `No pro matches today. Next in the US: ${longDay(d!.next_us!.date)}.` : 'No pro matches today.',
    more: { to: '/pro/matches', label: 'All pro matches' },
  };
}

export function intlLane(d: IntlHome | undefined, gender: 'm' | 'w', loading: boolean, failed: boolean): Lane {
  const groups = (d?.matches.groups ?? []).filter((g) => g.league.gender === gender);
  const todays = groups.flatMap((g) => g.matches);
  const upcoming = (d?.upcoming ?? []).filter((m) => m.league.gender === gender);
  const recent = (d?.recent ?? []).filter((m) => m.league.gender === gender);
  const rows = todays.length
    ? byMoment(todays.map((m) => ({ m, live: m.status === 'live', final: m.status === 'final' })), (r) => Date.parse(r.m.kickoff)).slice(0, ROWS).map((r) => fromPro(r.m, false))
    : upcoming.length ? upcoming.slice(0, ROWS).map((m) => fromPro(m, true)) : recent.slice(0, ROWS).map((m) => fromPro(m, true));
  return {
    id: 'intl', title: 'International', sub: gender === 'w' ? "The USWNT and every women's national team" : 'The USMNT and every national team', loading, failed,
    live: todays.filter((m) => m.status === 'live').length, today: todays.length, rows,
    note: todays.length ? null : upcoming.length ? 'No internationals today. Coming up:' : recent.length ? 'No internationals today. Latest results:' : 'No international matches scheduled yet.',
    more: { to: '/intl/matches', label: 'All international matches' },
  };
}

function Score({ s, other, final }: { s: Side; other: Side; final: boolean }) {
  const won = final && s.score != null && other.score != null && s.score > other.score;
  const lost = final && s.score != null && other.score != null && s.score < other.score;
  return (
    <div className={`flex min-w-0 items-center gap-2 ${lost ? 'text-chalk-400' : 'text-chalk-100'}`}>
      <TeamLogo src={s.logo} seo={s.seo} name={s.name} size={18} />
      {s.rank ? <span className="shrink-0 text-2xs text-chalk-500 tnum">{s.rank}</span> : null}
      <span className={`min-w-0 flex-1 truncate text-sm ${won ? 'font-semibold' : ''}`}>{s.name}</span>
      <span className={`display w-6 shrink-0 text-right text-lg leading-none tnum ${s.score == null ? 'text-chalk-500' : ''}`}>{s.score ?? ''}</span>
    </div>
  );
}

function Row({ m, showCaption }: { m: BoardMatch; showCaption: boolean }) {
  return (
    <li>
      {showCaption && m.caption && (
        <span className="flex items-center gap-1.5 px-4 pb-0.5 pt-2 text-2xs text-chalk-500">
          <TeamLogo src={m.caption.logo} name={m.caption.name} size={12} /><span className="truncate">{m.caption.name}</span>
        </span>
      )}
      <Link to={m.href} className="grid grid-cols-[3.75rem_minmax(0,1fr)] items-center gap-2 px-4 py-2 transition-colors duration-150 hover:bg-field-800/70 focus-visible:bg-field-800/70 coarse:py-2.5">
        <span className={`text-xs leading-tight tnum ${m.live ? 'font-semibold text-note' : 'text-chalk-400'}`}>{m.day && <span className="block text-chalk-300">{m.day}</span>}<span className="whitespace-nowrap">{m.when}</span></span>
        <span className="min-w-0 space-y-1">
          <Score s={m.home} other={m.away} final={m.final} />
          <Score s={m.away} other={m.home} final={m.final} />
        </span>
      </Link>
    </li>
  );
}

function LaneView({ lane }: { lane: Lane }) {
  const status: ReactNode = lane.live
    ? <LiveDot label={<span className="text-sm font-semibold tnum">{lane.live} live</span>} />
    : <span className="text-sm text-chalk-400 tnum">{lane.today ? `${lane.today} today` : ''}</span>;
  return (
    <section aria-labelledby={`lane-${lane.id}`} className={`flex min-w-0 flex-col ${lane.live ? 'order-first md:order-none' : ''}`}>
      <header className="flex items-start justify-between gap-3 px-4 pb-2 pt-4">
        <div className="min-w-0">
          <h3 id={`lane-${lane.id}`} className="display text-xl leading-none text-chalk-100">{lane.title}</h3>
          <p className="mt-1 truncate text-xs text-chalk-500">{lane.sub}</p>
        </div>
        <div className="shrink-0 pt-0.5">{status}</div>
      </header>
      {lane.loading ? <div className="space-y-3 px-4 py-3"><Skeleton lines={5} /></div>
        : lane.failed ? <p className="px-4 py-3 text-sm text-chalk-400">These matches did not load. Refresh to try again.</p>
        : (
          <>
            {lane.note && <p className="px-4 pb-1 text-xs text-chalk-400">{lane.note}</p>}
            <ul className="flex-1">{lane.rows.map((m, i) => <Row key={m.key} m={m} showCaption={!!m.caption && m.caption.name !== lane.rows[i - 1]?.caption?.name} />)}</ul>
          </>
        )}
      <Link to={lane.more.to} className="mt-auto border-t border-field-700/70 px-4 py-2.5 text-sm text-pitch-300 hover:bg-field-800/50 hover:text-pitch-200">{lane.more.label}</Link>
    </section>
  );
}

/** The three lanes on one surface. The faint vertical bands are a mown pitch; the dividers are its touchlines. */
export function Board({ lanes }: { lanes: Lane[] }) {
  return (
    <div
      className="grid overflow-hidden rounded-xl border border-field-700 bg-field-900 max-md:divide-y max-md:divide-field-700 md:grid-cols-3 md:divide-x md:divide-field-700"
      style={{ backgroundImage: 'repeating-linear-gradient(90deg, rgba(255,255,255,0.018) 0 56px, transparent 56px 112px)' }}
    >
      {lanes.map((l) => <LaneView key={l.id} lane={l} />)}
    </div>
  );
}
