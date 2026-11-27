// The teams and players a reader follows (the star on their pages; kept in this browser, no account). On the home
// page: a strip of tiles, each with what is next or what just happened. On /following: the full list and how to add.
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Star, X } from 'lucide-react';
import { api } from '../../lib/api';
import { keyOf, unfollow, useFollows, type Follow } from '../../lib/follows';
import { PlayerAvatar, Skeleton, TeamLogo } from '../../components/primitives';

interface Game { id: string; date: string; status: string; home: boolean; opponent: string | null; us: number | null; them: number | null; to: string }
export interface FollowItem { kind: Follow['kind']; id: string; last: Game | null; next: Game | null; line: { game: Game; minutes: number | null; goals: number; assists: number; saves: number | null; started: boolean | null; rating?: number | null } | null }

const day = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const vs = (g: Game) => `${g.home ? 'v' : 'at'} ${g.opponent ?? 'opponent'}`;
const result = (g: Game) => (g.us == null || g.them == null ? '' : g.us > g.them ? 'W' : g.us < g.them ? 'L' : 'D');
const tone = (r: string) => (r === 'W' ? 'text-win' : r === 'L' ? 'text-loss' : 'text-draw');
const isTeam = (f: Follow) => f.kind === 'team' || f.kind === 'pro-team';

export function useFollowItems() {
  const list = useFollows();
  const f = list.map(keyOf).join(',');
  const q = useQuery({ queryKey: ['follows', f], queryFn: () => api<{ items: FollowItem[] }>(`/api/follows?f=${encodeURIComponent(f)}`), enabled: list.length > 0, staleTime: 60_000 });
  return { list, loading: q.isPending && list.length > 0, items: new Map((q.data?.items ?? []).map((i) => [`${i.kind}:${i.id}`, i])) };
}

function lineText(l: NonNullable<FollowItem['line']>): string {
  const did = [l.goals ? `${l.goals} G` : null, l.assists ? `${l.assists} A` : null, l.saves ? `${l.saves} saves` : null].filter(Boolean).join(', ');
  return [did || (l.started ? 'Started' : 'Played'), l.minutes != null ? `${l.minutes} min` : null].filter(Boolean).join(', ');
}

const Face = ({ f, size }: { f: Follow; size: number }) => (isTeam(f) ? <TeamLogo src={f.image} name={f.name} size={size} /> : <PlayerAvatar src={f.image} name={f.name} size={size} />);

/** What matters now for one followed thing: the next match if there is one, else the last result or the player's line. */
function Now({ f, item }: { f: Follow; item: FollowItem | undefined }) {
  if (!item) return <span className="text-chalk-500">No matches yet</span>;
  if (!isTeam(f)) return item.line ? <span className="text-chalk-300">{lineText(item.line)}<span className="text-chalk-500"> {vs(item.line.game)}</span></span> : <span className="text-chalk-500">No recent match</span>;
  if (item.next) return <span className="text-chalk-300">{vs(item.next)}<span className="text-chalk-500">, {day(item.next.date)}</span></span>;
  if (item.last) return <span className="text-chalk-300"><span className={`font-semibold ${tone(result(item.last))}`}>{result(item.last)}</span> <span className="tnum">{item.last.us}-{item.last.them}</span> {vs(item.last)}</span>;
  return <span className="text-chalk-500">Nothing scheduled</span>;
}

/** Home: a strip that scrolls sideways on phones. Nothing followed: one quiet line saying how. */
export function MyTeamsStrip() {
  const { list, items, loading } = useFollowItems();
  if (!list.length) {
    return <Link to="/following" className="flex items-center gap-2 text-sm text-chalk-400 hover:text-chalk-100"><Star size={15} aria-hidden className="text-pitch-400" />Follow teams and players to see them here first</Link>;
  }
  return (
    <section aria-labelledby="my-teams" className="lg:hidden">
      <div className="mb-2 flex items-baseline justify-between"><h2 id="my-teams" className="h-section">My teams</h2><Link to="/following" className="text-sm font-medium text-pitch-400 hover:text-pitch-300">Edit</Link></div>
      <ul className="bleed flex gap-2 overflow-x-auto px-3.5 pb-1 [scrollbar-width:none] sm:px-0">
        {list.map((f) => { const it = items.get(keyOf(f)); const to = (isTeam(f) ? it?.next?.to ?? it?.last?.to : it?.line?.game.to) ?? f.href; return (
          <li key={keyOf(f)} className="w-44 shrink-0">
            <Link to={to} className="card block p-2.5 text-xs hover:bg-field-800">
              <span className="flex items-center gap-2 text-sm font-semibold text-chalk-100"><Face f={f} size={22} /><span className="truncate">{f.name}</span></span>
              <span className="mt-1.5 block truncate">{loading ? <Skeleton className="h-4 w-28" /> : <Now f={f} item={it} />}</span>
            </Link>
          </li>
        ); })}
      </ul>
    </section>
  );
}

/** The list form: the desktop rail on the home page and the /following page. */
export function MyTeamsList({ edit }: { edit?: boolean }) {
  const { list, items, loading } = useFollowItems();
  if (!list.length) return null;
  return (
    <ul className="rows">
      {list.map((f) => (
        <li key={keyOf(f)} className="flex items-center gap-2.5 py-2">
          <Face f={f} size={edit ? 32 : 24} />
          <span className="min-w-0 flex-1 text-sm">
            <Link to={f.href} className="block truncate font-medium text-chalk-100 hover:text-pitch-300">{f.name}</Link>
            <span className="block truncate text-xs">{loading ? <Skeleton className="h-3 w-24" /> : <Now f={f} item={items.get(keyOf(f))} />}</span>
          </span>
          {edit && <button type="button" onClick={() => unfollow(f)} aria-label={`Stop following ${f.name}`} title="Stop following" className="btn-quiet btn-icon shrink-0"><X size={16} aria-hidden /></button>}
        </li>
      ))}
    </ul>
  );
}
