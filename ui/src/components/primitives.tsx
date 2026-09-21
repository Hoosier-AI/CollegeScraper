// Small building blocks shared by every page. Nothing here knows about soccer except FormPips and VerifiedMark.
import { useId, useState, type ReactNode, type SelectHTMLAttributes } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Check, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Clock, Info, Minus, RotateCw, SearchX } from 'lucide-react';
import { fmt } from '../lib/api';

/* ---------- text ---------- */

export function Badge({ children, tone = 'gray', title, className = '' }: { children: ReactNode; tone?: 'gray' | 'teal' | 'amber' | 'red' | 'blue' | 'green'; title?: string; className?: string }) {
  const map = { gray: 'bg-field-800 text-chalk-300', teal: 'bg-pitch-400/15 text-pitch-300', amber: 'bg-note/15 text-note', red: 'bg-loss/15 text-loss', blue: 'bg-sky-500/15 text-sky-300', green: 'bg-win/15 text-win' };
  return <span className={`badge ${map[tone]} ${className}`} title={title}>{children}</span>;
}

export function SourceBadge({ source }: { source: 'site' | 'ncaa' | null | undefined }) {
  if (!source) return <Badge tone="red">no source</Badge>;
  return <Badge tone={source === 'site' ? 'teal' : 'blue'}>{source === 'site' ? 'school site' : 'NCAA.com'}</Badge>;
}

/** Page title row: title on the left, controls on the right, both wrapping on narrow screens. */
export function PageHeader({ title, meta, children, as = 'h1' }: { title: ReactNode; meta?: ReactNode; children?: ReactNode; as?: 'h1' | 'h2' }) {
  const H = as;
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <H className={`display text-chalk-100 ${as === 'h1' ? 'text-2xl sm:text-3xl' : 'text-xl sm:text-2xl'}`}>{title}</H>
        {meta && <p className="mt-1 text-sm text-chalk-400">{meta}</p>}
      </div>
      {children && <div className="flex flex-wrap items-end gap-2">{children}</div>}
    </div>
  );
}

export function Section({ title, children, right, id }: { title: ReactNode; children: ReactNode; right?: ReactNode; id?: string }) {
  return (
    <section className="min-w-0 space-y-2" id={id}>
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-base font-semibold text-chalk-100">{title}</h2>{right}</div>
      {children}
    </section>
  );
}

/* ---------- media ---------- */

const NCAA_LOGO = (seo: string) => `https://www.ncaa.com/sites/default/files/images/logos/schools/bgl/${seo}.svg`;
/** A team crest on a light chip, so navy-on-transparent logos (Notre Dame, California) stay visible on the dark page. */
export function TeamLogo({ src, name, seo, size = 24, fallback = 'initials', chip = true }: { src?: string | null; name?: string | null; seo?: string | null; size?: number; fallback?: 'initials' | 'blank'; chip?: boolean }) {
  const [broken, setBroken] = useState<string | null>(null);
  const url = src || (seo && !seo.startsWith('x-') ? NCAA_LOGO(seo) : null);
  if (!url || broken === url) return <span aria-hidden className={`inline-flex shrink-0 items-center justify-center rounded text-2xs font-medium text-chalk-400 ${fallback === 'blank' ? '' : 'bg-field-800'}`} style={{ width: size, height: size }}>{fallback === 'blank' ? '' : (name ?? '?').slice(0, 2)}</span>;
  return <span className={`inline-flex shrink-0 items-center justify-center overflow-hidden ${chip ? 'rounded bg-white' : ''}`} style={{ width: size, height: size, padding: chip ? Math.max(1, Math.round(size / 12)) : 0 }}><img src={url} alt="" width={size} height={size} className="h-full w-full object-contain" onError={() => setBroken(url)} loading="lazy" /></span>;
}

/** PrestoSports photos sit behind a bot challenge and cannot be hotlinked; showing them would leave broken images. */
export const hotlinkable = (url: string | null | undefined): boolean => !!url && !/prestosports\.com|\/sports\/[a-z]+\/\d{4}-\d{2}\/photos\//i.test(url);

