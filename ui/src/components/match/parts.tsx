// Pieces of the match page: masthead, timeline, lineups, stat bars, head-to-head and the pre-match preview.
import { Link } from 'react-router-dom';
import { ArrowDownCircle, ArrowUpCircle, CalendarClock, ExternalLink, Hand, MapPin, Square } from 'lucide-react';
import { fmt } from '../../lib/api';
import { useHref } from '../../lib/filters';
import { PlayerAvatar, Badge, EmptyState, FormPips, Note, ResultBadge, TeamLogo } from '../primitives';
import { liveMinute, MatchRow, type MatchLike } from './MatchRow';
import { WeatherLine } from './Weather';
import { Goals, SoccerBall } from '../icons';
import type { Scorer } from '../../lib/match';

/* ---------- masthead ---------- */

export function MatchMasthead({ g, sides, scorers }: { g: any; sides?: any; scorers?: { home: Scorer[]; away: Scorer[] } }) {
  const href = useHref();
  const live = g.status === 'live', final = g.status === 'final';
  const statusLine = live ? liveMinute(g.live ?? { period: g.live_period, clock: g.live_clock }) : final ? (g.forfeit ? 'Final, forfeit' : g.shootout ? 'Final, penalties' : g.overtime ? 'Final, overtime' : 'Final') : g.result_pending ? 'Result not in yet' : g.status === 'scheduled' ? (fmt.kickoff(g.start_epoch) ? `${fmt.weekday(g.game_date)}, ${fmt.kickoff(g.start_epoch)}` : `${fmt.weekday(g.game_date)}, time TBD`) : g.status;
  const team = (side: 'home' | 'away') => {
    const s = g[side]; const info = sides?.[side];
    return (
      <div className={`flex min-w-0 flex-col items-center gap-2 text-center ${side === 'home' ? 'sm:items-start sm:text-left' : 'sm:items-end sm:text-right'}`}>
        <TeamLogo src={s.logo} seo={s.seo} name={s.name} size={64} />
        <div className="min-w-0">
          <span className={`mb-1 inline-flex items-center rounded px-1.5 py-0.5 text-2xs font-medium ${side === 'home' ? 'bg-pitch-400/15 text-pitch-300' : 'bg-field-800 text-chalk-300'}`}>{side === 'home' ? (g.neutral_site ? 'Home (neutral site)' : 'Home') : 'Away'}</span>
          {s.program_id ? <Link to={href(`/teams/${s.program_id}`)} className="display block text-xl leading-tight hover:text-pitch-300 sm:text-2xl">{s.name ?? 'TBD'}</Link> : <span className="display block text-xl sm:text-2xl">{s.name ?? 'TBD'}</span>}
          <div className="mt-1 text-xs text-chalk-400 tnum">
            {s.rank && <span className="mr-2 text-note">No. {s.rank}</span>}
            {info?.stats && <span>{fmt.rec(info.stats.w, info.stats.l, info.stats.t)}</span>}
            {info?.standing?.rank && info.stats && <span>, {fmt.ordinal(info.standing.rank)}{info.standing.of ? ` of ${info.standing.of}` : ''} in the {s.conference?.short ?? s.conference?.name ?? 'conference'}</span>}
          </div>
          {(live || final) && scorers?.[side]?.length ? (
            <ul className={`mt-2 space-y-0.5 text-sm ${side === 'home' ? '' : 'sm:text-right'}`} aria-label={`${s.name ?? side} scorers`}>
              {scorers[side].map((x) => (
                <li key={x.name} className={`flex items-center gap-1.5 text-chalk-200 ${side === 'home' ? 'justify-center sm:justify-start' : 'justify-center sm:justify-end'}`}>
                  <SoccerBall size={13} className="text-chalk-300" />
                  <span className="font-medium text-chalk-100">{x.name}</span>
                  <span className="text-chalk-400 tnum">{x.minutes.length ? x.minutes.join(', ') : x.count > 1 ? `×${x.count}` : ''}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    );
  };
  return (
    <header className="card p-4 sm:p-6">
      <div className="grid items-center gap-4 sm:grid-cols-[1fr_auto_1fr]">
        {team('home')}
        <div className="text-center">
          {live || final ? <div className="display text-4xl tnum sm:text-5xl">{g.home.score ?? '–'}<span className="mx-2 text-chalk-500">–</span>{g.away.score ?? '–'}</div> : <div className="display text-3xl text-chalk-300 sm:text-4xl">{fmt.kickoff(g.start_epoch) ?? 'TBD'}</div>}
          <div className={`mt-1 inline-flex items-center gap-1.5 text-sm ${live ? 'font-semibold text-win' : 'text-chalk-400'}`}>
            {live && <span aria-hidden className="inline-block h-2 w-2 animate-pulse rounded-full bg-win motion-reduce:animate-none" />}{statusLine}
          </div>
        </div>
        {team('away')}
      </div>
      <div className="mt-5 grid gap-4 border-t border-field-700 pt-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.3fr]">
        <Fact icon={<MapPin size={18} aria-hidden />} label="Where">
          {venueText(g) ? <>
            <span className="text-chalk-100">{venueText(g)}</span>
            <a className="ml-2 inline-flex items-center gap-1 text-xs text-pitch-400 hover:text-pitch-300" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venueText(g)!)}`} target="_blank" rel="noreferrer">Map <ExternalLink size={11} aria-hidden /></a>
          </> : <span className="text-chalk-300">{g.neutral_site ? 'Neutral site, venue not published' : `${g.home.name ?? 'The home team'}'s home ground`}</span>}
          <span className="block text-xs text-chalk-500">{g.neutral_site ? `Neutral site; ${g.home.name ?? 'home'} is the designated home team` : `${g.home.name ?? 'TBD'} at home, ${g.away.name ?? 'TBD'} travelling`}</span>
        </Fact>
        <Fact icon={<CalendarClock size={18} aria-hidden />} label="When">
          <span className="text-chalk-100">{fmt.weekday(g.game_date)}{fmt.kickoff(g.start_epoch) ? `, ${fmt.kickoff(g.start_epoch)}` : ', time TBD'}</span>
          {fmt.kickoffEt(g.start_epoch) && <span className="block text-xs text-chalk-500">{fmt.kickoffEt(g.start_epoch)}</span>}
          <span className="mt-1 flex flex-wrap gap-1.5">{g.conference_game && <Badge>Conference</Badge>}{g.tournament && <Badge tone="teal">{g.tournament}</Badge>}{g.postseason && <Badge tone="teal">Postseason</Badge>}</span>
        </Fact>
        <Fact label="Weather">
          {g.weather ? <WeatherLine w={g.weather} past={live || final} /> : <span className="text-sm text-chalk-500">{live || final || g.result_pending ? 'No forecast was recorded for this match.' : 'The forecast appears within a week of kickoff, once the ground is known.'}</span>}
        </Fact>
      </div>
    </header>
  );
}

/* ---------- timeline ---------- */

const EV: Record<string, { icon: JSX.Element; label: string; cls?: string }> = {
  goal: { icon: <SoccerBall size={15} />, label: 'Goal', cls: 'text-chalk-100' }, pk: { icon: <SoccerBall size={15} />, label: 'Penalty', cls: 'text-chalk-100' },
  yellow: { icon: <Square size={12} fill="currentColor" />, label: 'Yellow card', cls: 'text-note' }, red: { icon: <Square size={12} fill="currentColor" />, label: 'Red card', cls: 'text-loss' },
  sub_in: { icon: <ArrowUpCircle size={14} />, label: 'Sub on', cls: 'text-chalk-400' }, sub_out: { icon: <ArrowDownCircle size={14} />, label: 'Sub off', cls: 'text-chalk-500' },
  goalie_change: { icon: <Hand size={14} />, label: 'Keeper change', cls: 'text-chalk-400' },
};
const KEY_EVENTS = new Set(Object.keys(EV));

export function Timeline({ events, homeId, homeName, awayName, source }: { events: any[]; homeId: string | null; homeName: string | null; awayName: string | null; source: string | null }) {
  const rows = events.filter((e) => e.source === source && KEY_EVENTS.has(e.event_type)).sort((a, b) => a.period - b.period || a.seq - b.seq);
  if (!rows.length) return <EmptyState title="No goals, cards or substitutions recorded" body="The play-by-play arrives with the box score." />;
  const minute = (e: any) => { const m = String(e.clock ?? '').match(/^(\d+):(\d\d)/); const base = m ? Number(m[1]) + (Number(m[2]) > 0 ? 1 : 0) : null; return base != null ? `${base}′` : e.period > 2 ? 'OT' : ''; };
  return (
    <ol className="frame divide-y divide-field-700" aria-label="Key events">
      {rows.map((e) => {
        const home = e.program_id === homeId; const ev = EV[e.event_type]!;
        const who = <span className="text-sm"><span className="font-medium text-chalk-100">{personName(e.player_name_raw) ?? (e.event_type === 'goal' ? 'Unknown scorer' : 'Team (bench)')}</span>{e.assist_name_raw && <span className="text-chalk-400"> (assist {e.assist_name_raw})</span>}{e.event_type === 'goal' && e.home_score != null && <span className="ml-2 text-chalk-500 tnum">{e.home_score}–{e.away_score}</span>}</span>;
        return (
          <li key={e.id} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 py-2">
            <div className={`flex items-center justify-end gap-2 ${home ? '' : 'invisible'}`}>{who}<span className={ev.cls} title={ev.label}>{ev.icon}<span className="sr-only">{ev.label}</span></span></div>
            <div className="w-12 text-center text-xs text-chalk-500 tnum">{minute(e)}</div>
            <div className={`flex items-center gap-2 ${home ? 'invisible' : ''}`}><span className={ev.cls} title={ev.label}>{ev.icon}<span className="sr-only">{ev.label}</span></span>{who}</div>
          </li>
        );
      })}
      <li className="grid grid-cols-[1fr_auto_1fr] px-3 py-1.5 text-2xs text-chalk-500"><span className="text-right">{homeName}</span><span className="w-12" /><span>{awayName}</span></li>
    </ol>
  );
}

/** Stored names from before the parsers dropped placeholders ("0", "TEAM") still show as no person. */
const personName = (raw: string | null | undefined): string | null => { const s = (raw ?? '').trim(); return /[a-z]/i.test(s) && !/^(the )?(team|tm|bench)$/i.test(s) ? s : null; };

/** "Freeman Field at Koskinen Stadium, Durham, NC", or whichever part is known. */
export const venueText = (g: { venue?: { name: string | null; city: string | null } | null }): string | null => [g.venue?.name, g.venue?.city].filter(Boolean).join(', ') || null;

function Fact({ icon, label, children }: { icon?: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      {icon && <span className="mt-0.5 text-chalk-400">{icon}</span>}
      <div className="min-w-0 text-sm"><div className="mb-0.5 text-2xs font-medium text-chalk-500">{label}</div>{children}</div>
    </div>
  );
}

/* ---------- lineups ---------- */

const POS_GROUPS: [string, RegExp][] = [['Goalkeeper', /^(GK|G)$/i], ['Defenders', /^(D|DEF|CB|LB|RB)$/i], ['Midfielders', /^(M|MF|MID|CM|DM|AM)$/i], ['Forwards', /^(F|FW|FWD|ST|W)$/i]];

/** What a side's lineup on this page is: this match's XI, this match's players with no starters marked, a past
 * match's XI carried over, or nothing. `past` carries the earlier match it came from. */
export type LineupStatus = 'match' | 'no_starters' | 'past' | 'none';
export interface SideLineup { lineup: any | null; status: LineupStatus; past?: { opponent: string | null; game_date: string } | null; crest?: string | null; crestSeo?: string | null }

/** The status chip shown beside a side's name, on the pitch and above the list. */
export function LineupChip({ status, past, compact }: { status: LineupStatus; past?: { opponent: string | null; game_date: string } | null; compact?: boolean }) {
  if (status === 'match') return <span className="inline-flex items-center rounded bg-pitch-500/20 px-1.5 py-0.5 text-2xs font-medium text-pitch-300">Starting XI</span>;
  if (status === 'past') return <span className="inline-flex items-center rounded bg-note/20 px-1.5 py-0.5 text-2xs font-medium text-note">{compact ? 'Past lineup' : `Past lineup · vs ${past?.opponent ?? '?'}, ${past ? fmt.day(past.game_date) : ''}`}</span>;
  if (status === 'no_starters') return <span className="inline-flex items-center rounded bg-field-700 px-1.5 py-0.5 text-2xs font-medium text-chalk-300">Starters not marked</span>;
  return <span className="inline-flex items-center rounded bg-field-700 px-1.5 py-0.5 text-2xs font-medium text-chalk-400">No lineup yet</span>;
}

function Line({ l, crest, crestSeo, past }: { l: any; crest?: string | null; crestSeo?: string | null; past?: boolean }) {
  const href = useHref();
  const glyphs = [l.assists ? `${l.assists} A` : null, l.yc ? `${l.yc} YC` : null, l.rc ? `${l.rc} RC` : null, l.is_goalie && l.saves != null ? `${l.saves} SV` : null].filter(Boolean).join(', ');
  return (
    <li className="flex items-center gap-2 px-3 py-1.5 text-sm">
      <PlayerAvatar src={l.headshot_url} name={l.name} size={26} crest={crest} crestSeo={crestSeo} ring={past ? 'past' : undefined} />
      <span className="w-6 text-right text-xs text-chalk-500 tnum">{l.jersey ?? ''}</span>
      {l.player_id ? <Link to={href(`/players/${l.player_id}`)} className="min-w-0 flex-1 truncate font-medium text-chalk-100 hover:text-pitch-300">{l.name}</Link> : <span className="min-w-0 flex-1 truncate font-medium text-chalk-100">{l.name}</span>}
      {l.position && <span className="hidden text-2xs text-chalk-500 sm:inline">{l.position}</span>}
      {l.goals > 0 && <Goals n={l.goals} size={13} className="text-chalk-100" />}
      {glyphs && <span className="text-xs text-chalk-300 tnum">{glyphs}</span>}
      <span className="w-10 text-right text-xs text-chalk-500 tnum">{l.minutes != null ? `${l.minutes}′` : ''}</span>
    </li>
  );
}

export function LineupColumn({ title, side, benchOnly }: { title: string; side: SideLineup; benchOnly?: boolean }) {
  const { lineup, status, past, crest, crestSeo } = side;
  const head = <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-chalk-100">{title}<LineupChip status={status} past={past} /></h3>;
  if (!lineup) return <div className="space-y-2">{head}<EmptyState title="No lineup yet" body={status === 'none' ? 'Lineups arrive with the box score.' : ''} /></div>;
  const row = (l: any) => <Line key={`${l.jersey}-${l.name}`} l={l} crest={crest} crestSeo={crestSeo} past={status === 'past'} />;
  if (benchOnly) return (
    <div className="space-y-2">
      {head}
      <div className="frame divide-y divide-field-700">
        {status === 'no_starters'
          ? <div><div className="px-3 pt-2 text-2xs font-medium text-chalk-500">Played</div><ul>{lineup.subs.map(row)}</ul></div>
          : <div><div className="px-3 pt-2 text-2xs font-medium text-chalk-500">Substitutes used</div>{lineup.subs.length ? <ul>{lineup.subs.map(row)}</ul> : <p className="px-3 pb-2 text-sm text-chalk-500">None</p>}</div>}
        {lineup.dnp.length > 0 && <div><div className="px-3 pt-2 text-2xs font-medium text-chalk-500">Did not play</div><ul>{lineup.dnp.map(row)}</ul></div>}
      </div>
    </div>
  );
  const groups = POS_GROUPS.map(([label, re]) => ({ label, rows: lineup.starters.filter((l: any) => (l.is_goalie && label === 'Goalkeeper') || (!l.is_goalie && re.test(l.position ?? ''))) }));
  const placed = new Set(groups.flatMap((g) => g.rows));
  const rest = lineup.starters.filter((l: any) => !placed.has(l));
  return (
    <div className="space-y-2">
      {head}
      <div className="frame divide-y divide-field-700">
        {[...groups, { label: 'Starters', rows: rest }].filter((g) => g.rows.length).map((g) => (
          <div key={g.label}><div className="px-3 pt-2 text-2xs font-medium text-chalk-500">{g.label}</div><ul>{g.rows.map(row)}</ul></div>
        ))}
        {lineup.subs.length > 0 && <div><div className="px-3 pt-2 text-2xs font-medium text-chalk-500">{status === 'no_starters' ? 'Played' : 'Substitutes used'}</div><ul>{lineup.subs.map(row)}</ul></div>}
        {lineup.dnp.length > 0 && <div><div className="px-3 pt-2 text-2xs font-medium text-chalk-500">Did not play</div><ul>{lineup.dnp.map(row)}</ul></div>}
      </div>
    </div>
  );
}

/* ---------- stat bars ---------- */

const BAR_FIELDS: [string, string][] = [['shots', 'Shots'], ['shots_on_goal', 'On target'], ['corners', 'Corners'], ['fouls', 'Fouls'], ['offsides', 'Offsides'], ['saves', 'Saves'], ['yellow_cards', 'Yellow cards'], ['red_cards', 'Red cards']];

export function StatBars({ home, away, homeName, awayName }: { home: any | null; away: any | null; homeName: string | null; awayName: string | null }) {
  if (!home && !away) return <EmptyState title="No team stats for this match yet" />;
  return (
    <div className="frame divide-y divide-field-700">
      <div className="grid grid-cols-[1fr_auto_1fr] px-3 py-1.5 text-2xs text-chalk-500"><span>{homeName}</span><span /><span className="text-right">{awayName}</span></div>
      {BAR_FIELDS.map(([k, label]) => {
        const a = home?.[k] ?? null, b = away?.[k] ?? null; if (a == null && b == null) return null;
        const total = (a ?? 0) + (b ?? 0) || 1; const pa = Math.round(((a ?? 0) / total) * 100), pb = 100 - pa;
        return (
          <div key={k} className="px-3 py-2">
            <div className="grid grid-cols-[2.5rem_1fr_2.5rem] items-center gap-2 text-sm tnum">
              <span className={`text-left ${(a ?? 0) > (b ?? 0) ? 'font-semibold text-chalk-100' : 'text-chalk-300'}`}>{a ?? '–'}</span>
              <div className="flex items-center gap-1" aria-hidden><div className="flex h-2 flex-1 justify-end overflow-hidden rounded-l bg-field-700"><div className="h-2 bg-pitch-400" style={{ width: `${pa}%` }} /></div><div className="flex h-2 flex-1 overflow-hidden rounded-r bg-field-700"><div className="h-2 bg-chalk-300" style={{ width: `${pb}%` }} /></div></div>
              <span className={`text-right ${(b ?? 0) > (a ?? 0) ? 'font-semibold text-chalk-100' : 'text-chalk-300'}`}>{b ?? '–'}</span>
            </div>
            <div className="mt-0.5 text-center text-2xs text-chalk-500">{label}</div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- head to head ---------- */

export function HeadToHead({ g, h2h, sides }: { g: any; h2h: any; sides: any }) {
  const href = useHref();
  const h = sides.home, a = sides.away;
  const hn = g.home.short_name ?? g.home.name ?? 'Home', an = g.away.short_name ?? g.away.name ?? 'Away';
  const row = (label: string, hv: any, av: any) => <tr><td className="td num text-chalk-100">{hv ?? '–'}</td><th scope="row" className="td text-center font-normal text-chalk-500">{label}</th><td className="td text-left text-chalk-100 tnum">{av ?? '–'}</td></tr>;
  const rec = (r: { w: number; l: number; t: number }) => (r.w + r.l + r.t ? fmt.rec(r.w, r.l, r.t) : '–');
  const streakText = (st: any) => !st ? null : st.kind === 'drawn' ? `Last ${st.count} meetings drawn` : `${st.side === 'home' ? hn : an} ${st.kind === 'won' ? (st.count === 1 ? 'won the last meeting' : `won the last ${st.count}`) : `unbeaten in the last ${st.count}`}`;
  const total = h2h.home_wins + h2h.ties + h2h.away_wins;
  const pct = (n: number) => (total ? `${(n / total) * 100}%` : '0%');
  return (
    <div className="space-y-6">
      <section className="space-y-3" aria-labelledby="h2h-title">
        <h3 id="h2h-title" className="text-sm font-semibold text-chalk-100">Head-to-head{h2h.first_season ? <span className="font-normal text-chalk-500">, meetings since {h2h.first_season}</span> : null}</h3>
        {h2h.played ? (
          <>
            <div className="card space-y-4 p-4">
              <div className="grid grid-cols-3 items-end text-center">
                <div><div className="display text-3xl tnum text-chalk-100">{h2h.home_wins}</div><div className="text-xs text-chalk-400">{hn} wins</div></div>
                <div><div className="display text-3xl tnum text-chalk-300">{h2h.ties}</div><div className="text-xs text-chalk-400">ties</div></div>
                <div><div className="display text-3xl tnum text-chalk-100">{h2h.away_wins}</div><div className="text-xs text-chalk-400">{an} wins</div></div>
              </div>
              <div className="flex h-2 overflow-hidden rounded-full bg-field-800" role="img" aria-label={`${hn} ${h2h.home_wins} wins, ${h2h.ties} ties, ${an} ${h2h.away_wins} wins`}>
                <span className="bg-pitch-400" style={{ width: pct(h2h.home_wins) }} /><span className="bg-chalk-500" style={{ width: pct(h2h.ties) }} /><span className="bg-note" style={{ width: pct(h2h.away_wins) }} />
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
                <Stat label="Meetings" value={h2h.played} />
                <Stat label="Goals" value={`${h2h.home_goals}–${h2h.away_goals}`} sub={h2h.avg_goals != null ? `${h2h.avg_goals} a game` : undefined} />
                <Stat label="Clean sheets" value={`${h2h.home_clean_sheets}–${h2h.away_clean_sheets}`} sub={`${hn}–${an}`} />
                <Stat label="Last meeting" value={h2h.last_meeting ? fmt.date(h2h.last_meeting.game_date) : '–'} />
                <Stat label={`${hn} at home`} value={rec(h2h.at_home)} />
                <Stat label={`${hn} away`} value={rec(h2h.at_away)} sub={h2h.at_neutral && (h2h.at_neutral.w + h2h.at_neutral.l + h2h.at_neutral.t) ? `${rec(h2h.at_neutral)} neutral` : undefined} />
                <Stat label={`${hn}'s biggest win`} value={h2h.biggest_home_win ? h2h.biggest_home_win.score : '–'} sub={h2h.biggest_home_win ? fmt.date(h2h.biggest_home_win.game_date) : undefined} />
                <Stat label={`${an}'s biggest win`} value={h2h.biggest_away_win ? h2h.biggest_away_win.score : '–'} sub={h2h.biggest_away_win ? fmt.date(h2h.biggest_away_win.game_date) : undefined} />
              </dl>
              {streakText(h2h.streak) && <p className="border-t border-field-700 pt-3 text-sm text-chalk-300">{streakText(h2h.streak)}.</p>}
            </div>
            <h4 className="text-sm font-semibold text-chalk-100">Every meeting</h4>
            <ol className="frame divide-y divide-field-700">
              {h2h.games.map((m: any) => {
                const hw = m.home.score != null && m.away.score != null && m.home.score > m.away.score, aw = m.home.score != null && m.away.score != null && m.away.score > m.home.score;
                // Older seasons were stored from the scoreboard alone, without a conference flag: only say what is known.
                const comp = m.postseason ? 'Postseason' : m.tournament ?? (m.conference_game ? 'Conference' : m.season === g.season ? 'Non-conference' : `${m.season} season`);
                const sc = (m.scorers ?? []) as { program_id: string | null; name: string | null; minute: string | null }[];
                return (
                  <li key={m.id}>
                    <Link to={href(`/matches/${m.id}`)} className="grid gap-x-4 gap-y-1 px-3 py-2.5 hover:bg-field-800 sm:grid-cols-[8.5rem_minmax(0,1fr)_auto]">
                      <span className="text-sm text-chalk-300"><span className="font-medium text-chalk-100">{fmt.date(m.game_date)}</span><span className="block text-2xs text-chalk-500">{comp}{m.neutral_site ? ', neutral site' : ''}{m.venue?.city ? `, ${m.venue.city}` : ''}</span></span>
                      <span className="min-w-0 text-sm">
                        <span className="flex items-center gap-2"><TeamLogo src={m.home.logo} seo={m.home.seo} name={m.home.name} size={18} /><span className={`truncate ${hw ? 'font-semibold text-chalk-100' : 'text-chalk-300'}`}>{m.home.name}</span><span className="text-2xs text-chalk-500">home</span><span className={`ml-auto tnum ${hw ? 'font-semibold text-chalk-100' : 'text-chalk-300'}`}>{m.home.score ?? '–'}</span></span>
                        <span className="mt-0.5 flex items-center gap-2"><TeamLogo src={m.away.logo} seo={m.away.seo} name={m.away.name} size={18} /><span className={`truncate ${aw ? 'font-semibold text-chalk-100' : 'text-chalk-300'}`}>{m.away.name}</span><span className={`ml-auto tnum ${aw ? 'font-semibold text-chalk-100' : 'text-chalk-300'}`}>{m.away.score ?? '–'}</span></span>
                        {sc.length > 0 && (
                          <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-chalk-400">
                            {sc.map((x, i) => <span key={i} className="inline-flex items-center gap-1"><SoccerBall size={11} />{x.name ?? 'Unknown'}{x.minute ? ` ${x.minute}` : ''}<span className="text-chalk-500">({x.program_id === m.home.program_id ? (m.home.short_name ?? m.home.name) : (m.away.short_name ?? m.away.name)})</span></span>)}
                          </span>
                        )}
                      </span>
                      <span className="self-center justify-self-start sm:justify-self-end">{m.result && <ResultBadge result={m.result} us={m.home.program_id === g.home.program_id ? m.home.score : m.away.score} them={m.home.program_id === g.home.program_id ? m.away.score : m.home.score} />}<span className="sr-only"> for {hn}</span></span>
                    </Link>
                  </li>
                );
              })}
            </ol>
            {h2h.scorers_pending && <Note>Scorers for older meetings are being fetched from NCAA.com; they appear here within a few minutes.</Note>}
            <p className="text-xs text-chalk-500">Results shown for {hn}. Our records start in {h2h.first_season}; earlier meetings are not counted.</p>
          </>
        ) : <EmptyState title="First meeting in our records" body="Results go back to the 2024 season." />}
      </section>
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-chalk-100">This season, side by side</h3>
        <div className="overflow-x-auto"><table className="frame w-full border-separate border-spacing-0 text-sm"><caption className="sr-only">Season comparison</caption>
          <thead><tr><th scope="col" className="th text-right">{g.home.name}</th><th scope="col" className="th text-center"></th><th scope="col" className="th">{g.away.name}</th></tr></thead>
          <tbody>
            {row('Record', h?.stats ? fmt.rec(h.stats.w, h.stats.l, h.stats.t) : null, a?.stats ? fmt.rec(a.stats.w, a.stats.l, a.stats.t) : null)}
            {row('Form', h?.stats ? <FormPips form={h.stats.form.last5} size="sm" /> : null, a?.stats ? <FormPips form={a.stats.form.last5} size="sm" /> : null)}
            {row('Conference', h?.standing ? `${fmt.ordinal(h.standing.rank)}${h.standing.of ? ` of ${h.standing.of}` : ''}, ${fmt.rec(h.standing.conf_w, h.standing.conf_l, h.standing.conf_t)}` : null, a?.standing ? `${fmt.ordinal(a.standing.rank)}${a.standing.of ? ` of ${a.standing.of}` : ''}, ${fmt.rec(a.standing.conf_w, a.standing.conf_l, a.standing.conf_t)}` : null)}
            {row('Coaches poll', h?.poll ? `No. ${h.poll.rank}` : 'unranked', a?.poll ? `No. ${a.poll.rank}` : 'unranked')}
            {row('Points a game', h?.stats ? fmt.num(h.stats.ppg, 2) : null, a?.stats ? fmt.num(a.stats.ppg, 2) : null)}
            {row('Goals for a game', h?.stats ? fmt.num(h.stats.gf_pg, 2) : null, a?.stats ? fmt.num(a.stats.gf_pg, 2) : null)}
            {row('Goals against a game', h?.stats ? fmt.num(h.stats.ga_pg, 2) : null, a?.stats ? fmt.num(a.stats.ga_pg, 2) : null)}
            {row('Home record', h?.stats ? fmt.rec(h.stats.home_w, h.stats.home_l, h.stats.home_t) : null, a?.stats ? fmt.rec(a.stats.home_w, a.stats.home_l, a.stats.home_t) : null)}
            {row('Away record', h?.stats ? fmt.rec(h.stats.away_w, h.stats.away_l, h.stats.away_t) : null, a?.stats ? fmt.rec(a.stats.away_w, a.stats.away_l, a.stats.away_t) : null)}
            {row('Shots a game', h?.stats ? fmt.num(h.stats.shots_pg, 1) : null, a?.stats ? fmt.num(a.stats.shots_pg, 1) : null)}
            {row('Clean sheets', h?.stats?.clean_sheets, a?.stats?.clean_sheets)}
          </tbody>
        </table></div>
        <p className="text-xs text-chalk-500"><Link className="text-pitch-400 hover:text-pitch-300" to={href(`/teams/${g.home.program_id}`)}>{g.home.name}</Link> and <Link className="text-pitch-400 hover:text-pitch-300" to={href(`/teams/${g.away.program_id}`)}>{g.away.name}</Link> team pages have the full season.</p>
      </section>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return <div className="min-w-0"><dt className="truncate text-2xs text-chalk-500">{label}</dt><dd className="display text-lg tnum text-chalk-100">{value}</dd>{sub && <dd className="truncate text-2xs text-chalk-500">{sub}</dd>}</div>;
}

/* ---------- key players (preview) ---------- */

function PlayerCard({ p, line }: { p: any; line: string }) {
  const href = useHref();
  return (
    <li className="flex items-center gap-2 px-3 py-1.5 text-sm">
      <PlayerAvatar src={p.headshot_url} name={p.display_name} size={24} />
      <Link to={href(`/players/${p.player_id}`)} className="min-w-0 flex-1 truncate font-medium text-chalk-100 hover:text-pitch-300">{p.display_name}</Link>
      <span className="text-xs text-chalk-500">{p.position ?? ''}</span>
      <span className="text-xs text-chalk-300 tnum">{line}</span>
    </li>
  );
}

export function KeyPlayers({ g, sides }: { g: any; sides: any }) {
  const col = (side: 'home' | 'away') => {
    const s = sides[side]; const name = g[side].name;
    if (!s) return null;
    const { scorers, assists, keeper } = s.leaders;
    return (
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-chalk-100">{name}</h3>
        <div className="frame divide-y divide-field-700">
          {scorers.length > 0 && <div><div className="px-3 pt-2 text-2xs font-medium text-chalk-500">Scoring</div><ul>{scorers.map((p: any) => <PlayerCard key={p.player_id} p={p} line={`${p.goals ?? 0} G, ${p.assists ?? 0} A in ${p.gp ?? 0}`} />)}</ul></div>}
          {assists.length > 0 && <div><div className="px-3 pt-2 text-2xs font-medium text-chalk-500">Creating</div><ul>{assists.map((p: any) => <PlayerCard key={p.player_id} p={p} line={`${p.assists ?? 0} A`} />)}</ul></div>}
          {keeper && <div><div className="px-3 pt-2 text-2xs font-medium text-chalk-500">In goal</div><ul><PlayerCard p={keeper} line={`${fmt.pct(keeper.save_pct)} saves, ${fmt.num(keeper.gaa, 2)} GAA${keeper.shutouts ? `, ${keeper.shutouts} SHO` : ''}`} /></ul></div>}
          {!scorers.length && !assists.length && !keeper && <p className="px-3 py-3 text-sm text-chalk-500">No season stats yet.</p>}
        </div>
      </div>
    );
  };
  return <div className="grid gap-6 lg:grid-cols-2">{col('home')}{col('away')}</div>;
}

export function ResultLine({ g }: { g: any }) {
  const r = g.home.score == null || g.away.score == null ? null : g.home.score > g.away.score ? 'W' : g.home.score < g.away.score ? 'L' : 'T';
  return <ResultBadge result={r} us={g.home.score} them={g.away.score} ot={g.overtime} pk={g.shootout} forfeit={g.forfeit} />;
}
