import { fetchJson } from '../http.js';
import { cleanText, firstString } from '../util.js';

export const id = 'rumsey';
export const name = 'David Rumsey Map Collection';
export const homepage = 'https://www.davidrumsey.com';
export const group = 'libraries';
export const keyEnv = null;

export const LICENSE = 'CC BY-NC-SA 3.0 (non-commercial)';
export const NOTE =
  'Non-commercial license (CC BY-NC-SA 3.0). Commercial use needs permission from the collection.';

const SEARCH_URL = 'https://www.davidrumsey.com/luna/servlet/as/search';
const IIIF_BASE = 'https://www.davidrumsey.com/luna/servlet/iiif';
const DETAIL_BASE = 'https://www.davidrumsey.com/luna/servlet/detail';
const LICENSE_URL = 'https://creativecommons.org/licenses/by-nc-sa/3.0/';

const PAGE_SIZE = 24;
export const SEARCH_TIMEOUT_MS = 40000;
const INFO_TIMEOUT_MS = 20000;
const ITEM_ID_PATTERN = /^RUMSEY~8~1~[0-9]+~[0-9]+$/;

export function buildSearchUrl(q, page) {
  const currentPage = Math.max(1, Number(page) || 1);
  const params = new URLSearchParams({
    q: q ?? '',
    lc: 'RUMSEY~8~1',
    bs: String(PAGE_SIZE),
    os: String((currentPage - 1) * PAGE_SIZE),
  });
  return `${SEARCH_URL}?${params.toString()}`;
}

export function serviceUrl(itemId) {
  return `${IIIF_BASE}/${itemId}`;
}

function field(result, fieldName) {
  const values = Array.isArray(result?.fieldValues) ? result.fieldValues : [];
  for (const entry of values) {
    if (entry && typeof entry === 'object' && Object.hasOwn(entry, fieldName)) {
      return firstString(entry[fieldName]);
    }
  }
  return null;
}

export function normalize(result) {
  const record = result ?? {};
  const itemId = typeof record.id === 'string' ? record.id : '';
  if (itemId === '') return null;
  if (record.mediaType !== undefined && record.mediaType !== null && record.mediaType !== 'Image') {
    return null;
  }

  const service = serviceUrl(itemId);
  const title = record.displayName || field(record, 'Short Title') || 'Untitled';
  const fullTitle = field(record, 'Full Title');
  const note = field(record, 'Note');
  const descriptionText = fullTitle && fullTitle !== title ? fullTitle : note;

  return {
    source: id,
    id: itemId,
    title,
    creator: field(record, 'Author'),
    date: field(record, 'Date'),
    description: cleanText(descriptionText),
    thumb: record.urlSize2 || `${service}/full/400,/0/default.jpg`,
    preview: `${service}/full/2400,/0/default.jpg`,
    previewFallback: `${service}/full/1600,/0/default.jpg`,
    full: null,
    width: null,
    height: null,
    license: LICENSE,
    licenseUrl: LICENSE_URL,
    pageUrl: `${DETAIL_BASE}/${itemId}`,
    note: NOTE,
  };
}

export function parseSearch(json, page) {
  const rawItems = Array.isArray(json?.results) ? json.results : [];
  const items = rawItems.map((entry) => normalize(entry)).filter((item) => item !== null);
  const parsedTotal = Number(json?.totalResults);
  const total = Number.isFinite(parsedTotal) ? parsedTotal : null;
  const currentPage = Math.max(1, Number(page) || 1);
  const hasMore = total === null ? false : (currentPage - 1) * PAGE_SIZE + rawItems.length < total;

  return { total, hasMore, items };
}

export async function search(q, page, deps = {}) {
  const doFetch = deps.fetchJson ?? fetchJson;
  const json = await doFetch(buildSearchUrl(q, page), { timeoutMs: SEARCH_TIMEOUT_MS });
  return parseSearch(json, page);
}

export async function resolveDownload(itemId, deps = {}) {
  if (typeof itemId !== 'string' || !ITEM_ID_PATTERN.test(itemId)) {
    const err = new Error('Invalid David Rumsey item id');
    err.status = 400;
    throw err;
  }

  const service = serviceUrl(itemId);
  const doFetch = deps.fetchJson ?? fetchJson;
  const info = await doFetch(`${service}/info.json`, { timeoutMs: INFO_TIMEOUT_MS });
  const width = Number(info?.width);

  if (Number.isFinite(width) && width > 0) {
    return { url: `${service}/full/${width},/0/default.jpg`, filename: itemId };
  }
  // Never use full/full: Luna caps it at 1536 px.
  return { url: `${service}/full/max/0/default.jpg`, filename: itemId };
}