/** A player's photo in a circle, or initials on the team's chip when there is no usable photo. */
export function PlayerAvatar({ src, name, size = 24, crest, crestSeo }: { src?: string | null; name?: string | null; size?: number; crest?: string | null; crestSeo?: string | null }) {
  const [broken, setBroken] = useState(false);
  const usable = hotlinkable(src) && !broken;
  if (usable) return <img src={src!} alt="" width={size} height={size} className="shrink-0 rounded-full bg-field-800 object-cover" style={{ width: size, height: size }} onError={() => setBroken(true)} loading="lazy" />;
  if (crest || crestSeo) return <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}><TeamLogo src={crest} seo={crestSeo} name={name} size={size} /></span>;
  const initials = (name ?? '').split(/\s+/).filter(Boolean).map((w) => w[0]!.toUpperCase()).slice(0, 2).join('') || '?';
  return <span aria-hidden className="inline-flex shrink-0 items-center justify-center rounded-full bg-field-800 font-medium text-chalk-400" style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size / 2.6)) }}>{initials}</span>;
}

/* ---------- state ---------- */

export function Skeleton({ className = '', lines = 1 }: { className?: string; lines?: number }) {
  return <span aria-hidden className="block space-y-2">{Array.from({ length: lines }, (_, i) => <span key={i} className={`skeleton block h-4 ${i === lines - 1 && lines > 1 ? 'w-2/3' : 'w-full'} ${className}`} />)}</span>;
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return <div role="status" className="flex items-center gap-2 text-sm text-chalk-400"><span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-field-700 border-t-pitch-400 motion-reduce:animate-none" />{label}</div>;
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="frame flex flex-col items-center gap-2 px-4 py-10 text-center">
      <span className="text-chalk-500">{icon ?? <SearchX size={24} />}</span>
      <p className="font-medium text-chalk-100">{title}</p>
      {body && <p className="max-w-md text-sm text-chalk-400">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorBox({ error, retry }: { error: unknown; retry?: () => void }) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div role="alert" className="frame flex flex-wrap items-center gap-3 border-loss/40 px-4 py-3 text-sm">
      <AlertTriangle size={18} className="shrink-0 text-loss" />
      <span className="text-chalk-100">Couldn't load this. <span className="text-chalk-400">{msg}</span></span>
      {retry && <button className="btn-ghost btn-sm ml-auto" onClick={retry}><RotateCw size={14} /> Try again</button>}
    </div>
  );
}

/* ---------- controls ---------- */

export function Field({ label, children, hint, className = '' }: { label: string; children: (id: string) => ReactNode; hint?: string; className?: string }) {
  const id = useId();
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label htmlFor={id} className="text-2xs font-medium text-chalk-500">{label}</label>
      {children(id)}
      {hint && <span className="text-2xs text-chalk-500">{hint}</span>}
    </div>
  );
}

export function Select({ options, value, onChange, className = '', ...rest }: { options: { value: string; label: string; group?: string }[]; value: string; onChange: (v: string) => void; className?: string } & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value'>) {
  const groups = [...new Set(options.map((o) => o.group))];
  const render = (o: { value: string; label: string }) => <option key={o.value} value={o.value}>{o.label}</option>;
  return (
    <select className={`select ${className}`} value={value} onChange={(e) => onChange(e.target.value)} {...rest}>
      {groups.length === 1 && groups[0] === undefined ? options.map(render) : groups.map((g) => g === undefined ? options.filter((o) => !o.group).map(render) : <optgroup key={g} label={g}>{options.filter((o) => o.group === g).map(render)}</optgroup>)}
    </select>
  );
}

