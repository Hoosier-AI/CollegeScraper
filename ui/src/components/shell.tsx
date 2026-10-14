// The frame around every page: a one-line top bar, a bottom tab bar on phones, the season/gender controls,
// and the pages shown when a route is missing or throws.
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Link, NavLink, isRouteErrorResponse, useLocation, useRouteError, useSearchParams } from 'react-router-dom';
import { ChevronDown, Flag, Gauge, GraduationCap, Home as HomeIcon, MoreHorizontal, Search, Shield, Trophy, X } from 'lucide-react';
import { GENDER_PAGES, useGender, useGenderSync } from '../lib/proGender';
import { isIntlPath, isProPath as isProSection, sectionOf, type Section } from '../lib/section';
import { AREA_LABEL, AREA_NAV, PHONE_SLOTS, navItemFor, slotBarClass, slotMoreClass, under, type NavItem } from '../lib/nav';
import { useAdmin, clearToken } from '../lib/api';
import { useFilters } from '../lib/filters';
import { useUrlPatch } from '../lib/urlState';
import { Logo } from './Brand';
import { UniversalSearch } from '../pages/home/UniversalSearch';
import { SegmentedControl, Select } from './primitives';

const ADMIN_ITEM: NavItem = { key: 'console', to: '/console', label: 'Console', icon: Gauge, hint: 'Crawls, jobs and data quality' };
/** Pro or International: the halves that share pages, search and the men's/women's toggle. */
export const isProPath = (path: string) => isProSection(path) || isIntlPath(path);
const AREA_HOME: Record<Section, string> = { college: '/matches', pro: '/pro/matches', intl: '/intl/matches' };

/** Closes a popover on a click outside it, on Escape and when the page changes. */
function useDismiss(open: boolean, close: () => void, ref: RefObject<HTMLElement | null>) {
  const { pathname, search } = useLocation();
  useEffect(() => { close(); }, [pathname, search]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** The three areas. Wider screens: a segmented switch; phones: one button naming the area, opening the list. On the
 *  home page none is lit. */
function AreaSwitch({ section }: { section: Section | null }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), root);
  const cls = (on: boolean) => `rounded px-2 py-1 text-xs font-semibold transition-colors duration-150 coarse:py-2 ${on ? 'bg-pitch-400/20 text-pitch-300' : 'text-chalk-400 hover:text-chalk-100'}`;
  const areas: Section[] = ['college', 'pro', 'intl'];
  return (
    <>
      <nav aria-label="Area" className="hidden shrink-0 items-center gap-0.5 rounded-md border border-field-700 p-0.5 sm:flex">
        {areas.map((a) => <Link key={a} to={AREA_HOME[a]} className={cls(section === a)} aria-current={section === a ? 'true' : undefined}>{AREA_LABEL[a]}</Link>)}
      </nav>
      <div ref={root} className="relative shrink-0 sm:hidden">
        <button type="button" className="flex min-h-11 items-center gap-1.5 rounded-md pr-1 text-sm font-semibold text-chalk-100" aria-expanded={open} aria-haspopup="true" aria-controls="area-menu" onClick={() => setOpen((v) => !v)}>
          <Logo withText={false} size={24} />{section ? AREA_LABEL[section] : 'Plaibook Stats'}<ChevronDown size={14} aria-hidden className="text-chalk-400" />
        </button>
        {open && (
          <nav id="area-menu" aria-label="Area" className="absolute left-0 top-full z-40 mt-1 w-56 rounded-lg border border-field-700 bg-field-900 p-1 shadow-xl shadow-black/50">
            <Link to="/" className="flex min-h-11 items-center gap-2 rounded-md px-3 text-sm text-chalk-200 hover:bg-field-800"><HomeIcon size={16} aria-hidden />Home</Link>
            {areas.map((a) => <Link key={a} to={AREA_HOME[a]} aria-current={section === a ? 'true' : undefined} className={`flex min-h-11 items-center rounded-md px-3 text-sm hover:bg-field-800 ${section === a ? 'font-semibold text-pitch-300' : 'text-chalk-200'}`}>{AREA_LABEL[a]}</Link>)}
          </nav>
        )}
      </div>
    </>
  );
}

const barLink = (on: boolean) => `whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors duration-150 ${on ? 'bg-field-800 text-chalk-100' : 'text-chalk-400 hover:text-chalk-100'}`;

