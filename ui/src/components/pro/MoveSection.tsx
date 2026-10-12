// A Pro page whose data belongs to International (a national team opened under /pro) or the other way round: moves to
// the same page in its own half, keeping the query string (season, tab).
import { Navigate, useLocation } from 'react-router-dom';
import { useSection } from '../../lib/section';

/** True when the page should move: `intl` is what the data says the page is. */
export function useWrongSection(intl: boolean | null | undefined): boolean {
  const section = useSection();
  return intl != null && intl !== (section === 'intl');
}

export function MoveSection({ to }: { to: string }) {
  const { search, hash } = useLocation();
  return <Navigate to={`${to}${search}${hash}`} replace />;
}
