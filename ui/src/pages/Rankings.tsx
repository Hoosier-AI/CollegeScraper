// College rankings: the United Soccer Coaches poll and NCAA.com's statistical rankings, week by week. Standings and
// leaders were tabs here until 2026-10-14; they are Conferences and Leaders now, and their old addresses lead there.
import { Navigate, useSearchParams } from 'react-router-dom';
import { PollsView } from './rankings/PollsView';

export default function Rankings() {
  const [sp] = useSearchParams();
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
  return <PollsView />;
}
