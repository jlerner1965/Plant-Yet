import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const dataPath = (name) => resolve(ROOT, 'data', name);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw err;
  }
}

export async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 1) + '\n');
}

/**
 * Like writeJson, but each entry of value[key] goes on one line. Keeps the files that change
 * every day small and their git diffs to one line per town.
 */
export async function writeJsonLines(path, value, key) {
  const { [key]: entries, ...rest } = value;
  const head = JSON.stringify(rest, null, 1).replace(/\n}$/, '');
  const lines = Object.entries(entries).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${head},\n ${JSON.stringify(key)}: {\n${lines.join(',\n')}\n }\n}\n`);
}

export const site = JSON.parse(await readFile(resolve(ROOT, 'config', 'site.json'), 'utf8'));

/** User-Agent for bulk one-off downloads (Census, USGS, NCEI). */
export const BUILD_UA = `PlantYet/1.0 (+${site.url})`;

/**
 * fetch with timeout + retries. Returns the Response (ok) or throws.
 * Retries on network errors, 429 and 5xx.
 */
export async function fetchRetry(url, { headers = {}, tries = 4, timeoutMs = 30000, baseDelayMs = 1500 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) return res;
      lastErr = new Error(`HTTP ${res.status} for ${url}`);
      lastErr.status = res.status;
      if (res.status < 500 && res.status !== 429) throw Object.assign(lastErr, { fatal: true });
    } catch (err) {
      if (err.fatal) throw err;
      lastErr = err;
    }
    if (attempt < tries) await sleep(baseDelayMs * 2 ** (attempt - 1));
  }
  throw lastErr;
}

const R_MILES = 3958.7613;
export function haversineMiles(lat1, lon1, lat2, lon2) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_MILES * Math.asin(Math.sqrt(a));
}

export const today = () => new Date().toISOString().slice(0, 10);

export function slugify(name) {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
