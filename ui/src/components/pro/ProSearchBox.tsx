// Search across pro competitions, clubs and players (/api/pro/search). Same combobox behaviour as the college one.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import { api, qs } from '../../lib/api';
import { proPath } from '../../lib/pro';
import { PlayerAvatar, Spinner, TeamLogo } from '../primitives';

interface HitRow { id: number; name: string; slug: string; sub: string | null; logo: string | null }
export type Hit = { key: string; kind: 'league' | 'team' | 'player'; label: string; sub: string; href: string; logo: string | null; slug: string };

/** `onPick`: choose instead of navigating (the compare page picks players with it). */
export function ProSearchBox({ size = 'md', placeholder = 'Find a league, club or player', examples, onNavigate, onPick }: { size?: 'md' | 'lg'; placeholder?: string; examples?: string[]; onNavigate?: () => void; onPick?: (h: Hit) => void }) {
  const nav = useNavigate();
  const listId = useId();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const hits = useQuery({ queryKey: ['pro-search', debounced], queryFn: () => api<{ leagues: HitRow[]; teams: HitRow[]; players: HitRow[] }>(`/api/pro/search${qs({ q: debounced, limit: 6 })}`), enabled: debounced.length >= 2 });
  const items = useMemo<Hit[]>(() => [
    ...(onPick ? [] : (hits.data?.leagues ?? []).map((h) => ({ key: `l${h.id}`, kind: 'league' as const, label: h.name, sub: h.sub ?? 'Competition', href: proPath.league(h.slug), logo: h.logo, slug: h.slug }))),
    ...(onPick ? [] : (hits.data?.teams ?? []).map((h) => ({ key: `t${h.id}`, kind: 'team' as const, label: h.name, sub: h.sub ?? 'Club', href: proPath.team(h.slug), logo: h.logo, slug: h.slug }))),
    ...(hits.data?.players ?? []).map((h) => ({ key: `p${h.id}`, kind: 'player' as const, label: h.name, sub: h.sub ?? 'Player', href: proPath.player(h.slug), logo: h.logo, slug: h.slug })),
  ], [hits.data, onPick]);
  useEffect(() => { setCursor(0); }, [items]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  const go = (h: Hit) => { setOpen(false); setQ(''); if (onPick) { onPick(h); return; } onNavigate?.(); nav(h.href); };
  const listOpen = open && debounced.length >= 2;
  const big = size === 'lg';
  return (
    <div ref={root} className={`relative ${big ? 'w-full' : 'w-full max-w-xs'}`}>
      <div className="relative">
        <Search size={big ? 20 : 16} aria-hidden className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-chalk-500 ${big ? 'left-4' : 'left-2.5'}`} />
        <input ref={input} type="search" value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (!listOpen || !items.length) { if (e.key === 'Escape') { setOpen(false); input.current?.blur(); } return; }
            if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => (c + 1) % items.length); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => (c - 1 + items.length) % items.length); }
            else if (e.key === 'Enter') { e.preventDefault(); const h = items[cursor]; if (h) go(h); }
            else if (e.key === 'Escape') setOpen(false);
          }}
          role="combobox" aria-expanded={listOpen} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={listOpen && items[cursor] ? `${listId}-${items[cursor]!.key}` : undefined}
          aria-label="Search pro leagues, clubs and players" placeholder={placeholder} className={`input w-full ${big ? 'h-12 pl-11 pr-10 text-base' : 'pl-8 pr-8'}`} />
        {q && <button type="button" aria-label="Clear search" onClick={() => { setQ(''); input.current?.focus(); }} className={`absolute top-1/2 -translate-y-1/2 rounded p-1 text-chalk-500 hover:text-chalk-100 ${big ? 'right-3' : 'right-1.5'}`}><X size={16} /></button>}
      </div>
      {!q && examples && big && (
        <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Examples">
          {examples.map((e) => <button key={e} type="button" className="chip" onClick={() => { setQ(e); setOpen(true); input.current?.focus(); }}>{e}</button>)}
        </div>
      )}
      {listOpen && (
        <ul id={listId} role="listbox" aria-label="Search results" className="absolute inset-x-0 top-full z-40 mt-1 max-h-96 overflow-auto rounded-lg border border-field-700 bg-field-900 p-1 shadow-xl shadow-black/50">
          {hits.isPending && <li className="px-3 py-2"><Spinner label="Searching…" /></li>}
          {hits.error && <li className="px-3 py-2 text-sm text-loss">Search failed. Try again in a moment.</li>}
          {hits.data && !items.length && <li className="px-3 py-2 text-sm text-chalk-400">Nothing matched “{debounced}”.</li>}
          {items.map((h, i) => (
            <li key={h.key} id={`${listId}-${h.key}`} role="option" aria-selected={i === cursor}
              className={`flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm ${i === cursor ? 'bg-field-800 text-chalk-100' : 'text-chalk-200'}`}
              onMouseEnter={() => setCursor(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => go(h)}>
              {h.kind === 'player' ? <PlayerAvatar src={h.logo} name={h.label} size={20} /> : <TeamLogo src={h.logo} name={h.label} size={20} />}
              <span className="truncate font-medium">{h.label}</span>
              <span className="ml-auto shrink-0 text-xs text-chalk-500">{h.sub}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
