// Small pieces the console tabs share: stat tiles, health dots, sparklines, a drawer, a confirm dialog, a toggle,
// and the form the job catalogue drives.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Check, Copy, X } from 'lucide-react';
import { Field, Select } from '../../components/primitives';
import type { ParamSpec } from '../../lib/console';

export function StatTile({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'ok' | 'warn' | 'bad' }) {
  const ring = tone === 'bad' ? 'border-loss/50' : tone === 'warn' ? 'border-note/50' : tone === 'ok' ? 'border-win/40' : 'border-field-700';
  return (
    <div className={`card min-w-0 border p-3 ${ring}`}>
      <div className="text-2xs font-medium text-chalk-500">{label}</div>
      <div className="display mt-0.5 truncate text-2xl tnum text-chalk-100">{value}</div>
      {sub && <div className="mt-0.5 truncate text-xs text-chalk-400">{sub}</div>}
    </div>
  );
}

export function HealthDot({ ok, label }: { ok: boolean | null; label?: string }) {
  const cls = ok == null ? 'bg-chalk-500' : ok ? 'bg-win' : 'bg-loss';
  return <span className="inline-flex items-center gap-1.5 text-sm"><span aria-hidden className={`inline-block h-2.5 w-2.5 rounded-full ${cls}`} /><span className="sr-only">{ok == null ? 'unknown' : ok ? 'healthy' : 'problem'}</span>{label}</span>;
}

/** A tiny inline line chart; meaning is in the numbers beside it, not the colour. */
export function Sparkline({ points, width = 96, height = 24 }: { points: number[]; width?: number; height?: number }) {
  if (points.length < 2) return <span className="inline-block" style={{ width, height }} aria-hidden />;
  const max = Math.max(...points, 1), min = Math.min(...points, 0);
  const x = (i: number) => (i / (points.length - 1)) * (width - 2) + 1;
  const y = (v: number) => height - 1 - ((v - min) / (max - min || 1)) * (height - 2);
  const d = points.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="shrink-0 text-chalk-400" aria-label={`trend: ${points.join(', ')}`} role="img">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(points.length - 1)} cy={y(points[points.length - 1]!)} r="2" fill="currentColor" />
    </svg>
  );
}

export function Drawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode }) {
  useEffect(() => { if (!open) return; const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true">
      <button type="button" className="flex-1 bg-field-950/70" aria-label="Close" onClick={onClose} />
      <div className="flex h-full w-full max-w-xl flex-col border-l border-field-700 bg-field-900 shadow-xl">
        <div className="flex items-center justify-between gap-3 border-b border-field-700 px-4 py-3"><h2 className="min-w-0 truncate text-base font-semibold text-chalk-100">{title}</h2><button className="btn-icon btn-quiet" onClick={onClose} aria-label="Close"><X size={16} /></button></div>
        <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, title, body, confirmLabel = 'Confirm', danger, busy, onConfirm, onClose }: { open: boolean; title: string; body: ReactNode; confirmLabel?: string; danger?: boolean; busy?: boolean; onConfirm: () => void; onClose: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (open) ref.current?.focus(); }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
      <button type="button" className="absolute inset-0 bg-field-950/70" aria-label="Cancel" onClick={onClose} />
      <div className="card relative w-full max-w-md space-y-3 p-4">
        <h2 id="confirm-title" className="text-base font-semibold text-chalk-100">{title}</h2>
        <div className="text-sm text-chalk-300">{body}</div>
        <div className="flex justify-end gap-2"><button className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button><button ref={ref} className={danger ? 'btn bg-loss text-field-950 hover:bg-loss/90' : 'btn-primary'} onClick={onConfirm} disabled={busy}>{busy ? 'Working…' : confirmLabel}</button></div>
      </div>
    </div>
  );
}

export function Toggle({ on, onChange, label, busy }: { on: boolean; onChange: (v: boolean) => void; label: string; busy?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={busy} onClick={() => onChange(!on)} className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-150 disabled:opacity-50 ${on ? 'border-pitch-400 bg-pitch-400/80' : 'border-field-600 bg-field-800'}`}>
      <span aria-hidden className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-150 ${on ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  );
}

export function CopyField({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  const id = useId();
  const copy = async () => { try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 2000); } catch { /* clipboard blocked */ } };
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="sr-only">{label}</label>
      <input id={id} className="input flex-1 font-mono text-xs" value={value} readOnly onFocus={(e) => e.currentTarget.select()} />
      <button className="btn-ghost btn-sm" onClick={copy}>{done ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}</button>
    </div>
  );
}

/** Inputs for one job's parameters; the value object only holds keys the operator filled in. */
export function ParamForm({ specs, value, onChange }: { specs: ParamSpec[]; value: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void }) {
  const set = (k: string, v: unknown) => { const next = { ...value }; if (v === '' || v === undefined || v === null || (Array.isArray(v) && !v.length)) delete next[k]; else next[k] = v; onChange(next); };
  if (!specs.length) return <p className="text-xs text-chalk-500">This job takes no parameters.</p>;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {specs.map((p) => (
        <Field key={p.name} label={p.label} hint={p.help}>{(id) => {
          const v = value[p.name];
          if (p.type === 'boolean') return <label className="inline-flex h-9 items-center gap-2 text-sm text-chalk-200"><input id={id} type="checkbox" className="h-4 w-4" checked={v === true} onChange={(e) => set(p.name, e.target.checked ? true : undefined)} /><span>{v === true ? 'on' : (p.default === true ? 'default on' : 'off')}</span></label>;
          if (p.type === 'enum') return <Select id={id} value={String(v ?? '')} onChange={(x) => set(p.name, x)} options={[{ value: '', label: p.default ? `default (${String(p.default)})` : '—' }, ...(p.options ?? []).map((o) => ({ value: o, label: o }))]} />;
          if (p.type === 'number') return <input id={id} type="number" className="input w-full" value={v == null ? '' : String(v)} onChange={(e) => set(p.name, e.target.value === '' ? undefined : Number(e.target.value))} />;
          if (p.type === 'string[]') return <input id={id} className="input w-full" placeholder={p.options ? p.options.join(', ') : 'comma-separated'} value={Array.isArray(v) ? v.join(', ') : ''} onChange={(e) => set(p.name, e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} />;
          return <input id={id} className="input w-full" value={v == null ? '' : String(v)} onChange={(e) => set(p.name, e.target.value)} />;
        }}</Field>
      ))}
    </div>
  );
}

export const shortId = (id: string | null | undefined) => (id ? id.slice(0, 8) : '');
export const counterLine = (c: Record<string, unknown> | null | undefined, max = 12) => Object.entries(c ?? {}).filter(([, v]) => typeof v === 'number' && v).slice(0, max).map(([k, v]) => `${k}=${v}`).join(' ');
