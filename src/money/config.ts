// What keeps the Site free: display ads (Google AdSense, off until approved) and sponsors ("Presented by ..."), both
// set from the hub (PUT /api/console/settings) and stored in college_kv. Pure functions here; the server reads the
// stored values through cachedKv.
//   ads       { enabled, client: 'ca-pub-...', slots: { rail, inline } }  - ads show only when enabled and a client is set
//   sponsors  [{ placement, name, url, tagline?, starts_on?, ends_on? }]  - shown on their section while current

export const SPONSOR_PLACEMENTS = ['site', 'college', 'pro', 'intl', 'news'] as const;
export type SponsorPlacement = (typeof SPONSOR_PLACEMENTS)[number];

export interface AdsSettings { enabled: boolean; client: string | null; slots: { rail: string | null; inline: string | null } }
export interface Sponsor { placement: SponsorPlacement; name: string; url: string; tagline: string | null; starts_on: string | null; ends_on: string | null }

export const ADS_OFF: AdsSettings = { enabled: false, client: null, slots: { rail: null, inline: null } };

const CLIENT = /^ca-pub-\d{10,20}$/;
const SLOT = /^\d{6,20}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const text = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');

/** Stored or submitted ad settings, cleaned: anything malformed becomes "not set", and ads stay off without a client. */
export function normalizeAds(raw: unknown): AdsSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const client = CLIENT.test(String(r.client ?? '')) ? String(r.client) : null;
  const slot = (v: unknown) => (SLOT.test(String(v ?? '')) ? String(v) : null);
  return { enabled: r.enabled === true && !!client, client, slots: { rail: slot(r.slots?.rail), inline: slot(r.slots?.inline) } };
}

/** Stored or submitted sponsors, cleaned: https links only, short names, known placements, real dates. */
export function normalizeSponsors(raw: unknown): Sponsor[] {
  if (!Array.isArray(raw)) return [];
  const out: Sponsor[] = [];
  for (const s of raw.slice(0, 20)) {
    if (!s || typeof s !== 'object') continue;
    const placement = (SPONSOR_PLACEMENTS as readonly string[]).includes(s.placement) ? (s.placement as SponsorPlacement) : null;
    const name = text(s.name, 60);
    let url: string | null = null;
    try { const u = new URL(String(s.url ?? '')); if (u.protocol === 'https:') url = u.toString(); } catch { url = null; }
    if (!placement || !name || !url) continue;
    const day = (v: unknown) => (DAY.test(String(v ?? '')) ? String(v) : null);
    out.push({ placement, name, url, tagline: text(s.tagline, 80) || null, starts_on: day(s.starts_on), ends_on: day(s.ends_on) });
  }
  return out;
}

/** Sponsors running on `today` (YYYY-MM-DD). */
export function currentSponsors(list: readonly Sponsor[], today: string): Sponsor[] {
  return list.filter((s) => (!s.starts_on || s.starts_on <= today) && (!s.ends_on || s.ends_on >= today));
}

/** The section a path belongs to, for picking its sponsor. */
export function placementFor(path: string): SponsorPlacement {
  if (/^(\/pro|\/intl)?\/news(\/|$)/.test(path)) return 'news';
  if (path.startsWith('/pro')) return 'pro';
  if (path.startsWith('/intl')) return 'intl';
  return 'college';
}

/** The ads.txt line for a publisher, or null when there is none (the route then answers 404). */
export function adsTxt(ads: AdsSettings): string | null {
  return ads.client ? `google.com, ${ads.client.replace(/^ca-/, '')}, DIRECT, f08c47fec0942fa0\n` : null;
}

// Google's ad, ad-quality and consent-message hosts (AdSense's published Content-Security-Policy list).
const AD_HOSTS = [
  'https://pagead2.googlesyndication.com',
  'https://*.googlesyndication.com',
  'https://*.doubleclick.net',
  'https://adservice.google.com',
  'https://www.google.com',
  'https://*.adtrafficquality.google',
  'https://www.googletagservices.com',
  'https://fundingchoicesmessages.google.com',
  'https://csi.gstatic.com',
].join(' ');

/** The Content-Security-Policy: our own scripts only, plus Google's ad hosts while ads are on. */
export function buildCsp(adsOn: boolean): string {
  const ads = adsOn ? ` ${AD_HOSTS}` : '';
  return [
    'default-src \'self\'',
    `script-src 'self'${ads}`,
    'style-src \'self\' \'unsafe-inline\'',
    'img-src \'self\' https: data: blob:',
    'font-src \'self\' data:',
    `connect-src 'self'${ads}`,
    'media-src \'self\' https:',
    ...(adsOn ? [`frame-src${ads}`] : []),
    'object-src \'none\'',
    'base-uri \'self\'',
    'form-action \'self\'',
    'frame-ancestors \'none\'',
  ].join('; ');
}
