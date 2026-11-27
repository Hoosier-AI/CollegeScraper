// Score alerts in the phone app. No account: the app makes a random install token once, and the server keeps the
// device's push address and the list of what it follows under that token's hash (src/push/routes.ts). Nothing here
// runs on the website; every Capacitor import is dynamic so the web bundle never loads one.
import { apiUrl } from './apiBase';
import { isNative } from './platform';

const TOKEN_KEY = 'plaibook-live:install-token:v1';
const ASKED_KEY = 'plaibook-live:alerts-asked:v1';
const FOLLOWS_KEY = 'plaibook-stats:follows:v1';
const FOLLOWS_EVENT = 'plaibook-follows';

const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage off */ } };

/** iOS can clear a web view's storage; the follows, the install token and the "asked" flag are mirrored to native
 *  preferences and put back on launch. Returns once localStorage is whole again. */
export async function restoreStorage(): Promise<void> {
  if (!isNative) return;
  const { Preferences } = await import('@capacitor/preferences');
  for (const k of [FOLLOWS_KEY, TOKEN_KEY, ASKED_KEY]) {
    const local = read(k);
    if (local != null) { await Preferences.set({ key: k, value: local }).catch(() => {}); continue; }
    const saved = (await Preferences.get({ key: k }).catch(() => ({ value: null }))).value;
    if (saved != null) write(k, saved);
  }
  window.dispatchEvent(new Event(FOLLOWS_EVENT));
}

async function mirror(k: string) {
  const { Preferences } = await import('@capacitor/preferences');
  const v = read(k);
  if (v != null) await Preferences.set({ key: k, value: v }).catch(() => {});
}

function installToken(): string {
  let t = read(TOKEN_KEY);
  if (!t || !/^[0-9a-f]{64}$/.test(t)) {
    t = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');
    write(TOKEN_KEY, t);
    void mirror(TOKEN_KEY);
  }
  return t;
}

const send = (method: string, path: string, body?: unknown) =>
  fetch(apiUrl(path), { method, headers: { Authorization: `Device ${installToken()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }).catch(() => null);

const followed = (): { kind: string; ref: string }[] => {
  try { const v = JSON.parse(read(FOLLOWS_KEY) ?? '[]'); return Array.isArray(v) ? v.filter((f) => f && typeof f.kind === 'string' && typeof f.id === 'string').slice(0, 40).map((f) => ({ kind: f.kind, ref: f.id })) : []; } catch { return []; }
};

let timer: ReturnType<typeof setTimeout> | undefined;
/** Tell the server what this device follows, a moment after the last change (a few stars in a row is one call). */
export function syncFollows() {
  if (!isNative) return;
  void mirror(FOLLOWS_KEY);
  clearTimeout(timer);
  timer = setTimeout(() => { void send('PUT', '/api/device/follows', { follows: followed() }); }, 2000);
}

export const alertsAsked = () => read(ASKED_KEY) != null;
export const markAlertsAsked = (answer: 'yes' | 'later') => { write(ASKED_KEY, answer); void mirror(ASKED_KEY); };

/** Ask iOS for permission and register. Call only from the reader's own tap on "Turn on alerts". */
export async function enableAlerts(): Promise<boolean> {
  if (!isNative) return false;
  const { PushNotifications } = await import('@capacitor/push-notifications');
  const perm = await PushNotifications.requestPermissions().catch(() => ({ receive: 'denied' as const }));
  markAlertsAsked('yes');
  if (perm.receive !== 'granted') return false;
  await PushNotifications.register().catch(() => {});
  return true;
}

/** On every launch: listen for the device's push address and for taps on an alert; re-register quietly when alerts
 *  are already allowed (the address can change). `open` gets the page an alert points at. */
export async function startPush(open: (to: string) => void): Promise<() => void> {
  if (!isNative) return () => {};
  const { PushNotifications } = await import('@capacitor/push-notifications');
  const reg = await PushNotifications.addListener('registration', (t) => {
    void send('POST', '/api/device', { apns_token: t.value, apns_env: import.meta.env.VITE_APNS_ENV === 'sandbox' ? 'sandbox' : 'production', tz: Intl.DateTimeFormat().resolvedOptions().timeZone, app_version: import.meta.env.VITE_APP_VERSION ?? null })
      .then(() => send('PUT', '/api/device/follows', { follows: followed() }));
  });
  const tap = await PushNotifications.addListener('pushNotificationActionPerformed', (a) => {
    const to = (a.notification.data as { to?: unknown } | undefined)?.to;
    if (typeof to === 'string' && to.startsWith('/')) open(to);
  });
  const onFollows = () => syncFollows();
  window.addEventListener(FOLLOWS_EVENT, onFollows);
  const perm = await PushNotifications.checkPermissions().catch(() => null);
  if (perm?.receive === 'granted') await PushNotifications.register().catch(() => {});
  return () => { void reg.remove(); void tap.remove(); window.removeEventListener(FOLLOWS_EVENT, onFollows); };
}
