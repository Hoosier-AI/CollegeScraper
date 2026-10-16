// "Presented by ..." under the top bar: the sponsor of the section the reader is in (college, pro, international or
// news), else the whole-Site sponsor. A plain link we serve ourselves: no cookies, no tracking. Set in the hub (Deals).
import { useLocation } from 'react-router-dom';
import { placementFor, useMoney } from '../lib/money';

export function SponsorLine() {
  const { pathname } = useLocation();
  const { sponsors } = useMoney();
  if (pathname.startsWith('/console') || pathname.startsWith('/admin')) return null;
  const area = placementFor(pathname);
  const s = sponsors.find((x) => x.placement === area) ?? sponsors.find((x) => x.placement === 'site');
  if (!s) return null;
  return (
    <div className="border-b border-field-700 bg-field-900/40">
      <p className="mx-auto flex w-full max-w-page flex-wrap items-baseline gap-x-2 px-4 py-1.5 text-xs text-chalk-400 sm:px-6">
        <span>Presented by</span>
        <a href={s.url} target="_blank" rel="sponsored noopener" className="font-medium text-chalk-200 hover:text-pitch-300">{s.name}</a>
        {s.tagline && <span className="truncate text-chalk-500">{s.tagline}</span>}
      </p>
    </div>
  );
}
