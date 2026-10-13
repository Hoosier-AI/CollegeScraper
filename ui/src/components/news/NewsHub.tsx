// The News pages (College /news, Pro /pro/news, International /intl/news): Top stories of the last three
// days, the latest with a filter (team news, transfers or commitments, coaching, awards, results), and a side column.
import type { ReactNode } from 'react';
import { Chip, Section, Skeleton } from '../primitives';
import { useUrlState } from '../../lib/urlState';
import { useNews, type NewsKind, type NewsQuery } from '../../lib/news';
import { NewsFeed, NewsList } from './News';

export function NewsHub({ base, filters, aside, intro }: { base: NewsQuery; filters: { id: string; label: string; kinds: NewsKind[] }[]; aside?: ReactNode; intro?: ReactNode }) {
  const [f, setF] = useUrlState('show', 'all', { allow: filters.map((x) => x.id) });
  const filter = filters.find((x) => x.id === f) ?? filters[0]!;
  const top = useNews({ ...base, top: true, limit: 1 }, filter.id === 'all');
  const topStories = top.data?.pages[0]?.top ?? [];
  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-6">
        {intro}
        {filter.id === 'all' && (top.isPending ? <Skeleton className="h-40" /> : topStories.length > 0 && (
          <Section title="Top stories">
            <NewsList stories={topStories} />
          </Section>
        ))}
        <Section title={filter.id === 'all' ? 'Latest' : filter.label} right={
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show">
            {filters.map((x) => <Chip key={x.id} on={x.id === filter.id} onClick={() => setF(x.id)}>{x.label}</Chip>)}
          </div>
        }>
          <NewsFeed key={filter.id} q={{ ...base, kind: filter.kinds, limit: 25 }} empty={filter.id === 'all' ? 'No news yet' : `No ${filter.label.toLowerCase()} stories yet`} />
        </Section>
      </div>
      {aside && <aside className="space-y-6 lg:sticky lg:top-20">{aside}</aside>}
    </div>
  );
}

/** Where the stories come from (shown on each News page). */
export function NewsCredit({ college }: { college?: boolean }) {
  return (
    <p className="text-xs text-chalk-500">
      Headlines link to the outlet that published them. {college ? 'Most college stories come from the schools\' own athletics sites. ' : ''}
      Also from BBC Sport, ESPN and outlets found through <a className="underline hover:text-chalk-300" href="https://www.gdeltproject.org" target="_blank" rel="noopener noreferrer">GDELT</a>. Tags and links to teams and players are ours.
    </p>
  );
}
