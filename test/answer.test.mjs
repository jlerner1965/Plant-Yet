import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cropAnswer, cropSeason, buildAnswers, dayNum, isoOf, isStale, townHeadline } from '../src/lib/answer.mjs';
import { reduceForecast } from '../scripts/lib/nws.mjs';

// Boulder's real 1991–2020 normals (USC00050848).
const station = { id: 'S1', lastSpring: { p10: '05-18', p50: '05-06', p90: '04-24' }, firstFall: { p10: '09-21', p50: '10-05', p90: '10-18' } };
const tomato = { slug: 'tomato', name: 'Tomato', plantWindow: { startWeeks: 2, endWeeks: null }, daysToHarvest: { min: 65, max: 65 }, indoorStartWeeks: { min: 6, max: null, relativeTo: 'last frost' }, nightMinF: { value: 52 }, coldToleranceF: { value: 32 } };
const pea = { slug: 'pea', name: 'Pea', plantWindow: { startWeeks: -4, endWeeks: -2 }, daysToHarvest: { min: 60, max: 70 }, coldToleranceF: { value: 28 } };
const dill = { slug: 'dill', name: 'Dill', plantWindow: { startWeeks: 0, endWeeks: null } };
const fc = (tonight, min = tonight, minName = 'Thursday Night') => ({
  fetchedAt: '2026-05-25T10:30:00Z',
  tonight: { name: 'Tonight', start: '', lowF: tonight },
  min7: min === tonight ? { name: 'Tonight', start: '', lowF: tonight } : { name: minName, start: '', lowF: min },
  nights: [],
});
const ask = (crop, date, forecast) => cropAnswer({ crop, station, forecast, today: dayNum(date) });

test('season dates come from the station and the sourced weeks', () => {
  const s = cropSeason(tomato, station, 2026);
  assert.equal(isoOf(s.lastFrost), '2026-05-06');
  assert.equal(isoOf(s.open), '2026-05-20'); // 2 weeks after last frost
  assert.equal(isoOf(s.close), '2026-08-01'); // first frost Oct 5 minus 65 days
  assert.equal(isoOf(s.indoorFrom), '2026-03-25'); // 6 weeks before last frost
  assert.equal(isoOf(s.seasonEnd), '2026-10-18');
  const p = cropSeason(pea, station, 2026);
  assert.equal(isoOf(p.open), '2026-04-08');
  // Seed-start weeks counted from the transplant date when the source says so.
  const t2 = cropSeason({ ...tomato, indoorStartWeeks: { min: 8, max: 8, relativeTo: 'transplant date' } }, station, 2026);
  assert.equal(isoOf(t2.indoorFrom), '2026-03-25');
});

test('PLANT: inside the window and the 7-night low is above the crop limit', () => {
  const a = ask(tomato, '2026-05-25', fc(56, 54));
  assert.equal(a.s, 'plant');
  assert.match(a.r, /54°F/);
});

test('WAIT: inside the window but a cold night is forecast — says which night', () => {
  const a = ask(tomato, '2026-05-25', fc(55, 41));
  assert.equal(a.s, 'wait');
  assert.match(a.r, /^41°F forecast Thursday Night/);
  // exactly at the limit is not "above" it
  assert.equal(ask(tomato, '2026-05-25', fc(52)).s, 'wait');
});

test('WAIT in spring before the window: says the typical last frost date', () => {
  const a = ask(tomato, '2026-03-10', fc(40));
  assert.equal(a.s, 'wait');
  assert.equal(a.r, 'Typical last frost here is May 6; planting window opens May 20. Start seeds indoors on Mar 25.');
  assert.match(ask({ ...tomato, indoorStartWeeks: { min: 2, max: 6 } }, '2026-04-01', fc(40)).r, /Seeds can be started indoors now/);
});

test('COVER TONIGHT: tonight at or below the damage threshold while the crop is in the ground', () => {
  assert.equal(ask(tomato, '2026-05-25', fc(32)).s, 'cover');
  assert.equal(ask(tomato, '2026-09-20', fc(31)).s, 'cover'); // fall, window long closed but still in the ground
  assert.equal(ask(tomato, '2026-05-25', fc(33)).s, 'wait'); // above threshold
  // a cold night LATER in the week is a reason to wait, not to cover tonight
  assert.equal(ask(tomato, '2026-05-25', fc(45, 30)).s, 'wait');
});

test('no COVER outside the weeks the crop is in the ground', () => {
  assert.equal(ask(tomato, '2026-04-20', fc(20)).s, 'wait'); // before its window
  assert.equal(ask(tomato, '2026-11-11', fc(10)).s, 'off'); // after the season
});

