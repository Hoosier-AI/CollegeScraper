// Filters that fit a phone (ESPN/FotMob pattern): the one or two filters people change most stay in view, the rest
// sit behind a "Filters" button that opens a bottom sheet. From md up, everything is inline as before.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import { useMediaQuery } from '../lib/hooks';

export function FilterBar({ primary, children, active = 0, onReset, label = 'Filters' }: { primary?: ReactNode; children?: ReactNode; active?: number; onReset?: () => void; label?: string }) {
  const wide = useMediaQuery('(min-width: 768px)');
  const [open, setOpen] = useState(false);
  const id = useId();
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => { if (wide) setOpen(false); }, [wide]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    sheet.current?.querySelector<HTMLElement>('button, select, input')?.focus();
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open]);
  if (wide) return <div className="flex flex-wrap items-end gap-x-4 gap-y-3" role="group" aria-label={label}>{primary}{children}</div>;
  return (
    <div className="stack-sm" role="group" aria-label={label}>
      <div className="flex flex-wrap items-end gap-2 [&>*]:min-w-0">
        {primary}
        {children && (
          <button type="button" className={`btn-ghost ml-auto ${active ? 'border-pitch-400/60 text-pitch-300' : ''}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={id} onClick={() => setOpen(true)}>
            <SlidersHorizontal size={16} aria-hidden /> Filters{active ? <span className="rounded-full bg-pitch-400 px-1.5 text-2xs font-semibold text-field-950 tnum">{active}</span> : null}
          </button>
        )}
      </div>
      {open && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" role="presentation">
          <button type="button" aria-label="Close filters" className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <div ref={sheet} id={id} role="dialog" aria-modal="true" aria-label={label} className="relative max-h-[85dvh] overflow-y-auto rounded-t-2xl border-t border-field-700 bg-field-900 shadow-2xl shadow-black/60" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-field-700 bg-field-900 px-4 py-3">
              <h2 className="h-section">{label}</h2>
              <div className="flex items-center gap-1">
                {onReset && active > 0 && <button type="button" className="btn-quiet btn-sm" onClick={onReset}>Reset</button>}
                <button type="button" className="btn-ghost btn-icon" aria-label="Close" onClick={() => setOpen(false)}><X size={18} /></button>
              </div>
            </div>
            <div className="flex flex-col gap-5 px-4 py-4 [&_.input]:w-full [&_.select]:w-full [&_select]:max-w-none [&_[role=radiogroup]]:flex [&_[role=radiogroup]>button]:flex-1">{children}</div>
            <div className="sticky bottom-0 border-t border-field-700 bg-field-900 px-4 py-3"><button type="button" className="btn-primary w-full" onClick={() => setOpen(false)}>Show results</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
