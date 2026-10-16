// Ads and sponsors on the page (set in the hub, served by /api/meta; src/money/config.ts on the server).
//   Display ads: Google AdSense, loaded only while switched on. Personalised ads are off when the browser sends Global
//   Privacy Control or the visitor turned them off on /privacy-choices (kept in this browser only). In the EU and UK
//   Google's own consent message asks first.
//   Sponsors: "Presented by" links we serve ourselves, no tracking.
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export interface PublicAds { enabled: boolean; client: string | null; slots: { rail: string | null; inline: string | null } }
export interface PublicSponsor { placement: 'site' | 'college' | 'pro' | 'intl' | 'news'; name: string; url: string; tagline: string | null }

const OFF: PublicAds = { enabled: false, client: null, slots: { rail: null, inline: null } };

export function useMoney(): { ads: PublicAds; sponsors: PublicSponsor[] } {
  const q = useQuery({ queryKey: ['meta'], queryFn: () => api<{ ads?: PublicAds; sponsors?: PublicSponsor[] }>('/api/meta') });
  return { ads: q.data?.ads ?? OFF, sponsors: q.data?.sponsors ?? [] };
}

/** The section a page belongs to, for its sponsor (same rule as the server's placementFor). */
export function placementFor(path: string): PublicSponsor['placement'] {
  if (/^(\/pro|\/intl)?\/news(\/|$)/.test(path)) return 'news';
  if (path.startsWith('/pro')) return 'pro';
  if (path.startsWith('/intl')) return 'intl';
  return 'college';
}

// ---- Personalised ads: the visitor's choice ----

const CHOICE = 'ads-personalised-off';
const listeners = new Set<() => void>();
export const gpcOn = () => typeof navigator !== 'undefined' && (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
const storedOff = () => { try { return localStorage.getItem(CHOICE) === '1'; } catch { return false; } };
export const personalisedOff = () => gpcOn() || storedOff();

export function setPersonalisedOff(off: boolean) {
  try { if (off) localStorage.setItem(CHOICE, '1'); else localStorage.removeItem(CHOICE); } catch { /* storage blocked */ }
  applyChoice();
  for (const fn of listeners) fn();
}

/** The stored choice (GPC aside), re-rendering when it changes. */
export function useStoredChoice(): boolean {
  const [off, setOff] = useState(storedOff);
  useEffect(() => { const fn = () => setOff(storedOff()); listeners.add(fn); return () => { listeners.delete(fn); }; }, []);
  return off;
}

// ---- AdSense ----

type AdsQueue = unknown[] & { requestNonPersonalizedAds?: 0 | 1 };
declare global { interface Window { adsbygoogle?: AdsQueue } }

const queue = (): AdsQueue => (window.adsbygoogle = window.adsbygoogle ?? []);
/** Google reads this flag on every ad request: 1 asks for ads that are not personalised. */
function applyChoice() { if (typeof window !== 'undefined') queue().requestNonPersonalizedAds = personalisedOff() ? 1 : 0; }

let loaded: string | null = null;
/** Adds Google's ad script once (only ever called while ads are switched on). */
export function loadAdsense(client: string) {
  if (loaded === client) return;
  loaded = client;
  applyChoice();
  const s = document.createElement('script');
  s.async = true;
  s.crossOrigin = 'anonymous';
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
  document.head.appendChild(s);
}

/** Asks Google to fill one ad unit (once per unit; a second push for the same unit is an error). */
export function fillAd(el: HTMLElement | null) {
  if (!el || el.dataset.filled) return;
  el.dataset.filled = '1';
  try { queue().push({}); } catch { /* blocked by an ad blocker */ }
}
