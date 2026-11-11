// Builds data/towns.json: every incorporated Colorado municipality.
//  - List + coordinates: U.S. Census Bureau Gazetteer "places" file for Colorado.
//    Incorporated places are LSAD 25 (city) and 43 (town); CDPs (LSAD 57) are dropped.
//  - Elevation: USGS Elevation Point Query Service at the Census internal point.
// Re-run rarely (a new Gazetteer comes out once a year). Existing elevations are
// reused when the coordinates have not changed, unless --refresh is passed.
import { BUILD_UA, dataPath, fetchRetry, readJson, writeJson, sleep, slugify, today } from './lib/util.mjs';

const GAZ_YEAR = process.env.GAZETTEER_YEAR || '2025';
const GAZ_URL = `https://www2.census.gov/geo/docs/maps-data/data/gazetteer/${GAZ_YEAR}_Gazetteer/${GAZ_YEAR}_gaz_place_08.txt`;
const EPQS = 'https://epqs.nationalmap.gov/v1/json';
const refresh = process.argv.includes('--refresh');
const headers = { 'User-Agent': BUILD_UA };

const text = await (await fetchRetry(GAZ_URL, { headers })).text();
const lines = text.split(/\r?\n/).filter((l) => l.trim());
const sep = lines[0].includes('|') ? '|' : '\t';
const cols = lines[0].split(sep).map((c) => c.trim());
const rows = lines.slice(1).map((l) => Object.fromEntries(l.split(sep).map((v, i) => [cols[i], v.trim()])));

// The Census lists the City of Central as "Central"; everyone, including the city, calls it Central City.
const DISPLAY_NAME = { Central: "Central City" };
const KIND = { 25: 'city', 43: 'town' };
const places = rows.filter((r) => r.USPS === 'CO' && KIND[r.LSAD]);

const prev = await readJson(dataPath('towns.json'), { towns: [] });
const prevByGeoid = new Map(prev.towns.map((t) => [t.geoid, t]));
const fetched = today();
const seen = new Set();

const towns = places.map((r) => {
  const kind = KIND[r.LSAD];
  const base = r.NAME.replace(new RegExp(` ${kind}$`), "");
  const name = DISPLAY_NAME[base] || base;
  const slug = slugify(name);
  if (seen.has(slug)) throw new Error(`Duplicate slug ${slug}`);
  seen.add(slug);
  const lat = Number(r.INTPTLAT);
  const lon = Number(r.INTPTLONG);
  const old = prevByGeoid.get(r.GEOID);
  const same = old && !refresh && old.lat === lat && old.lon === lon;
  return {
    slug,
    name,
    kind,
    geoid: r.GEOID,
    // FUNCSTAT "I" = incorporated but currently without a functioning government (Census definition).
    inactive: r.FUNCSTAT === 'I' || undefined,
    lat,
    lon,
    coords: { url: GAZ_URL, fetched: same ? old.coords.fetched : fetched },
    elevation: same ? old.elevation : null,
  };
});

async function save() {
  const done = towns.filter((t) => t.elevation).sort((a, b) => a.name.localeCompare(b.name));
  await writeJson(dataPath('towns.json'), {
    about: 'Every incorporated Colorado municipality (Census LSAD 25 = city, 43 = town). Coordinates are the Census internal point; elevation is the USGS 3DEP value at that point.',
    sources: {
      list: { name: `U.S. Census Bureau ${GAZ_YEAR} Gazetteer Files — Places, Colorado`, url: GAZ_URL, fetched },
      elevation: { name: 'USGS Elevation Point Query Service (3DEP)', url: EPQS },
    },
    count: done.length,
    towns: done,
  });
}

// The USGS service is slow (several seconds a point), so run a few lookups at a time.
const todo = towns.filter((t) => !t.elevation);
let done = 0;
async function worker() {
  for (let t = todo.shift(); t; t = todo.shift()) {
    const url = `${EPQS}?x=${t.lon}&y=${t.lat}&units=Feet&wkid=4326`;
    const json = await (await fetchRetry(url, { headers, timeoutMs: 60000 })).json();
    const ft = Number(json.value);
    if (!Number.isFinite(ft) || ft < 3000 || ft > 14500) throw new Error(`Implausible elevation for ${t.name}: ${json.value}`);
    t.elevation = { ft: Math.round(ft), url, fetched };
    if (++done % 20 === 0) {
      console.log(`${done} elevations fetched`);
      await save(); // so an interrupted run resumes instead of starting over
    }
    await sleep(100);
  }
}
await Promise.all(Array.from({ length: 6 }, worker));

await save();
console.log(`Wrote ${towns.length} towns`);
