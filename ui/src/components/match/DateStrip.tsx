// Seven days around the chosen date, arrow keys and a native date input for anything further.
import { useEffect, useRef } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { dayChip, shiftIso } from '../../lib/dates';

export function DateStrip({ date, today, onChange, counts }: { date: string; today: string; onChange: (iso: string) => void; counts?: Record<string, number> }) {
  const days = Array.from({ length: 7 }, (_, i) => shiftIso(date, i - 3));
  const input = useRef<HTMLInputElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  // On narrow screens the chosen day is scrolled to the middle of the strip.
  useEffect(() => { const el = strip.current?.querySelector<HTMLElement>('[aria-pressed="true"]'); el?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'instant' as ScrollBehavior }); }, [date]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      if (e.key === 'ArrowLeft') onChange(shiftIso(date, -1)); else if (e.key === 'ArrowRight') onChange(shiftIso(date, 1));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [date, onChange]);
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Choose a day">
      <button className="btn-ghost btn-icon shrink-0" aria-label="Previous day" onClick={() => onChange(shiftIso(date, -1))}><ChevronLeft size={16} /></button>
      <div ref={strip} className="flex min-w-0 flex-1 gap-1 overflow-x-auto scroll-smooth [scrollbar-width:none]">
        {days.map((d) => {
          const c = dayChip(d, today); const on = d === date; const n = counts?.[d];
          return (
            <button key={d} onClick={() => onChange(d)} aria-pressed={on} aria-label={`${c.top} ${c.bottom}${n != null ? `, ${n} matches` : ''}`}
              className={`flex min-w-[64px] flex-1 flex-col items-center rounded-md border px-2 py-1.5 text-xs transition-colors duration-150 coarse:min-h-11 ${on ? 'border-pitch-400/60 bg-pitch-400/15 text-chalk-100' : d === today ? 'border-field-700 text-chalk-100 hover:bg-field-800' : 'border-field-700 text-chalk-400 hover:bg-field-800 hover:text-chalk-100'}`}>
              <span className={`font-medium ${on ? 'text-pitch-300' : ''}`}>{c.top}</span>
              <span className="text-2xs tnum">{c.bottom}</span>
            </button>
          );
        })}
      </div>
      <button className="btn-ghost btn-icon shrink-0" aria-label="Next day" onClick={() => onChange(shiftIso(date, 1))}><ChevronRight size={16} /></button>
      <label className="sr-only" htmlFor="pick-date">Pick a date</label>
      <span className="relative shrink-0">
        <button type="button" className="btn-ghost btn-icon sm:hidden" aria-label="Pick a date" onClick={() => input.current?.showPicker?.()}><CalendarDays size={16} /></button>
        <input id="pick-date" ref={input} type="date" value={date} onChange={(e) => e.target.value && onChange(e.target.value)} className="input absolute inset-0 h-9 w-9 opacity-0 sm:static sm:h-9 sm:w-36 sm:opacity-100" aria-label="Pick a date" tabIndex={-1} />
      </span>
    </div>
  );
}
