import { useEffect, useState } from 'react';
import { NavLink, Outlet, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError, getToken, setToken, clearToken } from './lib/api';
import { FiltersProvider } from './lib/filters';

const NAV = [
  ['/teams', 'Teams'], ['/leaders', 'Leaders'], ['/standings', 'Standings'], ['/rankings', 'Rankings'], ['/jobs', 'Jobs'], ['/quality', 'Quality'],
] as const;

export default function App() {
  const [token, setTok] = useState(getToken());
  const health = useQuery({ queryKey: ['meta', token], queryFn: () => api<{ seasons: number[] }>('/api/meta'), enabled: !!token, retry: false });
  const unauthorized = health.error instanceof ApiError && health.error.status === 401;
  useEffect(() => { if (unauthorized) { clearToken(); setTok(''); } }, [unauthorized]);
  if (!token) return <Login onToken={(t) => { setToken(t); setTok(t); }} />;
  return (
    <FiltersProvider>
      <div className="min-h-screen">
        <header className="sticky top-0 z-20 border-b border-navy-700 bg-navy-950/90 backdrop-blur">
          <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
            <span className="text-lg font-black tracking-tight text-teal-400">College Stats</span>
            <nav className="flex gap-1 overflow-x-auto">
              {NAV.map(([to, label]) => (
                <NavLink key={to} to={to} className={({ isActive }) => `rounded-lg px-3 py-1.5 text-sm font-semibold ${isActive ? 'bg-navy-800 text-ink-100' : 'text-ink-400 hover:text-ink-100'}`}>{label}</NavLink>
              ))}
            </nav>
            <GlobalFilters />
            <button className="btn-ghost ml-auto" onClick={() => { clearToken(); setTok(''); }}>Sign out</button>
          </div>
        </header>
        <main className="mx-auto max-w-[1500px] px-4 py-4">
          <Outlet />
        </main>
      </div>
    </FiltersProvider>
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

function Login({ onToken }: { onToken: (t: string) => void }) {
  const [v, setV] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const r = await fetch('/api/meta', { headers: { Authorization: `Bearer ${v.trim()}` } });
      if (!r.ok) throw new Error(r.status === 401 ? 'That secret was rejected.' : `Server error ${r.status}`);
      onToken(v.trim());
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : String(e2)); }
  };
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-3">
        <h1 className="text-xl font-black text-teal-400">College Stats Viewer</h1>
        <p className="text-sm text-ink-400">Enter the scraper's trigger secret (COLLEGE_TRIGGER_SECRET).</p>
        <input className="input w-full" type="password" value={v} onChange={(e) => setV(e.target.value)} placeholder="secret" autoFocus />
        {err && <p className="text-sm text-red-400">{err}</p>}
        <button className="btn-primary w-full justify-center" type="submit">Sign in</button>
      </form>
    </div>
  );
}
