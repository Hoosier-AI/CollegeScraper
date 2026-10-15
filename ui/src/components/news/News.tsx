// News lists: a story is its headline (to the publisher, new tab), the picture the publisher's feed supplies (loaded
// from the publisher, hidden when there is none or it fails), the outlet and time, our tags, the teams and players it
// is about (to our pages), and how many outlets ran it. Used on the News pages, team, player, league and country
// pages, and the match previews (Team news).
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Newspaper } from 'lucide-react';
import { fmt } from '../../lib/api';
import { KIND_LABEL, TEAM_NEWS_KINDS, useNews, type NewsKind, type NewsQuery, type Story } from '../../lib/news';
import { Badge, EmptyState, ErrorBox, Skeleton, RailCard } from '../primitives';

const KIND_TONE: Record<NewsKind, 'red' | 'blue' | 'green' | 'amber' | 'teal' | 'gray'> = {
  injury: 'red', suspension: 'red', transfer: 'blue', loan: 'blue', contract: 'blue', commitment: 'green', coaching: 'amber',
  callup: 'teal', award: 'teal', milestone: 'teal', ranking: 'gray', report: 'gray', preview: 'gray',
};

export function KindBadge({ kind }: { kind: NewsKind }) {
  return <Badge tone={KIND_TONE[kind] ?? 'gray'}>{KIND_LABEL[kind] ?? kind}</Badge>;
}

/** The story's picture at a fixed size (nothing shifts as it loads), gone when it fails to load. Decorative: the
 *  headline beside it says what it is. */
function Thumb({ src, href, dense }: { src: string; href: string; dense?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" tabIndex={-1} aria-hidden className={`shrink-0 overflow-hidden rounded bg-field-800 ${dense ? 'h-12 w-12' : 'h-14 w-24 sm:h-[4.5rem] sm:w-32'}`}>
      <img src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="h-full w-full object-cover" />
    </a>
  );
}

/** One story. `hide` leaves out a link the whole list is already about (the team on its own page). */
export function NewsItem({ s, hide, dense }: { s: Story; hide?: string; dense?: boolean }) {
  const links = s.links.filter((l) => l.href && `${l.type}:${l.id}` !== hide).slice(0, dense ? 3 : 5);
  return (
    <li className={`group flex items-start gap-3 ${dense ? 'px-3 py-2' : 'px-3 py-2.5'}`}>
      {s.image_url && <Thumb src={s.image_url} href={s.url} dense={dense} />}
      <div className="min-w-0 flex-1">
      <a href={s.url} target="_blank" rel="noopener noreferrer" className={`flex items-start gap-1 font-medium text-chalk-100 hover:text-pitch-300 ${dense ? 'text-sm' : 'text-[15px] leading-snug'}`}>
        <span className="min-w-0">{s.title}</span>
        <ArrowUpRight size={14} aria-hidden className="mt-1 shrink-0 text-chalk-500 opacity-0 transition-opacity group-hover:opacity-100" />
        <span className="sr-only">(opens {s.publisher})</span>
      </a>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-chalk-400">
        <span className="font-medium text-chalk-300">{s.publisher}</span>
        <time dateTime={s.published_at} title={new Date(s.published_at).toLocaleString()} className="tnum">{fmt.agoWords(s.published_at)}</time>
        {s.kinds.slice(0, dense ? 1 : 2).map((k) => <KindBadge key={k} kind={k} />)}
        {s.outlets > 1 && (
          <span className="text-chalk-400" title={s.also.map((a) => a.publisher).join(', ')}>
            {s.outlets} outlets
          </span>
        )}
        {links.map((l) => (
          <Link key={`${l.type}:${l.id}`} to={l.href!} className="rounded bg-field-800 px-1.5 py-0.5 text-2xs text-chalk-200 hover:bg-field-700 hover:text-pitch-300">
            {l.label}
          </Link>
        ))}
      </div>
      </div>
    </li>
  );
}

export function NewsList({ stories, hide, dense }: { stories: Story[]; hide?: string; dense?: boolean }) {
  return <ul className="frame divide-y divide-field-700">{stories.map((s) => <NewsItem key={s.id} s={s} hide={hide} dense={dense} />)}</ul>;
}

/**
 * A list of stories with "More", for a team, player, league, conference or a whole area. `hide` is the entity the page
 * is about ("program:<id>"), so its own chip is not repeated on every story.
 */
