import { fetchJson } from '../http.js';
import { cleanText } from '../util.js';

export const id = 'pexels';
export const name = 'Pexels';
export const homepage = 'https://www.pexels.com';
export const group = 'aggregators';
export const keyEnv = 'PEXELS_KEY';

const SEARCH_URL = 'https://api.pexels.com/v1/search';
const PAGE_SIZE = 24;
const LICENSE = 'Pexels License';
const LICENSE_URL = 'https://www.pexels.com/license/';

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

export function normalize(raw) {
  const record = raw ?? {};
  const src = record.src ?? {};
  const full = src.original;
  if (typeof full !== 'string' || full === '') return null;

  const preview = src.large2x || src.large || full;

  return {
    source: id,
    id: String(record.id ?? ''),
    title: cleanText(record.alt, 200) || 'Untitled',
    creator: typeof record.photographer === 'string' && record.photographer !== ''
      ? record.photographer
      : null,
    date: null,
    description: null,
    thumb: src.medium || preview,
    preview,
    full,
    width: numberOrNull(record.width),
    height: numberOrNull(record.height),
    license: LICENSE,
    licenseUrl: LICENSE_URL,
    pageUrl: record.url || null,
  };
}

export function parseSearch(json) {
  const photos = Array.isArray(json?.photos) ? json.photos : [];
  const items = photos.map((entry) => normalize(entry)).filter((item) => item !== null);

  const rawTotal = Number(json?.total_results);
  const total = Number.isFinite(rawTotal) ? rawTotal : null;
  const hasMore = Boolean(json?.next_page);

  return { total, hasMore, items };
}

export async function search(q, page, deps = {}) {
  const key = currentKey();
  if (!key) throw needsKeyError();

  const doFetch = deps.fetchJson ?? fetchJson;
  let json;
  try {
    json = await doFetch(buildSearchUrl(q, page), {
      headers: { Authorization: key },
    });
  } catch (err) {
    if (err?.status === 429) throw rateLimitError();
    throw err;
  }

  return parseSearch(json, page);
}
