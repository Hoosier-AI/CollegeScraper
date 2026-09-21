// The internal console's front door. The stats pages are public; this is only for the crawl operator.
import { useState, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { setToken, useAdmin } from '../lib/api';
import { Logo } from '../components/Brand';

export default function Admin() {
  const admin = useAdmin();
  const { state } = useLocation() as { state?: { from?: string } };
  if (admin) return <Navigate to={state?.from && state.from !== '/admin' ? state.from : '/console'} replace />;
  return <Login />;
}

function Login() {
  const [v, setV] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const { state } = useLocation() as { state?: { from?: string } };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      // /api/runs is admin-only, so a 200 here proves the secret rather than just that the server is up.
      const r = await fetch('/api/runs?limit=1', { headers: { Authorization: `Bearer ${v.trim()}` } });
      if (!r.ok) throw new Error(r.status === 401 ? 'That secret was rejected.' : `Server error ${r.status}`);
      setToken(v.trim());
      navigate(state?.from && state.from !== '/admin' ? state.from : '/console', { replace: true });
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : String(e2)); } finally { setBusy(false); }
  };
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-3 p-4">
        <Logo size={32} />
        <h1 className="text-xl display text-chalk-100">Admin sign-in</h1>
        <p className="text-sm text-chalk-400">Enter the scraper's trigger secret (COLLEGE_TRIGGER_SECRET). Browsing the stats does not need this.</p>
        <label className="block text-xs font-medium text-chalk-500" htmlFor="secret">Trigger secret</label>
        <input id="secret" className="input w-full" type="password" value={v} onChange={(e) => setV(e.target.value)} autoComplete="current-password" autoFocus />
        {err && <p role="alert" className="text-sm text-loss">{err}</p>}
        <button className="btn-primary w-full justify-center" type="submit" disabled={busy}>{busy ? 'Checking…' : 'Sign in'}</button>
        <Link to="/" className="block text-center text-sm text-chalk-500 hover:text-chalk-300">Back to the stats</Link>
      </form>
    </div>
  );
}

/** Sends anyone without the secret to the sign-in page instead of showing an empty console. */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const admin = useAdmin();
  const { pathname } = useLocation();
  if (!admin) return <Navigate to="/admin" replace state={{ from: pathname }} />;
  return <>{children}</>;
}
