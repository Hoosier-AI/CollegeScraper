// The one table. Semantic markup (caption, th scope, aria-sort), a sticky primary column that links the row,
// column priorities so phones see the essentials, opt-in presets for the wide stat tables, skeleton rows while
// loading, and scroll-edge shadows so it is obvious there is more to the right.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { fmt } from '../lib/api';
import type { Sort } from '../lib/urlState';
import { EmptyState } from './primitives';

export interface Column<T> {
  key: string;
  label: ReactNode;
  /** Longer name for the header tooltip and screen readers when `label` is an abbreviation. */
  title?: string;
  value?: (row: T) => unknown;
  render?: (row: T, index: number) => ReactNode;
  num?: boolean;
  /** Decimal places when the default renderer formats a number. */
  decimals?: number;
  wrap?: boolean;
  sortable?: boolean;
  className?: string;
  /** 1 always shown; 2 hidden below md; 3 only when the preset includes it or "all columns" is on. */
  priority?: 1 | 2 | 3;
  /** The sticky first column whose cell carries the row link. */
  primary?: boolean;
  /** @deprecated alias of primary */
  sticky?: boolean;
}

export interface Preset { id: string; label: string; columns: string[] }

export function DataTable<T>({ rows, columns, rowKey, caption, rowHref, sort, onSort, defaultSort, mode = 'client', loading, skeletonRows = 8, empty, presets, preset, onPreset, allColumns, onAllColumns, dense, maxHeight, highlightRow, rowClassName, footer }: {
  rows: T[]; columns: Column<T>[]; rowKey: (r: T) => string; caption: string;
  rowHref?: (r: T) => string | null | undefined;
  sort?: Sort | null; onSort?: (s: Sort | null) => void; defaultSort?: Sort;
  mode?: 'client' | 'server';
  loading?: boolean; skeletonRows?: number;
  empty?: ReactNode;
  presets?: Preset[]; preset?: string; onPreset?: (id: string) => void;
  allColumns?: boolean; onAllColumns?: (on: boolean) => void;
  dense?: boolean; maxHeight?: string;
  highlightRow?: (r: T) => boolean; rowClassName?: (r: T) => string;
  footer?: ReactNode;
}) {
  const [innerSort, setInnerSort] = useState<Sort | null>(defaultSort ?? null);
  const [innerAll, setInnerAll] = useState(false);
  const activeSort = sort !== undefined ? sort : innerSort;
  const setSort = onSort ?? setInnerSort;
  const showAll = allColumns ?? innerAll;
  const setShowAll = onAllColumns ?? setInnerAll;

  // Which columns are on: the preset's list plus every priority-1/2 column; priority 3 only via preset or "all".
  const active = useMemo(() => {
    const chosen = presets?.find((p) => p.id === preset) ?? presets?.[0];
    return columns.filter((c) => {
      if (c.primary || c.sticky || showAll) return true;
      if (chosen) return chosen.columns.includes(c.key);
      return (c.priority ?? 1) < 3;
    });
  }, [columns, presets, preset, showAll]);

  const sorted = useMemo(() => {
    if (mode === 'server' || !activeSort) return rows;
    const col = columns.find((c) => c.key === activeSort.key);
    if (!col) return rows;
    const get = (r: T) => (col.value ? col.value(r) : (r as any)[col.key]);
    return [...rows].sort((a, b) => {
      const va = get(a), vb = get(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true });
      return activeSort.dir === 'asc' ? c : -c;
    });
  }, [rows, activeSort, columns, mode]);

  const toggle = (c: Column<T>) => {
    if (activeSort?.key === c.key) setSort({ key: c.key, dir: activeSort.dir === 'asc' ? 'desc' : 'asc' });
    else setSort({ key: c.key, dir: c.num ? 'desc' : 'asc' });
  };

  // Scroll-edge shadows: sentinels at both ends of the scroll container.
  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });
  useEffect(() => {
    const el = scroller.current; if (!el) return;
    const update = () => setEdges({ start: el.scrollLeft > 2, end: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update); ro.observe(el);
    return () => { el.removeEventListener('scroll', update); ro.disconnect(); };
  }, [active.length, sorted.length, loading]);

  const cellPad = dense ? 'py-1' : 'py-1.5';
  const hasPrimary = active.some((c) => c.primary || c.sticky);
  const sortable = (c: Column<T>) => mode !== 'server' && c.sortable !== false;

  return (
    <div className="space-y-2">
      {(presets?.length || onAllColumns || columns.some((c) => (c.priority ?? 1) === 3)) && (
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Columns">
          {presets?.map((p) => <button key={p.id} type="button" className={`chip ${(preset ?? presets[0]?.id) === p.id && !showAll ? 'chip-on' : ''}`} aria-pressed={(preset ?? presets[0]?.id) === p.id && !showAll} onClick={() => { setShowAll(false); onPreset?.(p.id); }}>{p.label}</button>)}
          <button type="button" className={`chip ${showAll ? 'chip-on' : ''}`} aria-pressed={showAll} onClick={() => setShowAll(!showAll)}>All columns</button>
        </div>
      )}
      <div className={`relative frame overflow-hidden ${edges.start ? 'shadow-start' : ''} ${edges.end ? 'shadow-end' : ''}`}>
        <div ref={scroller} className="overflow-auto" style={maxHeight ? { maxHeight } : undefined}>
          <table className="w-full border-separate border-spacing-0 text-left">
            <caption className="sr-only">{caption}</caption>
            <thead>
              <tr>
                {active.map((c) => {
                  const sorting = activeSort?.key === c.key;
                  const stickyCls = c.primary || c.sticky ? 'sticky left-0 z-20' : '';
                  return (
                    <th key={c.key} scope="col" aria-sort={sorting ? (activeSort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                      className={`th ${maxHeight ? 'sticky top-0 z-10' : ''} ${stickyCls} ${c.num ? 'text-right' : ''} ${(c.priority ?? 1) === 2 ? 'hidden md:table-cell' : ''} border-b border-field-700`}>
                      {sortable(c) ? (
                        <button type="button" title={c.title} onClick={() => toggle(c)} className={`group inline-flex items-center gap-1 rounded hover:text-chalk-100 ${c.num ? 'flex-row-reverse' : ''} ${sorting ? 'text-chalk-100' : ''}`}>
                          <span>{c.label}</span>
                          <span aria-hidden className={sorting ? '' : 'opacity-0 transition-opacity duration-150 group-hover:opacity-60 group-focus-visible:opacity-60'}>{sorting ? (activeSort!.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowUpDown size={12} />}</span>
                          {c.title && <span className="sr-only">{c.title}</span>}
                        </button>
                      ) : <span title={c.title}>{c.label}{c.title && <span className="sr-only">, {c.title}</span>}</span>}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="[&>tr:hover>td]:bg-field-800 [&>tr:focus-within>td]:bg-field-800">
              {loading && Array.from({ length: skeletonRows }, (_, i) => (
                <tr key={`sk-${i}`} aria-hidden>
                  {active.map((c) => <td key={c.key} className={`td ${cellPad} ${c.primary || c.sticky ? 'sticky left-0 z-10 bg-field-900' : 'bg-field-900'} ${(c.priority ?? 1) === 2 ? 'hidden md:table-cell' : ''}`}><span className={`skeleton block h-3.5 ${c.num ? 'ml-auto w-8' : c.primary || c.sticky ? 'w-32' : 'w-12'}`} /></td>)}
                </tr>
              ))}
              {!loading && sorted.length === 0 && (
                <tr><td className="p-0" colSpan={active.length}>{typeof empty === 'string' || empty == null ? <EmptyState title={empty ?? 'Nothing to show'} /> : empty}</td></tr>
              )}
              {!loading && sorted.map((r, i) => {
                const href = rowHref?.(r);
                const hl = highlightRow?.(r);
                return (
                  <tr key={rowKey(r)} className={rowClassName?.(r) ?? ''}>
                    {active.map((c) => {
                      const raw = c.value ? c.value(r) : (r as any)[c.key];
                      const cell: ReactNode = c.render ? c.render(r, i) : c.num ? fmt.num(raw, c.decimals ?? 0) : (raw as ReactNode);
                      const isPrimary = c.primary || c.sticky;
                      return (
                        <td key={c.key} className={`td ${cellPad} ${c.num ? 'num' : ''} ${c.wrap ? '!whitespace-normal' : ''} ${isPrimary ? 'sticky left-0 z-10 bg-field-900' : 'bg-field-900'} ${hl ? '!bg-pitch-400/10' : ''} ${(c.priority ?? 1) === 2 ? 'hidden md:table-cell' : ''} ${c.className ?? ''}`}>
                          {isPrimary && href ? <Link to={href} className="font-medium text-chalk-100 hover:text-pitch-300">{cell}</Link> : cell}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {hasPrimary && <span aria-hidden className={`pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-field-950/70 to-transparent transition-opacity duration-150 ${edges.end ? 'opacity-100' : 'opacity-0'}`} />}
      </div>
      {footer}
    </div>
  );
}