/** The area's menu on the header: the slots that fit, then More with the rest and the area's own pages. */
function AreaNav({ area, admin }: { area: Section; admin: boolean }) {
  const { pathname } = useLocation();
  const { slots, more } = AREA_NAV[area];
  const extras = admin ? [...more, ADMIN_ITEM] : more;
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), root);
  const inMore = extras.some((i) => under(pathname, i.to));
  return (
    <nav aria-label="Main" className="hidden min-w-0 items-center gap-0.5 md:flex">
      {slots.map((n, i) => <NavLink key={n.key} to={n.to} className={({ isActive }) => `${barLink(isActive)} ${slotBarClass(i)}`}>{n.label}</NavLink>)}
      <div ref={root} className={`relative ${extras.length ? '' : 'xl:hidden'}`}>
        <button type="button" className={`${barLink(inMore)} inline-flex items-center gap-1`} aria-expanded={open} aria-haspopup="true" aria-controls="more-menu" onClick={() => setOpen((v) => !v)}>
          More<ChevronDown size={14} aria-hidden className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
        </button>
        {open && (
          <div id="more-menu" className="absolute left-0 top-full z-40 mt-1 w-72 rounded-lg border border-field-700 bg-field-900 p-1 shadow-xl shadow-black/50">
            <ul>{slots.map((n, i) => <li key={n.key} className={slotMoreClass(i)}><MenuLink n={n} on={under(pathname, n.to)} /></li>)}</ul>
            {extras.length > 0 && <ul className="mt-1 border-t border-field-700 pt-1 [&:first-child]:mt-0">{extras.map((n) => <li key={n.key}><MenuLink n={n} on={under(pathname, n.to)} /></li>)}</ul>}
          </div>
        )}
      </div>
    </nav>
  );
}

function MenuLink({ n, on }: { n: NavItem; on: boolean }) {
  return (
    <Link to={n.to} aria-current={on ? 'page' : undefined} className={`flex min-h-10 items-start gap-2.5 rounded-md px-3 py-2 hover:bg-field-800 ${on ? 'bg-field-800' : ''}`}>
      <n.icon size={16} aria-hidden className={`mt-0.5 shrink-0 ${on ? 'text-pitch-300' : 'text-chalk-400'}`} />
      <span className="min-w-0"><span className={`block text-sm font-medium ${on ? 'text-chalk-100' : 'text-chalk-200'}`}>{n.label}</span>{n.hint && <span className="block text-xs text-chalk-500">{n.hint}</span>}</span>
    </Link>
  );
}

// The season control only means something on the college data pages.
const FILTERLESS = ['/', '/admin', '/search', '/console'];

export function TopBar() {
  useGenderSync();
  const admin = useAdmin();
  const { pathname } = useLocation();
  const home = pathname === '/';
  const section = sectionOf(pathname);
  // Season is a college filter; pro pages carry their own season pickers.
  const showSeason = section === 'college' && !FILTERLESS.includes(pathname);
  // Men's or women's on every list page, in every area; a team, player or match is one already.
  const showGender = GENDER_PAGES.test(pathname);
  // Search: one box over all three areas. A box on the widest screens; elsewhere an icon opening a full-width row.
  const [searching, setSearching] = useState(false);
  useEffect(() => { setSearching(false); }, [pathname]);
  const searchRow = useRef<HTMLDivElement>(null);
  useEffect(() => { if (searching) searchRow.current?.querySelector('input')?.focus(); }, [searching]);
  return (
    <header className="sticky top-0 z-30 border-b border-field-700 bg-field-950">
      <div className="mx-auto flex h-14 max-w-page items-center gap-2 px-4 sm:gap-4 sm:px-6">
        <Link to="/" className="hidden shrink-0 rounded sm:block" aria-label="Plaibook Stats home"><Logo size={34} className="hidden xl:inline-flex" /><Logo withText={false} size={28} className="xl:hidden" /></Link>
        <AreaSwitch section={home ? null : section} />
        {/* The home page belongs to no one area: its search and the switch are the way in. */}
        {!home && <AreaNav area={section} admin={admin} />}
        {!home && <>
          <div className="ml-auto hidden w-80 2xl:block"><UniversalSearch size="md" /></div>
          <button type="button" className="btn-ghost btn-icon ml-auto shrink-0 2xl:hidden" aria-label={searching ? 'Close search' : 'Search'} aria-expanded={searching} aria-controls="site-search-row" onClick={() => setSearching((v) => !v)}>
            {searching ? <X size={18} /> : <Search size={18} />}
          </button>
        </>}
        {home && <div className="ml-auto" />}
        {showSeason && <SeasonPicker />}
        {showGender && <GenderToggle />}
        {admin && <button className="btn-quiet btn-sm hidden lg:inline-flex" onClick={() => clearToken()}><Shield size={14} /> Sign out</button>}
      </div>
      {searching && (
        <div id="site-search-row" ref={searchRow} className="mx-auto max-w-page border-t border-field-700 px-4 py-2 sm:px-6 2xl:hidden" onKeyDown={(e) => { if (e.key === 'Escape') setSearching(false); }}>
          <UniversalSearch size="md" />
        </div>
      )}
    </header>
  );
}

/** Phones: the same five everywhere. Home, Matches, the competitions slot, Teams, and More for the rest. On the home
 *  page itself, the three areas and search. */
