import { fetchJson } from '../http.js';
import { mapLimit, cleanText, cacheSet } from '../util.js';

export const id = 'rijksmuseum';
export const name = 'Rijksmuseum';
export const group = 'museums';
export const homepage = 'https://www.rijksmuseum.nl';
export const keyEnv = null;

const PAGE_SIZE = 12;
const LIST_TTL_MS = 10 * 60 * 1000;
const SEARCH_URL = 'https://data.rijksmuseum.nl/search/collection';
const PUBLIC_DOMAIN = {
  license: 'Public domain',
  licenseUrl: 'https://creativecommons.org/publicdomain/mark/1.0/',
};
const IN_COPYRIGHT = {
  license: 'In copyright',
  licenseUrl: 'https://rightsstatements.org/vocab/InC/1.0/',
};
const ENGLISH = 'http://vocab.getty.edu/aat/300388277';
const DESCRIPTION_TYPE = 'http://vocab.getty.edu/aat/300435452';
const HEADERS = { headers: { Accept: 'application/ld+json' } };

const listCache = new Map();
const itemCache = new Map();

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
}

function isEnglish(entry) {
  return asArray(entry?.language).some((language) => language?.id === ENGLISH);
}

function notationValues(entry) {
  return asArray(entry?.notation)
    .map((notation) => (typeof notation === 'string' ? notation : notation?.['@value']))
    .filter((value) => typeof value === 'string' && value !== '');
}

function englishNotation(entry) {
  const notations = asArray(entry?.notation);
  const english = notations.find((notation) => notation?.['@language'] === 'en');
  const value = english?.['@value'] ?? notations[0]?.['@value'];
  return typeof value === 'string' && value !== '' ? value : null;
}

function objectNumber(object) {
  const identifiers = asArray(object?.identified_by).filter(
    (entry) => entry?.type === 'Identifier',
  );
  const withObjectNumber = identifiers.find((entry) =>
    asArray(entry?.classified_as).some((classification) =>
      notationValues(classification).includes('object number'),
    ),
  );
  const entry = withObjectNumber ?? identifiers[0];
  return typeof entry?.content === 'string' && entry.content !== '' ? entry.content : null;
}

function titleOf(object) {
  const names = asArray(object?.identified_by).filter((entry) => entry?.type === 'Name');
  const english = names.find((entry) => isEnglish(entry) && entry.content);
  const entry = english ?? names.find((candidate) => candidate?.content);
  return entry?.content || 'Untitled';
}

function creatorOf(object) {
  const produced = object?.produced_by;
  if (!produced) return null;
  const people = [];
  for (const part of asArray(produced.part)) {
    people.push(...asArray(part?.carried_out_by));
  }
  people.push(...asArray(produced.carried_out_by));
  const person = people.find((candidate) => candidate);
  if (!person) return null;
  if (typeof person._label === 'string' && person._label !== '') return person._label;
  return englishNotation(person);
}

function dateOf(object) {
  const names = asArray(object?.produced_by?.timespan?.identified_by);
  if (names.length === 0) return null;
  const english = names.find((entry) => isEnglish(entry) && entry.content);
  const entry = english ?? names[0];
  return typeof entry?.content === 'string' && entry.content !== '' ? entry.content : null;
}

function descriptionOf(object) {
  const entries = asArray(object?.referred_to_by).filter((entry) =>
    asArray(entry?.classified_as).some((classification) => classification?.id === DESCRIPTION_TYPE),
  );
  if (entries.length === 0) return null;
  const english = entries.find((entry) => isEnglish(entry) && entry.content);
  const entry = english ?? entries[0];
  return cleanText(entry?.content);
}

