// Cookie-free analytics (src/api/analytics.ts): one beacon per page change and one per search the visitor settles on.
// Nothing is stored in the browser and nothing identifies the visitor; the owner (an admin token here) is not counted.
import { isAdmin } from './api';

let lastPath = '';
let landed = false;

// A view is only sent once a person is on the page: real input (a pointer move, tap or key press the browser marks as
// trusted; a scroll does not count, a script scrolling the page fires one too) after the page has been in view for
// at least three seconds. A crawler driving a real browser passed the first version of this (scroll) for ~90,000
// "visitors" on 2026-10-20 (it runs 03:00-16:00 UTC, about 100k requests an hour). Automated browsers that say so
// (navigator.webdriver) never send. Until then the latest view waits; it goes the moment both are true.
let human = false;
let waiting: Record<string, unknown> | null = null;
const now = () => (typeof performance !== 'undefined' ? performance.now() : 0);
const DWELL_MS = 3000;
let visibleMs = 0; let visibleSince: number | null = null;
let input = false;
const shownFor = () => visibleMs + (visibleSince != null ? now() - visibleSince : 0);
function check(): void {
  if (human || !input || shownFor() < DWELL_MS) return;
  human = true;
  for (const ev of HUMAN_EVENTS) window.removeEventListener(ev, onInput, true);
  if (waiting) { const w = waiting; waiting = null; send(w); }
}
function onInput(e: Event): void {
  if (!e.isTrusted || input) return;
  input = true;
  check();
  // Input before three seconds in view: the view goes once the page has been in view long enough.
  if (!human) setTimeout(check, Math.max(0, DWELL_MS - shownFor()) + 50);
}
const HUMAN_EVENTS = ['pointermove', 'pointerdown', 'keydown', 'touchstart'] as const;
if (typeof window !== 'undefined' && !(navigator as Navigator & { webdriver?: boolean }).webdriver) {
  if (document.visibilityState === 'visible') visibleSince = now();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') visibleSince = now();
    else if (visibleSince != null) { visibleMs += now() - visibleSince; visibleSince = null; }
  });
  for (const ev of HUMAN_EVENTS) window.addEventListener(ev, onInput, { capture: true, passive: true });
}

function send(body: Record<string, unknown>): void {
  if (isAdmin()) return;
  if (body.t === 'view' && !human) { waiting = body; return; }
  if (body.t === 'view') body = { ...body, h: 1 };
  try {
    const data = JSON.stringify(body);
    if (!navigator.sendBeacon?.('/api/t', data)) void fetch('/api/t', { method: 'POST', body: data, keepalive: true, headers: { 'Content-Type': 'text/plain' } }).catch(() => {});
  } catch { /* analytics never breaks the page */ }
}

/** A page view. The referrer goes with the first page of the visit only (where the visitor came from). */
export function trackView(path: string): void {
  if (path === lastPath) return;
  lastPath = path;
  send({ t: 'view', path, ref: landed ? null : document.referrer || null });
  landed = true;
}

let pending: { scope: 'college' | 'pro' | 'all'; q: string; n: number } | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let lastSent = '';

/** The search box's latest answer. Sent once typing has stopped for a moment, or at once when a result is picked. */
export function trackSearch(scope: 'college' | 'pro' | 'all', q: string, n: number): void {
  if (q.trim().length < 2) return;
  pending = { scope, q: q.trim(), n };
  if (timer) clearTimeout(timer);
  timer = setTimeout(flushSearch, 1500);
}

export function flushSearch(): void {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!pending) return;
  const key = `${pending.scope}|${pending.q.toLowerCase()}`;
  if (key !== lastSent) send({ t: 'search', ...pending });
  lastSent = key; pending = null;
}
