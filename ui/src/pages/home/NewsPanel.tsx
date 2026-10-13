// The latest college news for the scope (men's or women's): the schools' own stories and college coverage.
import { Panel, type Scope } from './Panel';
import { useNews } from '../../lib/news';
import { NewsList } from '../../components/news/News';
import { Skeleton } from '../../components/primitives';

export function NewsPanel({ scope, className }: { scope: Scope; className?: string }) {
  const q = useNews({ scope: 'college', gender: scope.gender as 'm' | 'w', top: true, limit: 8 });
  const page = q.data?.pages[0];
  const stories = (page?.top?.length ? page.top : page?.stories ?? []).slice(0, 6);
  return (
    <Panel className={className} title="News" meta="From the schools and college soccer coverage" footer={{ to: `/news?gender=${scope.gender}`, label: 'All college news' }}>
      {q.isPending && <Skeleton lines={5} />}
      {q.data && !stories.length && <p className="text-sm text-chalk-500">No news yet.</p>}
      {stories.length > 0 && <div className="-mx-1"><NewsList stories={stories} dense /></div>}
    </Panel>
  );
}