export function BottomBar() {
  const admin = useAdmin();
  const { pathname } = useLocation();
  const [sheet, setSheet] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useDismiss(sheet, () => setSheet(false), root);
  const home = pathname === '/';
  const area = sectionOf(pathname);
  const { slots, more } = AREA_NAV[area];
  const homeItem = { key: 'home', to: '/', label: 'Home', icon: HomeIcon };
  const items: NavItem[] = home
    ? [homeItem, { key: 'college', to: '/matches', label: 'College', icon: GraduationCap }, { key: 'pro', to: '/pro/matches', label: 'Pro', icon: Trophy }, { key: 'intl', to: '/intl/matches', label: 'Intl', icon: Flag }, { key: 'search', to: '/search', label: 'Search', icon: Search }]
    : [homeItem, ...PHONE_SLOTS.map((k) => slots.find((s) => s.key === k)!).filter(Boolean)];
  const rest = home ? [] : [...slots.filter((s) => !PHONE_SLOTS.includes(s.key as never)), ...more, ...(admin ? [ADMIN_ITEM] : [])];
  const inRest = rest.some((i) => under(pathname, i.to));
  const tab = (on: boolean) => `flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-2xs font-medium ${on ? 'text-pitch-300' : 'text-chalk-400'}`;
  return (
    <div ref={root} className="md:hidden">
      {sheet && (
        <div id="more-sheet" className="fixed inset-x-0 z-30 max-h-[70dvh] overflow-auto rounded-t-xl border-t border-field-700 bg-field-900 p-2 shadow-2xl shadow-black/60" style={{ bottom: 'calc(56px + env(safe-area-inset-bottom))' }}>
          <p className="px-3 pb-1 pt-1 text-xs font-semibold text-chalk-500">{AREA_LABEL[area]}</p>
          <ul className="grid grid-cols-1 gap-0.5">{rest.map((n) => <li key={n.key}><MenuLink n={n} on={under(pathname, n.to)} /></li>)}</ul>
        </div>
      )}
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 border-t border-field-700 bg-field-950" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="grid" style={{ gridTemplateColumns: `repeat(${items.length + (rest.length ? 1 : 0)}, minmax(0, 1fr))` }}>
          {items.map((n) => (
            <NavLink key={n.key} to={n.to} end={n.to === '/'} className={({ isActive }) => tab(isActive && !sheet)}>
              {({ isActive }) => <><n.icon size={20} aria-hidden strokeWidth={isActive && !sheet ? 2.25 : 1.75} /><span>{n.label}</span></>}
            </NavLink>
          ))}
          {rest.length > 0 && (
            <button type="button" className={tab(sheet || inRest)} aria-expanded={sheet} aria-controls="more-sheet" onClick={() => setSheet((v) => !v)}>
              <MoreHorizontal size={20} aria-hidden strokeWidth={sheet || inRest ? 2.25 : 1.75} /><span>More</span>
            </button>
          )}
        </div>
      </nav>
    </div>
  );
}

function GenderToggle() {
  const [gender, setGender] = useGender();
  return <SegmentedControl label="Men's or women's" size="sm" value={gender} onChange={setGender} options={[{ value: 'm', label: 'Men' }, { value: 'w', label: 'Women' }]} />;
}

function SeasonPicker() {
  const [sp] = useSearchParams();
  const { seasons, currentSeason } = useFilters();
  const patch = useUrlPatch();
  const season = sp.get('season') ?? String(currentSeason ?? new Date().getFullYear());
  const list = seasons.length ? seasons : [Number(season)];
  return <Select aria-label="Season" className="h-9 !pr-7 text-sm" value={season} onChange={(v) => patch({ season: v === String(currentSeason) ? null : v })} options={list.map((s) => ({ value: String(s), label: String(s) }))} />;
}

/** Area / Section / Entity above a detail page: the area goes to its matches, the section to its list. */
export function Crumbs({ items }: { items: { label: ReactNode; to?: string }[] }) {
  const { pathname } = useLocation();
  const area = sectionOf(pathname);
  const section = navItemFor(area, pathname);
  const all = [{ label: AREA_LABEL[area], to: AREA_HOME[area] }, ...(section ? [{ label: section.label, to: section.to }] : []), ...items];
  return (
    <nav aria-label="Breadcrumb" className="text-xs text-chalk-500">
      <ol className="flex flex-wrap items-center gap-x-1.5">
        {all.map((c, i) => (
          <li key={i} className="flex min-w-0 items-center gap-x-1.5">
            {i > 0 && <span aria-hidden className="text-chalk-600">/</span>}
            {c.to && i < all.length - 1 ? <Link to={c.to} className="hover:text-chalk-200">{c.label}</Link> : <span aria-current={i === all.length - 1 ? 'page' : undefined} className="truncate text-chalk-400">{c.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
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
