// Cookie-free analytics (src/api/analytics.ts): one beacon per page change and one per search the visitor settles on.
// Nothing is stored in the browser and nothing identifies the visitor; the owner (an admin token here) is not counted.
import { isAdmin } from './api';

let lastPath = '';
let landed = false;

// A view is only sent once a person is on the page: a scroll, touch, key or pointer move (automated browsers that
// crawl the site load pages but never do any of these, and announce themselves through navigator.webdriver). Until
// then the latest view waits; it goes the moment the visitor shows up.
let human = false;
let waiting: Record<string, unknown> | null = null;
function onHuman(): void {
  if (human) return;
  human = true;
  for (const ev of HUMAN_EVENTS) window.removeEventListener(ev, onHuman, true);
  if (waiting) { const w = waiting; waiting = null; send(w); }
}
const HUMAN_EVENTS = ['pointermove', 'pointerdown', 'scroll', 'wheel', 'keydown', 'touchstart'] as const;
if (typeof window !== 'undefined' && !(navigator as Navigator & { webdriver?: boolean }).webdriver) {
  for (const ev of HUMAN_EVENTS) window.addEventListener(ev, onHuman, { capture: true, passive: true });
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
