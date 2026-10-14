// The frame around every page: a one-line top bar, a bottom tab bar on phones, the season/gender controls,
// and the pages shown when a route is missing or throws.
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, isRouteErrorResponse, useLocation, useRouteError, useSearchParams } from 'react-router-dom';
import { BarChart3, CalendarDays, Flag, Gauge, Globe, GraduationCap, Home as HomeIcon, Medal, Newspaper, Search, Shield, Trophy, Users, X } from 'lucide-react';
import { PRO_GENDER_PAGES, useProGender } from '../lib/proGender';
import { isIntlPath, isProPath as isProSection, sectionOf, type Section } from '../lib/section';
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
  { to: '/news', label: 'News', icon: Newspaper },
] as const;
// Plaibook Stats Pro's own sections; the header switch moves between the college and pro halves of the site.
// wide: the label where the header has room (xl and up); the short one elsewhere.
export const PRO_NAV: { to: string; label: string; wide?: string; icon: typeof CalendarDays }[] = [
  { to: '/pro/matches', label: 'Matches', icon: CalendarDays },
  { to: '/pro/leagues', label: 'Leagues', icon: Trophy },
  { to: '/pro/players', label: 'Players', icon: Users },
  { to: '/pro/leaders', label: 'Leaders', icon: BarChart3 },
  { to: '/pro/abroad', label: 'Abroad', wide: 'Americans abroad', icon: Globe },
  { to: '/pro/college', label: 'College to Pro', icon: GraduationCap },
  { to: '/pro/news', label: 'News', icon: Newspaper },
];
// International: national teams (Pro is club football only).
export const INTL_NAV: { to: string; label: string; wide?: string; icon: typeof CalendarDays }[] = [
  { to: '/intl/matches', label: 'Matches', icon: CalendarDays },
  { to: '/intl/tournaments', label: 'Tournaments', icon: Trophy },
  { to: '/intl/teams', label: 'Teams', wide: 'National teams', icon: Flag },
  { to: '/intl/players', label: 'Players', icon: Users },
  { to: '/intl/rankings', label: 'Rankings', icon: Medal },
  { to: '/intl/news', label: 'News', icon: Newspaper },
];
const ADMIN_NAV = [{ to: '/console', label: 'Console' }] as const;
/** Pro or International: the halves that share pages, search and the men's/women's toggle. */
export const isProPath = (path: string) => isProSection(path) || isIntlPath(path);

/** The three areas. There is one home page (/) for all of them, so each area opens on its matches; on the home page
 *  none is lit. */
function SectionSwitch({ section }: { section: Section | null }) {
  const cls = (on: boolean) => `rounded px-2 py-1 text-xs font-semibold transition-colors duration-150 ${on ? 'bg-pitch-400/20 text-pitch-300' : 'text-chalk-400 hover:text-chalk-100'}`;
  return (
    <nav aria-label="Area" className="flex shrink-0 items-center gap-0.5 rounded-md border border-field-700 p-0.5">
      <Link to="/matches" className={cls(section === 'college')} aria-current={section === 'college' ? 'true' : undefined}>College</Link>
      <Link to="/pro/matches" className={cls(section === 'pro')} aria-current={section === 'pro' ? 'true' : undefined}>Pro</Link>
      <Link to="/intl/matches" className={cls(section === 'intl')} aria-current={section === 'intl' ? 'true' : undefined}><span className="sm:hidden">Intl</span><span className="hidden sm:inline">International</span></Link>
    </nav>
  );
}
// The season/gender controls only mean something on the data pages.
const FILTERLESS = ['/', '/admin', '/search', '/console'];

