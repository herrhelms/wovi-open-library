import { fetchJson } from '../http.js';
import { cleanText } from '../util.js';

export const id = 'europeana';
export const name = 'Europeana';
export const homepage = 'https://www.europeana.eu';
export const keyEnv = 'EUROPEANA_KEY';
export const trustResolvedUrl = true;

const API_URL = 'https://api.europeana.eu/record/v2/search.json';
const RECORD_URL = 'https://api.europeana.eu/record/v2';
const PAGE_SIZE = 24;
const DEFAULT_KEY = 'api2demo';

function currentKey() {
  return process.env.EUROPEANA_KEY || DEFAULT_KEY;
}

export function buildSearchUrl(q, page, key = DEFAULT_KEY) {
  const params = new URLSearchParams({
    wskey: key,
    query: q,
    qf: 'TYPE:IMAGE',
    reusability: 'open',
    media: 'true',
    thumbnail: 'true',
    rows: String(PAGE_SIZE),
    start: String((page - 1) * PAGE_SIZE + 1),
    profile: 'rich',
  });
  return `${API_URL}?${params.toString()}`;
}

export function licenseLabel(url) {
  if (typeof url !== 'string' || url === '') return 'See item page';

  if (url.includes('publicdomain/zero')) return 'CC0';
  if (url.includes('publicdomain/mark')) return 'Public domain';

  const cc = url.match(/\/licenses\/(by(?:-(?:sa|nd|nc|nc-sa|nc-nd))?)\/([0-9.]+)/i);
  if (cc) {
    return `CC ${cc[1].toUpperCase()} ${cc[2]}`;
  }

  const rights = url.match(/rightsstatements\.org\/vocab\/(NoC-[A-Za-z0-9-]+)/);
  if (rights) {
    return `No copyright (${rights[1]})`;
  }

  return 'See item page';
}

function withoutTracking(url) {
  if (typeof url !== 'string' || url === '') return '';
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete('utm_source');
    parsed.searchParams.delete('utm_medium');
    parsed.searchParams.delete('utm_campaign');
    let result = parsed.toString();
    if (result.endsWith('?')) result = result.slice(0, -1);
    return result;
  } catch {
    return url;
  }
}

export function normalize(raw) {
  const item = raw ?? {};
  const full = item.edmIsShownBy?.[0];
  if (!full) return null;

  const rights = item.rights?.[0] ?? null;
  const creators = Array.isArray(item.dcCreator) ? item.dcCreator : [];
  const creator = creators.find((value) => typeof value === 'string' && !value.startsWith('http')) ?? null;

  return {
    source: id,
    id: String(item.id ?? '').replace(/^\//, ''),
    title: item.title?.[0] || 'Untitled',
    creator,
    date: item.year?.[0] || null,
    description: cleanText(item.dcDescription, 600),
    thumb: item.edmPreview?.[0] || full,
    preview: full,
    full,
    width: null,
    height: null,
    license: licenseLabel(rights),
    licenseUrl: rights,
    pageUrl: withoutTracking(item.guid),
  };
}

export function parseSearch(json, page) {
  const items = Array.isArray(json?.items)
    ? json.items.map(normalize).filter(Boolean)
    : [];
  const total = Number.isFinite(json?.totalResults) ? json.totalResults : null;
  const start = (page - 1) * PAGE_SIZE + 1;
  const hasMore = total === null ? false : start + PAGE_SIZE - 1 < total;

  return { total, hasMore, items };
}

export async function search(q, page) {
  const json = await fetchJson(buildSearchUrl(q, page, currentKey()));
  return parseSearch(json, page);
}

export async function resolveDownload(itemId) {
  if (typeof itemId !== 'string' || !/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(itemId)) {
    const err = new Error('Invalid Europeana item id');
    err.status = 400;
    throw err;
  }

  const url = `${RECORD_URL}/${itemId}.json?wskey=${encodeURIComponent(currentKey())}`;
  const json = await fetchJson(url);

  const aggregation = json?.object?.aggregations?.[0];
  const shownBy = aggregation?.edmIsShownBy;
  const imageUrl = Array.isArray(shownBy) ? shownBy[0] : shownBy;
  if (!imageUrl) throw new Error('Europeana record has no image file');

  let title = null;
  for (const proxy of json?.object?.proxies ?? []) {
    const value = proxy?.dcTitle;
    if (Array.isArray(value)) {
      const found = value.find((entry) => typeof entry === 'string' && entry !== '');
      if (found) {
        title = found;
        break;
      }
    } else if (typeof value === 'string' && value !== '') {
      title = value;
      break;
    }
  }

  return { url: imageUrl, filename: title };
}
