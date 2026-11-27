// The origin for addresses that leave the page: share links, calendar subscriptions, anything a person pastes or
// sends. On the website this is the page's own origin (unchanged). In the app the page's origin is
// capacitor://localhost, which is no use to whoever receives the link, so the app's build pins it to the public site
// (VITE_PUBLIC_WEB_ORIGIN); a person with the app installed is brought back into it by the universal link.
import { isNative } from './platform';

const DEFAULT_ORIGIN = 'https://www.plaibook.live';
const fromEnv = String(import.meta.env.VITE_PUBLIC_WEB_ORIGIN ?? '').replace(/\/+$/, '');

export const PUBLIC_WEB_ORIGIN: string = fromEnv || (!isNative && typeof window !== 'undefined' && window.location?.origin ? window.location.origin : DEFAULT_ORIGIN);

/** The public address of a page path ('/teams/x?season=2025'). */
export const publicUrl = (path: string): string => `${PUBLIC_WEB_ORIGIN}${path.startsWith('/') ? path : `/${path}`}`;

/** The public site's host ('www.plaibook.live'), for schemes that take a host and no origin (webcal://). */
export const PUBLIC_HOST: string = (() => { try { return new URL(PUBLIC_WEB_ORIGIN).host; } catch { return 'www.plaibook.live'; } })();
