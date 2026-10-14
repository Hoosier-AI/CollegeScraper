// Men's or women's for the whole site (College, Pro, International and the home page), chosen once in the header and
// kept while moving between pages and areas. A link with ?gender=w|m opens that game and makes it the viewer's choice;
// otherwise the viewer's last choice (this browser), men's first.
import { useCallback, useEffect, useSyncExternalStore } from 'react';
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

/** A ?gender in the address becomes the stored choice, so moving to another area keeps it. Called once, by the shell. */
export function useGenderSync() {
  const [sp] = useSearchParams();
  const url = sp.get('gender');
  useEffect(() => { if ((url === 'm' || url === 'w') && url !== read()) write(url); }, [url]);
}

/** The pages the toggle applies to, in every area: lists across teams and competitions. A team, player or match is
 *  one game already. A college conference page is a list of that conference's men's or women's teams. */
export const GENDER_PAGES = /^\/(matches|conferences(\/[^/]+)?|teams|players|leaders|rankings|transfers|news)\/?$|^\/pro(\/(matches|leagues|teams|players|leaders|countries(\/[^/]+)?|college|abroad|news))?\/?$|^\/intl(\/(matches|tournaments|teams|players|leaders|rankings|h2h|news))?\/?$/;
/** @deprecated GENDER_PAGES covers every area. */
export const PRO_GENDER_PAGES = GENDER_PAGES;
/** One setting for every area. */
export const useGender = useProGender;