export function SegmentedControl<T extends string>({ options, value, onChange, label, size = 'md' }: { options: { value: T; label: ReactNode; title?: string }[]; value: T; onChange: (v: T) => void; label: string; size?: 'sm' | 'md' }) {
  const idx = options.findIndex((o) => o.value === value);
  const move = (d: number) => { const next = options[(idx + d + options.length) % options.length]; if (next) onChange(next.value); };
  return (
    <div role="radiogroup" aria-label={label} className={`inline-flex rounded-md border border-field-700 bg-field-950 p-0.5 ${size === 'sm' ? 'text-xs' : 'text-sm'}`}
      onKeyDown={(e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(1); } if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(-1); } }}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} tabIndex={o.value === value ? 0 : -1} title={o.title}
          className={`rounded px-2.5 font-medium transition-colors duration-150 ${size === 'sm' ? 'py-1 coarse:min-h-8' : 'py-1.5 coarse:min-h-10'} ${o.value === value ? 'bg-field-700 text-chalk-100' : 'text-chalk-400 hover:text-chalk-100'}`}
          onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Chip({ on, children, onClick, to, title }: { on?: boolean; children: ReactNode; onClick?: () => void; to?: string; title?: string }) {
  const cls = `chip ${on ? 'chip-on' : ''}`;
  if (to) return <Link to={to} className={cls} title={title} aria-current={on ? 'true' : undefined}>{children}</Link>;
  if (!onClick) return <span className={cls} title={title}>{children}</span>;
  return <button type="button" className={cls} onClick={onClick} aria-pressed={on} title={title}>{children}</button>;
}