export function TopBar() {
  const admin = useAdmin();
  const { pathname } = useLocation();
  const home = pathname === '/';
  const pro = isProPath(pathname);
  const section = sectionOf(pathname);
  // Season and gender are college filters; pro pages carry their own season pickers.
  const showFilters = !pro && !FILTERLESS.includes(pathname);
  const nav = section === 'intl' ? INTL_NAV : pro ? PRO_NAV : NAV;
  // Pro: men's or women's across the list pages, like the college toggle; a league, club, player or match is one already.
  const proGender = pro && PRO_GENDER_PAGES.test(pathname);
  // Pro search: a box on wide screens; below that an icon opening a full-width row, so the toggle fits.
  const [searching, setSearching] = useState(false);
  useEffect(() => { setSearching(false); }, [pathname]);
  const searchRow = useRef<HTMLDivElement>(null);
  useEffect(() => { if (searching) searchRow.current?.querySelector('input')?.focus(); }, [searching]);
  return (
    <header className="sticky top-0 z-30 border-b border-field-700 bg-field-950">
      <div className="mx-auto flex h-14 max-w-page items-center gap-3 px-4 sm:gap-4 sm:px-6">
        <Link to="/" className="shrink-0 rounded" aria-label="Plaibook Stats home"><Logo withText={false} size={26} className="sm:hidden" /><Logo size={34} className="hidden sm:inline-flex" /></Link>
        <SectionSwitch section={home ? null : section} />
        {/* The home page belongs to no one area: its search and the switch are the way in. */}
        {!home && <nav aria-label="Main" className="hidden items-center gap-0.5 md:flex">
          {nav.map((n) => <NavLink key={n.to} to={n.to} className={({ isActive }) => `whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors duration-150 ${isActive ? 'bg-field-800 text-chalk-100' : 'text-chalk-400 hover:text-chalk-100'}`}>{'wide' in n && n.wide ? <><span className="xl:hidden">{n.label}</span><span className="hidden xl:inline">{n.wide}</span></> : n.label}</NavLink>)}
          {admin && ADMIN_NAV.map((n) => <NavLink key={n.to} to={n.to} className={({ isActive }) => `rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors duration-150 ${isActive ? 'bg-field-800 text-chalk-100' : 'text-note/80 hover:text-note'}`}>{n.label}</NavLink>)}
        </nav>}
        {home ? <div className="ml-auto" /> : pro ? <>
          <div className="ml-auto hidden w-72 xl:block"><ProSearchBox /></div>
          <button type="button" className="btn-ghost btn-icon ml-auto shrink-0 xl:hidden" aria-label={searching ? 'Close search' : 'Search'} aria-expanded={searching} aria-controls="pro-search-row" onClick={() => setSearching((v) => !v)}>
            {searching ? <X size={18} /> : <Search size={18} />}
          </button>
          {proGender && <ProGenderToggle />}
        </> : <div className="ml-auto hidden w-64 md:block lg:w-72"><SearchBox /></div>}
        {showFilters && <GlobalFilters />}
        {admin && <button className="btn-quiet btn-sm hidden md:inline-flex" onClick={() => clearToken()}><Shield size={14} /> Sign out</button>}
      </div>
      {pro && searching && (
        <div id="pro-search-row" ref={searchRow} className="mx-auto max-w-page border-t border-field-700 px-4 py-2 sm:px-6 xl:hidden" onKeyDown={(e) => { if (e.key === 'Escape') setSearching(false); }}>
          <ProSearchBox />
        </div>
      )}
    </header>
  );
}

export function BottomBar() {
  const admin = useAdmin();
  const { pathname } = useLocation();
  const pro = isProPath(pathname);
  // Phones: five slots, Home first everywhere. On the home page itself, the three areas.
  const homeItem = { to: '/', label: 'Home', icon: HomeIcon };
  const items = pathname === '/'
    ? [homeItem, { to: '/matches', label: 'College', icon: GraduationCap }, { to: '/pro/matches', label: 'Pro', icon: Trophy }, { to: '/intl/matches', label: 'Intl', icon: Flag }, { to: '/search', label: 'Search', icon: Search }]
    : isIntlPath(pathname)
    ? [homeItem, ...INTL_NAV.filter((n) => ['/intl/matches', '/intl/tournaments', '/intl/teams', '/intl/news'].includes(n.to))]
    : pro
    ? [homeItem, ...PRO_NAV.filter((n) => ['/pro/matches', '/pro/leagues', '/pro/abroad', '/pro/news'].includes(n.to))]
    : [homeItem, ...NAV, ...(admin ? [{ to: '/console', label: 'Console', icon: Gauge }] : [])];
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 border-t border-field-700 bg-field-950 md:hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="grid" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => `flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-2xs font-medium ${isActive ? 'text-pitch-300' : 'text-chalk-400'}`}>
            {({ isActive }) => <><n.icon size={20} aria-hidden strokeWidth={isActive ? 2.25 : 1.75} /><span>{n.label}</span></>}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

function ProGenderToggle() {
  const [gender, setGender] = useProGender();
  return <SegmentedControl label="Men's or women's" size="sm" value={gender} onChange={setGender} options={[{ value: 'm', label: 'Men' }, { value: 'w', label: 'Women' }]} />;
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
  const home = pathname === '/';
  return (
    <footer className="mx-auto mt-12 max-w-page border-t border-field-700 px-4 py-6 text-xs text-chalk-500 sm:px-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {home
          ? <span>College: each school's athletics site, NCAA.com, conference sites and United Soccer Coaches, checked against each other. Pro: API-Football (api-sports.io) with scraped and open sources first. International: international_results (CC0), the Fjelstul World Cup Database (CC BY-SA 4.0), openfootball (CC0) and Wikipedia caps; Plaibook Elo is our own.</span>
          : isIntlPath(pathname)
          ? <span>Plaibook Stats International: results since 1872 from international_results (Mart Jürisoo, CC0), World Cups from the Fjelstul World Cup Database (CC BY-SA 4.0) and openfootball (CC0), caps from Wikipedia (CC BY-SA 4.0); live scores, lineups and player stats from API-Football (api-sports.io). Rankings are Plaibook Elo, our own.</span>
          : pro
          ? <span>Plaibook Stats Pro: professional match data from API-Football (api-sports.io); college links from Wikidata and Plaibook Stats.</span>
          : <span>Plaibook Stats collects NCAA soccer data from each school's athletics site, NCAA.com, conference sites and United Soccer Coaches, and shows where they agree.</span>}
        <Link to="/admin" className="ml-auto hover:text-chalk-300">Admin</Link>
      </div>
      <p className="mt-2">News: headlines link to the schools and outlets that published them (school athletics sites, BBC Sport, ESPN, and outlets found through GDELT); tags and links to our pages are ours.</p>
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
