import { fetchJson } from '../http.js';
import { cleanText, firstString } from '../util.js';

export const id = 'digitalnz';
export const name = 'DigitalNZ';
export const homepage = 'https://digitalnz.org';
export const group = 'aggregators';
export const keyEnv = 'DIGITALNZ_KEY';
export const keyOptional = true;
export const trustResolvedUrl = true;

export const NOTE_THUMB =
  'DigitalNZ gives a thumbnail only for this item. Open the partner page for the full image.';

const SEARCH_URL = 'https://api.digitalnz.org/v3/records.json';
const RECORD_URL = 'https://api.digitalnz.org/v3/records';
const PAGE_SIZE = 24;
const FIELDS =
  'id,title,large_thumbnail_url,thumbnail_url,object_url,landing_url,rights_url,usage,content_partner,creator,date';

function key() {
  const value = process.env[keyEnv];
  return typeof value === 'string' && value !== '' ? value : null;
}

function headers() {
  const token = key();
  return token ? { 'Authentication-Token': token } : {};
}

function needsKeyError() {
  const err = new Error('DigitalNZ needs DIGITALNZ_KEY in .env');
  err.code = 'NEEDS_KEY';
  return err;
}

function asKeyError(err) {
  if (err?.status === 401 || err?.status === 403) return needsKeyError();
  return err;
}

export function buildSearchUrl(q, page) {
  const currentPage = Math.max(1, Number(page) || 1);
  const params = new URLSearchParams();
  params.set('text', q ?? '');
  params.append('and[category][]', 'Images');
  params.append('and[usage][]', 'Use commercially');
  params.set('per_page', String(PAGE_SIZE));
  params.set('page', String(currentPage));
  params.set('fields', FIELDS);
  return `${SEARCH_URL}?${params.toString()}`;
}

function dateOf(record) {
  const value = firstString(record?.date);
  if (value === null) return null;
  return value.slice(0, 10);
}

export function normalize(raw) {
  const record = raw ?? {};
  const objectUrl = typeof record.object_url === 'string' ? record.object_url : null;
  const largeThumb =
    typeof record.large_thumbnail_url === 'string' ? record.large_thumbnail_url : null;
  const thumbnail = typeof record.thumbnail_url === 'string' ? record.thumbnail_url : null;

  if (!objectUrl && !largeThumb && !thumbnail) return null;

  const thumb = thumbnail || largeThumb || objectUrl;
  const full = objectUrl || largeThumb || thumbnail;
  const recordId = String(record.id ?? '');

  return {
    source: id,
    id: recordId,
    title: cleanText(record.title) ?? 'Untitled',
    creator: cleanText(firstString(record.creator)),
    date: dateOf(record),
    description: null,
    thumb,
    preview: full,
    full,
    width: null,
    height: null,
    license: 'Free to reuse (commercial use OK)',
    licenseUrl: firstString(record.rights_url),
    pageUrl: record.landing_url || `https://digitalnz.org/records/${recordId}`,
    provider: cleanText(firstString(record.content_partner)),
    note: objectUrl ? null : NOTE_THUMB,
  };
}

export function parseSearch(json, page) {
  const search = json?.search ?? {};
  const rawItems = Array.isArray(search.results) ? search.results : [];
  const items = rawItems.map((entry) => normalize(entry)).filter((item) => item !== null);
  const total = Number.isFinite(search.result_count) ? search.result_count : null;
  const currentPage = Math.max(1, Number(page) || 1);
  const hasMore = total === null ? false : currentPage * PAGE_SIZE < total;

  return { total, hasMore, items };
}

export async function search(q, page, deps = {}) {
  const doFetch = deps.fetchJson ?? fetchJson;
  try {
    const json = await doFetch(buildSearchUrl(q, page), { headers: headers() });
    return parseSearch(json, page);
  } catch (err) {
    throw asKeyError(err);
  }
}

export async function resolveDownload(itemId, deps = {}) {
  if (typeof itemId !== 'string' || !/^[0-9]+$/.test(itemId)) {
    const err = new Error('Invalid DigitalNZ item id');
    err.status = 400;
    throw err;
  }

  const doFetch = deps.fetchJson ?? fetchJson;
  const url = `${RECORD_URL}/${itemId}.json?fields=id,title,object_url,large_thumbnail_url,thumbnail_url`;
  let json;
  try {
    json = await doFetch(url, { headers: headers() });
  } catch (err) {
    throw asKeyError(err);
  }

  const record = json?.record ?? {};
  const imageUrl = record.object_url || record.large_thumbnail_url || record.thumbnail_url;
  if (typeof imageUrl !== 'string' || imageUrl === '') {
    throw new Error('DigitalNZ record has no image URL');
  }

  return { url: imageUrl, filename: record.title || null };
}
