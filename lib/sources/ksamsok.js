import { fetchJson } from '../http.js';
import { cleanText } from '../util.js';

export const id = 'ksamsok';
export const name = 'Swedish heritage (K-samsök)';
export const homepage = 'https://www.raa.se/hitta-information/k-samsok/';
export const group = 'aggregators';
export const keyEnv = null;
export const trustResolvedUrl = true;

const API_URL = 'https://kulturarvsdata.se/ksamsok/api';
const RECORD_URL = 'https://kulturarvsdata.se';
const PAGE_SIZE = 24;
const ITEM_ID_PATTERN = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_.-]+)+$/;
const UNKNOWN_CREATORS = new Set(['Okänd', 'Uppgift om fotograf saknas']);
const ENTITY_PREFIXES = ['http://kulturarvsdata.se/', 'https://kulturarvsdata.se/'];

export function localName(key) {
  const text = String(key ?? '');
  if (text.startsWith('@')) return text;
  const index = text.lastIndexOf(':');
  return index === -1 ? text : text.slice(index + 1);
}

export function textValue(value, lang = 'en') {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value === '' ? null : value;
  if (Array.isArray(value)) {
    const entries = value.filter((entry) => entry !== null && entry !== undefined);
    const localized = entries.find(
      (entry) => entry && typeof entry === 'object' && entry['@language'] === lang,
    );
    if (localized !== undefined) {
      const found = textValue(localized, lang);
      if (found !== null) return found;
    }
    for (const entry of entries) {
      const found = textValue(entry, lang);
      if (found !== null) return found;
    }
    return null;
  }
  if (typeof value === 'object') {
    if (value['@value'] !== undefined) return textValue(value['@value'], lang);
    if (value['@id'] !== undefined) return textValue(value['@id'], lang);
  }
  return null;
}

const LICENSES = {
  pdmark: {
    label: 'Public domain',
    url: 'https://creativecommons.org/publicdomain/mark/1.0/',
  },
  cc0: {
    label: 'CC0',
    url: 'https://creativecommons.org/publicdomain/zero/1.0/',
  },
  by: {
    label: 'CC BY',
    url: 'https://creativecommons.org/licenses/by/4.0/',
  },
  'by-sa': {
    label: 'CC BY-SA',
    url: 'https://creativecommons.org/licenses/by-sa/4.0/',
  },
};

function licenseVersion(licenseUrl, code) {
  if (typeof licenseUrl !== 'string' || licenseUrl === '') return null;
  const pattern = new RegExp(`/licenses/${code}/([0-9.]+)`, 'i');
  const match = licenseUrl.match(pattern);
  return match ? match[1] : null;
}

export function licenseOf(uri, licenseUrl = null) {
  const value = typeof uri === 'string' ? uri : textValue(uri);
  if (typeof value !== 'string' || value === '') return null;
  const hash = value.lastIndexOf('#');
  if (hash === -1) return null;
  const code = value.slice(hash + 1).trim().toLowerCase();
  const license = LICENSES[code];
  if (!license) return null;

  if (code === 'by' || code === 'by-sa') {
    const version = licenseVersion(licenseUrl, code);
    return { label: version ? `${license.label} ${version}` : license.label, url: license.url };
  }
  return { label: license.label, url: license.url };
}

function field(node, local) {
  if (!node || typeof node !== 'object') return undefined;
  let found;
  for (const [key, value] of Object.entries(node)) {
    if (localName(key) === local) found = value;
  }
  return found;
}

function nodeType(node) {
  const type = node?.['@type'];
  const value = Array.isArray(type) ? type[0] : type;
  return typeof value === 'string' ? localName(value) : '';
}

function httpsUrl(value) {
  if (typeof value !== 'string' || value === '') return null;
  return value.replace(/^http:\/\//i, 'https://');
}

function withDimension(url, dimension) {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set('dimension', dimension);
    return parsed.toString();
  } catch {
    return url;
  }
}

function isDimu(url) {
  try {
    return new URL(url).host === 'ems.dimu.org';
  } catch {
    return false;
  }
}

function recordNodes(record) {
  const graph = record?.['@graph'];
  return Array.isArray(graph) ? graph.filter((node) => node && typeof node === 'object') : [];
}

function entityId(entity) {
  const raw = textValue(field(entity, '@id'));
  if (typeof raw !== 'string' || raw === '') return null;
  for (const prefix of ENTITY_PREFIXES) {
    if (raw.startsWith(prefix)) return raw.slice(prefix.length);
  }
  return raw;
}

function pageUrlOf(entity) {
  const url = httpsUrl(textValue(field(entity, 'url')));
  if (url !== null) return url;
  const raw = textValue(field(entity, '@id'));
  return httpsUrl(raw);
}

