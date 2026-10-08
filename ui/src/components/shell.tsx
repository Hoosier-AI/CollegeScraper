// The frame around every page: a one-line top bar, a bottom tab bar on phones, the season/gender controls,
// and the pages shown when a route is missing or throws.
import { useEffect, useRef } from 'react';
import { Link, NavLink, isRouteErrorResponse, useLocation, useRouteError, useSearchParams } from 'react-router-dom';
import { CalendarDays, Gauge, GraduationCap, Home as HomeIcon, Search, Shield, Trophy, Users } from 'lucide-react';
import { useAdmin, clearToken } from '../lib/api';
import { useFilters } from '../lib/filters';
import { useUrlPatch } from '../lib/urlState';
import { Logo } from './Brand';
import { SearchBox } from './SearchBox';
import { ProSearchBox } from './pro/ProSearchBox';
import { SegmentedControl, Select } from './primitives';

export const NAV = [
  { to: '/matches', label: 'Matches', icon: CalendarDays },
  { to: '/teams', label: 'Teams', icon: Users },
  { to: '/rankings', label: 'Rankings', icon: Trophy },
] as const;
// Plaibook Stats Pro's own sections; the header switch moves between the college and pro halves of the site.
export const PRO_NAV = [
  { to: '/pro/matches', label: 'Matches', icon: CalendarDays },
  { to: '/pro/leagues', label: 'Leagues', icon: Trophy },
] as const;
const ADMIN_NAV = [{ to: '/console', label: 'Console' }] as const;
export const isProPath = (path: string) => path === '/pro' || path.startsWith('/pro/');

function SectionSwitch({ pro }: { pro: boolean }) {
  const cls = (on: boolean) => `rounded px-2 py-1 text-xs font-semibold transition-colors duration-150 ${on ? 'bg-pitch-400/20 text-pitch-300' : 'text-chalk-400 hover:text-chalk-100'}`;
  return (
    <nav aria-label="Section" className="flex shrink-0 items-center gap-0.5 rounded-md border border-field-700 p-0.5">
      <Link to="/" className={cls(!pro)} aria-current={!pro ? 'page' : undefined}>College</Link>
      <Link to="/pro" className={cls(pro)} aria-current={pro ? 'page' : undefined}>Pro</Link>
    </nav>
  );
}
// The season/gender controls only mean something on the data pages.
const FILTERLESS = ['/', '/admin', '/search', '/console'];

export function TopBar() {
  const admin = useAdmin();
  const { pathname } = useLocation();
  const pro = isProPath(pathname);
  // Season and gender are college filters; pro pages carry their own season pickers.
  const showFilters = !pro && !FILTERLESS.includes(pathname);
  const nav = pro ? PRO_NAV : NAV;
  return (
    <header className="sticky top-0 z-30 border-b border-field-700 bg-field-950">
      <div className="mx-auto flex h-14 max-w-page items-center gap-3 px-4 sm:gap-4 sm:px-6">
        <Link to={pro ? '/pro' : '/'} className="shrink-0 rounded" aria-label={pro ? 'Plaibook Stats Pro home' : 'Plaibook Stats home'}><Logo withText={false} size={26} className="sm:hidden" /><Logo size={34} className="hidden sm:inline-flex" /></Link>
        <SectionSwitch pro={pro} />
        <nav aria-label="Main" className="hidden items-center gap-0.5 md:flex">
          {nav.map((n) => <NavLink key={n.to} to={n.to} className={({ isActive }) => `rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors duration-150 ${isActive ? 'bg-field-800 text-chalk-100' : 'text-chalk-400 hover:text-chalk-100'}`}>{n.label}</NavLink>)}
          {admin && ADMIN_NAV.map((n) => <NavLink key={n.to} to={n.to} className={({ isActive }) => `rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors duration-150 ${isActive ? 'bg-field-800 text-chalk-100' : 'text-note/80 hover:text-note'}`}>{n.label}</NavLink>)}
        </nav>
        <div className="ml-auto hidden w-64 md:block lg:w-72">{pro ? <ProSearchBox /> : <SearchBox />}</div>
        {showFilters && <GlobalFilters />}
        {admin && <button className="btn-quiet btn-sm hidden md:inline-flex" onClick={() => clearToken()}><Shield size={14} /> Sign out</button>}
      </div>
    </header>
  );
}

