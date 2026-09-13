import { createContext, useContext, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export interface Filters { season: number; gender: 'm' | 'w'; division: string; conference: string }
const Ctx = createContext<Filters>({ season: new Date().getFullYear(), gender: 'm', division: '', conference: '' });

export function FiltersProvider({ children }: { children: ReactNode }) {
  const [sp] = useSearchParams();
  const meta = useQuery({ queryKey: ['meta'], queryFn: () => api<{ currentSeason: number }>('/api/meta') });
  const season = Number(sp.get('season') ?? meta.data?.currentSeason ?? new Date().getFullYear());
  const gender = (sp.get('gender') === 'w' ? 'w' : 'm') as 'm' | 'w';
  return <Ctx.Provider value={{ season, gender, division: sp.get('division') ?? '', conference: sp.get('conference') ?? '' }}>{children}</Ctx.Provider>;
}

export const useFilters = () => useContext(Ctx);

/** Keep season/gender in links so navigation preserves the global filters. */
export function useKeepQuery() {
  const [sp] = useSearchParams();
  const keep = new URLSearchParams();
  for (const k of ['season', 'gender']) { const v = sp.get(k); if (v) keep.set(k, v); }
  const s = keep.toString();
  return (path: string) => (s ? `${path}${path.includes('?') ? '&' : '?'}${s}` : path);
}
