// Pieces of the match page: masthead, timeline, lineups, stat bars, head-to-head and the pre-match preview.
import { Link } from 'react-router-dom';
import { ArrowDownCircle, ArrowUpCircle, CircleDot, Hand, Square } from 'lucide-react';
import { fmt } from '../../lib/api';
import { useHref } from '../../lib/filters';
import { PlayerAvatar, Badge, EmptyState, FormPips, ResultBadge, TeamLogo } from '../primitives';
import { liveMinute, MatchRow, type MatchLike } from './MatchRow';

/* ---------- masthead ---------- */

export function MatchMasthead({ g, sides }: { g: any; sides?: any }) {
  const href = useHref();
  const live = g.status === 'live', final = g.status === 'final';
  const statusLine = live ? liveMinute(g.live ?? { period: g.live_period, clock: g.live_clock }) : final ? (g.forfeit ? 'Final, forfeit' : g.shootout ? 'Final, penalties' : g.overtime ? 'Final, overtime' : 'Final') : g.status === 'scheduled' ? (fmt.kickoff(g.start_epoch) ? `${fmt.weekday(g.game_date)}, ${fmt.kickoff(g.start_epoch)}` : fmt.weekday(g.game_date)) : g.status;
  const team = (side: 'home' | 'away') => {
    const s = g[side]; const info = sides?.[side];
    return (
      <div className={`flex min-w-0 flex-col items-center gap-2 text-center ${side === 'home' ? 'sm:items-start sm:text-left' : 'sm:items-end sm:text-right'}`}>
        <TeamLogo src={s.logo} seo={s.seo} name={s.name} size={64} />
        <div className="min-w-0">
          {s.program_id ? <Link to={href(`/teams/${s.program_id}`)} className="display block text-xl leading-tight hover:text-pitch-300 sm:text-2xl">{s.name ?? 'TBD'}</Link> : <span className="display block text-xl sm:text-2xl">{s.name ?? 'TBD'}</span>}
          <div className="mt-1 text-xs text-chalk-400 tnum">
            {s.rank && <span className="mr-2 text-note">No. {s.rank}</span>}
            {info?.stats && <span>{fmt.rec(info.stats.w, info.stats.l, info.stats.t)}</span>}
            {info?.standing?.rank && info.stats && <span>, {fmt.ordinal(info.standing.rank)}{info.standing.of ? ` of ${info.standing.of}` : ''} in the {s.conference?.short ?? s.conference?.name ?? 'conference'}</span>}
          </div>
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
      <p className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-chalk-400 sm:justify-start">
        <span>{fmt.weekday(g.game_date)}{g.start_epoch ? `, ${fmt.kickoffEt(g.start_epoch)}` : ''}</span>
        {g.venue?.name && <span>{g.venue.name}{g.venue.city ? `, ${g.venue.city}` : ''}</span>}
        {g.neutral_site && <Badge>Neutral site</Badge>}{g.conference_game && <Badge>Conference</Badge>}{g.tournament && <Badge tone="teal">{g.tournament}</Badge>}{g.postseason && <Badge tone="teal">Postseason</Badge>}
      </p>
    </header>
  );
}

/* ---------- timeline ---------- */

const EV: Record<string, { icon: JSX.Element; label: string; cls?: string }> = {
  goal: { icon: <CircleDot size={14} />, label: 'Goal', cls: 'text-win' }, pk: { icon: <CircleDot size={14} />, label: 'Penalty', cls: 'text-win' },
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
        const who = <span className="text-sm"><span className="font-medium text-chalk-100">{e.player_name_raw ?? ''}</span>{e.assist_name_raw && <span className="text-chalk-400"> (assist {e.assist_name_raw})</span>}{e.event_type === 'goal' && e.home_score != null && <span className="ml-2 text-chalk-500 tnum">{e.home_score}–{e.away_score}</span>}</span>;
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

/* ---------- lineups ---------- */

const POS_GROUPS: [string, RegExp][] = [['Goalkeeper', /^(GK|G)$/i], ['Defenders', /^(D|DEF|CB|LB|RB)$/i], ['Midfielders', /^(M|MF|MID|CM|DM|AM)$/i], ['Forwards', /^(F|FW|FWD|ST|W)$/i]];

function Line({ l }: { l: any }) {
  const href = useHref();
  const glyphs = [l.goals ? `${l.goals} G` : null, l.assists ? `${l.assists} A` : null, l.yc ? `${l.yc} YC` : null, l.rc ? `${l.rc} RC` : null, l.is_goalie && l.saves != null ? `${l.saves} SV` : null].filter(Boolean).join(', ');
  return (
    <li className="flex items-center gap-2 px-3 py-1.5 text-sm">
      <span className="w-6 text-right text-xs text-chalk-500 tnum">{l.jersey ?? ''}</span>
      {l.player_id ? <Link to={href(`/players/${l.player_id}`)} className="min-w-0 flex-1 truncate font-medium text-chalk-100 hover:text-pitch-300">{l.name}</Link> : <span className="min-w-0 flex-1 truncate font-medium text-chalk-100">{l.name}</span>}
      {glyphs && <span className="text-xs text-chalk-300 tnum">{glyphs}</span>}
      <span className="w-10 text-right text-xs text-chalk-500 tnum">{l.minutes != null ? `${l.minutes}′` : ''}</span>
    </li>
  );
}

export function LineupColumn({ title, lineup, note, benchOnly }: { title: string; lineup: any; note?: string; benchOnly?: boolean }) {
  if (!lineup) return <div className="space-y-2"><h3 className="text-sm font-semibold text-chalk-100">{title}</h3><EmptyState title="No lineup yet" body="Lineups arrive with the box score." /></div>;
  if (benchOnly) return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-chalk-100">{title}{note && <span className="ml-2 text-xs font-normal text-chalk-500">{note}</span>}</h3>
      <div className="frame divide-y divide-field-700">
        <div><div className="px-3 pt-2 text-2xs font-medium text-chalk-500">Substitutes used</div>{lineup.subs.length ? <ul>{lineup.subs.map((l: any) => <Line key={`${l.jersey}-${l.name}`} l={l} />)}</ul> : <p className="px-3 pb-2 text-sm text-chalk-500">None</p>}</div>
        {lineup.dnp.length > 0 && <div><div className="px-3 pt-2 text-2xs font-medium text-chalk-500">Did not play</div><ul>{lineup.dnp.map((l: any) => <Line key={`${l.jersey}-${l.name}`} l={l} />)}</ul></div>}
      </div>
    </div>
  );
  const groups = POS_GROUPS.map(([label, re]) => ({ label, rows: lineup.starters.filter((l: any) => (l.is_goalie && label === 'Goalkeeper') || (!l.is_goalie && re.test(l.position ?? ''))) }));
  const placed = new Set(groups.flatMap((g) => g.rows));
  const rest = lineup.starters.filter((l: any) => !placed.has(l));
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-chalk-100">{title}{note && <span className="ml-2 text-xs font-normal text-chalk-500">{note}</span>}</h3>
      <div className="frame divide-y divide-field-700">
        {[...groups, { label: 'Starters', rows: rest }].filter((g) => g.rows.length).map((g) => (
          <div key={g.label}><div className="px-3 pt-2 text-2xs font-medium text-chalk-500">{g.label}</div><ul>{g.rows.map((l: any) => <Line key={`${l.jersey}-${l.name}`} l={l} />)}</ul></div>
        ))}
        {lineup.subs.length > 0 && <div><div className="px-3 pt-2 text-2xs font-medium text-chalk-500">Substitutes used</div><ul>{lineup.subs.map((l: any) => <Line key={`${l.jersey}-${l.name}`} l={l} />)}</ul></div>}
        {lineup.dnp.length > 0 && <div><div className="px-3 pt-2 text-2xs font-medium text-chalk-500">Did not play</div><ul>{lineup.dnp.map((l: any) => <Line key={`${l.jersey}-${l.name}`} l={l} />)}</ul></div>}
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
  const row = (label: string, hv: any, av: any) => <tr><td className="td num text-chalk-100">{hv ?? '–'}</td><th scope="row" className="td text-center font-normal text-chalk-500">{label}</th><td className="td text-left text-chalk-100 tnum">{av ?? '–'}</td></tr>;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-chalk-100">Previous meetings</h3>
        {h2h.played ? (
          <>
            <div className="flex items-center justify-around rounded-lg border border-field-700 p-3 text-center">
              <div><div className="display text-2xl tnum">{h2h.home_wins}</div><div className="text-2xs text-chalk-500">{g.home.name} wins</div></div>
              <div><div className="display text-2xl tnum text-chalk-300">{h2h.ties}</div><div className="text-2xs text-chalk-500">ties</div></div>
              <div><div className="display text-2xl tnum">{h2h.away_wins}</div><div className="text-2xs text-chalk-500">{g.away.name} wins</div></div>
              <div><div className="display text-2xl tnum text-chalk-300">{h2h.home_goals}–{h2h.away_goals}</div><div className="text-2xs text-chalk-500">goals</div></div>
            </div>
            <div className="frame divide-y divide-field-700">{h2h.games.map((m: MatchLike) => <MatchRow key={m.id} g={m} showDate dense />)}</div>
          </>
        ) : <EmptyState title="First meeting in our records" body="Only seasons we hold are counted." />}
      </section>
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-chalk-100">This season, side by side</h3>
        <table className="frame w-full border-separate border-spacing-0 text-sm"><caption className="sr-only">Season comparison</caption>
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
        </table>
        <p className="text-xs text-chalk-500"><Link className="text-pitch-400 hover:text-pitch-300" to={href(`/teams/${g.home.program_id}`)}>{g.home.name}</Link> and <Link className="text-pitch-400 hover:text-pitch-300" to={href(`/teams/${g.away.program_id}`)}>{g.away.name}</Link> team pages have the full season.</p>
      </section>
    </div>
  );
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