/** Tab strip rendered as links so tabs are addressable and open in new tabs. */
export function TabsNav<T extends string>({ tabs, value, hrefFor, label }: { tabs: { id: T; label: string; count?: number }[]; value: T; hrefFor: (id: T) => string; label: string }) {
  return (
    <nav aria-label={label} className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <div className="flex min-w-max gap-1 border-b border-field-700">
        {tabs.map((t) => (
          <Link key={t.id} to={hrefFor(t.id)} replace aria-current={value === t.id ? 'page' : undefined}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors duration-150 coarse:py-3 ${value === t.id ? 'border-pitch-400 text-chalk-100' : 'border-transparent text-chalk-400 hover:text-chalk-100'}`}>
            {t.label}{t.count != null && <span className="ml-1.5 text-xs text-chalk-500 tnum">{t.count}</span>}
          </Link>
        ))}
      </div>
    </nav>
  );
}

export function Pager({ page, pageSize, total, onPage, busy, noun }: { page: number; pageSize: number; total: number; onPage: (p: number) => void; busy?: boolean; noun: string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? page * pageSize + 1 : 0, to = Math.min(total, (page + 1) * pageSize);
  return (
    <nav aria-label={`${noun} pages`} className="flex flex-wrap items-center gap-2 text-sm text-chalk-400">
      <span aria-live="polite">{total ? <>{fmt.num(from)}–{fmt.num(to)} of <b className="font-medium text-chalk-100">{fmt.num(total)}</b> {noun}</> : `No ${noun}`}{busy && <span className="ml-2 text-chalk-500">updating…</span>}</span>
      {pages > 1 && (
        <span className="ml-auto flex items-center gap-1">
          <button className="btn-ghost btn-icon" disabled={page === 0 || busy} onClick={() => onPage(0)} aria-label="First page"><ChevronsLeft size={16} /></button>
          <button className="btn-ghost btn-icon" disabled={page === 0 || busy} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft size={16} /></button>
          <span className="px-1 tnum">Page {fmt.num(page + 1)} of {fmt.num(pages)}</span>
          <button className="btn-ghost btn-icon" disabled={page + 1 >= pages || busy} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight size={16} /></button>
          <button className="btn-ghost btn-icon" disabled={page + 1 >= pages || busy} onClick={() => onPage(pages - 1)} aria-label="Last page"><ChevronsRight size={16} /></button>
        </span>
      )}
    </nav>
  );
}

/* ---------- soccer ---------- */

const PIP = { W: 'bg-win/20 text-win', L: 'bg-loss/20 text-loss', T: 'bg-draw/15 text-draw' } as const;

/** Result letters as pips, oldest first, each carrying its letter so colour is never the only signal. */
export function FormPips({ form, size = 'md', label = 'Form' }: { form: string | null | undefined; size?: 'sm' | 'md'; label?: string }) {
  const letters = (form ?? '').toUpperCase().split('').filter((c): c is 'W' | 'L' | 'T' => c === 'W' || c === 'L' || c === 'T');
  if (!letters.length) return <span className="text-chalk-500">–</span>;
  return (
    <span className="inline-flex gap-0.5" role="img" aria-label={`${label}: ${letters.join(' ')}`}>
      {letters.map((c, i) => <span key={i} aria-hidden className={`inline-flex items-center justify-center rounded font-semibold tnum ${size === 'sm' ? 'h-4 w-4 text-[10px]' : 'h-6 w-6 text-xs'} ${PIP[c]}`}>{c}</span>)}
    </span>
  );
}

export function ResultBadge({ result, us, them, ot, pk, forfeit }: { result: 'W' | 'L' | 'T' | null; us?: number | null; them?: number | null; ot?: boolean | null; pk?: boolean | null; forfeit?: boolean | null }) {
  if (!result) return <span className="text-chalk-500">–</span>;
  return (
    <span className="inline-flex items-center gap-1.5 tnum">
      <span className={`inline-flex h-6 w-6 items-center justify-center rounded text-xs font-semibold ${PIP[result]}`}>{result}</span>
      {forfeit ? <span className="text-2xs text-chalk-400" title="Forfeit: counted in the conference table only">Forfeit</span> : us != null && <span className="font-medium text-chalk-100">{us}–{them}</span>}
      {!forfeit && (ot || pk) && <span className="text-2xs text-chalk-500">{pk ? 'PK' : 'OT'}</span>}
    </span>
  );
}

export type VerifyState = 'ok' | 'lag' | 'mismatch' | 'none';

/** How a record compares with its official source: icon + word, with the numbers one tap away. */
export function VerifiedMark({ state, details, compact }: { state: VerifyState; details?: { field: string; official: string; ours: string }[]; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const map = {
    ok: { icon: <Check size={14} />, word: 'Verified', cls: 'text-win', help: 'Matches the official source' },
    lag: { icon: <Clock size={14} />, word: 'Source behind', cls: 'text-chalk-400', help: 'Every result the source lists is in our record; we hold games it has not posted yet' },
    mismatch: { icon: <AlertTriangle size={14} />, word: 'Differs', cls: 'text-note', help: 'Our record differs from the official source' },
    none: { icon: <Minus size={14} />, word: 'Not checked', cls: 'text-chalk-500', help: 'No official source to compare with' },
  }[state];
  const content = <span className={`inline-flex items-center gap-1 text-xs ${map.cls}`}>{map.icon}{!compact && <span>{map.word}</span>}</span>;
  if (!details?.length) return <span title={map.help} aria-label={`${map.word}: ${map.help}`}>{content}</span>;
  return (
    <span className="relative inline-block">
      <button type="button" className="rounded px-0.5 hover:bg-field-800" aria-expanded={open} aria-controls={id} aria-label={`${map.word} — show details`} onClick={() => setOpen((o) => !o)}>{content}</button>
      {open && (
        <span id={id} role="note" className="absolute left-0 top-full z-30 mt-1 block w-max max-w-[260px] rounded-md border border-field-700 bg-field-900 p-2 text-left text-xs shadow-lg shadow-black/40">
          <span className="mb-1 block text-chalk-400">{map.help}.</span>
          {details.map((d, i) => <span key={i} className="block tnum"><span className="text-chalk-400">{d.field.replace(/_/g, ' ')}:</span> official <b className="text-chalk-100">{d.official}</b>, ours <b className="text-chalk-100">{d.ours}</b></span>)}
        </span>
      )}
    </span>
  );
}

/** A number with its label, for mastheads and summary strips. */
export function Figure({ label, value, sub, big }: { label: string; value: ReactNode; sub?: ReactNode; big?: boolean }) {
  return (
    <div className="min-w-0">
      <div className={`display tnum text-chalk-100 ${big ? 'text-3xl sm:text-4xl' : 'text-xl'}`}>{value}</div>
      <div className="text-xs text-chalk-500">{label}{sub && <span className="text-chalk-400">, {sub}</span>}</div>
    </div>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="flex items-start gap-2 text-xs text-chalk-400"><Info size={14} className="mt-0.5 shrink-0" /><span>{children}</span></p>;
}

export function JsonViewer({ value, title }: { value: unknown; title?: string }) {
  return (
    <details className="frame">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-chalk-300">{title ?? 'Raw JSON'}</summary>
      <pre className="max-h-[480px] overflow-auto border-t border-field-700 p-3 text-2xs leading-snug text-chalk-300">{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}
