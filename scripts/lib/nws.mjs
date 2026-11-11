// National Weather Service API client (api.weather.gov). Free, no key.
// NWS asks every client to send a User-Agent that identifies the app and a contact.
import { fetchRetry, site } from './util.mjs';

const API = 'https://api.weather.gov';

export function nwsUserAgent({ allowNoEmail = false } = {}) {
  const email = (process.env.NWS_CONTACT_EMAIL || site.nwsContactEmail || '').trim();
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return `PlantYet/1.0 (+${site.url}; ${email})`;
  if (allowNoEmail) return `PlantYet/1.0 (+${site.url})`;
  throw new Error(
    'No NWS contact email. Set "nwsContactEmail" in config/site.json or the NWS_CONTACT_EMAIL environment variable.'
  );
}

const headers = (ua) => ({ 'User-Agent': ua, Accept: 'application/geo+json' });

/** Look up the forecast grid cell for a point. Cached forever by the caller. */
export async function fetchGridpoint(town, ua) {
  const url = `${API}/points/${town.lat.toFixed(4)},${town.lon.toFixed(4)}`;
  const json = await (await fetchRetry(url, { headers: headers(ua) })).json();
  const p = json.properties;
  if (!p?.gridId || !p.forecast) throw new Error(`No gridpoint in ${url}`);
  return { wfo: p.gridId, x: p.gridX, y: p.gridY, forecastUrl: p.forecast, url, fetched: new Date().toISOString().slice(0, 10) };
}

/**
 * Fetch the 7-day forecast and reduce it to night lows.
 * Returns { fetchedAt, nwsUpdated, url, tonight, nights[], min7 }.
 */
export async function fetchForecast(grid, ua, now = new Date()) {
  const json = await (await fetchRetry(grid.forecastUrl, { headers: headers(ua), tries: 3 })).json();
  return reduceForecast(json, grid.forecastUrl, now);
}

export function reduceForecast(json, url, now = new Date()) {
  const periods = json?.properties?.periods;
  if (!Array.isArray(periods) || !periods.length) throw new Error('Forecast has no periods');
  const nights = periods
    .filter((p) => p.isDaytime === false && Number.isFinite(p.temperature))
    .map((p) => ({
      name: p.name,
      start: p.startTime,
      lowF: p.temperatureUnit === 'C' ? Math.round((p.temperature * 9) / 5 + 32) : p.temperature,
    }))
    .slice(0, 7);
  if (!nights.length) throw new Error('Forecast has no night periods');
  // "Tonight" must really be the coming (or current) night, not an old cached product.
  const firstEnd = new Date(periods.find((p) => p.isDaytime === false).endTime).getTime();
  const firstStart = new Date(nights[0].start).getTime();
  if (firstEnd < now.getTime() || firstStart - now.getTime() > 24 * 3600 * 1000) {
    throw new Error(`Forecast is out of date (first night starts ${nights[0].start})`);
  }
  const min7 = nights.reduce((a, b) => (b.lowF < a.lowF ? b : a));
  return {
    fetchedAt: now.toISOString(),
    nwsUpdated: json.properties.updateTime || json.properties.generatedAt || null,
    url,
    tonight: nights[0],
    nights,
    min7,
  };
}
