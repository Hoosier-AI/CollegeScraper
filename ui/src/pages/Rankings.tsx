// The Rankings hub: conference tables, the polls and the stat leaders under one roof, each keeping its own URL state.
import { useUrlState } from '../lib/urlState';
import { useHref } from '../lib/filters';
import { TabsNav } from '../components/primitives';
import { StandingsView } from './rankings/StandingsView';
import { PollsView } from './rankings/PollsView';
import { LeadersView } from './rankings/LeadersView';

type View = 'standings' | 'polls' | 'leaders';

export default function Rankings() {
  const [view] = useUrlState('view', 'standings', { allow: ['standings', 'polls', 'leaders'] });
  const href = useHref();
  return (
    <div className="space-y-4">
      <h1 className="display text-2xl sm:text-3xl">Rankings</h1>
      <TabsNav label="Rankings sections" value={view as View} hrefFor={(v) => href('/rankings', { view: v === 'standings' ? null : v })}
        tabs={[{ id: 'standings' as View, label: 'Standings' }, { id: 'polls' as View, label: 'Polls' }, { id: 'leaders' as View, label: 'Leaders' }]} />
      {view === 'standings' && <StandingsView />}
      {view === 'polls' && <PollsView />}
      {view === 'leaders' && <LeadersView />}
    </div>
  );
}
