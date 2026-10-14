// One search over the whole site: college teams and players (/v1/search), pro competitions, clubs and players
// (/api/pro/search) and international tournaments, national teams and players (/api/intl/search), asked side by side
// and grouped by area. Same combobox behaviour as the area searches (arrow keys, Enter, Escape).
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import { api, qs } from '../../lib/api';
import { flushSearch, trackSearch } from '../../lib/track';
import { genderLabel } from '../../lib/filters';
import { PlayerAvatar, Spinner, TeamLogo } from '../../components/primitives';

interface ProHit { id: number; name: string; slug: string; sub: string | null; logo: string | null }
interface CollegeHits { programs: { program_id: string; name: string; gender: 'm' | 'w'; conference_name?: string | null; logo_svg_url?: string | null }[]; players: { player_id: string; display_name: string; program_name?: string | null; pos?: string | null }[] }
type Area = 'college' | 'pro' | 'intl';
interface Hit { key: string; area: Area; person: boolean; label: string; sub: string; href: string; logo: string | null }
const AREA_LABEL: Record<Area, string> = { college: 'College', pro: 'Pro', intl: 'International' };

export function UniversalSearch({ examples, size = 'lg' }: { examples?: string[]; size?: 'md' | 'lg' }) {
  const nav = useNavigate();
  const listId = useId();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const on = debounced.length >= 2;
  const [college, pro, intl] = useQueries({
    queries: [
      { queryKey: ['search', debounced], queryFn: () => api<CollegeHits>(`/v1/search${qs({ q: debounced, limit: 4 })}`), enabled: on },
      { queryKey: ['pro-search', 'pro', debounced], queryFn: () => api<{ leagues: ProHit[]; teams: ProHit[]; players: ProHit[] }>(`/api/pro/search${qs({ q: debounced, limit: 4 })}`), enabled: on },
      { queryKey: ['pro-search', 'intl', debounced], queryFn: () => api<{ leagues: ProHit[]; teams: ProHit[]; players: ProHit[] }>(`/api/intl/search${qs({ q: debounced, limit: 3 })}`), enabled: on },
    ],
  });
  const items = useMemo<Hit[]>(() => {
    const out: Hit[] = [];
    for (const p of college.data?.programs ?? []) out.push({ key: `ct${p.program_id}`, area: 'college', person: false, label: p.name, sub: `${genderLabel(p.gender)} team${p.conference_name ? `, ${p.conference_name}` : ''}`, href: `/teams/${p.program_id}${qs({ gender: p.gender })}`, logo: p.logo_svg_url ?? null });
    for (const p of college.data?.players ?? []) out.push({ key: `cp${p.player_id}`, area: 'college', person: true, label: p.display_name, sub: [p.program_name, p.pos].filter(Boolean).join(', ') || 'College player', href: `/players/${p.player_id}`, logo: null });
    const pros = (d: typeof pro.data, area: 'pro' | 'intl') => {
      const base = area === 'intl' ? '/intl' : '/pro';
      for (const h of d?.leagues ?? []) out.push({ key: `${area}l${h.id}`, area, person: false, label: h.name, sub: h.sub && h.sub !== 'World' ? h.sub : area === 'intl' ? 'Tournament' : 'Competition', href: `${base}/${area === 'intl' ? 'tournaments' : 'leagues'}/${h.slug}`, logo: h.logo });
      for (const h of d?.teams ?? []) out.push({ key: `${area}t${h.id}`, area, person: false, label: h.name, sub: area === 'intl' ? (/-women(-|$)/.test(h.slug) ? "Women's national team" : 'National team') : h.sub ?? 'Club', href: `${base}/teams/${h.slug}`, logo: h.logo });
      for (const h of d?.players ?? []) out.push({ key: `${area}p${h.id}`, area, person: true, label: h.name, sub: h.sub ?? 'Player', href: `${base}/players/${h.slug}`, logo: h.logo });
    };
    pros(pro.data, 'pro');
    pros(intl.data, 'intl');
    // The college feed can hold the same player twice under different spellings ("INDIANA CHAMBERS"): one row each.
    const seen = new Set<string>();
    return out.filter((h) => { const k = `${h.area}|${h.person}|${h.label.toLowerCase()}|${h.sub.toLowerCase()}`; if (seen.has(k)) return false; seen.add(k); return true; });
  }, [college.data, pro.data, intl.data]);
  const pending = on && (college.isPending || pro.isPending || intl.isPending);
  const allDone = on && !pending;
  useEffect(() => { setCursor(0); }, [items]);
  useEffect(() => { if (allDone) trackSearch('pro', debounced, items.length); }, [allDone, debounced, items.length]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  const go = (h: Hit) => { flushSearch(); setOpen(false); setQ(''); nav(h.href); };
  const listOpen = open && on;
  const big = size === 'lg';
  return (
    <div ref={root} className="relative w-full">
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
          aria-label="Search college and pro teams, players, leagues and national teams" placeholder="Find a team, player, league or nation"
          className={`input w-full [&::-webkit-search-cancel-button]:appearance-none ${big ? 'h-12 pl-11 pr-10 text-base' : 'pl-8 pr-8'}`} />
        {q && <button type="button" aria-label="Clear search" onClick={() => { setQ(''); input.current?.focus(); }} className={`absolute top-1/2 -translate-y-1/2 rounded p-1 text-chalk-500 hover:text-chalk-100 ${big ? 'right-3' : 'right-1.5'}`}><X size={16} /></button>}
      </div>
      {!q && examples && big && (
        <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Examples">
          {examples.map((e) => <button key={e} type="button" className="chip" onClick={() => { setQ(e); setOpen(true); input.current?.focus(); }}>{e}</button>)}
        </div>
      )}
      {listOpen && (
        <ul id={listId} role="listbox" aria-label="Search results" className="absolute inset-x-0 top-full z-40 mt-1 max-h-[26rem] overflow-auto rounded-lg border border-field-700 bg-field-900 p-1 shadow-xl shadow-black/50">
          {pending && !items.length && <li className="px-3 py-2"><Spinner label="Searching…" /></li>}
          {allDone && !items.length && <li className="px-3 py-2 text-sm text-chalk-400">Nothing matched “{debounced}”.</li>}
          {items.map((h, i) => (
            <li key={h.key} role="presentation">
              {h.area !== items[i - 1]?.area && <span aria-hidden className="block px-3 pb-1 pt-2 text-2xs font-semibold text-chalk-500">{AREA_LABEL[h.area]}</span>}
              <div id={`${listId}-${h.key}`} role="option" aria-selected={i === cursor} aria-label={`${h.label}, ${AREA_LABEL[h.area]}, ${h.sub}`}
                className={`flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm ${i === cursor ? 'bg-field-800 text-chalk-100' : 'text-chalk-200'}`}
                onMouseEnter={() => setCursor(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => go(h)}>
                {h.person ? <PlayerAvatar src={h.logo} name={h.label} size={20} /> : <TeamLogo src={h.logo} name={h.label} size={20} />}
                <span className="truncate font-medium">{h.label}</span>
                <span className="ml-auto shrink-0 truncate text-xs text-chalk-500">{h.sub}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
