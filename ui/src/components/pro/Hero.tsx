// The header the pro club, league and player pages share: a gradient card with the crest or photo, the name, a line of
// links and a row of fact chips, with page actions (season, compare) on the right.
import type { ReactNode } from 'react';

/** badge: one emphasised thing beside the name (a player's season rating). */
export function ProHero({ image, title, line, chips = [], actions, badge, children }: { image: ReactNode; title: ReactNode; line?: ReactNode; chips?: (string | null | undefined | false)[]; actions?: ReactNode; badge?: ReactNode; children?: ReactNode }) {
  const shown = chips.filter(Boolean) as string[];
  return (
    <header className="relative rounded-xl border border-field-700 bg-gradient-to-br from-field-800/80 to-field-900 pad">
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
        {badge && <div className="shrink-0 self-start sm:order-last sm:ml-2">{badge}</div>}
        {/* Phones: the actions get their own line so the name keeps the width. */}
        {actions && <div className="order-last flex w-full flex-wrap items-center gap-2 sm:order-none sm:w-auto sm:shrink-0 sm:self-start">{actions}</div>}
      </div>
      {children && <div className="relative mt-4 space-y-3">{children}</div>}
    </header>
  );
}

// The one stat tile lives in primitives; re-exported here for the pages that import it from the hero.
export { StatTile } from '../primitives';

/** Facts under a header (FotMob style): small label over a value, in a hairline grid. 3 across on a phone, 6 from md. */
export function FactGrid({ facts, label = 'Facts' }: { facts: ({ label: string; value: ReactNode; sub?: ReactNode; title?: string } | null | false | undefined)[]; label?: string }) {
  const shown = facts.filter(Boolean) as { label: string; value: ReactNode; sub?: ReactNode; title?: string }[];
  if (!shown.length) return null;
  return (
    <dl aria-label={label} className="grid grid-cols-3 gap-px overflow-hidden rounded-lg bg-field-700/70 md:grid-cols-6">
      {shown.map((f) => (
        <div key={f.label} className="min-w-0 bg-field-900/90 px-3 py-2" title={f.title}>
          <dt className="truncate text-2xs text-chalk-500">{f.label}</dt>
          <dd className="truncate text-sm font-semibold text-chalk-100 tnum">{f.value}</dd>
          {f.sub != null && <dd className="truncate text-2xs text-chalk-400">{f.sub}</dd>}
        </div>
      ))}
      {/* Fill the last row so the grid has no hole. */}
      {Array.from({ length: (3 - (shown.length % 3)) % 3 }, (_, i) => <div key={`f${i}`} aria-hidden className="bg-field-900/90 md:hidden" />)}
      {Array.from({ length: (6 - (shown.length % 6)) % 6 }, (_, i) => <div key={`m${i}`} aria-hidden className="hidden bg-field-900/90 md:block" />)}
    </dl>
  );
}
