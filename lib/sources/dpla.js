import { fetchJson } from '../http.js';
import { cleanText, firstString } from '../util.js';

export const id = 'dpla';
export const name = 'DPLA';
export const homepage = 'https://dp.la';
export const group = 'aggregators';
export const keyEnv = 'DPLA_KEY';
export const trustResolvedUrl = true;

const SEARCH_URL = 'https://api.dp.la/v2/items';
const ITEM_URL = 'https://api.dp.la/v2/items';
const PAGE_SIZE = 24;
const NOTE = 'DPLA gives a thumbnail only. Open the partner page for the full image.';

const RIGHTS_STATEMENTS = {
  'NoC-US': 'No Copyright - United States',
  'NoC-NC': 'No Copyright - Non-Commercial Use Only',
  'NoC-OKLR': 'No Copyright - Other Known Legal Restrictions',
  NKC: 'No Known Copyright',
  'InC-EDU': 'In Copyright - Educational Use Permitted',
  InC: 'In Copyright',
  CNE: 'Copyright Not Evaluated',
  UND: 'Copyright Undetermined',
};

function currentKey() {
  return process.env.DPLA_KEY || '';
}

function needsKeyError() {
  const err = new Error(`${name} needs ${keyEnv} in .env`);
  err.code = 'NEEDS_KEY';
  return err;
}

export function rightsLabel(rights) {
  if (typeof rights !== 'string' || rights === '') return 'See partner page';

  const url = rights.replace(/^https?:\/\//i, '').replace(/^www\./i, '');

  const statement = url.match(/^rightsstatements\.org\/vocab\/([^/?#]+)/i);
  if (statement) {
    const code = statement[1];
    return RIGHTS_STATEMENTS[code] ?? `Rights statement: ${code}`;
  }

  if (/^creativecommons\.org\/publicdomain\/zero\//i.test(url)) return 'CC0';
  if (/^creativecommons\.org\/publicdomain\/mark\//i.test(url)) return 'Public domain';

  const cc = url.match(/^creativecommons\.org\/licenses\/([^/?#]+)\/([^/?#]+)/i);
  if (cc) return `CC ${cc[1].toUpperCase()} ${cc[2]}`;

  return 'See partner page';
}

function rightsUrl(rights) {
  if (typeof rights !== 'string') return null;
  return /^https?:\/\//i.test(rights) ? rights : null;
}

function objectUrl(value) {
  const first = firstString(value);
  return first && first !== '' ? first : null;
}

function providerName(value) {
  if (typeof value === 'string' && value !== '') return value;
  if (value && typeof value === 'object') {
    const nested = firstString(value.name);
    if (nested) return nested;
  }
  return null;
}

function dateValue(value) {
  if (Array.isArray(value)) return dateValue(value[0]);
  if (!value || typeof value !== 'object') return null;
  return firstString(value.displayDate);
}

export function normalize(doc) {
  const record = doc ?? {};
  const object = objectUrl(record.object);
  if (!object) return null;

  const source = record.sourceResource ?? {};
  const itemId = String(record.id ?? '');
  const rights = typeof record.rights === 'string' ? record.rights : null;

  return {
    source: id,
    id: itemId,
    title: firstString(source.title) || 'Untitled',
    creator: firstString(source.creator),
    date: dateValue(source.date),
    description: cleanText(source.description, 600),
    thumb: object,
    preview: object,
    full: object,
    width: null,
    height: null,
    license: rightsLabel(rights),
    licenseUrl: rightsUrl(rights),
    pageUrl: firstString(record.isShownAt) || `https://dp.la/item/${itemId}`,
    provider: providerName(record.dataProvider) ?? providerName(record.provider),
    note: NOTE,
  };
}

export function parseSearch(json, page) {
  const docs = Array.isArray(json?.docs) ? json.docs : [];
  const items = docs.map((entry) => normalize(entry)).filter((item) => item !== null);

  const count = json?.count;
  const total = typeof count === 'number' && Number.isFinite(count) ? count : null;
  const startValue = json?.start;
  const start =
    typeof startValue === 'number' && Number.isFinite(startValue)
      ? startValue
      : (Math.max(1, Number(page) || 1) - 1) * PAGE_SIZE;
  const hasMore = total === null ? false : start + docs.length < total;

  return { total, hasMore, items };
}

export function buildSearchUrl(key, q, page) {
  const currentPage = Math.max(1, Number(page) || 1);
  const params = new URLSearchParams({
    q: q ?? '',
    api_key: key,
    'sourceResource.type': 'image',
    page_size: String(PAGE_SIZE),
    page: String(currentPage),
  });
  return `${SEARCH_URL}?${params.toString()}`;
}

export async function search(q, page, deps = {}) {
  const key = currentKey();
  if (!key) throw needsKeyError();

  const doFetch = deps.fetchJson ?? fetchJson;
  const json = await doFetch(buildSearchUrl(key, q, page));
  return parseSearch(json, page);
}

export async function resolveDownload(itemId, deps = {}) {
  if (typeof itemId !== 'string' || !/^[A-Za-z0-9]+$/.test(itemId)) {
    const err = new Error('Invalid DPLA item id');
    err.status = 400;
    throw err;
  }

  const key = currentKey();
  if (!key) throw needsKeyError();

  const doFetch = deps.fetchJson ?? fetchJson;
  const json = await doFetch(`${ITEM_URL}/${itemId}?api_key=${encodeURIComponent(key)}`);

  const doc = Array.isArray(json?.docs) ? json.docs[0] : null;
  const url = objectUrl(doc?.object);
  if (!url) throw new Error('DPLA item has no image URL');

  const title = firstString(doc?.sourceResource?.title);
  return { url, filename: title || null };
}
