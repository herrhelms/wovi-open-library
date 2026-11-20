import { fetchJson } from '../http.js';
import { mapLimit, cleanText, cacheSet } from '../util.js';

export const id = 'princeton';
export const name = 'Princeton University Art Museum';
export const homepage = 'https://artmuseum.princeton.edu';
export const group = 'museums';
export const keyEnv = null;

const PAGE_SIZE = 24;
const CONCURRENCY = 6;
const SEARCH_URL = 'https://data.artmuseum.princeton.edu/search';
const OBJECT_URL = 'https://data.artmuseum.princeton.edu/objects';

const objectCache = new Map();
const running = new Map();

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
}

function isBlank(value) {
  return value === null || value === undefined || value === '';
}

function primaryMedia(object) {
  const media = asArray(object?.media).filter(
    (entry) => entry !== null && typeof entry === 'object',
  );
  if (media.length === 0) return null;
  const primary = media.find(
    (entry) => entry.isprimary === 1 || entry.isprimary === '1' || entry.isprimary === true,
  );
  return primary ?? media[0];
}

function iiifBase(object) {
  const media = primaryMedia(object);
  if (media && typeof media.uri === 'string' && media.uri !== '') return media.uri;
  const image = asArray(object?.primaryimage).find(
    (entry) => typeof entry === 'string' && entry !== '',
  );
  return image ?? null;
}

export function isOpen(object) {
  if (!object || typeof object !== 'object') return false;
  if (!isBlank(object.restrictions)) return false;

  const media = primaryMedia(object);
  if (!media || !isBlank(media.restrictions)) return false;

  const nowebuse = object.nowebuse;
  if (nowebuse === true || nowebuse === 'True' || nowebuse === 'true') return false;

  if (
    typeof object.creditlinerepro === 'string' &&
    object.creditlinerepro.includes('©')
  ) {
    return false;
  }

  return true;
}

function creatorOf(object) {
  if (typeof object?.displaymaker !== 'string' || object.displaymaker === '') return null;
  const name = object.displaymaker.split(/[,;]/)[0].trim();
  return name === '' ? null : name;
}

export function normalize(object) {
  if (!isOpen(object)) return null;

  const base = iiifBase(object);
  if (!base) return null;

  return {
    source: id,
    id: String(object.objectid ?? ''),
    title: object.displaytitle || 'Untitled',
    creator: creatorOf(object),
    date: object.displaydate || null,
    description: cleanText(object.medium),
    thumb: `${base}/full/400,/0/default.jpg`,
    preview: `${base}/full/1600,/0/default.jpg`,
    full: `${base}/full/max/0/default.jpg`,
    width: null,
    height: null,
    license: 'Open access',
    licenseUrl: null,
    pageUrl: `https://artmuseum.princeton.edu/collections/objects/${object.objectid}`,
  };
}

function hitsOf(json) {
  const hits = json?.hits;
  const list = Array.isArray(hits?.hits) ? hits.hits : [];
  return list;
}

function totalOf(json) {
  const total = json?.hits?.total;
  if (typeof total === 'number' && Number.isFinite(total)) return total;
  if (total && typeof total === 'object' && Number.isFinite(total.value)) return total.value;
  return null;
}

export function parseSearch(json, page) {
  const hits = hitsOf(json);
  const sources = hits.map((hit) => hit?._source ?? {});
  const items = sources.map((source) => normalize(source)).filter((item) => item !== null);
  const total = totalOf(json);
  const currentPage = Math.max(1, Number(page) || 1);
  const hasMore = total === null ? false : (currentPage - 1) * PAGE_SIZE + hits.length < total;

  return { total, hasMore, items };
}

export function clearCache() {
  objectCache.clear();
  running.clear();
}

async function resolveObject(objectId, doFetch) {
  const key = String(objectId);
  if (objectCache.has(key)) return objectCache.get(key);
  if (running.has(key)) return running.get(key);

  const job = (async () => {
    try {
      const raw = await doFetch(`${OBJECT_URL}/${encodeURIComponent(key)}`);
      const item = normalize(raw);
      cacheSet(objectCache, key, item);
      return item;
    } catch {
      return undefined;
    } finally {
      running.delete(key);
    }
  })();

  running.set(key, job);
  return job;
}

export function buildSearchUrl(q, page) {
  const currentPage = Math.max(1, Number(page) || 1);
  const offset = (currentPage - 1) * PAGE_SIZE;
  return (
    `${SEARCH_URL}?q=${encodeURIComponent(q ?? '')}` +
    `&type=artobjects&size=${PAGE_SIZE}&from=${offset}`
  );
}

export async function search(q, page, deps = {}) {
  const doFetch = deps.fetchJson ?? fetchJson;
  const currentPage = Math.max(1, Number(page) || 1);
  const json = await doFetch(buildSearchUrl(q, currentPage));
  const hits = hitsOf(json);
  const total = totalOf(json);

  const resolved = await mapLimit(hits, CONCURRENCY, (hit) => {
    const objectId = hit?._source?.objectid ?? hit?._id;
    if (objectId === null || objectId === undefined || objectId === '') return null;
    return resolveObject(objectId, doFetch);
  });

  const items = resolved.filter((item) => item !== null && item !== undefined);
  const hasMore = total === null ? false : (currentPage - 1) * PAGE_SIZE + hits.length < total;

  return { total, hasMore, items };
}
