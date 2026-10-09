// The header the pro club, league and player pages share: a gradient card with the crest or photo, the name, a line of
// links and a row of fact chips, with page actions (season, compare) on the right.
import type { ReactNode } from 'react';

export function ProHero({ image, title, line, chips = [], actions, children }: { image: ReactNode; title: ReactNode; line?: ReactNode; chips?: (string | null | undefined | false)[]; actions?: ReactNode; children?: ReactNode }) {
  const shown = chips.filter(Boolean) as string[];
  return (
    <header className="relative overflow-hidden rounded-xl border border-field-700 bg-gradient-to-br from-field-800 via-field-900 to-field-950 p-4 sm:p-6">
      <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-pitch-400/10 blur-3xl" />
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="w-fit shrink-0">{image}</div>
        <div className="min-w-0 flex-1 space-y-2">
          <h1 className="display text-3xl leading-tight text-chalk-100 sm:text-4xl">{title}</h1>
          {line && <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-chalk-300">{line}</div>}
          {shown.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label="Facts">
              {shown.map((c) => <li key={c} className="rounded-full border border-field-600 bg-field-900/70 px-2.5 py-0.5 text-xs text-chalk-200">{c}</li>)}
            </ul>
          )}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2 self-start">{actions}</div>}
      </div>
      {children && <div className="relative mt-4">{children}</div>}
    </header>
  );
}

/** A number with its label, for the strips under a header. */
/** text: the value is a name, not a number (smaller, so it fits on a phone). */
export function StatTile({ label, value, sub, accent, text }: { label: string; value: ReactNode; sub?: ReactNode; accent?: boolean; text?: boolean }) {
  return (
    <div className={`min-w-0 rounded-lg border px-3 py-2.5 ${accent ? 'border-pitch-400/40 bg-pitch-400/5' : 'border-field-700 bg-field-900/60'}`}>
      <div className={`display truncate tnum text-chalk-100 ${text ? 'text-base leading-8 sm:text-xl' : 'text-2xl'}`} title={typeof value === 'string' ? value : undefined}>{value}</div>
      <div className="truncate text-2xs uppercase tracking-wider text-chalk-500">{label}</div>
      {sub != null && <div className="truncate text-2xs text-chalk-400">{sub}</div>}
    </div>
  );
}
