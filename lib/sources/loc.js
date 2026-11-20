import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { PROJECT_ROOT } from '../env.js';
import { fetchJson, fetchWithTimeout, HttpError } from '../http.js';
import { mapLimit } from '../util.js';
import {
  applyIiif,
  buildIndex,
  iiifCandidates,
  parseSet,
  parseSetList,
  searchIndex,
} from './loc-free.js';

export const id = 'loc';
export const name = 'Library of Congress (Free to Use)';
export const homepage = 'https://www.loc.gov/free-to-use/';
export const keyEnv = null;

export const SETS_URL = 'https://www.loc.gov/free-to-use/?fo=json';
export const PREPARING_MESSAGE =
  'Library of Congress data is being prepared (first use reads 101 Free to Use sets). Try again in a minute.';
export const BLOCKED_MESSAGE =
  'Library of Congress blocked the request (Cloudflare challenge). Try again later or from another network.';

export { normalize } from './loc-free.js';

const PAGE_SIZE = 24;
const CACHE_FILE = 'iiif-cache.json';
const INDEX_FILE = 'free-to-use.json';
const INDEX_VERSION = 1;

function positiveNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return number;
}

function preparingError() {
  const err = new Error(PREPARING_MESSAGE);
  err.code = 'PREPARING';
  return err;
}

function prepareFailedError(cause) {
  const message = cause?.message ?? String(cause);
  const err = new Error(`Library of Congress data preparation failed: ${message}`);
  err.code = 'PREPARE_FAILED';
  return err;
}

export function toBlockedError(err) {
  if (!(err instanceof HttpError) && !(err && typeof err === 'object')) return null;
  const code = err.code;
  const status = err.status;
  const snippet = typeof err.bodySnippet === 'string' ? err.bodySnippet : '';

  const blocked =
    code === 'NOT_JSON' ||
    (code === 'HTTP' && (status === 403 || status === 429 || status === 503)) ||
    snippet.includes('cf-') ||
    snippet.includes('Just a moment') ||
    snippet.toLowerCase().includes('challenge');

  if (!blocked) return null;

  const error = new Error(BLOCKED_MESSAGE);
  error.code = 'BLOCKED';
  return error;
}

export async function probeIiif(base, deps = {}) {
  const doFetch = typeof deps.fetch === 'function' ? deps.fetch : fetchWithTimeout;
  const root = String(base).replace(/\/+$/, '');
  const res = await doFetch(`${root}/info.json`, {
    timeoutMs: 8000,
    headers: { Accept: 'application/json' },
  });

  let body = '';
  try {
    body = await res.text();
  } catch {
    body = '';
  }

  if (res.status !== 200) return null;

  let json;
  try {
    json = JSON.parse(body);
  } catch {
    return null;
  }

  const width = positiveNumber(json?.width);
  const height = positiveNumber(json?.height);
  if (width === null || height === null) return null;

  return { width, height };
}

function isFresh(info, maxAgeDays) {
  const maxAgeMs = Number(maxAgeDays) * 24 * 60 * 60 * 1000;
  return Date.now() - info.mtimeMs < maxAgeMs;
}

function setJsonUrl(url) {
  return `${url}${url.includes('?') ? '&' : '?'}fo=json`;
}

function pickItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    title: raw.title ?? null,
    alt: raw.alt ?? null,
    image: raw.image ?? null,
    link: raw.link ?? null,
  };
}

function usableSavedSets(json) {
  if (!json || typeof json !== 'object' || !Array.isArray(json.sets)) return null;
  const sets = [];
  for (const entry of json.sets) {
    if (!entry || typeof entry !== 'object') continue;
    const items = Array.isArray(entry.items)
      ? entry.items.map(pickItem).filter(Boolean)
      : [];
    sets.push({
      title: typeof entry.title === 'string' ? entry.title : null,
      url: typeof entry.url === 'string' ? entry.url : '',
      items,
    });
  }
  return sets;
}

