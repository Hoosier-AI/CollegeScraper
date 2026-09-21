// Standings: browse conferences, open one, or compare every table of a division.
import { useUrlState } from '../../lib/urlState';
import { ConferenceCards } from './ConferenceCards';
import { ConferenceDetail } from './ConferenceDetail';
import { StandingsGrid } from './StandingsGrid';

export function StandingsView() {
  const [conference] = useUrlState('conference');
  const [all] = useUrlState('all', '', { allow: ['1'] });
  if (conference) return <ConferenceDetail id={conference} />;
  if (all === '1') return <StandingsGrid />;
  return <ConferenceCards />;
}
