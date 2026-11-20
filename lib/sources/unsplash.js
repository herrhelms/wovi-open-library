import { fetchJson } from '../http.js';
import { cleanText } from '../util.js';

export const id = 'unsplash';
export const name = 'Unsplash';
export const homepage = 'https://unsplash.com';
export const group = 'aggregators';
export const keyEnv = 'UNSPLASH_KEY';
export const trustResolvedUrl = true;

const SEARCH_URL = 'https://api.unsplash.com/search/photos';
const PHOTO_URL = 'https://api.unsplash.com/photos';
const PAGE_SIZE = 24;
const LICENSE = 'Unsplash License';
const LICENSE_URL = 'https://unsplash.com/license';
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function needsKeyError() {
  const err = new Error(`${name} needs ${keyEnv} in .env`);
  err.code = 'NEEDS_KEY';
  return err;
}

function currentKey() {
  const value = process.env[keyEnv];
  return typeof value === 'string' && value !== '' ? value : null;
}

function rateLimitError() {
  const err = new Error(`${name} rate limit reached. Try again later.`);
  err.code = 'RATE_LIMIT';
  return err;
}

function headersFor(key) {
  return {
    Authorization: `Client-ID ${key}`,
    'Accept-Version': 'v1',
  };
}

export function buildSearchUrl(q, page) {
  const currentPage = Math.max(1, Number(page) || 1);
  const params = new URLSearchParams({
    query: q ?? '',
    per_page: String(PAGE_SIZE),
    page: String(currentPage),
  });
  return `${SEARCH_URL}?${params.toString()}`;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function dateOnly(value) {
  if (typeof value !== 'string' || value.length < 10) return null;
  return value.slice(0, 10);
}

export function normalize(raw) {
  const record = raw ?? {};
  const urls = record.urls ?? {};
  const full = urls.full;
  if (typeof full !== 'string' || full === '') return null;

  const title =
    cleanText(record.description, 200) ||
    cleanText(record.alt_description, 200) ||
    'Untitled';

  return {
    source: id,
    id: String(record.id ?? ''),
    title,
    creator: typeof record.user?.name === 'string' && record.user.name !== ''
      ? record.user.name
      : null,
    date: dateOnly(record.created_at),
    description: null,
    thumb: urls.small || urls.regular || full,
    preview: urls.regular || full,
    full,
    width: numberOrNull(record.width),
    height: numberOrNull(record.height),
    license: LICENSE,
    licenseUrl: LICENSE_URL,
    pageUrl: record.links?.html || null,
    provider: null,
  };
}

export function parseSearch(json, page) {
  const results = Array.isArray(json?.results) ? json.results : [];
  const items = results.map((entry) => normalize(entry)).filter((item) => item !== null);

  const rawTotal = Number(json?.total);
  const total = Number.isFinite(rawTotal) ? rawTotal : null;
  const totalPages = Number(json?.total_pages);
  const currentPage = Math.max(1, Number(page) || 1);
  const hasMore = Number.isFinite(totalPages) ? currentPage < totalPages : false;

  return { total, hasMore, items };
}

export async function search(q, page, deps = {}) {
  const key = currentKey();
  if (!key) throw needsKeyError();

  const doFetch = deps.fetchJson ?? fetchJson;
  let json;
  try {
    json = await doFetch(buildSearchUrl(q, page), { headers: headersFor(key) });
  } catch (err) {
    if (err?.status === 429) throw rateLimitError();
    throw err;
  }

  return parseSearch(json, page);
}

export async function resolveDownload(itemId, deps = {}) {
  const key = currentKey();
  if (!key) throw needsKeyError();

  if (typeof itemId !== 'string' || !ID_PATTERN.test(itemId)) {
    const err = new Error('Invalid Unsplash item id');
    err.status = 400;
    throw err;
  }

  const doFetch = deps.fetchJson ?? fetchJson;
  let json;
  try {
    // This endpoint is the item's download_location and counts the download.
    json = await doFetch(`${PHOTO_URL}/${itemId}/download`, { headers: headersFor(key) });
  } catch (err) {
    if (err?.status === 429) throw rateLimitError();
    throw err;
  }

  const url = json?.url;
  if (typeof url !== 'string' || url === '') {
    throw new Error('Unsplash gave no download URL');
  }

  return { url, filename: itemId };
}
