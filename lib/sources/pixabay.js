import { fetchJson } from '../http.js';
import { cleanText } from '../util.js';

export const id = 'pixabay';
export const name = 'Pixabay';
export const homepage = 'https://pixabay.com';
export const group = 'aggregators';
export const keyEnv = 'PIXABAY_KEY';

const SEARCH_URL = 'https://pixabay.com/api/';
const PAGE_SIZE = 24;
const MAX_SIDE = 1280;
const LICENSE = 'Pixabay Content License';
const LICENSE_URL = 'https://pixabay.com/service/license-summary/';

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

export function buildSearchUrl(key, q, page) {
  const currentPage = Math.max(1, Number(page) || 1);
  const params = new URLSearchParams({
    key,
    q: q ?? '',
    image_type: 'photo',
    per_page: String(PAGE_SIZE),
    page: String(currentPage),
    safesearch: 'true',
  });
  return `${SEARCH_URL}?${params.toString()}`;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// largeImageURL is at most 1280 px. Scale the original size to that limit.
function displaySize(width, height) {
  if (width === null || height === null || width <= 0 || height <= 0) {
    return { width: null, height: null };
  }
  const longest = Math.max(width, height);
  if (longest <= MAX_SIDE) return { width, height };
  const factor = MAX_SIDE / longest;
  return { width: Math.round(width * factor), height: Math.round(height * factor) };
}

export function normalize(raw) {
  const record = raw ?? {};
  const full = record.largeImageURL || record.webformatURL || null;
  if (!full) return null;

  const thumb = record.webformatURL || record.previewURL || full;
  const size = displaySize(numberOrNull(record.imageWidth), numberOrNull(record.imageHeight));

  return {
    source: id,
    id: String(record.id ?? ''),
    title: cleanText(record.tags, 80) || 'Untitled',
    creator: typeof record.user === 'string' && record.user !== '' ? record.user : null,
    date: null,
    description: null,
    thumb,
    preview: full,
    full,
    width: size.width,
    height: size.height,
    license: LICENSE,
    licenseUrl: LICENSE_URL,
    pageUrl: record.pageURL || null,
  };
}

export function parseSearch(json, page) {
  const hits = Array.isArray(json?.hits) ? json.hits : [];
  const items = hits.map((entry) => normalize(entry)).filter((item) => item !== null);

  const rawTotal = Number(json?.totalHits);
  const total = Number.isFinite(rawTotal) ? rawTotal : null;
  const currentPage = Math.max(1, Number(page) || 1);
  const hasMore = total === null ? false : currentPage * PAGE_SIZE < total;

  return { total, hasMore, items };
}

export async function search(q, page, deps = {}) {
  const key = currentKey();
  if (!key) throw needsKeyError();

  const doFetch = deps.fetchJson ?? fetchJson;
  let json;
  try {
    json = await doFetch(buildSearchUrl(key, q, page));
  } catch (err) {
    if (err?.status === 429) throw rateLimitError();
    throw err;
  }

  return parseSearch(json, page);
}
