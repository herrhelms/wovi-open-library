import { fetchJson, HttpError } from '../http.js';
import { cleanText } from '../util.js';

export const id = 'loc';
export const name = 'Library of Congress';
export const homepage = 'https://www.loc.gov';
export const keyEnv = null;

const API_URL = 'https://www.loc.gov/photos/';
const PAGE_SIZE = 24;
const BLOCKED_MESSAGE =
  'Library of Congress blocked the request (Cloudflare challenge). Try again later or from another network.';

export function buildSearchUrl(q, page) {
  const params = new URLSearchParams({
    q,
    fo: 'json',
    c: String(PAGE_SIZE),
    sp: String(page),
    at: 'results,pagination',
  });
  return `${API_URL}?${params.toString()}`;
}

export function toBlockedError(err) {
  if (!(err instanceof HttpError) && !(err && typeof err === 'object')) return null;
  const code = err.code;
  const status = err.status;
  const snippet = typeof err.bodySnippet === 'string' ? err.bodySnippet : '';

  const blocked =
    code === 'NOT_JSON' ||
    (code === 'HTTP' && (status === 403 || status === 429 || status === 503)) ||
    snippet.includes('cf-') ||
    snippet.includes('Just a moment') ||
    snippet.toLowerCase().includes('challenge');

  if (!blocked) return null;

  const error = new Error(BLOCKED_MESSAGE);
  error.code = 'BLOCKED';
  return error;
}

export async function search(q, page) {
  try {
    const json = await fetchJson(buildSearchUrl(q, page));
    return parseSearch(json, page);
  } catch (err) {
    const blocked = toBlockedError(err);
    if (blocked) throw blocked;
    throw err;
  }
}

function parseImageUrl(entry) {
  if (typeof entry !== 'string' || entry === '') return null;
  const hashIndex = entry.indexOf('#');
  const base = hashIndex === -1 ? entry : entry.slice(0, hashIndex);
  const fragment = hashIndex === -1 ? '' : entry.slice(hashIndex + 1);
  const params = new URLSearchParams(fragment);
  const height = Number.parseInt(params.get('h') ?? '', 10);
  const width = Number.parseInt(params.get('w') ?? '', 10);
  return {
    url: base,
    width: Number.isFinite(width) ? width : null,
    height: Number.isFinite(height) ? height : null,
  };
}

function idFromRecord(record) {
  const candidates = [record?.id, record?.url];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const parts = candidate.split('/').filter((part) => part !== '');
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return '';
}

export function normalize(raw) {
  const record = raw ?? {};
  const rawImages = Array.isArray(record.image_url) ? record.image_url : [];
  const images = rawImages.map(parseImageUrl).filter(Boolean);
  if (images.length === 0) return null;

  const withWidth = images.filter((image) => image.width !== null);
  let thumb = rawImages.length > 0 ? images[0] : null;

  if (withWidth.length > 0) {
    const underLimit = withWidth
      .filter((image) => image.width <= 400)
      .sort((a, b) => b.width - a.width);
    thumb = underLimit[0] ?? images[0];
  }

  let full = images[0];
  for (const image of images) {
    if ((image.width ?? -1) > (full.width ?? -1)) full = image;
  }

  const pageUrl = typeof record.url === 'string'
    ? record.url.replace(/^http:\/\//, 'https://')
    : null;

  return {
    source: id,
    id: idFromRecord(record),
    title: record.title || 'Untitled',
    creator: Array.isArray(record.contributor) ? record.contributor[0] ?? null : null,
    date: record.date || null,
    description: cleanText(record.description, 600),
    thumb: thumb.url,
    preview: full.url,
    full: full.url,
    width: full.width,
    height: full.height,
    license: 'No known restrictions (see item)',
    licenseUrl: null,
    pageUrl,
  };
}

export function parseSearch(json, page) {
  void page;
  const results = Array.isArray(json?.results) ? json.results : [];
  const pagination = json?.pagination ?? {};

  return {
    total: Number.isFinite(pagination.total) ? pagination.total : null,
    hasMore: Boolean(pagination.next),
    items: results.map(normalize).filter(Boolean),
  };
}
