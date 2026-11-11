// The whole "plant, wait, or cover tonight?" decision lives here. Pure functions, no I/O:
// the daily job calls buildAnswers() and the tests exercise the same code.
//
// Vocabulary
//   lastFrost  = station's 50% last-spring 32°F date ("typical last frost")
//   firstFrost = station's 50% first-fall 32°F date ("typical first frost")
//   window     = the crop's outdoor planting window for this town (see cropSeason)
//   in ground  = window opens -> the date by which 9 falls in 10 have had a 32°F freeze

const DAY = 86400000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'YYYY-MM-DD' -> integer day number */
export const dayNum = (iso) => Math.round(Date.parse(iso + 'T00:00:00Z') / DAY);
export const isoOf = (n) => new Date(n * DAY).toISOString().slice(0, 10);

/** Calendar date in a time zone, as 'YYYY-MM-DD'. */
export function localDate(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** "May 12", or "May 12, 2027" when the year differs from the reference day. */
export function fmtDay(n, refDay) {
  const d = new Date(n * DAY);
  const base = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return refDay !== undefined && new Date(refDay * DAY).getUTCFullYear() !== d.getUTCFullYear() ? `${base}, ${d.getUTCFullYear()}` : base;
}
export const fmtMonthDay = (mmdd) => `${MONTHS[Number(mmdd.slice(0, 2)) - 1]} ${Number(mmdd.slice(3))}`;

const plural = (name) => name; // crop names are already written the way they read in a sentence

/** Dates for one crop, one station, one calendar year. */
export function cropSeason(crop, station, year) {
  const last = dayNum(`${year}-${station.lastSpring.p50}`);
  const first = dayNum(`${year}-${station.firstFall.p50}`);
  const w = crop.plantWindow;
  let open = null;
  let close = null;
  let closeBasis = null;
  if (w) {
    const a = w.startWeeks;
    const b = w.endWeeks ?? w.startWeeks;
    open = last + 7 * Math.min(a, b);
    const sourcedEnd = last + 7 * Math.max(a, b);
    if (crop.daysToHarvest) {
      // Last day a planting still has time to mature before the typical first fall frost.
      close = Math.max(sourcedEnd, first - crop.daysToHarvest.max);
      closeBasis = close === sourcedEnd ? 'source' : 'harvest';
    } else if (w.endWeeks !== null && w.endWeeks !== undefined) {
      close = sourcedEnd;
      closeBasis = 'source';
    } else {
      // The source gives only a start ("after last frost") and there is no sourced days-to-harvest:
      // we don't invent a cut-off, so the window runs to the typical first fall frost.
      close = first;
      closeBasis = 'none';
    }
  }
  // Seed-starting weeks are counted back from last frost, or from the transplant date
  // (= the day the window opens) when that is how the source words it.
  const iw = crop.indoorStartWeeks;
  const base = iw && (iw.relativeTo === 'transplant date' ? open : last);
  return {
    year,
    lastFrost: last,
    firstFrost: first,
    open,
    close,
    closeBasis,
    // Seeds are started "min–max weeks before last frost": the earliest sensible day is max weeks before.
    indoorFrom: iw && base !== null ? base - 7 * (iw.max ?? iw.min) : null,
    indoorTo: iw && base !== null ? base - 7 * iw.min : null,
    // After this date a freeze has normally already happened (9 years in 10): the season is over.
    seasonEnd: dayNum(`${year}-${station.firstFall.p90}`),
  };
}

const nightLabel = (night) => (/^(tonight|overnight)$/i.test(night.name) ? 'tonight' : night.name);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Answer for one crop in one town.
 * Returns { s: 'cover'|'plant'|'wait'|'off'|'nodata', r: reason/sentence, next?: ISO date of the next action }.
 */
export function cropAnswer({ crop, station, forecast, today }) {
  const year = new Date(today * DAY).getUTCFullYear();
  const cur = cropSeason(crop, station, year);
  const nxt = cropSeason(crop, station, year + 1);
  if (cur.open === null) return { s: 'off', r: 'No sourced planting window for this crop, so no answer is given.' };

  const tonight = forecast.tonight;
  const min7 = forecast.min7;
  // nightMin: an explicit minimum NIGHT temperature for planting out (few crops have one sourced).
  // tolerance: the coldest temperature the source says the crop takes without serious damage.
  const nightMin = crop.nightMinF?.value ?? null;
  const damage = crop.coldToleranceF?.value ?? null;
  const gate = nightMin ?? damage;
  const name = plural(crop.name).toLowerCase();
  const needs = nightMin !== null ? `${name} needs nights above ${nightMin}°F` : `cold limit for ${name} is ${damage}°F`;

  // COVER TONIGHT — only while the crop is normally in the ground.
  if (damage !== null && today >= cur.open && today <= cur.seasonEnd && tonight.lowF <= damage) {
    return {
      s: 'cover',
      r: `${tonight.lowF}°F forecast ${nightLabel(tonight)}. ${cap(name)} is at risk at ${damage}°F or colder — cover what is already planted.`,
    };
  }

  // Inside the planting window.
  if (today >= cur.open && today <= cur.close) {
    const windowText = `Planting window here is ${fmtDay(cur.open)}–${fmtDay(cur.close)}`;
    if (gate === null) {
      return { s: 'nodata', r: `${windowText}, but no extension source gives a cold limit for ${name}, so we can't check the forecast for it.` };
    }
    if (min7.lowF > gate) {
      return { s: 'plant', r: `${windowText}. Coldest of the next 7 nights: ${min7.lowF}°F (${needs}).` };
    }
    return { s: 'wait', r: `${min7.lowF}°F forecast ${nightLabel(min7)}; ${needs}.` };
  }

  // Before this year's window.
  if (today < cur.open) return before(cur, today);
  // After this year's window (still growing season, or winter): look to next year.
  const closed = today <= cur.seasonEnd ? 'Planting window closed for this year. ' : '';
  const b = before(nxt, today, true);
  return { ...b, r: closed + b.r };
}

function before(season, today, forceOff = false) {
  const year = new Date(today * DAY).getUTCFullYear();
  // "Spring" for this purpose starts March 1 (meteorological spring). Before that it is off-season.
  const spring = !forceOff && today >= dayNum(`${year}-03-01`);
  const opens = fmtDay(season.open, today);
  const last = fmtDay(season.lastFrost, today);
  const seeds =
    season.indoorFrom === null
      ? ''
      : today < season.indoorFrom
        ? ` Start seeds indoors on ${fmtDay(season.indoorFrom, today)}.`
        : today <= season.indoorTo
          ? ' Seeds can be started indoors now.'
          : '';
  if (spring) {
    return { s: 'wait', r: `Typical last frost here is ${last}; planting window opens ${opens}.${seeds}`, next: isoOf(season.open) };
  }
  if (season.indoorFrom !== null && today < season.indoorFrom) {
    return { s: 'off', r: `Start seeds indoors on ${fmtDay(season.indoorFrom, today)}. Planting window opens ${opens}.`, next: isoOf(season.indoorFrom) };
  }
  return { s: 'off', r: `Next planting window opens ${opens}.${seeds}`, next: isoOf(season.open) };
}

/** Is a stored forecast too old to base an answer on? */
export function isStale(forecast, now, staleAfterHours) {
  return !forecast || now.getTime() - Date.parse(forecast.fetchedAt) > staleAfterHours * 3600 * 1000;
}

const list = (names, max = 4) => {
  const shown = names.slice(0, max).map((n) => n.toLowerCase());
  const more = names.length - shown.length;
  return shown.join(', ') + (more > 0 ? ` and ${more} more` : '');
};

/** Town headline from its crop answers. Priority: cover > plant > wait > off. */
export function townHeadline({ crops, cropAnswers, forecast, station, today }) {
  const by = (s) => crops.filter((c) => cropAnswers[c.slug]?.s === s);
  const cover = by('cover');
  const plant = by('plant');
  const wait = by('wait');
  const n = crops.length;
  if (cover.length) {
    return {
      s: 'cover',
      word: 'Cover tonight',
      r: `${forecast.tonight.lowF}°F forecast ${nightLabel(forecast.tonight)}. Protect ${list(cover.map((c) => c.name))}.`,
    };
  }
  if (plant.length) {
    return {
      s: 'plant',
      word: 'Plant',
      r: `${plant.length} of ${n} crops can go in now: ${list(plant.map((c) => c.name))}. The coldest of the next 7 nights is ${forecast.min7.lowF}°F.`,
    };
  }
  const year = new Date(today * DAY).getUTCFullYear();
  if (wait.length) {
    const last = dayNum(`${year}-${station.lastSpring.p50}`);
    const cold = wait.some((c) => /forecast/.test(cropAnswers[c.slug].r));
    return {
      s: 'wait',
      word: 'Wait',
      r: cold
        ? `${forecast.min7.lowF}°F forecast ${nightLabel(forecast.min7)} — too cold for the crops whose planting window is open.`
        : `Typical last frost here is ${fmtDay(last)}. Nothing is in its planting window yet.`,
    };
  }
  // Off-season: point at the earliest next action.
  const nexts = crops
    .map((c) => ({ c, a: cropAnswers[c.slug] }))
    .filter((x) => x.a?.next)
    .sort((x, y) => x.a.next.localeCompare(y.a.next));
  const first = nexts[0];
  return {
    s: 'off',
    word: 'Not yet',
    r: first
      ? `Off-season. Next up: ${first.c.name.toLowerCase()} — ${first.a.r.replace(/^Planting window closed for this year\. /, '').split('. ')[0].replace(/\.$/, '')}.`
      : 'Off-season.',
  };
}

/** Everything the site renders, for every town. Written to data/answers.json by the daily job. */
export function buildAnswers({ towns, frost, stations, crops, forecasts, now, site }) {
  const date = localDate(now, site.timeZone);
  const today = dayNum(date);
  const stationById = new Map(stations.map((s) => [s.id, s]));
  const summary = { plant: 0, wait: 0, cover: 0, offseason: 0, unavailable: 0, norecord: 0 };
  const out = {};
  for (const town of towns) {
    const match = frost[town.slug];
    const station = match?.stationId ? stationById.get(match.stationId) : null;
    const forecast = forecasts[town.slug] || null;
    const stale = isStale(forecast, now, site.staleAfterHours);
    if (!station) {
      summary.norecord++;
      out[town.slug] = { headline: { s: 'norecord', word: 'No nearby frost record', r: 'No weather station with a 30-year freeze record is close enough in distance and elevation, so no planting dates are given.' } };
      continue;
    }
    if (stale) {
      summary.unavailable++;
      out[town.slug] = { headline: { s: 'unavailable', word: 'Forecast unavailable', r: forecast ? 'The last forecast we could fetch is too old to answer from.' : 'No forecast could be fetched for this town.' } };
      continue;
    }
    const cropAnswers = {};
    for (const crop of crops) cropAnswers[crop.slug] = cropAnswer({ crop, station, forecast, today });
    const headline = townHeadline({ crops, cropAnswers, forecast, station, today });
    summary[headline.s === 'off' ? 'offseason' : headline.s]++;
    // "next" is only needed to pick the headline; keep the committed file small.
    for (const a of Object.values(cropAnswers)) delete a.next;
    out[town.slug] = { headline, crops: cropAnswers };
  }
  return {
    about: 'Computed by scripts/daily.mjs from forecasts.json, frost.json, stations.json and crops.json. See /about/ for the rules.',
    date,
    generatedAt: now.toISOString(),
    staleAfterHours: site.staleAfterHours,
    summary,
    towns: out,
  };
}
