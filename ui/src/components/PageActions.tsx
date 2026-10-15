// The two actions on a team, player or match page: follow it (kept in this browser, shown first on Home) and share it
// (the phone's share sheet, else the link is copied). The link carries the page's own share card (src/seo/og.ts).
import { useEffect, useState } from 'react';
import { CalendarPlus, Check, Share2, Star } from 'lucide-react';
import { keyOf, toggleFollow, useFollows, type Follow } from '../lib/follows';

const btn = 'inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-pitch-400';

export function ShareButton({ title, text }: { title: string; text?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!copied) return; const t = setTimeout(() => setCopied(false), 2000); return () => clearTimeout(t); }, [copied]);
  async function share() {
    const url = window.location.href.split('#')[0]!;
    if (typeof navigator.share === 'function' && window.matchMedia('(pointer: coarse)').matches) {
      try { await navigator.share({ title, text, url }); } catch { /* closed the sheet */ }
      return;
    }
    try { await navigator.clipboard.writeText(url); setCopied(true); } catch { window.prompt('Copy this link', url); }
  }
  return (
    <button type="button" onClick={share} className={`${btn} border-field-700 bg-field-900 text-chalk-200 hover:border-field-600 hover:text-chalk-100`} aria-live="polite">
      {copied ? <Check size={14} aria-hidden className="text-win" /> : <Share2 size={14} aria-hidden />}
      {copied ? 'Link copied' : 'Share'}
    </button>
  );
}

export function FollowButton({ follow }: { follow: Follow }) {
  const on = useFollows().some((f) => keyOf(f) === keyOf(follow));
  return (
    <button type="button" aria-pressed={on} onClick={() => toggleFollow(follow)}
      className={`${btn} ${on ? 'border-note/40 bg-note/10 text-note hover:bg-note/15' : 'border-field-700 bg-field-900 text-chalk-200 hover:border-field-600 hover:text-chalk-100'}`}
      title={on ? 'Shown first on the home page. Kept in this browser.' : 'Show it first on the home page. Kept in this browser, no account needed.'}>
      <Star size={14} aria-hidden className={on ? 'fill-note' : ''} />
      {on ? 'Following' : 'Follow'}
    </button>
  );
}

/** Subscribe to a team's fixtures in the phone's or computer's calendar (webcal: opens Apple and Outlook calendars,
 *  which keep it up to date; the file itself downloads elsewhere). */
export function CalendarButton({ path }: { path: string }) {
  const host = typeof window !== 'undefined' ? window.location.host : 'www.plaibook.live';
  return (
    <a href={`webcal://${host}${path}`} className={`${btn} border-field-700 bg-field-900 text-chalk-200 hover:border-field-600 hover:text-chalk-100`} title="Every match in your calendar, kept up to date">
      <CalendarPlus size={14} aria-hidden />Add to calendar
    </a>
  );
}

export function PageActions({ follow, title, calendar, className = '' }: { follow?: Follow | null; title: string; calendar?: string | null; className?: string }) {
  return <div className={`flex flex-wrap items-center gap-2 ${className}`}>{follow && <FollowButton follow={follow} />}<ShareButton title={title} />{calendar && <CalendarButton path={calendar} />}</div>;
}
