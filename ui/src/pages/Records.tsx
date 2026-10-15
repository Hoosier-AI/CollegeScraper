// College records and streaks (/records): runs still going (teams unbeaten, winning, keeping clean sheets, scoring;
// players scoring or getting a point in consecutive games they played) and the season's best single games, for a
// gender and division.
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, fmt, qs } from '../lib/api';
import { genderLabel, useFilters, useHref } from '../lib/filters';
import { useUrlState } from '../lib/urlState';
import { EmptyState, ErrorBox, Field, PageHeader, SegmentedControl, Skeleton, TeamLogo } from '../components/primitives';
import { RatingBadge } from '../components/Rating';

interface Prog { id: string; name: string; short_name: string | null; seo: string | null; logo: string | null }
interface TeamRun { program_id: string; unbeaten: number; winning: number; clean: number; scoring: number; last: string }
interface PlayerRun { player_id: string; name: string; program_id: string; goals: number; points: number; last: string }
interface Game { player_id: string | null; name: string; program_id: string; opponent_id: string | null; game_id: string; game_date: string; goals: number; assists: number; saves: number | null; rating: number }
interface Data { played: number; team: Record<'unbeaten' | 'winning' | 'clean' | 'scoring', TeamRun[]>; player: Record<'goals' | 'points', PlayerRun[]>; games: Record<'goals' | 'points' | 'saves' | 'rating', Game[]>; programs: Record<string, Prog> }

const DIV_OPTIONS = [{ value: 'd1', label: 'D1' }, { value: 'd2', label: 'D2' }, { value: 'd3', label: 'D3' }];

function Card({ title, sub, children, empty }: { title: string; sub?: string; children: React.ReactNode; empty: boolean }) {
  return (
    <section className="frame min-w-0 bg-field-900/60">
      <header className="border-b border-field-700/70 px-3 py-2"><h2 className="text-sm font-semibold text-chalk-100">{title}</h2>{sub && <p className="text-2xs text-chalk-500">{sub}</p>}</header>
      {empty ? <p className="px-3 py-4 text-sm text-chalk-500">Nothing yet.</p> : <ol className="divide-y divide-field-800 text-sm">{children}</ol>}
    </section>
  );
}

