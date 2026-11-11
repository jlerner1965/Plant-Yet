// The daily job: fetch every town's NWS forecast, compute today's answers, write JSON.
//
//   node scripts/daily.mjs [--limit N] [--only slug,slug] [--no-fetch]
//
// Rules:
//  - Each town's gridpoint is looked up once and cached in data/gridpoints.json.
//  - One forecast request per town, with a polite delay between requests.
//  - If a town's fetch fails, its last good forecast is kept (with its original time).
//  - If more than 10% of towns fail, NOTHING is written, a failure summary is left
//    (stdout, $GITHUB_STEP_SUMMARY, daily-failure.md) and the process exits 1.
import { appendFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ROOT, dataPath, readJson, writeJson, writeJsonLines, sleep, site } from './lib/util.mjs';
import { nwsUserAgent, fetchGridpoint, fetchForecast } from './lib/nws.mjs';
import { buildAnswers } from '../src/lib/answer.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

const ua = nwsUserAgent({ allowNoEmail: flag('--allow-no-email') || flag('--no-fetch') });
const now = new Date();
const { towns: allTowns } = await readJson(dataPath('towns.json'));
const only = opt('--only')?.split(',');
const limit = Number(opt('--limit')) || Infinity;
const partial = Boolean(only) || Number.isFinite(limit);
const towns = allTowns.filter((t) => !only || only.includes(t.slug)).slice(0, limit);

const gridpoints = await readJson(dataPath('gridpoints.json'), { about: '', points: {} });
const previous = await readJson(dataPath('forecasts.json'), { towns: {} });
const forecasts = { ...previous.towns };
const failures = [];

async function forecastFor(town) {
  let grid = gridpoints.points[town.slug];
  if (!grid) {
    grid = gridpoints.points[town.slug] = await fetchGridpoint(town, ua);
    await sleep(site.nwsDelayMs);
  }
  try {
    return await fetchForecast(grid, ua);
  } catch (err) {
    if (err.status !== 404) throw err;
    // NWS occasionally re-grids an office: refresh the cached gridpoint once.
    grid = gridpoints.points[town.slug] = await fetchGridpoint(town, ua);
    await sleep(site.nwsDelayMs);
    return await fetchForecast(grid, ua);
  }
}

// --no-fetch recomputes answers from the forecasts already on disk (used after editing crop data).
for (const [i, town] of flag('--no-fetch') ? [] : towns.entries()) {
  try {
    forecasts[town.slug] = await forecastFor(town);
  } catch (err) {
    failures.push({ slug: town.slug, name: town.name, error: String(err.message || err).slice(0, 200) });
  }
  if (i % 20 === 0) console.log(`${i + 1}/${towns.length} … ${failures.length} failed`);
  await sleep(site.nwsDelayMs);
}

const share = failures.length / towns.length;
const failTable = failures.map((f) => `| ${f.name} | ${f.error.replace(/\|/g, '/')} |`).join('\n');
const failureFile = resolve(ROOT, 'daily-failure.md');
await rm(failureFile, { force: true });

async function summary(md) {
  console.log(md);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, md + '\n');
}

if (share > site.maxFailureShare) {
  const md = [
    `## Plant Yet? daily job FAILED — nothing committed`,
    `Run time: ${now.toISOString()}`,
    `**${failures.length} of ${towns.length} towns failed** (${(share * 100).toFixed(1)}%, limit ${site.maxFailureShare * 100}%).`,
    `The site keeps yesterday's data. Any forecast older than ${site.staleAfterHours} hours shows "Forecast unavailable".`,
    '',
    '| Town | Error |',
    '| --- | --- |',
    failTable,
  ].join('\n');
  await writeFile(failureFile, md + '\n');
  await summary(md);
  process.exit(1);
}

const frost = await readJson(dataPath('frost.json'));
const { stations } = await readJson(dataPath('stations.json'));
const { crops } = await readJson(dataPath('crops.json'));
const answers = buildAnswers({ towns: allTowns, frost: frost.towns, stations, crops, forecasts, now, site });

gridpoints.about = 'NWS forecast grid cell for each town (api.weather.gov/points). Looked up once and cached.';
await writeJsonLines(dataPath('gridpoints.json'), gridpoints, 'points');
await writeJsonLines(dataPath('forecasts.json'), {
  about: 'Night lows from the National Weather Service 7-day forecast for each town. A town whose latest fetch failed keeps its last good entry and its original fetchedAt.',
  source: { name: 'National Weather Service API', url: 'https://api.weather.gov' },
  lastRun: flag('--no-fetch') ? previous.lastRun : now.toISOString(),
  partialRun: partial || undefined,
  failedThisRun: flag('--no-fetch') ? previous.failedThisRun : failures.map((f) => f.slug),
  towns: forecasts,
}, 'towns');
await writeJsonLines(dataPath('answers.json'), answers, 'towns');

const c = answers.summary;
await summary(
  [
    `## Plant Yet? daily job OK`,
    `Run time: ${now.toISOString()} (answers for ${answers.date})`,
    `Towns fetched: ${towns.length - failures.length}/${towns.length}. Plant: ${c.plant}, wait: ${c.wait}, cover tonight: ${c.cover}, off-season: ${c.offseason}, forecast unavailable: ${c.unavailable}, no nearby frost record: ${c.norecord}.`,
    failures.length ? `\nKept last good forecast for:\n\n| Town | Error |\n| --- | --- |\n${failTable}` : '',
  ].join('\n')
);
