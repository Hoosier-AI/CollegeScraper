import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export interface Filters { season: number; gender: 'm' | 'w'; seasons: number[]; currentSeason: number | null }
const Ctx = createContext<Filters>({ season: new Date().getFullYear(), gender: 'm', seasons: [], currentSeason: null });

export function FiltersProvider({ children }: { children: ReactNode }) {
  const [sp] = useSearchParams();
  const meta = useQuery({ queryKey: ['meta'], queryFn: () => api<{ currentSeason: number; seasons: number[] }>('/api/meta') });
  const season = Number(sp.get('season') ?? meta.data?.currentSeason ?? new Date().getFullYear());
  const gender = (sp.get('gender') === 'w' ? 'w' : 'm') as 'm' | 'w';
  return <Ctx.Provider value={{ season, gender, seasons: meta.data?.seasons ?? [], currentSeason: meta.data?.currentSeason ?? null }}>{children}</Ctx.Provider>;
}

export const useFilters = () => useContext(Ctx);

export const genderLabel = (g: string | null | undefined, form: 'short' | 'long' = 'long') => (g === 'w' ? (form === 'short' ? 'W' : "women's") : (form === 'short' ? 'M' : "men's"));
const DIVISIONS: Record<string, string> = { d1: 'Division I', d2: 'Division II', d3: 'Division III' };
export const divisionLabel = (d: string | null | undefined) => (d ? DIVISIONS[d] ?? d.toUpperCase() : '');
export const divisionShort = (d: string | null | undefined) => (d ? d.toUpperCase() : '');

/**
 * Builds an href that carries the global season/gender unless the target already sets them.
 * Page-local parameters (division, stat, page, tab…) deliberately do not travel between pages.
 */
export function useHref() {
  const [sp] = useSearchParams();
  const season = sp.get('season'), gender = sp.get('gender');
  return useCallback((path: string, overrides: Record<string, string | number | null | undefined> = {}) => {
    const [base, query = ''] = path.split('?');
    const p = new URLSearchParams(query);
    if (season && !p.has('season')) p.set('season', season);
    if (gender && !p.has('gender')) p.set('gender', gender);
    for (const [k, v] of Object.entries(overrides)) { if (v == null || v === '') p.delete(k); else p.set(k, String(v)); }
    const s = p.toString();
    return s ? `${base}?${s}` : base!;
  }, [season, gender]);
}

/** @deprecated use useHref */
export const useKeepQuery = useHref;
