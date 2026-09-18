// Thin fetch wrapper: unwraps JSON and, when an admin secret has been stored, attaches it.
// The read routes are public, so most of the site works with no token at all.
import { useEffect, useState } from 'react';

const KEY = 'college-ui-token';
const listeners = new Set<() => void>();
const emit = () => { for (const fn of listeners) fn(); };

export const getToken = () => { try { return localStorage.getItem(KEY) ?? ''; } catch { return ''; } };
export const setToken = (t: string) => { try { localStorage.setItem(KEY, t); } catch { /* ignore */ } emit(); };
export const clearToken = () => { try { localStorage.removeItem(KEY); } catch { /* ignore */ } emit(); };
export const isAdmin = () => !!getToken();

/** Re-renders when the admin secret is stored or cleared, so admin-only controls appear and vanish live. */
export function useAdmin(): boolean {
  const [on, setOn] = useState(isAdmin);
  useEffect(() => {
    const fn = () => setOn(isAdmin());
    listeners.add(fn);
    window.addEventListener('storage', fn); // another tab signed in or out
    return () => { listeners.delete(fn); window.removeEventListener('storage', fn); };
  }, []);
  return on;
}

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const send = (bearer: string) => fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...(init.headers ?? {}) } });
  let res = await send(token);
  // A stored secret that the server no longer accepts would otherwise break the public pages too, because
  // /v1 rejects a wrong key where it would have served an anonymous caller. Drop it and try again as a visitor.
  if (res.status === 401 && token) { clearToken(); res = await send(''); }
  if (res.status === 401) { throw new ApiError(401, 'unauthorized'); }
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) throw new ApiError(res.status, body?.error ?? body?.message ?? `HTTP ${res.status}`);
  return body as T;
}

export const qs = (o: Record<string, unknown>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const fmt = {
  num: (v: unknown, d = 0) => (v === null || v === undefined || v === '' ? '–' : Number(v).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d })),
  pct: (v: unknown) => (v === null || v === undefined ? '–' : `${(Number(v) * 100).toFixed(1)}%`),
  date: (iso: string | null | undefined) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '–'),
  dt: (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : '–'),
  ago: (iso: string | null | undefined) => {
    if (!iso) return 'never';
    const s = (Date.now() - Date.parse(iso)) / 1000;
    if (s < 60) return `${Math.round(s)}s ago`;
    if (s < 3600) return `${Math.round(s / 60)}m ago`;
    if (s < 86400) return `${Math.round(s / 3600)}h ago`;
    return `${Math.round(s / 86400)}d ago`;
  },
  rec: (w?: number | null, l?: number | null, t?: number | null) => (w == null ? '–' : `${w}-${l ?? 0}-${t ?? 0}`),
};