function lastSegment(url) {
  if (typeof url !== 'string') return '';
  const clean = url.replace(/[?#].*$/, '').replace(/\/+$/, '');
  return clean.slice(clean.lastIndexOf('/') + 1);
}

function hasRightsStatement(value, needle) {
  if (typeof value === 'string') return value.toLowerCase().includes(needle);
  if (Array.isArray(value)) return value.some((entry) => hasRightsStatement(entry, needle));
  if (value && typeof value === 'object') {
    return Object.values(value).some((entry) => hasRightsStatement(entry, needle));
  }
  return false;
}

function licenseOf(object, digitalObject) {
  const contents = asArray(digitalObject?.referred_to_by)
    .map((entry) => entry?.content)
    .filter((content) => typeof content === 'string')
    .map((content) => content.toLowerCase().trim());

  // "niet downloadbaar" contains "downloadbaar"; check it first.
  if (contents.includes('niet downloadbaar')) return IN_COPYRIGHT;
  if (
    hasRightsStatement(digitalObject, 'rightsstatements.org/vocab/inc/') ||
    hasRightsStatement(object, 'rightsstatements.org/vocab/inc/')
  ) {
    return IN_COPYRIGHT;
  }
  return PUBLIC_DOMAIN;
}

export function normalize({ object, visualItem, digitalObject } = {}) {
  if (!object) return null;

  const accessPoint = asArray(digitalObject?.access_point)[0]?.id;
  if (typeof accessPoint !== 'string' || !accessPoint.includes('/full/')) return null;
  const base = accessPoint.split('/full/')[0];

  const licence = licenseOf(object, digitalObject);
  const objectNumberValue = objectNumber(object);
  const pageUrl = objectNumberValue
    ? `https://www.rijksmuseum.nl/en/collection/${encodeURIComponent(objectNumberValue)}`
    : object.id;

  return {
    source: id,
    id: lastSegment(object.id),
    title: titleOf(object),
    creator: creatorOf(object),
    date: dateOf(object),
    description: descriptionOf(object),
    thumb: `${base}/full/400,/0/default.jpg`,
    preview: `${base}/full/1600,/0/default.jpg`,
    full: `${base}/full/max/0/default.jpg`,
    width: null,
    height: null,
    license: licence.license,
    licenseUrl: licence.licenseUrl,
    pageUrl,
  };
}

function pageIds(page) {
  return asArray(page?.orderedItems)
    .map((entry) => entry?.id)
    .filter((value) => typeof value === 'string' && value !== '');
}

async function loadList(q, doFetch) {
  const key = String(q ?? '').trim().toLowerCase();
  const cached = listCache.get(key);
  if (cached && Date.now() - cached.time < LIST_TTL_MS) return cached;

  const query = encodeURIComponent(q ?? '');
  let field = 'description';
  let answer = await doFetch(
    `${SEARCH_URL}?description=${query}&imageAvailable=true`,
    HEADERS,
  );

  if (pageIds(answer).length === 0) {
    field = 'title';
    answer = await doFetch(`${SEARCH_URL}?title=${query}&imageAvailable=true`, HEADERS);
  }

  const entry = {
    ids: pageIds(answer),
    nextUrl: answer?.next?.id ?? null,
    total: answer?.partOf?.totalItems ?? null,
    field,
    time: Date.now(),
  };
  listCache.set(key, entry);
  return entry;
}

async function resolveObject(objectUrl, doFetch) {
  if (itemCache.has(objectUrl)) return itemCache.get(objectUrl);

  try {
    const object = await doFetch(objectUrl, HEADERS);
    const visualUrl = asArray(object?.shows)[0]?.id;
    if (!visualUrl) throw new Error('missing visual item');

    const visualItem = await doFetch(visualUrl, HEADERS);
    const digitalUrl = asArray(visualItem?.digitally_shown_by)[0]?.id;
    if (!digitalUrl) throw new Error('missing digital object');

    const digitalObject = await doFetch(digitalUrl, HEADERS);
    const item = normalize({ object, visualItem, digitalObject });
    cacheSet(itemCache, objectUrl, item);
    return item;
  } catch {
    cacheSet(itemCache, objectUrl, null);
    return null;
  }
}

export async function search(q, page, deps = {}) {
  const doFetch = deps.fetchJson ?? fetchJson;
  const currentPage = Math.max(1, Number(page) || 1);
  const list = await loadList(q, doFetch);

  while (list.ids.length < currentPage * PAGE_SIZE && list.nextUrl) {
    const next = await doFetch(list.nextUrl, HEADERS);
    const more = pageIds(next);
    if (more.length === 0) {
      list.nextUrl = null;
      break;
    }
    list.ids.push(...more);
    list.nextUrl = next?.next?.id ?? null;
    if (list.total === null) list.total = next?.partOf?.totalItems ?? null;
  }

  const start = (currentPage - 1) * PAGE_SIZE;
  const needed = list.ids.slice(start, start + PAGE_SIZE);

  const resolved = await mapLimit(needed, 6, (objectUrl) =>
    resolveObject(objectUrl, doFetch),
  );

  return {
    total: list.total,
    hasMore: list.ids.length > currentPage * PAGE_SIZE || Boolean(list.nextUrl),
    items: resolved.filter((item) => item !== null),
  };
}
