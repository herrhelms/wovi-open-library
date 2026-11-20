import { fetchJson } from '../http.js';
import { cleanText, firstString } from '../util.js';
import { licenseLabel } from './europeana.js';

export const id = 'archive';
export const name = 'Internet Archive';
export const group = 'aggregators';
export const homepage = 'https://archive.org';
export const keyEnv = null;

const API_URL = 'https://archive.org/advancedsearch.php';
const PAGE_SIZE = 24;

export function buildSearchUrl(q, page) {
  const params = new URLSearchParams();
  params.set('q', `(${q}) AND mediatype:image`);
  params.append('fl[]', 'identifier');
  params.append('fl[]', 'title');
  params.append('fl[]', 'creator');
  params.append('fl[]', 'date');
  params.append('fl[]', 'description');
  params.append('fl[]', 'licenseurl');
  params.set('rows', String(PAGE_SIZE));
  params.set('page', String(page));
  params.set('output', 'json');
  return `${API_URL}?${params.toString()}`;
}

function shortDate(value) {
  const text = firstString(value);
  if (!text) return null;
  return text.slice(0, 10);
}

export function normalize(raw) {
  const doc = raw ?? {};
  const identifier = firstString(doc.identifier);
  if (!identifier) return null;

  const licenseUrl = firstString(doc.licenseurl);

  return {
    source: id,
    id: identifier,
    title: firstString(doc.title) || 'Untitled',
    creator: firstString(doc.creator),
    date: shortDate(doc.date),
    description: cleanText(doc.description, 600),
    thumb: `https://archive.org/services/img/${identifier}`,
    preview: `https://archive.org/services/img/${identifier}`,
    full: null,
    width: null,
    height: null,
    license: licenseUrl ? licenseLabel(licenseUrl) : 'See item page',
    licenseUrl: licenseUrl || null,
    pageUrl: `https://archive.org/details/${identifier}`,
  };
}

export function parseSearch(json, page) {
  const response = json?.response ?? {};
  const docs = Array.isArray(response.docs) ? response.docs : [];
  const total = Number.isFinite(response.numFound) ? response.numFound : null;

  return {
    total,
    hasMore: total === null ? false : page * PAGE_SIZE < total,
    items: docs.map(normalize).filter(Boolean),
  };
}

export async function search(q, page) {
  const json = await fetchJson(buildSearchUrl(q, page));
  return parseSearch(json, page);
}

const ORIGINAL_FORMATS = new Set(['JPEG', 'PNG', 'TIFF', 'JPEG 2000']);
const ORIGINAL_EXTENSIONS = /\.(jpe?g|png|tiff?|jp2)$/i;

export function pickOriginal(metadataJson) {
  const files = metadataJson?.files;
  if (!Array.isArray(files)) return null;

  const candidates = files.filter((file) => {
    if (!file || file.source !== 'original') return false;
    const format = typeof file.format === 'string' ? file.format.toUpperCase() : '';
    const name = typeof file.name === 'string' ? file.name : '';
    return ORIGINAL_FORMATS.has(format) || ORIGINAL_EXTENSIONS.test(name);
  });

  let best = null;
  let bestSize = -1;
  for (const file of candidates) {
    const size = Number(file.size);
    const value = Number.isFinite(size) ? size : 0;
    if (value > bestSize) {
      best = file;
      bestSize = value;
    }
  }
  return best;
}

function encodePath(name) {
  return String(name)
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

export async function resolveDownload(identifier) {
  if (typeof identifier !== 'string' || !/^[A-Za-z0-9._-]+$/.test(identifier)) {
    const err = new Error('Invalid Internet Archive identifier');
    err.status = 400;
    throw err;
  }

  const json = await fetchJson(`https://archive.org/metadata/${encodeURIComponent(identifier)}`);
  const file = pickOriginal(json);
  if (!file) throw new Error('No original image file in this Internet Archive item');

  const title = firstString(json?.metadata?.title);

  return {
    url: `https://archive.org/download/${identifier}/${encodePath(file.name)}`,
    filename: title || null,
  };
}