export function BottomBar() {
  const admin = useAdmin();
  const { pathname } = useLocation();
  const pro = isProPath(pathname);
  const items = pro
    ? [{ to: '/pro', label: 'Pro', icon: HomeIcon }, ...PRO_NAV, { to: '/', label: 'College', icon: GraduationCap }]
    : [...NAV, { to: '/search', label: 'Search', icon: Search }, ...(admin ? [{ to: '/console', label: 'Console', icon: Gauge }] : [])];
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 border-t border-field-700 bg-field-950 md:hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="grid" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/pro' || n.to === '/'} className={({ isActive }) => `flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-2xs font-medium ${isActive ? 'text-pitch-300' : 'text-chalk-400'}`}>
            {({ isActive }) => <><n.icon size={20} aria-hidden strokeWidth={isActive ? 2.25 : 1.75} /><span>{n.label}</span></>}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

function GlobalFilters() {
  const [sp] = useSearchParams();
  const { seasons, currentSeason } = useFilters();
  const patch = useUrlPatch();
  const season = sp.get('season') ?? String(currentSeason ?? new Date().getFullYear());
  const gender = sp.get('gender') === 'w' ? 'w' : 'm';
  const list = seasons.length ? seasons : [Number(season)];
  return (
    <div className="ml-auto flex items-center gap-2 md:ml-0">
      <Select aria-label="Season" className="h-9 !pr-7 text-sm" value={season} onChange={(v) => patch({ season: v === String(currentSeason) ? null : v })} options={list.map((s) => ({ value: String(s), label: String(s) }))} />
      <SegmentedControl label="Gender" size="sm" value={gender} onChange={(v) => patch({ gender: v === 'm' ? null : v })} options={[{ value: 'm', label: 'Men' }, { value: 'w', label: 'Women' }]} />
    </div>
  );
}

export function Footer() {
  const { pathname } = useLocation();
  const pro = isProPath(pathname);
  return (
    <footer className="mx-auto mt-12 max-w-page border-t border-field-700 px-4 py-6 text-xs text-chalk-500 sm:px-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {pro
          ? <span>Plaibook Stats Pro: professional match data from API-Football (api-sports.io); college links from Wikidata and Plaibook Stats.</span>
          : <span>Plaibook Stats collects NCAA soccer data from each school's athletics site, NCAA.com, conference sites and United Soccer Coaches, and shows where they agree.</span>}
        <Link to="/admin" className="ml-auto hover:text-chalk-300">Admin</Link>
      </div>
      <p className="mt-3"><a href="https://www.plaibook.soccer/?utm_source=stats&utm_medium=referral&utm_campaign=footer" className="text-pitch-400 hover:text-pitch-300">Coach with Tekki</a>, Plaibook's AI assistant for soccer coaches.</p>
    </footer>
  );
}

/** Moves focus to the page content after navigation so keyboard and screen-reader users start at the top. */
export function useFocusMain() {
  const { pathname } = useLocation();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    document.getElementById('main')?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [pathname]);
}

export function NotFound() {
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <p className="display text-4xl text-chalk-100">Not here</p>
      <p className="mt-3 text-chalk-300">There is no page at this address. It may have moved, or the link was cut short.</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Link to="/" className="btn-primary">Go to the home page</Link>
        <Link to="/teams" className="btn-ghost">Browse teams</Link>
      </div>
    </div>
  );
}

export function RouteError() {
  const err = useRouteError();
  const msg = isRouteErrorResponse(err) ? `${err.status} ${err.statusText}` : err instanceof Error ? err.message : 'Something went wrong';
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <p className="display text-3xl text-chalk-100">This page hit a problem</p>
      <p className="mt-3 text-chalk-300">{msg}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <button className="btn-primary" onClick={() => window.location.reload()}>Reload</button>
        <Link to="/" className="btn-ghost">Go to the home page</Link>
      </div>
    </div>
  );
}
