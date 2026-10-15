// Followed teams and players, kept in this browser only (no account): the star on team and player pages adds one,
// Home shows them first. Any tab's change reaches the others through the storage event.
import { useSyncExternalStore } from 'react';

export type FollowKind = 'team' | 'player' | 'pro-team' | 'pro-player';
export interface Follow { kind: FollowKind; id: string; name: string; href: string; image?: string | null; sub?: string | null }

const KEY = 'plaibook-stats:follows:v1';
const EVENT = 'plaibook-follows';
const MAX = 40;
const EMPTY: Follow[] = [];
let cache: { raw: string | null; list: Follow[] } = { raw: null, list: EMPTY };

function read(): Follow[] {
  let raw: string | null = null;
  try { raw = localStorage.getItem(KEY); } catch { return EMPTY; }
  if (raw === cache.raw) return cache.list;
  let list: Follow[] = EMPTY;
  try {
    const v = raw ? JSON.parse(raw) : [];
    if (Array.isArray(v)) list = v.filter((f) => f && typeof f.id === 'string' && typeof f.kind === 'string' && typeof f.name === 'string' && typeof f.href === 'string').slice(0, MAX);
  } catch { /* a bad value counts as none */ }
  cache = { raw, list };
  return list;
}

function write(list: Follow[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX))); } catch { /* private window or storage off: the star just does not stick */ }
  window.dispatchEvent(new Event(EVENT));
}

export const keyOf = (f: Pick<Follow, 'kind' | 'id'>) => `${f.kind}:${f.id}`;
export const isFollowed = (f: Pick<Follow, 'kind' | 'id'>) => read().some((x) => keyOf(x) === keyOf(f));
/** Newest first. */
export function toggleFollow(f: Follow): boolean {
  const list = read(), k = keyOf(f);
  const on = !list.some((x) => keyOf(x) === k);
  write(on ? [f, ...list.filter((x) => keyOf(x) !== k)] : list.filter((x) => keyOf(x) !== k));
  return on;
}
export function unfollow(f: Pick<Follow, 'kind' | 'id'>) { write(read().filter((x) => keyOf(x) !== keyOf(f))); }

function subscribe(cb: () => void) {
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) cb(); };
  window.addEventListener(EVENT, cb); window.addEventListener('storage', onStorage);
  return () => { window.removeEventListener(EVENT, cb); window.removeEventListener('storage', onStorage); };
}
export const useFollows = (): Follow[] => useSyncExternalStore(subscribe, read, () => EMPTY);
