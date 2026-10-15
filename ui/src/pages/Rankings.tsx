// College rankings: the United Soccer Coaches poll and NCAA.com's statistical rankings week by week, and Plaibook
// Elo (tab=elo). Standings and leaders were tabs here until 2026-10-14; they are Conferences and Leaders now, and
// their old addresses lead there.
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { useHref } from '../lib/filters';
import { useUrlState } from '../lib/urlState';
import { PageHeader, PageWithRail, TabsNav } from '../components/primitives';
import { RankingsRail } from './rankings/RankingsRail';
import { PollsView } from './rankings/PollsView';
import { EloView } from './rankings/EloView';
import { RpiView } from './rankings/RpiView';

type Tab = 'polls' | 'rpi' | 'elo';

export default function Rankings() {
  const [sp] = useSearchParams();
  const { pathname } = useLocation();
  const href = useHref();
  const [tab] = useUrlState('tab', 'polls', { allow: ['polls', 'rpi', 'elo'] });
  const view = sp.get('view');
  if (view === 'standings' || view === 'leaders' || view === 'polls') {
    const p = new URLSearchParams(sp); p.delete('view');
    let to = '/rankings';
    if (view === 'leaders') to = '/leaders';
    if (view === 'standings') {
      const conf = p.get('conference');
      if (conf && p.get('all') !== '1') { p.delete('conference'); to = `/conferences/${encodeURIComponent(conf)}`; } else to = '/conferences';
    }
    const q = p.toString();
    return <Navigate to={`${to}${q ? `?${q}` : ''}`} replace />;
  }
  return (
    <div className="space-y-4">
      <PageHeader title="Rankings" meta="The coaches' poll and NCAA.com's statistical rankings, live RPI, and Plaibook Elo, our own rating from every result" />
      <TabsNav label="Rankings sections" tabs={[{ id: 'polls' as Tab, label: 'Polls' }, { id: 'rpi' as Tab, label: 'Live RPI' }, { id: 'elo' as Tab, label: 'Plaibook Elo' }]} value={tab as Tab} hrefFor={(x) => href(pathname, { tab: x === 'polls' ? null : x, page: null, conference: null })} />
      <PageWithRail label="Other rankings" rail={<RankingsRail tab={tab as Tab} />}>
        {tab === 'elo' ? <EloView /> : tab === 'rpi' ? <RpiView /> : <PollsView />}
      </PageWithRail>
    </div>
  );
}
