// The frame every home-page module sits in: one card, one header row (title, what it covers, a way to see all).
import { useId, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

export function Panel({ title, meta, action, footer, children, className = '' }: { title: ReactNode; meta?: ReactNode; action?: ReactNode; footer?: { to: string; label: string } | null; children: ReactNode; className?: string }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={`card flex min-w-0 flex-col p-4 sm:p-5 ${className}`}>
      <header className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 id={id} className="text-base font-semibold text-chalk-100">{title}</h2>
          {meta && <p className="mt-0.5 text-xs text-chalk-400">{meta}</p>}
        </div>
        {action}
      </header>
      <div className="min-w-0 flex-1">{children}</div>
      {footer && <Link to={footer.to} className="mt-3 inline-flex min-h-9 items-center self-start text-sm font-medium text-pitch-400 hover:text-pitch-300">{footer.label}</Link>}
    </section>
  );
}

/** Scope shared by the modules: gender from the global filter, division local to the home page. */
export interface Scope { season: number; gender: 'm' | 'w'; division: 'd1' | 'd2' | 'd3' }
