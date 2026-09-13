// Thin fetch wrapper: attaches the trigger secret from localStorage and unwraps JSON.
const KEY = 'college-ui-token';
export const getToken = () => { try { return localStorage.getItem(KEY) ?? ''; } catch { return ''; } };
export const setToken = (t: string) => { try { localStorage.setItem(KEY, t); } catch { /* ignore */ } };
export const clearToken = () => { try { localStorage.removeItem(KEY); } catch { /* ignore */ } };

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}`, ...(init.headers ?? {}) } });
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
