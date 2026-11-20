import { fetchJson, HttpError } from '../http.js';
import { cleanText } from '../util.js';

export const id = 'smithsonian';
export const name = 'Smithsonian Open Access';
export const group = 'museums';
export const homepage = 'https://www.si.edu/openaccess';
export const keyEnv = 'SMITHSONIAN_KEY';
export const keyOptional = true;

const API_URL = 'https://api.si.edu/openaccess/api/v1.0/search';
const PAGE_SIZE = 24;
const DEFAULT_KEY = 'DEMO_KEY';

function currentKey() {
  return process.env.SMITHSONIAN_KEY || DEFAULT_KEY;
}

export function buildSearchUrl(q, page, key = DEFAULT_KEY) {
  const params = new URLSearchParams({
    q: `${q} AND media_usage:CC0`,
    rows: String(PAGE_SIZE),
    start: String((page - 1) * PAGE_SIZE),
    api_key: key,
  });
  return `${API_URL}?${params.toString()}`;
}

function sizeVariant(full, size) {
  try {
    const parsed = new URL(full);
    if (parsed.searchParams.has('id')) {
      parsed.searchParams.set('max', String(size));
      return parsed.toString();
    }
    const base = full.replace(/\/+$/, '');
    return `${base}/${size}`;
  } catch {
    return full;
  }
}

function firstContent(list) {
  if (!Array.isArray(list)) return null;
  const entry = list.find((item) => item && typeof item.content === 'string' && item.content !== '');
  return entry ? entry.content : null;
}

export function normalize(raw) {
  const row = raw ?? {};
  const content = row.content ?? {};
  const descriptive = content.descriptiveNonRepeating ?? {};
  const mediaList = descriptive.online_media?.media;
  const media = Array.isArray(mediaList)
    ? mediaList.find((entry) => entry && entry.type === 'Images')
    : null;
  const full = media?.content;
  if (!full) return null;

  const freetext = content.freetext ?? {};
  const width = Number(media.width);
  const height = Number(media.height);

  const recordLink = descriptive.record_link;
  const pageUrl = (typeof recordLink === 'string' && recordLink !== '')
    ? recordLink
    : (typeof row.url === 'string' ? `https://collections.si.edu/search/detail/${row.url}` : null);

  return {
    source: id,
    id: String(row.id ?? ''),
    title: typeof row.title === 'string' && row.title !== '' ? row.title : 'Untitled',
    creator: firstContent(freetext.name),
    date: firstContent(freetext.date),
    description: cleanText(freetext.notes, 600),
    thumb: sizeVariant(full, 400),
    preview: sizeVariant(full, 1600),
    full,
    width: Number.isFinite(width) && width > 0 ? width : null,
    height: Number.isFinite(height) && height > 0 ? height : null,
    license: 'CC0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    pageUrl,
  };
}

export function parseSearch(json, page) {
  const response = json?.response ?? {};
  const rows = Array.isArray(response.rows) ? response.rows : [];
  const total = Number.isFinite(response.rowCount) ? response.rowCount : null;
  const start = (page - 1) * PAGE_SIZE;

  return {
    total,
    hasMore: total === null ? false : start + PAGE_SIZE < total,
    items: rows.map(normalize).filter(Boolean),
  };
}

function wrapError(err) {
  const isDemo = currentKey() === DEFAULT_KEY;

  if (err instanceof HttpError && err.status === 429) {
    const error = new Error(
      'Smithsonian rate limit reached (DEMO_KEY allows about 30 requests per hour). Put a personal key from api.data.gov in .env as SMITHSONIAN_KEY.',
    );
    error.code = 'RATE_LIMIT';
    return error;
  }

  if (err instanceof HttpError && err.status === 403 && isDemo) {
    const error = new Error(
      'Smithsonian refused the DEMO_KEY. Put a personal key from api.data.gov in .env as SMITHSONIAN_KEY.',
    );
    error.code = 'KEY';
    return error;
  }

  return null;
}

export async function search(q, page) {
  try {
    const json = await fetchJson(buildSearchUrl(q, page, currentKey()));
    return parseSearch(json, page);
  } catch (err) {
    const wrapped = wrapError(err);
    if (wrapped) throw wrapped;
    throw err;
  }
}
