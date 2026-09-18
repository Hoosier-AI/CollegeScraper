import { useEffect } from 'react';
import { Link, NavLink, Outlet, useLocation, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError, clearToken, useAdmin } from './lib/api';
import { FiltersProvider } from './lib/filters';
import { Logo } from './components/Brand';

// Everyone sees these. Jobs and Quality are appended once an admin secret is stored.
const NAV = [['/teams', 'Teams'], ['/leaders', 'Leaders'], ['/standings', 'Standings'], ['/rankings', 'Rankings'], ['/docs', 'API']] as const;
const ADMIN_NAV = [['/jobs', 'Jobs'], ['/quality', 'Quality']] as const;

// The season/gender selects only mean something on the data pages.
const FILTERLESS = ['/', '/docs', '/admin'];

export default function App() {
  const admin = useAdmin();
  const { pathname } = useLocation();
  // /api/meta is public now, so probe an admin-only route to notice a secret that has been rotated away.
  const check = useQuery({ queryKey: ['admin-check'], queryFn: () => api('/api/runs?limit=1'), enabled: admin, retry: false, staleTime: 5 * 60_000 });
  const rejected = check.error instanceof ApiError && check.error.status === 401;
  useEffect(() => { if (rejected) clearToken(); }, [rejected]);

  const nav = admin ? [...NAV, ...ADMIN_NAV] : NAV;
  return (
    <FiltersProvider>
      <div className="min-h-screen">
        <header className="sticky top-0 z-20 border-b border-navy-700 bg-navy-950/90 backdrop-blur">
          <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
            <Link to="/" className="shrink-0"><Logo /></Link>
            <nav className="flex gap-1 overflow-x-auto">
              {nav.map(([to, label]) => (
                <NavLink key={to} to={to} className={({ isActive }) => `rounded-lg px-3 py-1.5 text-sm font-semibold ${isActive ? 'bg-navy-800 text-ink-100' : 'text-ink-400 hover:text-ink-100'}`}>{label}</NavLink>
              ))}
            </nav>
            {!FILTERLESS.includes(pathname) && <GlobalFilters />}
            {admin && <button className="btn-ghost ml-auto" onClick={() => clearToken()}>Sign out</button>}
          </div>
        </header>
        <main className="mx-auto max-w-[1500px] px-4 py-4">
          <Outlet />
        </main>
        <Footer />
      </div>
    </FiltersProvider>
  );
}

function Footer() {
  return (
    <footer className="mx-auto mt-8 max-w-[1500px] border-t border-navy-800 px-4 py-6 text-sm text-ink-500">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span>Plaibook Stats — NCAA soccer data from each school's athletics site, NCAA.com, conference sites and United Soccer Coaches.</span>
        <Link to="/docs" className="ml-auto text-teal-400 hover:text-teal-300">API docs</Link>
        <a href="/v1/openapi.json" className="text-teal-400 hover:text-teal-300">OpenAPI</a>
        <Link to="/admin" className="hover:text-ink-300">Admin</Link>
      </div>
    </footer>
  );
}

function GlobalFilters() {
  const [sp, setSp] = useSearchParams();
  const meta = useQuery({ queryKey: ['meta'], queryFn: () => api<{ seasons: number[]; currentSeason: number }>('/api/meta') });
  const season = sp.get('season') ?? String(meta.data?.currentSeason ?? new Date().getFullYear());
  const gender = sp.get('gender') ?? 'm';
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); n.set(k, v); setSp(n, { replace: true }); };
  return (
    <div className="ml-4 flex items-center gap-2 text-sm">
      <select className="input" value={season} onChange={(e) => set('season', e.target.value)}>
        {(meta.data?.seasons ?? [Number(season)]).map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      <select className="input" value={gender} onChange={(e) => set('gender', e.target.value)}>
        <option value="m">Men</option><option value="w">Women</option>
      </select>
    </div>
  );
}
