// Results and fixtures: a list on phones, a sortable table with match stats on wider screens.
import { Link } from 'react-router-dom';
import { fmt, useAdmin } from '../../lib/api';
import { DataTable, type Column } from '../../components/DataTable';
import { Badge, EmptyState, ResultBadge, SourceBadge, TeamLogo } from '../../components/primitives';
import { sideOf } from './Masthead';

export function GamesList({ games, id, loading, href }: { games: any[]; id: string; loading: boolean; href: (p: string) => string }) {
  const admin = useAdmin();
  const stat = (g: any, k: string) => g.team_stats?.find((t: any) => t.program_id === id && t.source === g.source_of_truth)?.[k];
  const sorted = [...games].sort((a, b) => String(a.game_date).localeCompare(String(b.game_date)));
  const cols: Column<any>[] = [
    { key: 'game_date', label: 'Date', primary: true, render: (g) => fmt.weekday(g.game_date) },
    { key: 'opp', label: 'Opponent', value: (g) => sideOf(g, id).opp, render: (g) => { const s = sideOf(g, id); return <span className="flex items-center gap-2"><TeamLogo src={s.oppLogo} name={s.opp} size={20} /><span className="text-chalk-500">{s.where}</span> {s.oppId ? <Link className="hover:text-pitch-300" to={href(`/teams/${s.oppId}`)}>{s.opp ?? 'TBD'}</Link> : (s.opp ?? 'TBD')}</span>; } },
    { key: 'result', label: 'Result', value: (g) => { const s = sideOf(g, id); return s.result ? (s.us ?? 0) - (s.them ?? 0) : null; }, render: (g) => { const s = sideOf(g, id); return s.result ? <ResultBadge result={s.result} us={s.us} them={s.them} ot={g.overtime} pk={g.shootout} /> : <Badge>{g.status === 'scheduled' ? 'upcoming' : g.status}</Badge>; } },
    { key: 'conference_game', label: 'Conf', title: 'Conference game', value: (g) => (g.conference_game ? 1 : 0), render: (g) => (g.conference_game ? 'Conf' : '') },
    { key: 'venue', label: 'Venue', priority: 2, wrap: true, value: (g) => g.venue_name ? `${g.venue_name}${g.venue_city ? `, ${g.venue_city}` : ''}` : '' },
    { key: 'attendance', label: 'Att', title: 'Attendance', num: true, priority: 2 },
    { key: 'sh', label: 'Sh', title: 'Shots', num: true, priority: 2, value: (g) => stat(g, 'shots') },
    { key: 'sog', label: 'SOG', title: 'Shots on goal', num: true, priority: 2, value: (g) => stat(g, 'shots_on_goal') },
    { key: 'ck', label: 'CK', title: 'Corners', num: true, priority: 2, value: (g) => stat(g, 'corners') },
    { key: 'fo', label: 'Fouls', num: true, priority: 2, value: (g) => stat(g, 'fouls') },
  ];
  if (admin) cols.push(
    { key: 'truth', label: 'Source', priority: 3, value: (g) => g.source_of_truth, render: (g) => <SourceBadge source={g.source_of_truth} /> },
    { key: 'sources', label: 'Have', priority: 3, render: (g) => <span className="flex gap-1">{g.team_stats?.some((t: any) => t.source === 'site') && <Badge tone="teal">site</Badge>}{g.team_stats?.some((t: any) => t.source === 'ncaa') && <Badge tone="blue">ncaa</Badge>}</span> },
  );
  if (!loading && !games.length) return <EmptyState title="No games yet" body="The schedule has not been collected, or the season has not started." />;
  return (
    <>
      <ol className="frame divide-y divide-field-700 md:hidden" aria-label="Games">
        {loading && [0, 1, 2, 3].map((i) => <li key={i} className="p-3"><span className="skeleton block h-10" /></li>)}
        {sorted.map((g) => {
          const s = sideOf(g, id);
          return (
            <li key={g.id}>
              <Link to={href(`/games/${g.id}`)} className="flex items-center gap-3 p-3 hover:bg-field-800">
                <span className="w-16 shrink-0 text-xs text-chalk-500">{fmt.day(g.game_date)}</span>
                <TeamLogo src={s.oppLogo} name={s.opp} size={24} />
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-chalk-100">{s.where} {s.opp ?? 'TBD'}</span><span className="block truncate text-xs text-chalk-500">{g.conference_game ? 'Conference' : g.neutral_site ? 'Neutral site' : s.home ? 'Home' : 'Away'}{g.venue_name ? `, ${g.venue_name}` : ''}</span></span>
                {s.result ? <ResultBadge result={s.result} us={s.us} them={s.them} ot={g.overtime} pk={g.shootout} /> : <Badge>{g.status === 'scheduled' ? 'upcoming' : g.status}</Badge>}
              </Link>
            </li>
          );
        })}
      </ol>
      <div className="hidden md:block">
        <DataTable rows={sorted} columns={cols} rowKey={(g) => g.id} caption="Games" rowHref={(g) => href(`/games/${g.id}`)} loading={loading} dense defaultSort={{ key: 'game_date', dir: 'asc' }} />
      </div>
    </>
  );
}
