// The forecast for kickoff, from the National Weather Service: an icon, the temperature, sky, wind and chance of rain.
import { Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, Moon, Sun, Wind } from 'lucide-react';
import { fmt } from '../../lib/api';

export interface MatchWeather { temp_f: number | null; wind_mph: number | null; wind_gust_mph?: number | null; wind_dir: string | null; precip_pct: number | null; humidity: number | null; short: string | null; is_day: boolean | null; place: string | null; for: string; read_at: string | null; time_assumed?: boolean }

function iconFor(w: MatchWeather) {
  const s = (w.short ?? '').toLowerCase();
  if (/thunder|t-storm/.test(s)) return CloudLightning;
  if (/snow|sleet|flurr|ice/.test(s)) return CloudSnow;
  if (/drizzle/.test(s)) return CloudDrizzle;
  if (/rain|shower/.test(s)) return CloudRain;
  if (/fog|haze|smoke|mist/.test(s)) return CloudFog;
  if ((w.wind_mph ?? 0) >= 20) return Wind;
  if (/partly|mostly sunny|mostly clear/.test(s)) return CloudSun;
  if (/cloud|overcast/.test(s)) return Cloud;
  return w.is_day === false ? Moon : Sun;
}

/** One-line summary for lists: "64°", with the sky in the title. */
export function WeatherMini({ w }: { w: MatchWeather }) {
  const Icon = iconFor(w);
  return <span className="inline-flex items-center gap-1 text-2xs text-chalk-400 tnum" title={`${w.short ?? ''}${w.precip_pct ? `, ${w.precip_pct}% chance of rain` : ''}`}><Icon size={13} aria-hidden />{w.temp_f != null ? `${w.temp_f}°` : ''}</span>;
}

/** The full reading for the match page. `past` once the match has started: the last forecast before kickoff. */
export function WeatherLine({ w, past }: { w: MatchWeather; past?: boolean }) {
  const Icon = iconFor(w);
  const bits = [w.short, w.wind_mph != null ? `wind ${w.wind_dir ? `${w.wind_dir} ` : ''}${w.wind_mph} mph${w.wind_gust_mph && w.wind_gust_mph > w.wind_mph ? `, gusts ${w.wind_gust_mph}` : ''}` : null, w.precip_pct != null ? `${w.precip_pct}% chance of rain` : null, w.humidity != null ? `${w.humidity}% humidity` : null].filter(Boolean);
  return (
    <div className="flex items-start gap-3">
      <Icon size={28} className="mt-0.5 shrink-0 text-chalk-200" aria-hidden />
      <div className="min-w-0">
        <div className="text-sm text-chalk-100"><span className="display text-xl tnum">{w.temp_f != null ? `${w.temp_f}°F` : '–'}</span> <span className="text-chalk-300">{bits.join(', ')}</span></div>
        <div className="text-xs text-chalk-500">
          {past ? 'Forecast at kickoff' : w.time_assumed ? 'Forecast for 7 pm ET (kickoff time not announced)' : 'Forecast for kickoff'}{w.place ? ` near ${w.place}` : ''}, National Weather Service{w.read_at ? `, ${past ? 'read' : 'updated'} ${fmt.agoWords(w.read_at)}` : ''}.
        </div>
      </div>
    </div>
  );
}
