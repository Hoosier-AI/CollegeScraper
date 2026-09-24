import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { mph, weatherAt, type NwsPeriod } from '../../src/sources/weather/nws.js';
import { gameCoords, usualHomeCity, weatherDue } from '../../src/jobs/weather.js';

const periods = JSON.parse(readFileSync('fixtures/nws/rah-64-66-hourly.json', 'utf8')).properties.periods as NwsPeriod[];

describe('NWS forecast', () => {
  it('takes the hour that covers kickoff', () => {
    const p = periods[5]!;
    const kickoff = Date.parse(p.startTime) / 1000 + 30 * 60;
    const w = weatherAt(periods, kickoff, 'Durham, NC')!;
    expect(w).toMatchObject({ kind: 'forecast', source: 'nws', temp_f: p.temperature, short: p.shortForecast, wind_dir: p.windDirection, place: 'Durham, NC' });
    expect(w.precip_pct).toBe(p.probabilityOfPrecipitation?.value ?? null);
  });
  it('returns nothing outside the forecast', () => {
    expect(weatherAt(periods, Date.parse('2030-01-01T00:00:00Z') / 1000, null)).toBeNull();
  });
  it('reads the stronger end of a wind range', () => {
    expect(mph('5 to 10 mph')).toBe(10); expect(mph('15 mph')).toBe(15); expect(mph('')).toBeNull();
  });
});

describe('weather job rules', () => {
  const now = Date.parse('2026-09-24T12:00:00Z');
  it('refreshes every 3 hours, hourly in the last 6 hours before kickoff', () => {
    const at = (h: number) => new Date(now - h * 3600_000).toISOString();
    expect(weatherDue({ start_epoch: now / 1000 + 86400, weather_at: null }, now)).toBe(true);
    expect(weatherDue({ start_epoch: now / 1000 + 86400, weather_at: at(2) }, now)).toBe(false);
    expect(weatherDue({ start_epoch: now / 1000 + 86400, weather_at: at(3) }, now)).toBe(true);
    expect(weatherDue({ start_epoch: now / 1000 + 3 * 3600, weather_at: at(1) }, now)).toBe(true);
  });
  it('places a game at its listed city, a bare city in the home state, or the home team\'s usual city', () => {
    const home = usualHomeCity([
      { home_program_id: 'duke', neutral_site: false, venue_city: 'Durham, NC' },
      { home_program_id: 'duke', neutral_site: false, venue_city: 'Durham, NC' },
      { home_program_id: 'duke', neutral_site: true, venue_city: 'Cary, NC' },
      { home_program_id: 'uci', neutral_site: false, venue_city: 'Irvine, CA' },
    ]);
    expect(home.get('duke')).toBe('Durham, NC');
    expect(gameCoords({ home_program_id: 'x', neutral_site: false, venue_city: 'Boulder, CO' }, home)?.label).toBe('Boulder, CO');
    expect(gameCoords({ home_program_id: 'uci', neutral_site: false, venue_city: 'Irvine' }, home)?.label).toBe('Irvine, CA');
    expect(gameCoords({ home_program_id: 'duke', neutral_site: false, venue_city: null }, home)?.label).toBe('Durham, NC');
    expect(gameCoords({ home_program_id: 'duke', neutral_site: true, venue_city: null }, home)).toBeNull();
  });
});
