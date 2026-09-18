// The internal console's front door. The stats pages are public; this is only for the crawl operator.
import { useState, type ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { clearToken, setToken, useAdmin } from '../lib/api';
import { Logo } from '../components/Brand';

export default function Admin() {
  const admin = useAdmin();
  if (admin) {
    return (
      <div className="card mx-auto max-w-sm space-y-3">
        <h1 className="text-xl font-black text-ink-100">Admin</h1>
        <p className="text-sm text-ink-400">Signed in. Jobs and Quality are in the nav.</p>
        <div className="flex gap-2">
          <Link className="btn-primary" to="/jobs">Jobs</Link>
          <Link className="btn-ghost" to="/quality">Quality</Link>
          <button className="btn-ghost ml-auto" onClick={() => clearToken()}>Sign out</button>
        </div>
      </div>
    );
  }
  return <Login />;
}

function Login() {
  const [v, setV] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      // /api/runs is admin-only, so a 200 here proves the secret rather than just that the server is up.
      const r = await fetch('/api/runs?limit=1', { headers: { Authorization: `Bearer ${v.trim()}` } });
      if (!r.ok) throw new Error(r.status === 401 ? 'That secret was rejected.' : `Server error ${r.status}`);
      setToken(v.trim());
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : String(e2)); }
  };
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-3">
        <Logo size={32} />
        <h1 className="text-xl font-black text-ink-100">Admin sign-in</h1>
        <p className="text-sm text-ink-400">Enter the scraper's trigger secret (COLLEGE_TRIGGER_SECRET). Browsing the stats does not need this.</p>
        <input className="input w-full" type="password" value={v} onChange={(e) => setV(e.target.value)} placeholder="secret" autoFocus />
        {err && <p className="text-sm text-red-400">{err}</p>}
        <button className="btn-primary w-full justify-center" type="submit">Sign in</button>
        <Link to="/" className="block text-center text-sm text-ink-500 hover:text-ink-300">Back to the stats</Link>
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
