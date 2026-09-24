// National Weather Service API (api.weather.gov): free, public domain, US only, no key — it asks for an identifying
// User-Agent, which the crawler client sends with a contact address. Two calls per place: /points/{lat},{lon} names
// the forecast grid (stable, cached by the caller), then the grid's hourly forecast covers the next ~6.5 days.
import type { Fetcher } from '../../model.js';

export const NWS_BASE = 'https://api.weather.gov';

export interface NwsPoint { hourlyUrl: string; timeZone: string | null; place: string | null }

export interface Weather {
  kind: 'forecast';
  /** Kickoff instant the forecast hour covers (ISO). */
  for: string;
  temp_f: number | null;
  wind_mph: number | null;
  wind_gust_mph: number | null;
  wind_dir: string | null;
  precip_pct: number | null;
  humidity: number | null;
  short: string | null;
  is_day: boolean | null;
  /** Nearest named place NWS reports for the grid, e.g. "Durham, NC". */
  place: string | null;
  source: 'nws';
}

const get = (f: Fetcher, url: string) => f.get(url, { accept: 'application/geo+json', skipCache: true, noStore: true, documentedApi: true });

export async function nwsPoint(f: Fetcher, lat: number, lon: number): Promise<NwsPoint | null> {
  const res = await get(f, `${NWS_BASE}/points/${lat.toFixed(4)},${lon.toFixed(4)}`);
  const p = JSON.parse(res.text)?.properties;
  if (!p?.forecastHourly) return null;
  const rel = p.relativeLocation?.properties;
  return { hourlyUrl: String(p.forecastHourly), timeZone: p.timeZone ?? null, place: rel?.city ? `${rel.city}${rel.state ? `, ${rel.state}` : ''}` : null };
}

export interface NwsPeriod { startTime: string; endTime: string; isDaytime?: boolean; temperature?: number; temperatureUnit?: string; windSpeed?: string; windGust?: string | null; windDirection?: string; shortForecast?: string; probabilityOfPrecipitation?: { value: number | null }; relativeHumidity?: { value: number | null } }

export async function nwsHourly(f: Fetcher, hourlyUrl: string): Promise<NwsPeriod[]> {
  const res = await get(f, hourlyUrl);
  return (JSON.parse(res.text)?.properties?.periods ?? []) as NwsPeriod[];
}

/** "5 to 10 mph" → 10 (the upper figure, what a player feels in the gusty part of the hour). */
export const mph = (s: string | null | undefined): number | null => { const n = (s ?? '').match(/\d+/g); return n ? Number(n[n.length - 1]) : null; };

/** The hourly period covering kickoff, as stored weather; null when kickoff is outside the forecast. */
export function weatherAt(periods: NwsPeriod[], kickoffEpoch: number, place: string | null): Weather | null {
  const t = kickoffEpoch * 1000;
  const p = periods.find((x) => Date.parse(x.startTime) <= t && t < Date.parse(x.endTime));
  if (!p) return null;
  const f = p.temperature == null ? null : p.temperatureUnit === 'C' ? Math.round(p.temperature * 9 / 5 + 32) : p.temperature;
  return {
    kind: 'forecast', for: new Date(t).toISOString(), temp_f: f, wind_mph: mph(p.windSpeed), wind_gust_mph: mph(p.windGust ?? null),
    wind_dir: p.windDirection || null, precip_pct: p.probabilityOfPrecipitation?.value ?? null, humidity: p.relativeHumidity?.value ?? null,
    short: p.shortForecast || null, is_day: p.isDaytime ?? null, place, source: 'nws',
  };
}
