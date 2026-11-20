import { fetchJson } from '../../lib/http.js';
import { cleanText, firstString } from '../../lib/util.js';

export const id = 'digitalnz';
export const keyEnv = 'DIGITALNZ_KEY';

export const NOTE_THUMB =
  'DigitalNZ gives a thumbnail only for this item. Open the partner page for the full image.';

const SEARCH_URL = 'https://api.digitalnz.org/v3/records.json';
const RECORD_URL = 'https://api.digitalnz.org/v3/records';
const PAGE_SIZE = 24;
const FIELDS =
  'id,title,large_thumbnail_url,thumbnail_url,object_url,landing_url,rights_url,rights,usage,content_partner,creator,date';

const KURA_HOST = 'kura.aucklandlibraries.govt.nz';
const INATURALIST_HOST = 'inaturalist-open-data.s3.amazonaws.com';

function stringValue(value) {
  return typeof value === 'string' && value !== '' ? value : null;
}

function isHtmlObjectUrl(url) {
  try {
    return new URL(url).pathname.includes('/content-aggregator/getIEs');
  } catch {
    return false;
  }
}

function kuraInfo(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.host !== KURA_HOST) return null;
    const match = parsed.pathname.match(/^\/digital\/api\/singleitem\/image\/([^/]+)\/([^/]+)\//);
    if (!match) return null;
    return `https://${KURA_HOST}/digital/iiif/${match[1]}/${match[2]}`;
  } catch {
    return null;
  }
}

function inaturalistOriginal(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.host !== INATURALIST_HOST) return null;
    const match = parsed.pathname.match(/^\/photos\/(\d+)\/[^/]+\.([A-Za-z0-9]+)$/);
    if (!match) return null;
    return `https://${INATURALIST_HOST}/photos/${match[1]}/original.${match[2]}`;
  } catch {
    return null;
  }
}

function rightsUrls(record) {
  const raw = record?.rights_url;
  if (Array.isArray(raw)) {
    return raw.filter((entry) => typeof entry === 'string' && entry !== '');
  }
  const single = stringValue(raw);
  return single ? [single] : [];
}

function ccLabel(url) {
  if (!/creativecommons\.org\//i.test(url)) return null;
  if (/publicdomain\/zero/i.test(url)) return 'CC0';
  if (/publicdomain\/mark/i.test(url)) return 'Public domain';
  const match = url.match(/licenses\/([a-z-]+)\/([0-9.]+)/i);
  if (match) return `CC ${match[1].toUpperCase()} ${match[2]}`;
  return null;
}

function licenseInfo(record) {
  const urls = rightsUrls(record);
  const first = urls[0] ?? null;
  const fromUrl = first ? ccLabel(first) : null;
  if (fromUrl) return { license: fromUrl, licenseUrl: first };

  const rightsText = cleanText(record?.rights) ?? '';
  if (/no known copyright restrictions/i.test(rightsText)) {
    return { license: 'No known copyright restrictions', licenseUrl: first };
  }

  return { license: 'Free to reuse (commercial use OK)', licenseUrl: first };
}

function imageUrls(record) {
  const objectUrl = stringValue(record?.object_url);
  const usableObject = objectUrl && !isHtmlObjectUrl(objectUrl) ? objectUrl : null;
  const largeThumb = stringValue(record?.large_thumbnail_url);
  const thumbnail = stringValue(record?.thumbnail_url);

  if (!usableObject && !largeThumb && !thumbnail) return null;

  const oldThumb = thumbnail || largeThumb || usableObject;
  const base = usableObject || largeThumb || thumbnail;

  let thumb = oldThumb;
  let thumbFallback;
  const thumbKura = kuraInfo(oldThumb);
  if (thumbKura) {
    const next = `${thumbKura}/full/400,/0/default.jpg`;
    if (next !== oldThumb) thumbFallback = oldThumb;
    thumb = next;
  }

  let preview = base;
  let previewFallback;
  let full = base;

  const baseKura = kuraInfo(base);
  const baseInaturalist = inaturalistOriginal(base);

  if (baseKura) {
    preview = `${baseKura}/full/1600,/0/default.jpg`;
    previewFallback = base;
    full = `${baseKura}/full/max/0/default.jpg`;
  } else if (baseInaturalist) {
    preview = baseInaturalist;
    previewFallback = base;
    full = baseInaturalist;
  }

  const note = usableObject || thumbKura || baseKura || baseInaturalist ? null : NOTE_THUMB;

  return { thumb, thumbFallback, preview, previewFallback, full, note };
}

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
  const images = imageUrls(record);
  if (!images) return null;

  const recordId = String(record.id ?? '');
  const license = licenseInfo(record);

  return {
    source: id,
    id: recordId,
    title: cleanText(record.title) ?? 'Untitled',
    creator: cleanText(firstString(record.creator)),
    date: dateOf(record),
    description: null,
    thumb: images.thumb,
    thumbFallback: images.thumbFallback,
    preview: images.preview,
    previewFallback: images.previewFallback,
    full: images.full,
    width: null,
    height: null,
    license: license.license,
    licenseUrl: license.licenseUrl,
    pageUrl: record.landing_url || `https://digitalnz.org/records/${recordId}`,
    provider: cleanText(firstString(record.content_partner)),
    note: images.note,
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
  const images = imageUrls(record);
  if (!images || typeof images.full !== 'string' || images.full === '') {
    throw new Error('DigitalNZ record has no image URL');
  }

  return { url: images.full, filename: record.title || null };
}
