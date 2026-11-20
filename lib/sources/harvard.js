import { fetchJson } from '../http.js';
import { cleanText } from '../util.js';

export const id = 'harvard';
export const name = 'Harvard Art Museums';
export const homepage = 'https://harvardartmuseums.org';
export const group = 'museums';
export const keyEnv = 'HARVARD_KEY';
export const openLicenses = false;

const SEARCH_URL = 'https://api.harvardartmuseums.org/object';
const PAGE_SIZE = 24;
const LICENSE = 'See Harvard Art Museums image terms';
const LICENSE_URL = 'https://harvardartmuseums.org/collections/about';

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
    apikey: key,
    q: q ?? '',
    hasimage: '1',
    size: String(PAGE_SIZE),
    page: String(currentPage),
  });
  return `${SEARCH_URL}?${params.toString()}`;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function iiifUrls(base) {
  const root = base.replace(/\/+$/, '');
  return {
    thumb: `${root}/full/400,/0/default.jpg`,
    preview: `${root}/full/1600,/0/default.jpg`,
    full: `${root}/full/full/0/default.jpg`,
  };
}

export function normalize(raw) {
  const record = raw ?? {};
  if (record.imagepermissionlevel !== 0) return null;

  const image = Array.isArray(record.images) && record.images[0] ? record.images[0] : null;
  const imagePermission = image?.imagepermissionlevel;
  const iiif =
    image &&
    typeof image.iiifbaseuri === 'string' &&
    image.iiifbaseuri !== '' &&
    (imagePermission === 0 || imagePermission === null || imagePermission === undefined)
      ? image.iiifbaseuri
      : null;

  let urls;
  let width = null;
  let height = null;

  if (iiif) {
    urls = iiifUrls(iiif);
    width = numberOrNull(image.width);
    height = numberOrNull(image.height);
  } else if (typeof record.primaryimageurl === 'string' && record.primaryimageurl !== '') {
    urls = {
      thumb: record.primaryimageurl,
      preview: record.primaryimageurl,
      full: record.primaryimageurl,
    };
  } else {
    return null;
  }

  const itemId = String(record.objectid ?? record.id ?? '');
  const person = Array.isArray(record.people) ? record.people[0] : null;

  return {
    source: id,
    id: itemId,
    title: cleanText(record.title, 200) || 'Untitled',
    creator: typeof person?.name === 'string' && person.name !== '' ? person.name : null,
    date: typeof record.dated === 'string' && record.dated !== '' ? record.dated : null,
    description: null,
    thumb: urls.thumb,
    preview: urls.preview,
    full: urls.full,
    width,
    height,
    license: LICENSE,
    licenseUrl: LICENSE_URL,
    pageUrl:
      typeof record.url === 'string' && record.url !== ''
        ? record.url
        : `https://harvardartmuseums.org/collections/object/${itemId}`,
  };
}

export function parseSearch(json) {
  const info = json?.info ?? {};
  const records = Array.isArray(json?.records) ? json.records : [];
  const items = records.map((entry) => normalize(entry)).filter((item) => item !== null);

  const rawTotal = Number(info.totalrecords);
  const total = Number.isFinite(rawTotal) ? rawTotal : null;

  const pageNumber = numberOrNull(info.page);
  const pages = numberOrNull(info.pages);
  const hasMore =
    pageNumber === null || pages === null ? false : pageNumber < pages;

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
