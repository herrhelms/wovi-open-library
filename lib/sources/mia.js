import { fetchJson } from '../http.js';
import { cleanText } from '../util.js';

export const id = 'mia';
export const name = 'Minneapolis Institute of Art';
export const group = 'museums';
export const homepage = 'https://collections.artsmia.org';
export const keyEnv = null;

const PAGE_SIZE = 24;
const SEARCH_URL = 'https://search.artsmia.org/';
const QUERY_SUFFIX = ' public_access:1 image:valid rights_type:"Public Domain"';

function toDimension(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function normalize(record) {
  if (!record || typeof record !== 'object') return null;
  if (record.rights_type !== 'Public Domain') return null;
  if (record.id === null || record.id === undefined || record.id === '') return null;

  const itemId = String(record.id);

  return {
    source: id,
    id: itemId,
    title: record.title || 'Untitled',
    creator: record.artist || null,
    date: record.dated || null,
    description: cleanText(record.description),
    thumb: `https://1.api.artsmia.org/400/${itemId}.jpg`,
    preview: `https://1.api.artsmia.org/800/${itemId}.jpg`,
    full: `https://1.api.artsmia.org/full/${itemId}.jpg`,
    width: toDimension(record.image_width),
    height: toDimension(record.image_height),
    license: 'Public domain',
    licenseUrl: 'https://creativecommons.org/publicdomain/mark/1.0/',
    pageUrl: `https://collections.artsmia.org/art/${itemId}`,
  };
}

function readTotal(json) {
  const total = json?.hits?.total;
  if (typeof total === 'number') return total;
  if (typeof total?.value === 'number') return total.value;
  return null;
}

export function parseSearch(json, page = 1) {
  const total = readTotal(json);
  const rawHits = Array.isArray(json?.hits?.hits) ? json.hits.hits : [];
  const items = rawHits
    .map((hit) => normalize(hit?._source))
    .filter((item) => item !== null);
  const currentPage = Math.max(1, Number(page) || 1);
  const from = (currentPage - 1) * PAGE_SIZE;
  const hasMore = total !== null && from + rawHits.length < total;

  return { total, hasMore, items };
}

export async function search(q, page, deps = {}) {
  const doFetch = deps.fetchJson ?? fetchJson;
  const currentPage = Math.max(1, Number(page) || 1);
  const from = (currentPage - 1) * PAGE_SIZE;
  const query = encodeURIComponent(`${q ?? ''}${QUERY_SUFFIX}`);
  const url = `${SEARCH_URL}${query}?size=${PAGE_SIZE}&from=${from}`;

  const json = await doFetch(url);
  return parseSearch(json, currentPage);
}
