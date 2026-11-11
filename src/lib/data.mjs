// Loads the committed JSON and shapes it for the pages. Build-time only.
import townsFile from '../../data/towns.json';
import stationsFile from '../../data/stations.json';
import frostFile from '../../data/frost.json';
import cropsFile from '../../data/crops.json';
import forecastsFile from '../../data/forecasts.json';
import answersFile from '../../data/answers.json';
import gridFile from '../../data/gridpoints.json';
import site from '../../config/site.json';
import { fmtMonthDay } from './answer.mjs';

export { site };
export const towns = townsFile.towns;
export const townSources = townsFile.sources;
export const crops = cropsFile.crops;
export const cropsMeta = cropsFile;
export const answers = answersFile;
export const forecastsMeta = forecastsFile;
export const stationSources = stationsFile.sources;
export const frostRule = frostFile.rule;

const stationById = new Map(stationsFile.stations.map((s) => [s.id, s]));

export const STATUS = {
  plant: { label: 'Plant', cls: 's-plant' },
  wait: { label: 'Wait', cls: 's-wait' },
  cover: { label: 'Cover tonight', cls: 's-cover' },
  off: { label: 'Off-season', cls: 's-off' },
  unavailable: { label: 'Forecast unavailable', cls: 's-unavailable' },
  norecord: { label: 'No nearby frost record', cls: 's-norecord' },
};
export const ORDER = ['cover', 'plant', 'wait', 'off'];

const tz = site.timeZone;
export const fmtTime = (iso) =>
  new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(iso));
export const fmtDate = (iso) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(iso + 'T12:00:00Z'));
export const fmtShortDate = (iso) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso + 'T12:00:00Z'));
export const nightShort = (night) =>
  new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(new Date(night.start));
export { fmtMonthDay };

export const staleAt = (fetchedAt) => new Date(Date.parse(fetchedAt) + site.staleAfterHours * 3600 * 1000).toISOString();

export function townView(town) {
  const match = frostFile.towns[town.slug];
  const station = match?.stationId ? stationById.get(match.stationId) : null;
  const forecast = forecastsFile.towns[town.slug] || null;
  const answer = answers.towns[town.slug];
  return {
    town,
    match,
    station,
    forecast,
    grid: gridFile.points[town.slug] || null,
    answer,
    status: answer.headline.s,
    nwsPage: `https://forecast.weather.gov/MapClick.php?lat=${town.lat.toFixed(4)}&lon=${town.lon.toFixed(4)}`,
  };
}

export const weeksText = (n) => {
  const a = Math.abs(n);
  if (n === 0) return 'on the typical last frost date';
  return `${a} week${a === 1 ? '' : 's'} ${n < 0 ? 'before' : 'after'} typical last frost`;
};
export function windowText(w) {
  if (!w) return null;
  const a = Math.min(w.startWeeks, w.endWeeks ?? w.startWeeks);
  const b = Math.max(w.startWeeks, w.endWeeks ?? w.startWeeks);
  if (a === b) return cap(weeksText(a));
  if (a < 0 && b <= 0) return b === 0 ? `From ${-a} weeks before typical last frost up to the frost date` : `${-b}–${-a} weeks before typical last frost`;
  if (a >= 0) return a === 0 ? `From the typical last frost date to ${b} weeks after` : `${a}–${b} weeks after typical last frost`;
  return `From ${-a} weeks before to ${b} weeks after typical last frost`;
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
export const host = (url) => new URL(url).hostname.replace(/^www\./, '');
