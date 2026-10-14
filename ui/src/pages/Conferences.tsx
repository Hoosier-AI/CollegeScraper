// Every conference for a division (cards with the top of each table), or every table side by side (?all=1).
import { Navigate, useSearchParams } from 'react-router-dom';
import { ConferenceCards } from './rankings/ConferenceCards';
import { StandingsGrid } from './rankings/StandingsGrid';

export default function Conferences() {
  const [sp] = useSearchParams();
  const conf = sp.get('conference');
  if (sp.get('all') === '1') return <StandingsGrid />;
  // An old ?conference= link opens the conference's own page.
  if (conf) { const p = new URLSearchParams(sp); p.delete('conference'); const q = p.toString(); return <Navigate to={`/conferences/${encodeURIComponent(conf)}${q ? `?${q}` : ''}`} replace />; }
  return <ConferenceCards />;
}
