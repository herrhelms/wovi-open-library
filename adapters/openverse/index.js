import { fetchJson } from '../../lib/http.js';

export const id = 'openverse';

const SEARCH_URL = 'https://api.openverse.org/v1/images/';
const ITEM_URL = 'https://api.openverse.org/v1/images';
const PAGE_SIZE = 20;
const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function buildSearchUrl(q, page) {
  const currentPage = Math.max(1, Number(page) || 1);
  return (
    `${SEARCH_URL}?q=${encodeURIComponent(q ?? '')}` +
    `&license=cc0,pdm,by,by-sa` +
    `&page_size=${PAGE_SIZE}&page=${currentPage}`
  );
}

const LICENSE_LABELS = {
  cc0: 'CC0',
  pdm: 'Public domain',
  by: 'CC BY',
  'by-sa': 'CC BY-SA',
};

const VERSIONLESS_LICENSES = new Set(['cc0', 'pdm']);

export function licenseLabel(license, version) {
  if (typeof license !== 'string' || license === '') return 'See item page';
  const code = license.toLowerCase();
  const base = LICENSE_LABELS[code] ?? `CC ${code.toUpperCase()}`;
  const suffix = typeof version === 'string' ? version.trim() : '';
  if (VERSIONLESS_LICENSES.has(code) || suffix === '') return base;
  return `${base} ${suffix}`;
}

export function normalize(result) {
  const record = result ?? {};
  if (typeof record.url !== 'string' || record.url === '') return null;

  const url = record.url;
  return {
    source: id,
    id: String(record.id ?? ''),
    title: record.title || 'Untitled',
    creator: record.creator || null,
    date: null,
    description: null,
    thumb: record.thumbnail || url,
    preview: url,
    full: url,
    width: Number.isFinite(record.width) ? record.width : null,
    height: Number.isFinite(record.height) ? record.height : null,
    license: licenseLabel(record.license, record.license_version),
    licenseUrl: record.license_url || null,
    pageUrl: record.foreign_landing_url,
    provider: record.provider || null,
  };
}

export function parseSearch(json, page) {
  const rawItems = Array.isArray(json?.results) ? json.results : [];
  const items = rawItems.map((entry) => normalize(entry)).filter((item) => item !== null);
  const total = Number.isFinite(json?.result_count) ? json.result_count : null;
  const pageCount = Number.isFinite(json?.page_count) ? json.page_count : null;
  const currentPage = Math.max(1, Number(page) || 1);
  const hasMore = pageCount === null ? false : currentPage < pageCount;

  return { total, hasMore, items };
}

function asRateLimitError(err) {
  if (err?.status === 429) {
    const rateErr = new Error('Openverse rate limit reached. Try again in a few minutes.');
    rateErr.code = 'RATE_LIMIT';
    return rateErr;
  }
  return err;
}

export async function search(q, page, deps = {}) {
  const doFetch = deps.fetchJson ?? fetchJson;
  try {
    const json = await doFetch(buildSearchUrl(q, page));
    return parseSearch(json, page);
  } catch (err) {
    throw asRateLimitError(err);
  }
}

export async function resolveDownload(itemId, deps = {}) {
  if (typeof itemId !== 'string' || !UUID_PATTERN.test(itemId)) {
    const err = new Error('Invalid Openverse item id');
    err.status = 400;
    throw err;
  }

  const doFetch = deps.fetchJson ?? fetchJson;
  let json;
  try {
    json = await doFetch(`${ITEM_URL}/${itemId}/`);
  } catch (err) {
    throw asRateLimitError(err);
  }

  if (typeof json?.url !== 'string' || json.url === '') {
    throw new Error('Openverse item has no image URL');
  }

  return { url: json.url, filename: json.title || null };
}
