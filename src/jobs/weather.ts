// Weather at kickoff for the coming week's matches: the ground's city (from the schedules, else the home team's
// usual home city) placed with the Census list, then the NWS hourly forecast for that spot. Refreshed every three
// hours, hourly in the last six hours before kickoff; once a match starts the last forecast stays as "at kickoff".
import { registerJob, type JobContext } from './runner.js';
import { kvGet, kvSet, selectAll } from '../db/client.js';
import { updateGame } from '../db/repos.js';
import { makeFetcher } from './fetcher.js';
import { currentSeason, eastern, shiftIso } from './seasons.js';
import { cityLabel, parseVenue, placeCoords } from '../normalize/venue.js';
import { kickoffTbd } from '../ui/queries.js';
import { nwsHourly, nwsPoint, weatherAt, type NwsPeriod, type NwsPoint } from '../sources/weather/nws.js';
import { log } from '../log.js';

interface G { id: string; game_date: string; start_epoch: number | null; home_program_id: string | null; neutral_site: boolean | null; venue_city: string | null; weather_at: string | null }

/** Due for a (re)read: never read, or older than 3 h — 1 h once kickoff is within 6 h. */
export function weatherDue(g: Pick<G, 'start_epoch' | 'weather_at'>, nowMs: number): boolean {
  if (!g.weather_at) return true;
  const age = nowMs - Date.parse(g.weather_at);
  const soon = g.start_epoch != null && g.start_epoch * 1000 - nowMs < 6 * 3600_000;
  return age >= (soon ? 3600_000 : 3 * 3600_000);
}

/** The city a program usually hosts in: the most frequent stated city of its non-neutral home games. */
export function usualHomeCity(rows: { home_program_id: string | null; neutral_site: boolean | null; venue_city: string | null }[]): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!r.home_program_id || r.neutral_site || !r.venue_city) continue;
    const v = parseVenue(r.venue_city);
    const label = v.state ? cityLabel(v) : null;
    if (!label) continue;
    const m = counts.get(r.home_program_id) ?? new Map<string, number>();
    m.set(label, (m.get(label) ?? 0) + 1); counts.set(r.home_program_id, m);
  }
  const out = new Map<string, string>();
  for (const [pid, m] of counts) out.set(pid, [...m].sort((a, b) => b[1] - a[1])[0]![0]);
  return out;
}

/** Where to read the weather for one game, or null (neutral ground with no city, or a place the Census list lacks). */
export function gameCoords(g: Pick<G, 'home_program_id' | 'neutral_site' | 'venue_city'>, homeCity: Map<string, string>): { lat: number; lon: number; label: string } | null {
  const v = parseVenue(g.venue_city);
  const home = g.home_program_id ? homeCity.get(g.home_program_id) ?? null : null;
  let label: string | null = v.state ? cityLabel(v) : null;
  // A bare city ("Irvine") takes the home team's state when it is the home team's city.
  if (!label && v.city && home && home.toLowerCase().startsWith(`${v.city.toLowerCase()},`)) label = home;
  if (!label && !g.neutral_site && !v.city) label = home;
  if (!label) return null;
  const p = parseVenue(label);
  const c = placeCoords(p.city, p.state);
  return c ? { ...c, label } : null;
}

registerJob('weather', async (ctx: JobContext) => {
  const db = ctx.db;
  const season = Number(ctx.params.season ?? currentSeason());
  const today = eastern().date;
  const until = shiftIso(today, Number(ctx.params.days ?? 6));
  const now = Date.now();
  const upcoming = await selectAll<G>(db, 'college_games', 'id,game_date,start_epoch,home_program_id,neutral_site,venue_city,weather_at',
    (q) => q.eq('season', season).eq('status', 'scheduled').gte('game_date', today).lte('game_date', until));
  const due = upcoming.filter((g) => ctx.params.force || weatherDue(g, now));
  ctx.inc('upcoming', upcoming.length); ctx.inc('due', due.length);
  if (!due.length) return;
  const history = await selectAll<any>(db, 'college_games', 'home_program_id,neutral_site,venue_city', (q) => q.eq('season', season).not('venue_city', 'is', null));
  const homeCity = usualHomeCity(history);

  const groups = new Map<string, { lat: number; lon: number; label: string; games: G[] }>();
  for (const g of due) {
    const c = gameCoords(g, homeCity);
    if (!c) { ctx.inc('no_place'); continue; }
    const k = `${c.lat.toFixed(2)},${c.lon.toFixed(2)}`;
    const grp = groups.get(k) ?? { ...c, games: [] };
    grp.games.push(g); groups.set(k, grp);
  }
  ctx.inc('places', groups.size);

  const fetcher = makeFetcher(db);
  // Grid lookups never change for a spot; keep them so each run costs one request per place.
  const points = (await kvGet<Record<string, NwsPoint>>(db, 'nws:points')) ?? {};
  let pointsChanged = false;
  for (const [k, grp] of groups) {
    if (await ctx.cancelled()) break;
    try {
      let pt = points[k];
      if (!pt) { const fresh = await nwsPoint(fetcher, grp.lat, grp.lon); if (!fresh) { ctx.inc('no_grid'); continue; } pt = fresh; points[k] = pt; pointsChanged = true; }
      const periods: NwsPeriod[] = await nwsHourly(fetcher, pt.hourlyUrl);
      for (const g of grp.games) {
        // No kickoff time published: read 7 pm Eastern, the usual evening slot, and say so.
        const tbd = kickoffTbd(g.start_epoch);
        const kickoff = tbd ? Date.parse(`${g.game_date}T23:00:00Z`) / 1000 : g.start_epoch!;
        const w = weatherAt(periods, kickoff, pt.place ?? grp.label);
        if (!w) { ctx.inc('beyond_forecast'); continue; }
        await updateGame(db, g.id, { weather: tbd ? { ...w, time_assumed: true } : w, weather_at: new Date().toISOString() });
        ctx.inc('games_updated');
      }
    } catch (err) {
      ctx.inc('errors');
      // NWS occasionally re-draws its grids; forget the stored grid so the next run looks it up again.
      if (points[k]) { delete points[k]; pointsChanged = true; }
      log.warn({ place: grp.label, err: err instanceof Error ? err.message : String(err) }, 'weather read failed');
    }
    await ctx.heartbeat();
  }
  if (pointsChanged) await kvSet(db, 'nws:points', points);
});