export default function Records() {
  const f = useFilters();
  const href = useHref();
  const [division, setDivision] = useUrlState('division', 'd1', { allow: ['d1', 'd2', 'd3'] });
  const q = useQuery({ queryKey: ['records', f.season, f.gender, division], queryFn: () => api<Data>(`/api/records${qs({ season: f.season, gender: f.gender, division })}`), placeholderData: keepPreviousData });
  const d = q.data;
  const prog = (id: string | null) => (id ? d?.programs[id] ?? null : null);
  const team = (id: string, right: React.ReactNode, sub?: string) => {
    const p = prog(id);
    return (
      <li key={id}><Link to={href(`/teams/${id}`)} className="flex items-center gap-2.5 px-3 py-2 hover:bg-field-800">
        <TeamLogo src={p?.logo} seo={p?.seo} name={p?.name} size={20} />
        <span className="min-w-0 flex-1"><span className="block truncate font-medium text-chalk-100">{p?.name ?? '?'}</span>{sub && <span className="block text-2xs text-chalk-500">{sub}</span>}</span>
        {right}
      </Link></li>
    );
  };
  const count = (n: number, word: string) => <span className="text-right"><span className="display text-lg text-chalk-100 tnum">{n}</span><span className="ml-1 text-2xs text-chalk-500">{word}</span></span>;
  const player = (x: { player_id: string | null; name: string; program_id: string }, right: React.ReactNode, sub: string, key: string, to?: string) => (
    <li key={key}><Link to={to ?? (x.player_id ? href(`/players/${x.player_id}`) : href(`/teams/${x.program_id}`))} className="flex items-center gap-2.5 px-3 py-2 hover:bg-field-800">
      <TeamLogo src={prog(x.program_id)?.logo} seo={prog(x.program_id)?.seo} name={prog(x.program_id)?.name} size={20} />
      <span className="min-w-0 flex-1"><span className="block truncate font-medium text-chalk-100">{x.name}</span><span className="block truncate text-2xs text-chalk-500">{sub}</span></span>
      {right}
    </Link></li>
  );
  const gameSub = (g: Game) => `${prog(g.program_id)?.short_name ?? prog(g.program_id)?.name ?? ''}${g.opponent_id ? ` vs ${prog(g.opponent_id)?.short_name ?? prog(g.opponent_id)?.name ?? '?'}` : ''}, ${fmt.day(g.game_date)}`;
  return (
    <div className="space-y-4">
      <PageHeader title="Records and streaks" meta={`${division.toUpperCase()} ${genderLabel(f.gender)}, ${f.season}: runs still going and the season's best single games${d ? `, from ${fmt.num(d.played)} games` : ''}.`}>
        <Field label="Division">{() => <SegmentedControl label="Division" size="sm" value={division} onChange={setDivision} options={DIV_OPTIONS} />}</Field>
      </PageHeader>
      {q.error && <ErrorBox error={q.error} retry={() => q.refetch()} />}
      {q.isPending && <Skeleton className="h-96" />}
      {d && !d.played && <EmptyState title="No games yet" body="Records appear once the season's first games are played." />}
      {d && d.played > 0 && (
        <div className={`space-y-6 ${q.isPlaceholderData ? 'opacity-60 transition-opacity duration-150' : ''}`}>
          <section className="space-y-2">
            <h2 className="text-base font-semibold text-chalk-100">Team runs still going</h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              <Card title="Unbeaten" sub="Games without a loss" empty={!d.team.unbeaten.length}>{d.team.unbeaten.map((t) => team(t.program_id, count(t.unbeaten, 'games')))}</Card>
              <Card title="Winning" sub="Wins in a row" empty={!d.team.winning.length}>{d.team.winning.map((t) => team(t.program_id, count(t.winning, 'wins')))}</Card>
              <Card title="Clean sheets" sub="Games in a row without conceding" empty={!d.team.clean.length}>{d.team.clean.map((t) => team(t.program_id, count(t.clean, 'games')))}</Card>
              <Card title="Scoring" sub="Games in a row with a goal" empty={!d.team.scoring.length}>{d.team.scoring.map((t) => team(t.program_id, count(t.scoring, 'games')))}</Card>
            </div>
          </section>
          <section className="space-y-2">
            <h2 className="text-base font-semibold text-chalk-100">Player runs still going</h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Card title="Scoring streak" sub="Games played in a row with a goal" empty={!d.player.goals.length}>{d.player.goals.map((p) => player(p, count(p.goals, 'games'), `${prog(p.program_id)?.name ?? ''}, last ${fmt.day(p.last)}`, p.player_id))}</Card>
              <Card title="Point streak" sub="Games played in a row with a goal or an assist" empty={!d.player.points.length}>{d.player.points.map((p) => player(p, count(p.points, 'games'), `${prog(p.program_id)?.name ?? ''}, last ${fmt.day(p.last)}`, p.player_id))}</Card>
            </div>
          </section>
          <section className="space-y-2">
            <h2 className="text-base font-semibold text-chalk-100">Best single games this season</h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              <Card title="Most goals" sub="Three or more in a game" empty={!d.games.goals.length}>{d.games.goals.map((g) => player(g, count(g.goals, 'goals'), gameSub(g), `${g.game_id}-${g.player_id}-${g.name}`, href(`/matches/${g.game_id}`)))}</Card>
              <Card title="Most points" sub="Goals count two, assists one" empty={!d.games.points.length}>{d.games.points.map((g) => player(g, count(g.goals * 2 + g.assists, 'pts'), `${g.goals}G ${g.assists}A, ${gameSub(g)}`, `${g.game_id}-${g.player_id}-${g.name}`, href(`/matches/${g.game_id}`)))}</Card>
              <Card title="Most saves" sub="Ten or more in a game" empty={!d.games.saves.length}>{d.games.saves.map((g) => player(g, count(g.saves ?? 0, 'saves'), gameSub(g), `${g.game_id}-${g.player_id}-${g.name}`, href(`/matches/${g.game_id}`)))}</Card>
              <Card title="Highest ratings" sub="Plaibook match rating, 9 or more" empty={!d.games.rating.length}>{d.games.rating.map((g) => player(g, <RatingBadge v={g.rating} />, gameSub(g), `${g.game_id}-${g.player_id}-${g.name}`, href(`/matches/${g.game_id}`)))}</Card>
            </div>
          </section>
          <p className="text-xs text-chalk-500">From every finished game and box score we hold this season. A player's streak counts the games they played; a game without a box score breaks nothing and adds nothing.</p>
        </div>
      )}
    </div>
  );
}
