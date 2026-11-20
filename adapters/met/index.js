import { fetchJson } from '../../lib/http.js';
import { mapLimit, cacheSet } from '../../lib/util.js';

export const id = 'met';

const PAGE_SIZE = 24;
const SEARCH_URL = 'https://collectionapi.metmuseum.org/public/collection/v1.1/search';
const OBJECT_URL = 'https://collectionapi.metmuseum.org/public/collection/v1/objects';

const objectCache = new Map();

export function normalize(obj) {
  if (!obj || obj.isPublicDomain !== true) return null;
  if (typeof obj.primaryImage !== 'string' || obj.primaryImage === '') return null;

  return {
    source: id,
    id: String(obj.objectID),
    title: obj.title || 'Untitled',
    creator: obj.artistDisplayName || null,
    date: obj.objectDate || null,
    description: null,
    thumb: obj.primaryImageSmall || obj.primaryImage,
    preview: obj.primaryImage,
    full: obj.primaryImage,
    width: null,
    height: null,
    license: 'CC0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    pageUrl: obj.objectURL,
  };
}

async function resolveObject(objectId, doFetch) {
  const key = String(objectId);
  if (objectCache.has(key)) return objectCache.get(key);

  try {
    const raw = await doFetch(`${OBJECT_URL}/${encodeURIComponent(key)}`);
    const item = normalize(raw);
    cacheSet(objectCache, key, item);
    return item;
  } catch {
    cacheSet(objectCache, key, null);
    return null;
  }
}

export async function search(q, page, deps = {}) {
  const doFetch = deps.fetchJson ?? fetchJson;
  const currentPage = Math.max(1, Number(page) || 1);
  const offset = (currentPage - 1) * PAGE_SIZE;
  const url =
    `${SEARCH_URL}?q=${encodeURIComponent(q ?? '')}` +
    `&hasImages=true&isPublicDomain=true&offset=${offset}&limit=${PAGE_SIZE}`;

  const answer = await doFetch(url);
  const objectIds = Array.isArray(answer?.objectIDs) ? answer.objectIDs : [];
  const total = typeof answer?.total === 'number' ? answer.total : null;

  const resolved = await mapLimit(objectIds, 8, (objectId) =>
    resolveObject(objectId, doFetch),
  );

  return {
    total,
    hasMore: total !== null && currentPage * PAGE_SIZE < total,
    items: resolved.filter((item) => item !== null),
  };
}
