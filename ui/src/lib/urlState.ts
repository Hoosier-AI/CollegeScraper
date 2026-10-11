// Page state lives in the URL so Back works and links share what you were looking at.
// One navigate per patch; calls made in the same tick compose through a ref so two setters in one handler
// cannot clobber each other. Defaults are derived when read and deleted when written, keeping URLs short.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';

export type Patch = Record<string, string | number | boolean | null | undefined>;

// One queue for the whole page, not one per hook: each useUrlState/useUrlNumber has its own useUrlPatch, and two of
// them set in one handler (a filter and "back to page 1") must land in one navigate, or the second, built from the
// old URL, drops the first (the Pro position filter did nothing).
let pending: { sp: URLSearchParams; replace: boolean } | null = null;

export function useUrlPatch() {
  const navigate = useNavigate();
  const location = useLocation();
  const loc = useRef(location);
  loc.current = location;
  return useCallback((patch: Patch, opts: { replace?: boolean; resetPage?: boolean } = {}) => {
    const first = !pending;
    const cur = pending ?? { sp: new URLSearchParams(loc.current.search), replace: true };
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === undefined || v === '' || v === false) cur.sp.delete(k); else cur.sp.set(k, String(v));
    }
    // A filter change goes back to page 1; a change that sets the page itself (the pager) keeps it.
    if (opts.resetPage !== false && !('page' in patch)) cur.sp.delete('page');
    cur.replace = cur.replace && !!opts.replace;
    if (first) {
      pending = cur;
      queueMicrotask(() => {
        const p = pending; pending = null;
        if (!p) return;
        const s = p.sp.toString();
        navigate({ pathname: loc.current.pathname, search: s ? `?${s}` : '' }, { replace: p.replace });
      });
    }
  }, [navigate]);
}

/** One string parameter with a default that is never written to the URL. */
export function useUrlState(key: string, def = '', opts: { replace?: boolean; resetPage?: boolean; allow?: readonly string[] } = {}): [string, (v: string) => void] {
  const [sp] = useSearchParams();
  const patch = useUrlPatch();
  const raw = sp.get(key);
  const value = raw != null && (!opts.allow || opts.allow.includes(raw)) ? raw : def;
  const set = useCallback((v: string) => patch({ [key]: v === def ? null : v }, { replace: opts.replace, resetPage: opts.resetPage }), [patch, key, def, opts.replace, opts.resetPage]);
  return [value, set];
}

export function useUrlNumber(key: string, def: number, opts: { replace?: boolean; resetPage?: boolean; min?: number; max?: number } = {}): [number, (v: number) => void] {
  const [sp] = useSearchParams();
  const patch = useUrlPatch();
  const raw = Number(sp.get(key));
  let value = Number.isFinite(raw) && sp.get(key) != null ? Math.trunc(raw) : def;
  if (opts.min != null) value = Math.max(opts.min, value);
  if (opts.max != null) value = Math.min(opts.max, value);
  const set = useCallback((v: number) => patch({ [key]: v === def ? null : v }, { replace: opts.replace, resetPage: opts.resetPage }), [patch, key, def, opts.replace, opts.resetPage]);
  return [value, set];
}

/** Text that is typed locally and committed to the URL after a pause (replace, so typing never fills history). */
export function useUrlText(key: string, delay = 300): { draft: string; setDraft: (s: string) => void; value: string; clear: () => void } {
  const [sp] = useSearchParams();
  const patch = useUrlPatch();
  const value = sp.get(key) ?? '';
  const [draft, setDraft] = useState(value);
  const committed = useRef(value);
  // The URL changed from outside (Back, a cleared filter): follow it.
  useEffect(() => { if (value !== committed.current) { committed.current = value; setDraft(value); } }, [value]);
  useEffect(() => {
    const next = draft.trim();
    if (next === committed.current) return;
    const t = setTimeout(() => { committed.current = next; patch({ [key]: next }, { replace: true }); }, delay);
    return () => clearTimeout(t);
  }, [draft, delay, key, patch]);
  const clear = useCallback(() => { setDraft(''); committed.current = ''; patch({ [key]: null }, { replace: true }); }, [patch, key]);
  return { draft, setDraft, value, clear };
}

export interface Sort { key: string; dir: 'asc' | 'desc' }
/** Sort encoded as `key:asc` — replace, and it never resets the page. */
export function useSortParam(key = 'sort', def: Sort | null = null): [Sort | null, (s: Sort | null) => void] {
  const [sp] = useSearchParams();
  const patch = useUrlPatch();
  const raw = sp.get(key);
  let value: Sort | null = def;
  if (raw) { const [k, d] = raw.split(':'); if (k) value = { key: k, dir: d === 'asc' ? 'asc' : 'desc' }; }
  const set = useCallback((s: Sort | null) => patch({ [key]: s && !(def && s.key === def.key && s.dir === def.dir) ? `${s.key}:${s.dir}` : null }, { replace: true, resetPage: false }), [patch, key, def]);
  return [value, set];
}