export function NewsFeed({ q, hide, dense, empty, max }: { q: NewsQuery; hide?: string; dense?: boolean; empty?: string; max?: number }) {
  const news = useNews(q);
  if (news.isPending) return <div className="frame space-y-3 p-3" aria-busy="true"><Skeleton lines={4} /></div>;
  if (news.isError) return <ErrorBox error={news.error} retry={() => news.refetch()} />;
  const stories = news.data.pages.flatMap((p) => p.stories).slice(0, max);
  if (!stories.length) return <EmptyState icon={<Newspaper size={24} />} title={empty ?? 'No news yet'} body="Stories come from school athletics sites and news outlets, a few minutes after they publish." />;
  return (
    <div className="space-y-2">
      <NewsList stories={stories} hide={hide} dense={dense} />
      {!max && news.hasNextPage && (
        <button type="button" className="btn-ghost w-full justify-center text-sm" disabled={news.isFetchingNextPage} onClick={() => news.fetchNextPage()}>
          {news.isFetchingNextPage ? 'Loading...' : 'More stories'}
        </button>
      )}
    </div>
  );
}

/** A rail's news card: the latest three stories, and no card at all when there are none (an empty news box beside a
 *  page's numbers is just noise). */
export function RailNews({ q, hide, to, max = 3 }: { q: NewsQuery; hide?: string; to?: string; max?: number }) {
  const news = useNews(q);
  const stories = news.data?.pages.flatMap((p) => p.stories).slice(0, max) ?? [];
  if (news.isPending || news.isError || !stories.length) return null;
  return <RailCard title="News" to={to} flush><NewsList stories={stories} hide={hide} dense /></RailCard>;
}

/**
 * Team news before a match: for each side, what can change the line-ups (injuries, bans, call-ups, coaching changes,
 * signings) from the last three weeks first, then the latest stories. Hidden when neither side has any.
 */
export function TeamNews({ sides, title = 'Team news' }: { sides: { label: string; q: NewsQuery; hide: string; href?: string }[]; title?: string }) {
  // One request for both sides (their ids together), split by which side a story links.
  const ids = (k: keyof NewsQuery) => sides.map((s) => s.q[k]).filter(Boolean).join(',') || undefined;
  const both: NewsQuery = { program: ids('program') as string | undefined, team: ids('team') as string | undefined };
  const key = useNews({ ...both, kind: TEAM_NEWS_KINDS, limit: 10 });
  const latest = useNews({ ...both, limit: 12 });
  if (key.isPending || latest.isPending) return null;
  const pool = [...(key.data?.pages[0]?.stories ?? []).filter((s) => Date.now() - Date.parse(s.published_at) < 21 * 86400_000), ...(latest.data?.pages[0]?.stories ?? [])];
  const forSide = (hide: string) => pool.filter((s) => s.links.some((l) => `${l.type}:${l.id}` === hide)).filter((s, i, all) => all.findIndex((x) => x.id === s.id) === i).slice(0, 5);
  const lists = sides.map((side) => ({ side, stories: forSide(side.hide) }));
  if (lists.every((l) => !l.stories.length)) return null;
  return (
    <section className="min-w-0 space-y-2">
      <h2 className="text-base font-semibold text-chalk-100">{title}</h2>
      <div className="grid gap-3 md:grid-cols-2">
        {lists.map(({ side, stories }) => (
          <div key={side.hide} className="min-w-0 space-y-1.5">
            <h3 className="text-sm font-semibold text-chalk-200">{side.href ? <Link to={side.href} className="hover:text-pitch-300">{side.label}</Link> : side.label}</h3>
            {stories.length ? <NewsList stories={stories} hide={side.hide} dense /> : <p className="frame px-3 py-4 text-sm text-chalk-400">No recent news for {side.label}.</p>}
          </div>
        ))}
      </div>
    </section>
  );
}

/** A titled list that shows only when there are stories (player pages, sidebars). */
export function NewsSection({ title, q, hide, max = 5, dense, right }: { title: string; q: NewsQuery; hide?: string; max?: number; dense?: boolean; right?: ReactNode }) {
  const news = useNews({ ...q, limit: max });
  const stories = news.data?.pages[0]?.stories ?? [];
  if (news.isPending || !stories.length) return null;
  return (
    <section className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-base font-semibold text-chalk-100">{title}</h2>{right}</div>
      <NewsList stories={stories.slice(0, max)} hide={hide} dense={dense} />
    </section>
  );
}