test('off-season: seed-start date or next window, with the year when it is next year', () => {
  const a = ask(tomato, '2026-11-11', fc(30));
  assert.equal(a.s, 'off');
  assert.match(a.r, /^Start seeds indoors on Mar 25, 2027\. Planting window opens May 20, 2027\./);
  assert.equal(a.next, '2027-03-25');
  const p = ask(pea, '2027-01-15', fc(5));
  assert.equal(p.s, 'off');
  assert.equal(p.r, 'Next planting window opens Apr 8.');
  const summer = ask(pea, '2026-09-01', fc(50));
  assert.equal(summer.s, 'off');
  assert.match(summer.r, /^Planting window closed for this year\. Next planting window opens Apr 8, 2027/);
});

test('a crop with no sourced cold limit never gets a Plant answer', () => {
  const a = ask(dill, '2026-06-01', fc(60));
  assert.equal(a.s, 'nodata');
});

test('stale rule: more than 36 hours old', () => {
  const f = { fetchedAt: '2026-05-25T10:30:00Z' };
  assert.equal(isStale(f, new Date('2026-05-26T22:30:00Z'), 36), false);
  assert.equal(isStale(f, new Date('2026-05-26T22:30:01Z'), 36), true);
  assert.equal(isStale(null, new Date(), 36), true);
});

test('buildAnswers: stale forecast and missing station never produce plant/cover', () => {
  const site = { timeZone: 'America/Denver', staleAfterHours: 36 };
  const towns = [{ slug: 'fresh' }, { slug: 'stale' }, { slug: 'nostation' }, { slug: 'never' }];
  const frost = { fresh: { stationId: 'S1' }, stale: { stationId: 'S1' }, nostation: { stationId: null }, never: { stationId: 'S1' } };
  const warm = fc(56, 54);
  const forecasts = { fresh: warm, stale: { ...warm, fetchedAt: '2026-05-23T10:30:00Z' }, nostation: warm };
  const out = buildAnswers({ towns, frost, stations: [station], crops: [tomato, pea], forecasts, now: new Date('2026-05-25T11:00:00Z'), site });
  assert.equal(out.date, '2026-05-25');
  assert.equal(out.towns.fresh.headline.s, 'plant');
  assert.equal(out.towns.stale.headline.s, 'unavailable');
  assert.equal(out.towns.stale.crops, undefined);
  assert.equal(out.towns.never.headline.s, 'unavailable');
  assert.equal(out.towns.nostation.headline.s, 'norecord');
  assert.equal(out.towns.nostation.crops, undefined);
  assert.deepEqual(out.summary, { plant: 1, wait: 0, cover: 0, offseason: 0, unavailable: 2, norecord: 1 });
});

test('headline priority: cover beats plant', () => {
  const forecast = fc(30, 30);
  const crops = [tomato, pea];
  const cropAnswers = Object.fromEntries(crops.map((c) => [c.slug, ask(c, '2026-05-25', forecast)]));
  assert.equal(cropAnswers.tomato.s, 'cover');
  assert.equal(cropAnswers.pea.s, 'plant'); // peas take 30°F; window still open (harvest-based close)
  assert.equal(townHeadline({ crops, cropAnswers, forecast, station, today: dayNum('2026-05-25') }).s, 'cover');
});

test('reduceForecast: tonight is the first night, min7 is the coldest night, days ignored', () => {
  const now = new Date('2026-05-25T10:30:00Z');
  const mk = (name, start, end, isDaytime, temperature) => ({ name, startTime: start, endTime: end, isDaytime, temperature, temperatureUnit: 'F' });
  const json = { properties: { updateTime: '2026-05-25T09:00:00Z', periods: [
    mk('Today', '2026-05-25T06:00:00-06:00', '2026-05-25T18:00:00-06:00', true, 20),
    mk('Tonight', '2026-05-25T18:00:00-06:00', '2026-05-26T06:00:00-06:00', false, 44),
    mk('Tuesday', '2026-05-26T06:00:00-06:00', '2026-05-26T18:00:00-06:00', true, 70),
    mk('Tuesday Night', '2026-05-26T18:00:00-06:00', '2026-05-27T06:00:00-06:00', false, 38),
  ] } };
  const f = reduceForecast(json, 'u', now);
  assert.equal(f.tonight.lowF, 44);
  assert.deepEqual([f.min7.lowF, f.min7.name], [38, 'Tuesday Night']);
  assert.equal(f.fetchedAt, now.toISOString());
  // An out-of-date product (first night already over) is rejected, so the last good forecast is kept.
  assert.throws(() => reduceForecast(json, 'u', new Date('2026-05-27T10:30:00Z')), /out of date/);
});