function imageIsUsable(image) {
  const license = licenseOf(field(image, 'mediaLicense'));
  if (license === null) return false;
  return (
    textValue(field(image, 'highresSource')) !== null ||
    textValue(field(image, 'lowresSource')) !== null ||
    textValue(field(image, 'thumbnailSource')) !== null
  );
}

export function normalize(record) {
  const nodes = recordNodes(record);
  const entity = nodes.find((node) => nodeType(node) === 'Entity');
  const image = nodes.find((node) => nodeType(node) === 'Image' && imageIsUsable(node));
  if (!entity || !image) return null;

  const mediaLicenseUrl = httpsUrl(textValue(field(image, 'mediaLicenseUrl')));

  const license = licenseOf(field(image, 'mediaLicense'), mediaLicenseUrl);
  if (license === null) return null;

  const itemId = entityId(entity);
  if (itemId === null || itemId === '') return null;

  const itemName = nodes.find((node) => nodeType(node) === 'ItemName');

  const title =
    cleanText(textValue(field(entity, 'itemLabel'))) ??
    cleanText(textValue(field(itemName, 'name'))) ??
    cleanText(textValue(field(entity, 'name'))) ??
    cleanText(textValue(field(entity, 'itemTitle'))) ??
    'Untitled';

  const itemTitle = cleanText(textValue(field(entity, 'itemTitle')));
  const description = itemTitle !== null && itemTitle !== title ? itemTitle.slice(0, 600) : null;

  const byline = cleanText(textValue(field(image, 'byline')));
  const creator = byline !== null && !UNKNOWN_CREATORS.has(byline) ? byline : null;

  const thumbnail = httpsUrl(textValue(field(image, 'thumbnailSource')));
  const lowres = httpsUrl(textValue(field(image, 'lowresSource')));
  const highres = httpsUrl(textValue(field(image, 'highresSource')));

  const previewSource = highres ?? lowres;
  let thumb = thumbnail ?? lowres ?? highres;
  let thumbFallback;
  let preview = previewSource;
  let full = previewSource;

  if (previewSource !== null && isDimu(previewSource)) {
    const oldThumb = thumb;
    thumb = withDimension(previewSource, '400x400');
    preview = withDimension(previewSource, '1600x1600');
    full = withDimension(previewSource, 'max');
    if (oldThumb !== null && oldThumb !== thumb) thumbFallback = oldThumb;
  }

  return {
    source: id,
    id: itemId,
    title,
    creator,
    date: null,
    description,
    thumb,
    thumbFallback,
    preview,
    full,
    width: null,
    height: null,
    license: license.label,
    licenseUrl: mediaLicenseUrl ?? license.url,
    pageUrl: pageUrlOf(entity),
    provider: cleanText(textValue(field(entity, 'serviceOrganizationFull'))),
  };
}

export function buildSearchUrl(q, page) {
  const currentPage = Math.max(1, Number(page) || 1);
  const params = new URLSearchParams({
    method: 'search',
    query:
      `text=${q ?? ''} and thumbnailExists=j and (` +
      'mediaLicense="http://kulturarvsdata.se/resurser/License#pdmark" or ' +
      'mediaLicense="http://kulturarvsdata.se/resurser/License#cc0" or ' +
      'mediaLicense="http://kulturarvsdata.se/resurser/License#by" or ' +
      'mediaLicense="http://kulturarvsdata.se/resurser/License#by-sa")',
    hitsPerPage: String(PAGE_SIZE),
    startRecord: String((currentPage - 1) * PAGE_SIZE + 1),
  });
  return `${API_URL}?${params.toString()}`;
}

export function parseSearch(json, page) {
  const result = json?.result ?? {};
  const records = Array.isArray(result.records) ? result.records : [];
  const total = Number.isFinite(result.totalHits) ? result.totalHits : null;
  const currentPage = Math.max(1, Number(page) || 1);
  const start = (currentPage - 1) * PAGE_SIZE;

  return {
    total,
    hasMore: total === null ? false : start + records.length < total,
    items: records
      .map((entry) => normalize(entry?.record))
      .filter((item) => item !== null),
  };
}

export async function search(q, page, deps = {}) {
  const doFetch = deps.fetchJson ?? fetchJson;
  const json = await doFetch(buildSearchUrl(q, page), {
    headers: { Accept: 'application/json' },
  });
  return parseSearch(json, page);
}

export async function resolveDownload(itemId, deps = {}) {
  if (typeof itemId !== 'string' || !ITEM_ID_PATTERN.test(itemId)) {
    const err = new Error('Invalid K-samsök item id');
    err.status = 400;
    throw err;
  }

  const doFetch = deps.fetchJson ?? fetchJson;
  const json = await doFetch(`${RECORD_URL}/${itemId}`, {
    headers: { Accept: 'application/json' },
  });
  const item = normalize(json);
  if (!item || !item.full) {
    throw new Error('K-samsök record has no open image');
  }

  return { url: item.full, filename: item.title };
}
