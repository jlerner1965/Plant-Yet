# Plant Yet?

A free static site with one page for every incorporated town in Colorado, answering one question every day:
**should I plant, wait, or cover tonight?**

Live at <https://insidesummitcounty.com> (temporary domain; set `url` in `config/site.json` to change it). Costs $0 to run: no paid APIs, no database, no sign-in, no AI at runtime.

## How it works

```
GitHub Actions (4:30 am Denver)        Vercel
  node scripts/daily.mjs        ──►    git push to main triggers `astro build`
  commits data/*.json                  and serves the static files
```

| File | What | Source | Refreshed |
| --- | --- | --- | --- |
| `data/towns.json` | every incorporated municipality, coordinates, elevation | Census Gazetteer, USGS EPQS | `npm run data:towns` (yearly) |
| `data/stations.json`, `data/frost.json` | 1991–2020 freeze dates and the town → station match | NOAA NCEI Climate Normals | `npm run data:stations` (after towns change) |
| `data/crops.json` | crop values, each with URL + verbatim quote | CSU and other university extensions | by hand; check with `npm run data:crops` |
| `data/gridpoints.json` | NWS grid cell per town (cached once) | api.weather.gov | daily job, only when missing |
| `data/forecasts.json` | tonight's low and the next 7 night lows | api.weather.gov | daily job |
| `data/answers.json` | the computed answer per town per crop | `src/lib/answer.mjs` | daily job |

Every value keeps its source URL and the date it was fetched.

## Rules that matter

- **Station match:** nearest station with complete freeze data within 25 miles **and** 500 ft of elevation. Otherwise the town shows
  "No nearby frost record", gets no planting dates and is `noindex`.
- **Stale data:** a failed town keeps its last good forecast. Over 36 hours old → "Forecast unavailable" (enforced at build time and again in the browser).
- **Daily job:** if more than 10% of towns fail, nothing is written or committed; the failure summary is on the workflow run's Summary page
  and in the `daily-failure` artifact.
- **Crops:** no value without a source. Missing values are `null`, listed in each crop's `leftOut`, and shown as such.

The decision logic is one file, `src/lib/answer.mjs`, covered by `test/answer.test.mjs`. The method is explained for visitors at `/about/`.

## Develop

```bash
npm install
npm test
npm run dev
```

Run the daily job locally (needs a contact email for the NWS User-Agent):

```bash
NWS_CONTACT_EMAIL=you@example.com npm run daily
```

Settings live in `config/site.json`. The NWS contact email comes from `nwsContactEmail` there, or from the
`NWS_CONTACT_EMAIL` environment variable (a GitHub Actions repository variable in production).

## Deploy

Import the repository in Vercel (framework preset: Astro), add the domain from `config/site.json`, and create the DNS record Vercel shows you.
Keep the repository public so GitHub Actions minutes stay free.

Guidance only — see `/about/`.
