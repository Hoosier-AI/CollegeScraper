// Cookie-free analytics (src/api/analytics.ts): one beacon per page change and one per search the visitor settles on.
// Nothing is stored in the browser and nothing identifies the visitor; the owner (an admin token here) is not counted.
import { isAdmin } from './api';
import { isEngaged, SECOND_PAGE_MS, STAY_MS } from './engaged';

let lastPath = '';
let landed = false;

// A view is only sent once a person is on the page: real input (a pointer move, tap or key press the browser marks as
// trusted; a scroll does not count, a script scrolling the page fires one too) and then either a second page or a
// stay (engaged.ts has the rule and why: a crawler in real browsers passed "one input after three seconds" twice,
// 2026-10-20 and 2026-11-14). Automated browsers that say so (navigator.webdriver) never send. Until then the visit's
// views wait (the first few, in order); they go the moment the visit counts.
let human = false;
const waiting: Record<string, unknown>[] = [];
const MAX_WAITING = 8;
const now = () => (typeof performance !== 'undefined' ? performance.now() : 0);
let visibleMs = 0; let visibleSince: number | null = null;
let firstInputMs: number | null = null; let lastInputMs: number | null = null;
let pages = 0;
let timer0: ReturnType<typeof setTimeout> | null = null;
const shownFor = () => visibleMs + (visibleSince != null ? now() - visibleSince : 0);
function check(): void {
  if (human) return;
  const shownMs = shownFor();
  if (!isEngaged({ input: firstInputMs != null, shownMs, firstInputMs, lastInputMs, pages })) {
    // Looked at again when the next threshold can have passed; after the last one only input or a new page can
    // change the answer, and both call this.
    if (firstInputMs != null && !timer0 && shownMs < STAY_MS) timer0 = setTimeout(() => { timer0 = null; check(); }, Math.max(250, (shownMs < SECOND_PAGE_MS ? SECOND_PAGE_MS : STAY_MS) - shownMs) + 50);
    return;
  }
  human = true;
  for (const ev of HUMAN_EVENTS) window.removeEventListener(ev, onInput, true);
  for (const w of waiting.splice(0)) send(w);
}
function onInput(e: Event): void {
  if (!e.isTrusted) return;
  const t = shownFor();
  if (firstInputMs == null) firstInputMs = t;
  // One reading a second is plenty (pointer moves arrive by the hundred).
  if (lastInputMs == null || t - lastInputMs >= 1000) { lastInputMs = t; check(); }
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
  if (body.t === 'view' && !human) { if (waiting.length < MAX_WAITING) waiting.push(body); return; }
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
  pages += 1;
  send({ t: 'view', path, ref: landed ? null : document.referrer || null });
  landed = true;
  if (typeof window !== 'undefined') check();
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