export function createLocSource({
  dataDir,
  fetchJson: fetchJsonImpl = fetchJson,
  probeIiif: probeImpl = probeIiif,
  maxAgeDays = 7,
  setsUrl = SETS_URL,
  concurrency = 3,
  retryDelayMs = 2000,
  cacheWriteMs = 5000,
} = {}) {
  let state = 'idle';
  let index = null;
  let lastError = null;

  const cache = new Map();
  const running = new Map();
  let writeTimer = null;
  let lastWrite = 0;

  const cachePath = join(dataDir, CACHE_FILE);
  const indexPath = join(dataDir, INDEX_FILE);

  function cacheSnapshot() {
    const data = {};
    for (const [key, value] of cache) data[key] = value;
    return data;
  }

  async function writeCacheNow() {
    lastWrite = Date.now();
    try {
      const tmp = `${cachePath}.tmp`;
      await writeFile(tmp, JSON.stringify(cacheSnapshot()));
      await rename(tmp, cachePath);
    } catch (err) {
      process.stderr.write(
        `[loc] could not write the IIIF cache: ${err?.message ?? String(err)}\n`,
      );
    }
  }

  function scheduleCacheWrite() {
    if (writeTimer) return;
    const delay = Math.max(0, lastWrite + cacheWriteMs - Date.now());
    writeTimer = setTimeout(() => {
      writeTimer = null;
      writeCacheNow();
    }, delay);
    if (typeof writeTimer.unref === 'function') writeTimer.unref();
  }

  async function flushCache() {
    if (!writeTimer) return;
    clearTimeout(writeTimer);
    writeTimer = null;
    await writeCacheNow();
  }

  async function loadCache() {
    cache.clear();
    let text;
    try {
      text = await readFile(cachePath, 'utf8');
    } catch {
      return;
    }

    let json;
    try {
      json = JSON.parse(text);
    } catch {
      return;
    }
    if (!json || typeof json !== 'object' || Array.isArray(json)) return;

    for (const [key, value] of Object.entries(json)) {
      if (value === null) {
        cache.set(key, null);
        continue;
      }
      if (!value || typeof value !== 'object') continue;
      if (typeof value.base !== 'string' || value.base === '') continue;
      const width = positiveNumber(value.width);
      const height = positiveNumber(value.height);
      if (width === null || height === null) continue;
      cache.set(key, { base: value.base, width, height });
    }
  }

  async function readSavedSets() {
    let info;
    try {
      info = await stat(indexPath);
    } catch {
      return null;
    }
    if (!isFresh(info, maxAgeDays)) return null;

    let text;
    try {
      text = await readFile(indexPath, 'utf8');
    } catch {
      return null;
    }

    let json;
    try {
      json = JSON.parse(text);
    } catch {
      return null;
    }

    const sets = usableSavedSets(json);
    if (!sets) return null;

    process.stderr.write(`[loc] using saved Free to Use sets (${sets.length} sets)\n`);
    return sets;
  }

  async function saveSets(sets) {
    const data = {
      version: INDEX_VERSION,
      savedAt: new Date().toISOString(),
      sets: sets.map((set) => ({
        title: set.title,
        url: set.url,
        items: set.items.map(pickItem).filter(Boolean),
      })),
    };
    const tmp = `${indexPath}.tmp`;
    await writeFile(tmp, JSON.stringify(data));
    await rename(tmp, indexPath);
  }

  async function withRetry(fn) {
    try {
      return await fn();
    } catch (err) {
      if (err?.code !== 'NETWORK' && err?.code !== 'TIMEOUT') throw err;
      if (retryDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
      return fn();
    }
  }

  async function fetchAllSets() {
    const listJson = await withRetry(() =>
      fetchJsonImpl(setsUrl, { timeoutMs: 20000 }),
    );
    const list = parseSetList(listJson);
    if (list.length === 0) {
      throw new Error('no Free to Use sets in the set list');
    }

    let failed = 0;
    const results = await mapLimit(list, concurrency, async (set) => {
      try {
        const json = await withRetry(() =>
          fetchJsonImpl(setJsonUrl(set.url), { timeoutMs: 20000 }),
        );
        const parsed = parseSet(json);
        return {
          title: set.title ?? parsed.title,
          url: set.url,
          items: parsed.items.map(pickItem).filter(Boolean),
        };
      } catch {
        failed += 1;
        return null;
      }
    });

    if (failed > 0) {
      process.stderr.write(`[loc] ${failed} of ${list.length} sets failed\n`);
    }

    const sets = results.filter(Boolean);
    const itemCount = sets.reduce((total, set) => total + set.items.length, 0);
    if (sets.length === 0 || itemCount === 0) {
      throw new Error('no Free to Use items could be read');
    }

    return sets;
  }

  async function prepare() {
    state = 'preparing';
    lastError = null;
    const started = Date.now();

    try {
      await mkdir(dataDir, { recursive: true });
      await loadCache();

      let sets = await readSavedSets();
      if (!sets) {
        sets = await fetchAllSets();
        await saveSets(sets);
      }

      index = buildIndex(sets);
      state = 'ready';

      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      process.stderr.write(
        `[loc] index ready: ${index.items.length} items from ${sets.length} sets in ${seconds} s\n`,
      );
    } catch (err) {
      index = null;
      state = 'idle';
      lastError = toBlockedError(err) ?? err;
    }
  }

  async function resolveItem(item) {
    const itemId = item.id;
    const candidates = iiifCandidates(itemId);
    if (candidates.length === 0) return item;

    if (cache.has(itemId)) return applyIiif(item, cache.get(itemId));

    if (running.has(itemId)) {
      const entry = await running.get(itemId);
      return entry === undefined ? item : applyIiif(item, entry);
    }

    const promise = (async () => {
      try {
        for (const base of candidates) {
          const info = await probeImpl(base);
          const width = positiveNumber(info?.width);
          const height = positiveNumber(info?.height);
          if (width !== null && height !== null) {
            const entry = { base, width, height };
            cache.set(itemId, entry);
            scheduleCacheWrite();
            return entry;
          }
        }
        cache.set(itemId, null);
        scheduleCacheWrite();
        return null;
      } catch {
        return undefined;
      }
    })();

    running.set(itemId, promise);
    try {
      const entry = await promise;
      return entry === undefined ? item : applyIiif(item, entry);
    } finally {
      running.delete(itemId);
    }
  }

  async function search(q, page) {
    if (state === 'ready') {
      const result = searchIndex(index, q, page, PAGE_SIZE);
      const items = await mapLimit(result.items, 6, resolveItem);
      return { total: result.total, hasMore: result.hasMore, items };
    }

    if (state === 'preparing') throw preparingError();

    if (lastError) {
      const error = lastError;
      lastError = null;
      if (error?.code === 'BLOCKED') throw error;
      throw prepareFailedError(error);
    }

    prepare();
    throw preparingError();
  }

  function status() {
    return state;
  }

  return { search, status, flushCache };
}

let defaultSource = null;

export async function search(q, page) {
  if (!defaultSource) {
    defaultSource = createLocSource({
      dataDir: join(PROJECT_ROOT, 'data', 'loc'),
    });
  }
  return defaultSource.search(q, page);
}
