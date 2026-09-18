// Site search: teams and players from /v1/search. A combobox with arrow-key navigation, opened from the
// top bar on every page, the Search tab on phones, or the "/" key.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useFilters, genderLabel } from '../lib/filters';
import { Spinner, TeamLogo } from './primitives';

interface ProgramHit { program_id: string; name: string; gender: 'm' | 'w'; division?: string | null; conference_name?: string | null; logo_svg_url?: string | null }
interface PlayerHit { player_id: string; display_name: string; program_name?: string | null; pos?: string | null; season?: number | null }
type Hit = { id: string; kind: 'team' | 'player'; label: string; sub: string; href: string; logo?: string | null };

export function SearchBox({ size = 'md', autoFocus, placeholder = 'Find a team or player', onNavigate, examples }: { size?: 'md' | 'lg'; autoFocus?: boolean; placeholder?: string; onNavigate?: () => void; examples?: string[] }) {
  const { season } = useFilters();
  const nav = useNavigate();
  const listId = useId();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const hits = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => api<{ programs: ProgramHit[]; players: PlayerHit[] }>(`/v1/search${qs({ q: debounced, limit: 6 })}`),
    enabled: debounced.length >= 2,
  });
  const items = useMemo<Hit[]>(() => [
    ...(hits.data?.programs ?? []).map((p) => ({ id: `t-${p.program_id}`, kind: 'team' as const, label: p.name, sub: `${genderLabel(p.gender)} team${p.conference_name ? `, ${p.conference_name}` : ''}`, href: `/teams/${p.program_id}${qs({ season, gender: p.gender })}`, logo: p.logo_svg_url })),
    ...(hits.data?.players ?? []).map((p) => ({ id: `p-${p.player_id}`, kind: 'player' as const, label: p.display_name, sub: [p.program_name, p.pos, p.season].filter(Boolean).join(', '), href: `/players/${p.player_id}` })),
  ], [hits.data, season]);
  useEffect(() => { setCursor(0); }, [items]);
  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  // "/" focuses the search from anywhere that is not already a text field.
  useEffect(() => {
    if (size !== 'md') return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === '/' && !(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable))) { e.preventDefault(); input.current?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [size]);

  const go = (h: Hit) => { setOpen(false); setQ(''); onNavigate?.(); nav(h.href); };
  const listOpen = open && debounced.length >= 2;
  const big = size === 'lg';
  return (
    <div ref={root} className={`relative ${big ? 'w-full' : 'w-full max-w-xs'}`}>
      <div className="relative">
        <Search size={big ? 20 : 16} aria-hidden className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-chalk-500 ${big ? 'left-4' : 'left-2.5'}`} />
        <input ref={input} type="search" autoFocus={autoFocus} value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (!listOpen || !items.length) { if (e.key === 'Escape') { setOpen(false); input.current?.blur(); } return; }
            if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => (c + 1) % items.length); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => (c - 1 + items.length) % items.length); }
            else if (e.key === 'Enter') { e.preventDefault(); const h = items[cursor]; if (h) go(h); }
            else if (e.key === 'Escape') { setOpen(false); }
          }}
          role="combobox" aria-expanded={listOpen} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={listOpen && items[cursor] ? `${listId}-${items[cursor]!.id}` : undefined}
          aria-label="Search teams and players" placeholder={placeholder}
          className={`input w-full ${big ? 'h-12 pl-11 pr-10 text-base coarse:h-12' : 'pl-8 pr-8'}`} />
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
          {hits.data && !items.length && <li className="px-3 py-2 text-sm text-chalk-400">Nothing matched “{debounced}”. Try a school name, or a player's last name.</li>}
          {items.map((h, i) => (
            <li key={h.id} id={`${listId}-${h.id}`} role="option" aria-selected={i === cursor}
              className={`flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm coarse:py-2.5 ${i === cursor ? 'bg-field-800 text-chalk-100' : 'text-chalk-200'}`}
              onMouseEnter={() => setCursor(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => go(h)}>
              {h.kind === 'team' ? <TeamLogo src={h.logo} name={h.label} size={20} /> : <span aria-hidden className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-field-800 text-2xs text-chalk-400">{h.label.slice(0, 1)}</span>}
              <span className="truncate font-medium">{h.label}</span>
              <span className="ml-auto shrink-0 text-xs text-chalk-500">{h.sub}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
