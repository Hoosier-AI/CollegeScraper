// The two actions on a team, player or match page: follow it (kept in this browser, shown first on Home) and share it
// (the phone's share sheet, else the link is copied). The link carries the page's own share card (src/seo/og.ts).
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarPlus, Check, Ellipsis, Share2, Star, type LucideIcon } from 'lucide-react';
import { keyOf, toggleFollow, useFollows, type Follow } from '../lib/follows';
import { tick } from '../lib/files';
import { PUBLIC_HOST, publicUrl } from '../lib/publicOrigin';

const btn = 'inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-pitch-400';

export function ShareButton({ title, text }: { title: string; text?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!copied) return; const t = setTimeout(() => setCopied(false), 2000); return () => clearTimeout(t); }, [copied]);
  async function share() {
    const url = publicUrl(window.location.pathname + window.location.search);
    if (typeof navigator.share === 'function' && window.matchMedia('(pointer: coarse)').matches) {
      try { await navigator.share({ title, text, url }); } catch { /* closed the sheet */ }
      return;
    }
    try { await navigator.clipboard.writeText(url); setCopied(true); } catch { window.prompt('Copy this link', url); }
  }
  return (
    <button type="button" onClick={share} className={`${btn} border-transparent bg-field-900 text-chalk-200 hover:bg-field-800 hover:text-chalk-100`} aria-live="polite">
      {copied ? <Check size={14} aria-hidden className="text-win" /> : <Share2 size={14} aria-hidden />}
      {copied ? 'Link copied' : 'Share'}
    </button>
  );
}

export function FollowButton({ follow }: { follow: Follow }) {
  const on = useFollows().some((f) => keyOf(f) === keyOf(follow));
  return (
    <button type="button" aria-pressed={on} onClick={() => { toggleFollow(follow); void tick(); }}
      className={`${btn} ${on ? 'border-field-600 bg-transparent text-chalk-100 hover:bg-field-800' : 'border-transparent bg-pitch-400 font-semibold text-field-950 hover:bg-pitch-300'}`}
      title={on ? 'Shown first on Scores and in My teams. Kept on this device.' : 'Show it first on Scores and in My teams. Kept on this device, no account needed.'}>
      <Star size={14} aria-hidden className={on ? 'fill-pitch-300 text-pitch-300' : ''} />
      {on ? 'Following' : 'Follow'}
    </button>
  );
}

/** Subscribe to a team's fixtures in the phone's or computer's calendar (webcal: opens Apple and Outlook calendars,
 *  which keep it up to date; the file itself downloads elsewhere). */
export function CalendarButton({ path }: { path: string }) {
  return (
    <a href={`webcal://${PUBLIC_HOST}${path}`} className={`${btn} border-transparent bg-field-900 text-chalk-200 hover:bg-field-800 hover:text-chalk-100`} title="Every match in your calendar, kept up to date">
      <CalendarPlus size={14} aria-hidden />Add to calendar
    </a>
  );
}

export interface MoreAction { label: string; icon: LucideIcon; to?: string; href?: string; onSelect?: () => void }

/** The "…" beside Follow: everything else a page can do (share, calendar, compare, add a photo), in one menu. */
function MoreMenu({ items }: { items: MoreAction[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const row = 'flex min-h-10 w-full items-center gap-2.5 rounded-md px-3 text-left text-sm text-chalk-200 hover:bg-field-800 hover:text-chalk-100';
  return (
    <div ref={root} className="relative">
      <button type="button" className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-field-900 text-chalk-200 transition-colors hover:bg-field-800 hover:text-chalk-100" aria-label="More actions" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((v) => !v)}><Ellipsis size={18} aria-hidden /></button>
      {open && (
        <div className="absolute left-0 top-full z-40 mt-1 w-56 rounded-lg bg-field-900 p-1 shadow-xl shadow-black/50 ring-1 ring-field-700 sm:left-auto sm:right-0">
          {items.map((it) => {
            const inner = <><it.icon size={16} aria-hidden className="shrink-0 text-chalk-400" />{it.label}</>;
            if (it.to) return <Link key={it.label} to={it.to} className={row} onClick={() => setOpen(false)}>{inner}</Link>;
            if (it.href) return <a key={it.label} href={it.href} className={row} onClick={() => setOpen(false)}>{inner}</a>;
            return <button key={it.label} type="button" className={row} onClick={() => { setOpen(false); it.onSelect?.(); }}>{inner}</button>;
          })}
        </div>
      )}
    </div>
  );
}

/** Share this page: the phone's share sheet, else the link is copied. */
async function sharePage(title: string) {
  const url = publicUrl(window.location.pathname + window.location.search);
  if (typeof navigator.share === 'function' && window.matchMedia('(pointer: coarse)').matches) { try { await navigator.share({ title, url }); } catch { /* closed the sheet */ } return; }
  try { await navigator.clipboard.writeText(url); } catch { window.prompt('Copy this link', url); }
}

/** One primary action (Follow) and one menu for the rest, on every team, player, match and competition page. */
export function PageActions({ follow, title, calendar, more = [], className = '' }: { follow?: Follow | null; title: string; calendar?: string | null; more?: MoreAction[]; className?: string }) {
  const items: MoreAction[] = [
    { label: 'Share', icon: Share2, onSelect: () => { void sharePage(title); } },
    ...(calendar ? [{ label: 'Add to calendar', icon: CalendarPlus, href: `webcal://${PUBLIC_HOST}${calendar}` }] : []),
    ...more,
  ];
  return <div className={`flex items-center gap-2 ${className}`}>{follow && <FollowButton follow={follow} />}<MoreMenu items={items} /></div>;
}
