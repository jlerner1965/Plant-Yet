// Builds data/stations.json and data/frost.json.
//  - NOAA NCEI 1991–2020 U.S. Climate Normals (annual/seasonal, by station):
//    freeze probabilities for 32°F, last spring / first fall, at 10%, 50%, 90%.
//  - Each town is matched to the NEAREST station that has complete freeze data AND is
//    within 25 miles AND within 500 ft of the town's elevation. No match -> null
//    ("No nearby frost record"). A far or much lower/higher station is never borrowed.
// Normals are fixed for the decade, so this only needs re-running when towns change.
import { BUILD_UA, dataPath, fetchRetry, readJson, writeJson, sleep, haversineMiles, today, site } from './lib/util.mjs';

const BASE = 'https://www.ncei.noaa.gov/data/normals-annualseasonal/1991-2020/access/';
const DOC = 'https://www.ncei.noaa.gov/data/normals-annualseasonal/1991-2020/doc/Normals_ANN_Documentation_1991-2020.pdf';
const GHCND = 'https://www.ncei.noaa.gov/pub/data/ghcn/daily/ghcnd-stations.txt';
const headers = { 'User-Agent': BUILD_UA };
const MAX_MI = site.stationMaxMiles;
const MAX_FT = site.stationMaxElevDiffFt;
const M_TO_FT = 3.280839895;

const { towns } = await readJson(dataPath('towns.json'));

// 1. Candidate stations: anything in the GHCN-Daily inventory inside Colorado's
//    bounding box padded by ~25 miles (so border towns can use a station across the line).
const padLat = MAX_MI / 69 + 0.05;
const padLon = MAX_MI / 52 + 0.05;
const box = {
  s: Math.min(...towns.map((t) => t.lat)) - padLat,
  n: Math.max(...towns.map((t) => t.lat)) + padLat,
  w: Math.min(...towns.map((t) => t.lon)) - padLon,
  e: Math.max(...towns.map((t) => t.lon)) + padLon,
};
const inv = await (await fetchRetry(GHCND, { headers, timeoutMs: 120000 })).text();
const inBox = [];
for (const line of inv.split('\n')) {
  if (!line.startsWith('US')) continue;
  const lat = Number(line.slice(12, 20));
  const lon = Number(line.slice(21, 30));
  if (lat >= box.s && lat <= box.n && lon >= box.w && lon <= box.e) inBox.push(line.slice(0, 11));
}
const listing = await (await fetchRetry(BASE, { headers, timeoutMs: 120000 })).text();
const hasNormals = new Set([...listing.matchAll(/href="([A-Z0-9]{11})\.csv"/g)].map((m) => m[1]));
const candidates = inBox.filter((id) => hasNormals.has(id));
console.log(`${inBox.length} stations in box, ${candidates.length} with 1991–2020 annual normals`);

// 2. Read each candidate's normals file and keep those with all six freeze dates.
const FIELDS = {
  lastSpring: { p10: 'ANN-TMIN-PRBLST-T32FP10', p50: 'ANN-TMIN-PRBLST-T32FP50', p90: 'ANN-TMIN-PRBLST-T32FP90' },
  firstFall: { p10: 'ANN-TMIN-PRBFST-T32FP10', p50: 'ANN-TMIN-PRBFST-T32FP50', p90: 'ANN-TMIN-PRBFST-T32FP90' },
};
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}
const fetched = today();
const stations = [];
let skipped = 0;
for (const [i, id] of candidates.entries()) {
  const url = `${BASE}${id}.csv`;
  const text = await (await fetchRetry(url, { headers })).text();
  const [head, row] = text.trim().split(/\r?\n/).map(parseCsvLine);
  const rec = Object.fromEntries(head.map((h, j) => [h, row[j]]));
  const pick = (group) => {
    const o = {};
    for (const [k, col] of Object.entries(group)) {
      const m = /^(\d\d)\/(\d\d)$/.exec(rec[col] ?? '');
      if (!m) return null; // missing column or a special code (e.g. -4444 / -6666): not usable
      o[k] = `${m[1]}-${m[2]}`;
    }
    return o;
  };
  const lastSpring = pick(FIELDS.lastSpring);
  const firstFall = pick(FIELDS.firstFall);
  const elevM = Number(rec.ELEVATION);
  if (!lastSpring || !firstFall || !Number.isFinite(elevM)) { skipped++; }
  else {
    stations.push({
      id,
      name: rec.NAME,
      lat: Number(rec.LATITUDE),
      lon: Number(rec.LONGITUDE),
      elevFt: Math.round(elevM * M_TO_FT),
      // Dates are MM-DD. lastSpring.p10 = only a 10% chance of a 32°F freeze AFTER this date;
      // firstFall.p10 = only a 10% chance of a 32°F freeze BEFORE this date.
      lastSpring,
      firstFall,
      years: Number(rec['years_ANN-TMIN-PRBLST-T32FP50']) || undefined,
      url,
      fetched,
    });
  }
  if (i % 25 === 0) process.stdout.write(`\r${i + 1}/${candidates.length}`);
  await sleep(60);
}
console.log(`\n${stations.length} stations with complete 32°F freeze dates (${skipped} without)`);

// 3. Match towns.
const matches = {};
let none = 0;
for (const t of towns) {
  let best = null;
  let nearestAny = null;
  for (const s of stations) {
    const mi = haversineMiles(t.lat, t.lon, s.lat, s.lon);
    const dFt = s.elevFt - t.elevation.ft;
    if (!nearestAny || mi < nearestAny.distanceMi) nearestAny = { stationId: s.id, name: s.name, distanceMi: mi, elevDiffFt: dFt };
    if (mi <= MAX_MI && Math.abs(dFt) <= MAX_FT && (!best || mi < best.distanceMi)) best = { stationId: s.id, distanceMi: mi, elevDiffFt: dFt };
  }
  const round = (m) => m && { ...m, distanceMi: Math.round(m.distanceMi * 10) / 10 };
  if (best) matches[t.slug] = round(best);
  else {
    none++;
    // Kept only to explain the gap on the page; never used for dates.
    matches[t.slug] = { stationId: null, nearestRejected: round(nearestAny) };
  }
}
const used = new Set(Object.values(matches).map((m) => m.stationId).filter(Boolean));
await writeJson(dataPath('stations.json'), {
  about: 'NOAA NCEI 1991–2020 U.S. Climate Normals stations used by at least one town. Dates are MM-DD for a 32°F minimum.',
  sources: {
    normals: { name: 'NOAA NCEI U.S. Climate Normals 1991–2020, annual/seasonal by station', url: BASE, fetched },
    documentation: { url: DOC },
  },
  stations: stations.filter((s) => used.has(s.id)).sort((a, b) => a.id.localeCompare(b.id)),
});
await writeJson(dataPath('frost.json'), {
  about: `Town -> nearest station with complete freeze normals within ${MAX_MI} miles and ${MAX_FT} ft of elevation. stationId null = "No nearby frost record".`,
  rule: { maxMiles: MAX_MI, maxElevDiffFt: MAX_FT },
  computed: fetched,
  towns: matches,
});
console.log(`${towns.length - none} towns matched, ${none} with no nearby frost record, ${used.size} stations used`);
