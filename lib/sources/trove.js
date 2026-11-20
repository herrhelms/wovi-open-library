import { fetchJson } from '../http.js';
import { cacheSet, firstString } from '../util.js';

export const id = 'trove';
export const name = 'Trove (National Library of Australia)';
export const homepage = 'https://trove.nla.gov.au';
export const group = 'libraries';
export const keyEnv = 'TROVE_KEY';
export const trustResolvedUrl = true;

const SEARCH_URL = 'https://api.trove.nla.gov.au/v3/result';
const WORK_URL = 'https://api.trove.nla.gov.au/v3/work';
const PAGE_SIZE = 24;
const MAX_QUERIES = 200;
const MAX_CURSOR_REQUESTS = 10;
const NOTE = 'Trove often gives a thumbnail only. Open the item page for the full image.';

export function buildSearchUrl(q, cursor) {
  const params = new URLSearchParams({
    q: String(q ?? ''),
    category: 'image',
    encoding: 'json',
    n: String(PAGE_SIZE),
    s: cursor || '*',
    reclevel: 'full',
    include: 'links',
    'l-availability': 'y/f',
  });
  return `${SEARCH_URL}?${params.toString()}`;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
}

function thumbnailOf(work) {
  const found = asArray(work?.identifier).find(
    (entry) => entry?.linktype === 'thumbnail' && typeof entry.value === 'string' && entry.value !== '',
  );
  return found ? found.value : null;
}

export function normalize(work) {
  if (!work) return null;
  const thumbnail = thumbnailOf(work);
  if (thumbnail === null) return null;

  const itemId = String(work.id ?? '');
  const pageUrl = work.troveUrl || `https://trove.nla.gov.au/work/${itemId}`;

  return {
    source: id,
    id: itemId,
    title: work.title || 'Untitled',
    creator: firstString(work.contributor),
    date: work.issued === null || work.issued === undefined ? null : String(work.issued),
    description: null,
    thumb: thumbnail,
    preview: thumbnail,
    full: thumbnail,
    width: null,
    height: null,
    license: 'See item page',
    licenseUrl: null,
    pageUrl,
    note: NOTE,
  };
}

export function parseSearch(json) {
  const category = asArray(json?.category)[0];
  const records = category?.records ?? {};

  const items = asArray(records.work)
    .map((work) => normalize(work))
    .filter((item) => item !== null);

  const totalValue = Number(records.total);
  const total = Number.isFinite(totalValue) ? totalValue : null;
  const nextStart = records.nextStart ?? null;

  return { total, hasMore: Boolean(nextStart), items, nextStart };
}

function needsKeyError() {
  const err = new Error(`${name} needs ${keyEnv} in .env`);
  err.code = 'NEEDS_KEY';
  return err;
}

function tooFarError(page) {
  return new Error(`Trove: page ${page} is too far; load the pages in order`);
}

function readKey() {
  const value = process.env[keyEnv];
  return typeof value === 'string' && value !== '' ? value : null;
}

function cursorKey(q) {
  return String(q ?? '').trim().toLowerCase();
}

export function createTroveSource({ fetchJson: fetchJsonImpl = fetchJson } = {}) {
  const cursors = new Map();
  const lastTotals = new Map();

  function cursorsFor(q) {
    const key = cursorKey(q);
    let list = cursors.get(key);
    if (!list) {
      list = ['*'];
      cacheSet(cursors, key, list, MAX_QUERIES);
    }
    return list;
  }

  function storeCursor(q, page, nextStart) {
    const list = cursorsFor(q);
    list[page] = nextStart ?? null;
    cacheSet(cursors, cursorKey(q), list, MAX_QUERIES);
  }

  async function fetchPage(q, cursor, key, doFetch) {
    return doFetch(buildSearchUrl(q, cursor), {
      headers: { 'X-API-KEY': key },
    });
  }

  async function collectCursors(q, targetPage, key, doFetch) {
    const list = cursorsFor(q);
    let requests = 0;
    const missing = [];
    for (let page = 1; page < targetPage; page += 1) {
      if (list[page] === undefined) missing.push(page);
    }
    if (missing.length > MAX_CURSOR_REQUESTS) throw tooFarError(targetPage);
    for (let page = 1; page < targetPage; page += 1) {
      if (list[page] !== undefined) continue;
      if (list[page - 1] === null || list[page - 1] === undefined) {
        return { reached: false };
      }
      if (requests >= MAX_CURSOR_REQUESTS) {
        throw tooFarError(targetPage);
      }
      const json = await fetchPage(q, list[page - 1], key, doFetch);
      requests += 1;
      const parsed = parseSearch(json, page);
      if (parsed.total !== null) lastTotals.set(cursorKey(q), parsed.total);
      storeCursor(q, page, parsed.nextStart);
      if (list[page] === null) return { reached: false };
    }
    return { reached: true };
  }

  async function search(q, page, deps = {}) {
    const key = readKey();
    if (!key) throw needsKeyError();

    const currentPage = Math.max(1, Number(page) || 1);
    const doFetch = deps.fetchJson ?? fetchJsonImpl;
    const list = cursorsFor(q);

    if (list[currentPage - 1] === undefined) {
      const { reached } = await collectCursors(q, currentPage, key, doFetch);
      if (!reached || list[currentPage - 1] === undefined || list[currentPage - 1] === null) {
        return {
          total: lastTotals.get(cursorKey(q)) ?? null,
          hasMore: false,
          items: [],
          nextStart: null,
        };
      }
    }

    const json = await fetchPage(q, list[currentPage - 1], key, doFetch);
    const parsed = parseSearch(json, currentPage);
    storeCursor(q, currentPage, parsed.nextStart);
    if (parsed.total !== null) lastTotals.set(cursorKey(q), parsed.total);
    return parsed;
  }

  async function resolveDownload(itemId, deps = {}) {
    if (typeof itemId !== 'string' || !/^[0-9]+$/.test(itemId)) {
      const err = new Error('Invalid Trove item id');
      err.status = 400;
      throw err;
    }

    const key = readKey();
    if (!key) throw needsKeyError();

    const doFetch = deps.fetchJson ?? fetchJsonImpl;
    const url =
      `${WORK_URL}/${itemId}?encoding=json&reclevel=full&include=links`;
    const json = await doFetch(url, { headers: { 'X-API-KEY': key } });

    const work = json?.work && !Array.isArray(json.work) ? json.work : json;
    const thumbnail = thumbnailOf(work);
    if (thumbnail === null) throw new Error('Trove item has no image URL');

    return { url: thumbnail, filename: work?.title || null };
  }

  function clearCursors() {
    cursors.clear();
    lastTotals.clear();
  }

  return { search, resolveDownload, clearCursors };
}

let defaultSource = null;

function getDefaultSource() {
  if (!defaultSource) defaultSource = createTroveSource();
  return defaultSource;
}

export async function search(q, page, deps = {}) {
  return getDefaultSource().search(q, page, deps);
}

export async function resolveDownload(itemId, deps = {}) {
  return getDefaultSource().resolveDownload(itemId, deps);
}

export function clearCursors() {
  getDefaultSource().clearCursors();
}
