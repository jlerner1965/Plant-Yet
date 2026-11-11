// Re-checks every crop value in data/crops.json against its source.
// Each sourced value carries a URL and a verbatim quote; this script fetches the page and
// confirms the quote is really there. Run it after editing crops.json:  npm run data:crops
// Exit code 1 if any quote can't be found (so a value can never drift from its source silently).
import { BUILD_UA, dataPath, fetchRetry, readJson, sleep } from './lib/util.mjs';

const { crops } = await readJson(dataPath('crops.json'));
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', deg: '°', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', frac14: '¼', frac12: '½', frac34: '¾', ordm: 'º' };
function toText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z0-9]+);/gi, (m, n) => ENT[n] ?? m);
}
// Compare with all whitespace removed, so line breaks and table-cell joins don't matter.
const squash = (s) => s.toLowerCase().replace(/[\s ​]+/g, '');

const pages = new Map();
async function page(url) {
  if (!pages.has(url)) {
    const res = await fetchRetry(url, { headers: { 'User-Agent': BUILD_UA } });
    pages.set(url, squash(toText(await res.text())));
    await sleep(300);
  }
  return pages.get(url);
}

const FIELDS = ['frostCategory', 'indoorStartWeeks', 'plantWindow', 'daysToHarvest', 'nightMinF', 'minDaytimeTempF', 'coldToleranceF'];
let checked = 0;
const bad = [];
for (const crop of crops) {
  const items = [...FIELDS.filter((f) => crop[f]).map((f) => [f, crop[f]]), ...crop.tips.map((t, i) => [`tip ${i + 1}`, t])];
  for (const [label, v] of items) {
    checked++;
    try {
      if (!v.url || !v.quote) throw new Error('missing url or quote');
      if (!(await page(v.url)).includes(squash(v.quote))) throw new Error('quote not found on page');
    } catch (err) {
      bad.push(`${crop.slug} · ${label} · ${v.url} · ${err.message}`);
    }
  }
}
console.log(`${checked} sourced values checked on ${pages.size} pages, ${bad.length} failed`);
if (bad.length) {
  console.log(bad.join('\n'));
  process.exit(1);
}
