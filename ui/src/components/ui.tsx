import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { fmt } from '../lib/api';

export function Badge({ children, tone = 'gray', title }: { children: ReactNode; tone?: 'gray' | 'teal' | 'amber' | 'red' | 'blue' | 'green'; title?: string }) {
  const map = { gray: 'bg-navy-800 text-ink-300', teal: 'bg-teal-500/20 text-teal-400', amber: 'bg-amber-500/20 text-amber-300', red: 'bg-red-500/20 text-red-300', blue: 'bg-sky-500/20 text-sky-300', green: 'bg-emerald-500/20 text-emerald-300' };
  return <span className={`badge ${map[tone]}`} title={title}>{children}</span>;
}

export function SourceBadge({ source }: { source: 'site' | 'ncaa' | null | undefined }) {
  if (!source) return <Badge tone="red">none</Badge>;
  return <Badge tone={source === 'site' ? 'teal' : 'blue'}>{source}</Badge>;
}

export function TeamLogo({ src, name, size = 24 }: { src?: string | null; name?: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) return <span className="inline-flex shrink-0 items-center justify-center rounded bg-navy-800 text-[10px] text-ink-400" style={{ width: size, height: size }}>{(name ?? '?').slice(0, 2)}</span>;
  return <img src={src} alt={name ?? ''} width={size} height={size} className="shrink-0 rounded bg-white/5 object-contain" style={{ width: size, height: size }} onError={() => setBroken(true)} loading="lazy" />;
}

export function Spinner({ label }: { label?: string }) {
  return <div className="flex items-center gap-2 text-sm text-ink-400"><span className="h-4 w-4 animate-spin rounded-full border-2 border-navy-700 border-t-teal-400" />{label ?? 'Loading…'}</div>;
}

export function ErrorBox({ error }: { error: unknown }) {
  return <div className="card border-red-500/40 text-sm text-red-300">{error instanceof Error ? error.message : String(error)}</div>;
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-xl border border-navy-700 bg-navy-950/60 px-3 py-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">{label}</div>
      <div className="text-lg font-bold tabular-nums text-ink-100">{value}</div>
      {sub && <div className="text-xs text-ink-400">{sub}</div>}
    </div>
  );
}

/** Highlights a computed value against a reference value (e.g. aggregate vs the school's own table). */
export function DiffCell({ value, vs: reference, digits = 0, tolerance = 0 }: { value: unknown; vs: unknown; digits?: number; tolerance?: number }) {
  const a = value == null ? null : Number(value);
  const b = reference == null ? null : Number(reference);
  const same = a === b || (a != null && b != null && Math.abs(a - b) <= tolerance);
  if (b == null) return <span>{fmt.num(a, digits)}</span>;
  return (
    <span className={same ? '' : 'rounded bg-amber-500/20 px-1 text-amber-200'} title={same ? undefined : `source table: ${fmt.num(b, digits)}`}>
      {fmt.num(a, digits)}{!same && <span className="ml-1 text-[10px] text-amber-400">({fmt.num(b, digits)})</span>}
    </span>
  );
}

export function JsonViewer({ value, title }: { value: unknown; title?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-navy-700">
      <button className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-semibold text-ink-300" onClick={() => setOpen(!open)}>
        <span>{title ?? 'Raw JSON'}</span><span className="text-ink-500">{open ? '▾' : '▸'}</span>
      </button>
      {open && <pre className="max-h-[480px] overflow-auto border-t border-navy-700 p-3 text-[11px] leading-snug text-ink-300">{JSON.stringify(value, null, 2)}</pre>}
    </div>
  );
}

export interface Column<T> { key: string; label: string; render?: (row: T) => ReactNode; value?: (row: T) => unknown; num?: boolean; title?: string; className?: string; sticky?: boolean }

/** Sortable table with sticky header. Sorting uses `value` (or the row field named by key). */
export function DataTable<T>({ rows, columns, rowKey, onRow, rowHref, empty = 'No rows', defaultSort, dense }: { rows: T[]; columns: Column<T>[]; rowKey: (r: T) => string; onRow?: (r: T) => void; rowHref?: (r: T) => string; empty?: string; defaultSort?: { key: string; dir: 'asc' | 'desc' }; dense?: boolean }) {
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(defaultSort ?? null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    const get = (r: T) => (col?.value ? col.value(r) : (r as any)[sort.key]);
    return [...rows].sort((a, b) => {
      const va = get(a), vb = get(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true });
      return sort.dir === 'asc' ? c : -c;
    });
  }, [rows, sort, columns]);
  const toggle = (key: string) => setSort((s) => (s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: columns.find((c) => c.key === key)?.num ? 'desc' : 'asc' }));
  return (
    <div className="overflow-auto rounded-xl border border-navy-700">
      <table className="min-w-full border-collapse">
        <thead>
          <tr>{columns.map((c) => (
            <th key={c.key} className={`th ${c.num ? 'text-right' : ''} ${c.sticky ? 'left-0 z-20' : ''}`} title={c.title} onClick={() => toggle(c.key)}>
              {c.label}{sort?.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
            </th>
          ))}</tr>
        </thead>
        <tbody>
          {sorted.length === 0 && <tr><td className="td text-ink-500" colSpan={columns.length}>{empty}</td></tr>}
          {sorted.map((r) => (
            <tr key={rowKey(r)} className={`${onRow || rowHref ? 'cursor-pointer hover:bg-navy-800/60' : ''}`} onClick={() => onRow?.(r)}>
              {columns.map((c) => {
                const cell: ReactNode = c.render ? c.render(r) : (() => { const v = c.value ? c.value(r) : (r as any)[c.key]; return c.num ? fmt.num(v, 0) : (v as ReactNode); })();
                return <td key={c.key} className={`td ${c.num ? 'num' : ''} ${dense ? 'py-1' : ''} ${c.sticky ? 'sticky left-0 bg-navy-900' : ''} ${c.className ?? ''}`}>{rowHref && c.sticky ? <Link to={rowHref(r)} className="hover:text-teal-400">{cell}</Link> : cell}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; count?: number }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1 border-b border-navy-700">
      {tabs.map((t) => (
        <button key={t.id} onClick={() => onChange(t.id)} className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${value === t.id ? 'border-teal-400 text-ink-100' : 'border-transparent text-ink-400 hover:text-ink-100'}`}>
          {t.label}{t.count != null && <span className="ml-1 text-xs text-ink-500">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Section({ title, children, right }: { title: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between"><h2 className="text-sm font-bold uppercase tracking-wide text-ink-400">{title}</h2>{right}</div>
      {children}
    </section>
  );
}
