// The header the pro club, league and player pages share: a gradient card with the crest or photo, the name, a line of
// links and a row of fact chips, with page actions (season, compare) on the right.
import type { ReactNode } from 'react';

export function ProHero({ image, title, line, chips = [], actions, children }: { image: ReactNode; title: ReactNode; line?: ReactNode; chips?: (string | null | undefined | false)[]; actions?: ReactNode; children?: ReactNode }) {
  const shown = chips.filter(Boolean) as string[];
  return (
    <header className="relative rounded-xl border border-field-700 bg-gradient-to-br from-field-800/80 to-field-900 p-3 sm:p-5">
      <div className="relative flex flex-row flex-wrap items-center gap-3 sm:flex-nowrap sm:gap-4">
        <div className="w-fit shrink-0 [&>*]:max-h-16 sm:[&>*]:max-h-none">{image}</div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <h1 className="display break-words text-2xl leading-tight text-chalk-100 sm:text-3xl">{title}</h1>
          {line && <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-chalk-300">{line}</div>}
          {shown.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label="Facts">
              {shown.map((c) => <li key={c} className="rounded-full bg-field-950/50 px-2 py-0.5 text-2xs text-chalk-300">{c}</li>)}
            </ul>
          )}
        </div>
        {/* Phones: the actions get their own line so the name keeps the width. */}
        {actions && <div className="order-last flex w-full flex-wrap items-center gap-2 sm:order-none sm:w-auto sm:shrink-0 sm:self-start">{actions}</div>}
      </div>
      {children && <div className="relative mt-3">{children}</div>}
    </header>
  );
}

/** A number with its label, for the strips under a header. */
/** text: the value is a name, not a number (smaller, so it fits on a phone). */
export function StatTile({ label, value, sub, accent, text }: { label: string; value: ReactNode; sub?: ReactNode; accent?: boolean; text?: boolean }) {
  return (
    <div className={`min-w-0 rounded-lg px-3 py-2 ${accent ? 'bg-pitch-400/10 ring-1 ring-inset ring-pitch-400/30' : 'bg-field-950/40'}`}>
      <div className={`display truncate tnum text-chalk-100 ${text ? 'text-base leading-7 sm:text-lg' : 'text-xl sm:text-2xl'}`} title={typeof value === 'string' ? value : undefined}>{value}</div>
      <div className="truncate text-2xs text-chalk-400">{label}</div>
      {sub != null && <div className="truncate text-2xs text-chalk-400">{sub}</div>}
    </div>
  );
}
