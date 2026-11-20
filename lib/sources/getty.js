import { fetchJson } from '../http.js';
import { mapLimit, cacheSet } from '../util.js';

export const id = 'getty';
export const name = 'Getty Museum';
export const homepage = 'https://www.getty.edu/art/collection/';
export const group = 'museums';
export const keyEnv = null;

export const SPARQL_URL = 'https://data.getty.edu/museum/collection/sparql';

const PAGE_SIZE = 24;
const LIMIT = 25;
const MAX_WORDS = 8;
const SPARQL_ACCEPT = 'application/sparql-results+json';
const OBJECT_ACCEPT = 'application/ld+json';

const itemCache = new Map();
const runningRequests = new Map();

export function clearCache() {
  itemCache.clear();
}

export function sparqlString(text) {
  return String(text ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

function queryWords(q) {
  return String(q ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== '')
    .slice(0, MAX_WORDS);
}

export function buildQuery(q, page) {
  const currentPage = Math.max(1, Number(page) || 1);
  const offset = (currentPage - 1) * PAGE_SIZE;
  const words = queryWords(q);

  const filter =
    words.length === 0
      ? ''
      : `\n  FILTER(${words
          .map((word) => `CONTAINS(LCASE(?t), "${sparqlString(word)}")`)
          .join(' && ')})`;

  return (
    `PREFIX crm: <http://www.cidoc-crm.org/cidoc-crm/>\n` +
    `SELECT ?o (MIN(?t) AS ?title) WHERE {\n` +
    `  ?o a crm:E22_Human-Made_Object ;\n` +
    `     crm:P1_is_identified_by ?n ;\n` +
    `     crm:P138i_has_representation ?img .\n` +
    `  ?n a crm:E33_E41_Linguistic_Appellation ;\n` +
    `     crm:P190_has_symbolic_content ?t .` +
    filter +
    `\n} GROUP BY ?o ORDER BY ?title LIMIT ${LIMIT} OFFSET ${offset}`
  );
}

export function buildSearchUrl(q, page) {
  return `${SPARQL_URL}?query=${encodeURIComponent(buildQuery(q, page))}`;
}

function lastSegment(url) {
  if (typeof url !== 'string') return '';
  const clean = url.replace(/[?#].*$/, '').replace(/\/+$/, '');
  return clean.slice(clean.lastIndexOf('/') + 1);
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
}

export function parseBindings(json) {
  const bindings = asArray(json?.results?.bindings);
  const result = [];
  for (const binding of bindings) {
    const objectUrl = binding?.o?.value;
    if (typeof objectUrl !== 'string' || objectUrl === '') continue;
    const uuid = lastSegment(objectUrl);
    if (uuid === '') continue;
    const title = typeof binding?.title?.value === 'string' ? binding.title.value : null;
    result.push({ uuid, objectUrl, title });
  }
  return result;
}

function identifierValue(object, label) {
  const entry = asArray(object?.identified_by).find(
    (candidate) => candidate?._label === label && typeof candidate.content === 'string',
  );
  return entry?.content ?? null;
}

function titleOf(object) {
  const preferred = identifierValue(object, 'Preferred Title');
  if (preferred !== null && preferred !== '') return preferred;

  const label = typeof object?._label === 'string' ? object._label : '';
  const withoutAccession = label.replace(/\s*\([^()]*\)\s*$/, '').trim();
  if (withoutAccession !== '') return withoutAccession;

  return 'Untitled';
}

function creatorOf(object) {
  const produced = object?.produced_by;
  const person = asArray(produced?.carried_out_by).find(
    (entry) => typeof entry?._label === 'string' && entry._label !== '',
  );
  if (person) return person._label;

  const description = asArray(produced?.referred_to_by).find(
    (entry) => entry?._label === 'Artist/Maker (Producer) Description',
  );
  const content = description?.content;
  return typeof content === 'string' && content !== '' ? content : null;
}

function dateOf(object) {
  const entry = asArray(object?.produced_by?.timespan?.identified_by).find(
    (candidate) => typeof candidate?.content === 'string' && candidate.content !== '',
  );
  return entry?.content ?? null;
}

function pageUrlOf(object) {
  const webPage = asArray(object?.subject_of).find((entry) =>
    asArray(entry?.classified_as).some(
      (classification) => classification?._label === 'Web Page',
    ),
  );
  if (typeof webPage?.id === 'string' && webPage.id !== '') return webPage.id;
  return typeof object?.id === 'string' && object.id !== '' ? object.id : null;
}

const FULL_SUFFIXES = ['/full/full/0/default.jpg', '/full/max/0/default.jpg'];

function iiifBase(imageId) {
  for (const suffix of FULL_SUFFIXES) {
    if (imageId.endsWith(suffix)) return imageId.slice(0, -suffix.length);
  }
  return null;
}

export function normalize(object) {
  const image = asArray(object?.representation)[0];
  const imageId = image?.id;
  if (typeof imageId !== 'string' || imageId === '') return null;

  const base = iiifBase(imageId);
  const thumb = base === null ? imageId : `${base}/full/400,/0/default.jpg`;
  const preview = base === null ? imageId : `${base}/full/1600,/0/default.jpg`;
  const full = base === null ? imageId : `${base}/full/max/0/default.jpg`;

  return {
    source: id,
    id: lastSegment(object?.id),
    title: titleOf(object),
    creator: creatorOf(object),
    date: dateOf(object),
    description: null,
    thumb,
    preview,
    full,
    width: null,
    height: null,
    license: 'Getty Open Content (free to use)',
    licenseUrl: 'https://www.getty.edu/projects/open-content-program/',
    pageUrl: pageUrlOf(object),
  };
}

async function resolveObject(binding, doFetch) {
  if (itemCache.has(binding.uuid)) return itemCache.get(binding.uuid);
  if (runningRequests.has(binding.uuid)) return runningRequests.get(binding.uuid);

  const request = (async () => {
    let object;
    try {
      object = await doFetch(binding.objectUrl, {
        timeoutMs: 20000,
        headers: { Accept: OBJECT_ACCEPT },
      });
    } catch {
      // Do not cache a temporary failure; try again on the next search.
      return null;
    }

    const item = normalize(object);
    cacheSet(itemCache, binding.uuid, item);
    return item;
  })();

  runningRequests.set(binding.uuid, request);
  try {
    return await request;
  } finally {
    runningRequests.delete(binding.uuid);
  }
}

export async function search(q, page, deps = {}) {
  const words = queryWords(q);
  if (words.length === 0) {
    return { total: null, hasMore: false, items: [] };
  }

  const doFetch = deps.fetchJson ?? fetchJson;
  const json = await doFetch(buildSearchUrl(q, page), {
    timeoutMs: 30000,
    headers: { Accept: SPARQL_ACCEPT },
  });

  const bindings = parseBindings(json);
  const hasMore = bindings.length >= LIMIT;
  const used = bindings.slice(0, PAGE_SIZE);

  const items = await mapLimit(used, 6, (binding) => resolveObject(binding, doFetch));

  return {
    total: null,
    hasMore,
    items: items.filter((item) => item !== null),
  };
}
