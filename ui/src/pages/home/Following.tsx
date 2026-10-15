// Home, first thing for a returning visitor: the teams and players they follow (the star on those pages; kept in
// their browser), each with its last result and next match or the player's latest line. Absent when nothing is
// followed, so a first visit looks the same as before.
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { api } from '../../lib/api';
import { keyOf, unfollow, useFollows, type Follow } from '../../lib/follows';
import { PlayerAvatar, Skeleton, TeamLogo } from '../../components/primitives';
import { Panel } from './Panel';

interface Game { id: string; date: string; status: string; home: boolean; opponent: string | null; us: number | null; them: number | null; to: string }
interface Item { kind: Follow['kind']; id: string; last: Game | null; next: Game | null; line: { game: Game; minutes: number | null; goals: number; assists: number; saves: number | null; started: boolean | null; rating?: number | null } | null }

const day = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const vs = (g: Game) => `${g.home ? 'v' : 'at'} ${g.opponent ?? 'opponent'}`;
const result = (g: Game) => (g.us == null || g.them == null ? '' : g.us > g.them ? 'W' : g.us < g.them ? 'L' : 'D');
const tone = (r: string) => (r === 'W' ? 'text-win' : r === 'L' ? 'text-loss' : 'text-draw');

function lineText(l: NonNullable<Item['line']>, college: boolean): string {
  const bits = [l.goals ? `${l.goals} goal${l.goals > 1 ? 's' : ''}` : null, l.assists ? `${l.assists} assist${l.assists > 1 ? 's' : ''}` : null, l.saves ? `${l.saves} save${l.saves > 1 ? 's' : ''}` : null];
  const did = bits.filter(Boolean).join(', ');
  return [did || (l.started ? 'Started' : 'Played'), l.minutes != null ? `${l.minutes} min` : null, !college && l.rating != null ? `rated ${l.rating.toFixed(1)}` : null].filter(Boolean).join(', ');
}

function Row({ f, item, loading }: { f: Follow; item: Item | undefined; loading: boolean }) {
  const team = f.kind === 'team' || f.kind === 'pro-team';
  const last = item?.last, next = item?.next, line = item?.line;
  return (
    <li className="group relative flex min-w-0 items-start gap-3 rounded-lg bg-field-950/40 p-3">
      {team ? <TeamLogo src={f.image} name={f.name} size={36} /> : <PlayerAvatar src={f.image} name={f.name} size={36} />}
      <div className="min-w-0 flex-1 space-y-1 text-sm">
        <Link to={f.href} className="block truncate pr-7 font-semibold text-chalk-100 hover:text-pitch-300">{f.name}</Link>
        {loading ? <Skeleton lines={2} /> : team ? (
          <>
            {last ? <Link to={last.to} className="flex gap-1.5 text-chalk-300 hover:text-chalk-100"><span className={`w-3 shrink-0 font-semibold ${tone(result(last))}`}>{result(last)}</span><span className="truncate tnum">{last.us}-{last.them} {vs(last)}, {day(last.date)}</span></Link> : <p className="text-chalk-500">No recent result</p>}
            {next ? <Link to={next.to} className="block truncate text-chalk-400 hover:text-chalk-100">Next: {vs(next)}, {day(next.date)}</Link> : <p className="text-chalk-500">Nothing scheduled</p>}
          </>
        ) : line ? (
          <Link to={line.game.to} className="block text-chalk-300 hover:text-chalk-100">
            <span className="block truncate">{lineText(line, f.kind === 'player')}</span>
            <span className="block truncate text-chalk-400">{vs(line.game)}, {day(line.game.date)}{result(line.game) ? `, ${result(line.game)} ${line.game.us}-${line.game.them}` : ''}</span>
          </Link>
        ) : <p className="text-chalk-500">No recent match</p>}
      </div>
      <button type="button" onClick={() => unfollow(f)} aria-label={`Stop following ${f.name}`} title="Stop following"
        className="absolute right-1.5 top-1.5 grid h-8 w-8 place-items-center rounded-md text-chalk-500 hover:bg-field-800 hover:text-chalk-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-pitch-400">
        <X size={14} aria-hidden />
      </button>
    </li>
  );
}

export function FollowingPanel() {
  const list = useFollows();
  const f = list.map(keyOf).join(',');
  const q = useQuery({ queryKey: ['follows', f], queryFn: () => api<{ items: Item[] }>(`/api/follows?f=${encodeURIComponent(f)}`), enabled: list.length > 0, staleTime: 60_000 });
  if (!list.length) return null;
  const items = new Map((q.data?.items ?? []).map((i) => [`${i.kind}:${i.id}`, i]));
  return (
    <Panel title="Following" meta="Teams and players you starred. Kept in this browser.">
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((x) => <Row key={keyOf(x)} f={x} item={items.get(keyOf(x))} loading={q.isPending} />)}
      </ul>
    </Panel>
  );
}
