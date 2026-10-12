// Men's or women's for the Pro side, chosen once in the header (like the college toggle) and kept while moving between
// Pro pages. A link with ?gender=w|m opens that game; otherwise the viewer's last choice (this browser), men's first.
import { useCallback, useSyncExternalStore } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useUrlPatch } from './urlState';

export type ProGender = 'm' | 'w';
const KEY = 'plaibook:pro-gender';
const listeners = new Set<() => void>();
let memory: ProGender | null = null;

function read(): ProGender {
  if (memory) return memory;
  try { const v = localStorage.getItem(KEY); if (v === 'm' || v === 'w') return (memory = v); } catch { /* storage off */ }
  return 'm';
}
function write(g: ProGender) {
  memory = g;
  try { localStorage.setItem(KEY, g); } catch { /* storage off: kept for this visit */ }
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export function useProGender(): [ProGender, (g: ProGender) => void] {
  const [sp] = useSearchParams();
  const patch = useUrlPatch();
  const stored = useSyncExternalStore(subscribe, read, () => 'm' as ProGender);
  const url = sp.get('gender');
  const value: ProGender = url === 'w' || url === 'm' ? url : stored;
  // Choosing drops ?gender from the URL so the stored choice rules from here on.
  const set = useCallback((g: ProGender) => { write(g); patch({ gender: null }); }, [patch]);
  return [value, set];
}

/** The Pro and International pages the toggle applies to: lists across competitions. A league, club, player or match is
 *  one game already. */
export const PRO_GENDER_PAGES = /^\/pro(\/(matches|leagues|players|leaders|countries(\/[^/]+)?|college|abroad))?\/?$|^\/intl(\/(matches|tournaments|teams|players|rankings))?\/?$/;
