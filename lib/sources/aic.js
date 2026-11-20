import { fetchJson } from '../http.js';
import { cleanText } from '../util.js';

export const id = 'aic';
export const name = 'Art Institute of Chicago';
export const homepage = 'https://www.artic.edu/collection';
export const group = 'museums';
export const keyEnv = null;

export const AIC_USER_AGENT = 'OpenLibraryFetch/0.1 (local research tool)';

const SEARCH_URL = 'https://api.artic.edu/api/v1/artworks/search';
const IIIF_URL = 'https://www.artic.edu/iiif/2';
const PAGE_SIZE = 24;
const MAX_FULL_WIDTH = 3000;
const FIELDS =
  'id,title,artist_display,date_display,image_id,thumbnail,is_public_domain';

export function buildSearchUrl(q, page) {
  const currentPage = Math.max(1, Number(page) || 1);
  return (
    `${SEARCH_URL}?q=${encodeURIComponent(q ?? '')}` +
    `&query%5Bterm%5D%5Bis_public_domain%5D=true` +
    `&limit=${PAGE_SIZE}&page=${currentPage}&fields=${FIELDS}`
  );
}

function firstLine(value) {
  if (typeof value !== 'string') return null;
  const line = value.split('\n')[0].trim();
  return line === '' ? null : line;
}

export function normalize(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.is_public_domain !== true) return null;
  if (typeof raw.image_id !== 'string' || raw.image_id === '') return null;

  const base = `${IIIF_URL}/${raw.image_id}`;
  const thumbWidth = raw.thumbnail?.width;
  const thumbHeight = raw.thumbnail?.height;
  const hasSize = typeof thumbWidth === 'number' && typeof thumbHeight === 'number';
  const fullWidth =
    hasSize && thumbWidth < MAX_FULL_WIDTH ? thumbWidth : MAX_FULL_WIDTH;

  return {
    source: id,
    id: String(raw.id),
    title: raw.title || 'Untitled',
    creator: firstLine(raw.artist_display),
    date: raw.date_display || null,
    description: cleanText(raw.thumbnail?.alt_text),
    thumb: `${base}/full/400,/0/default.jpg`,
    preview: `${base}/full/843,/0/default.jpg`,
    full: `${base}/full/${fullWidth},/0/default.jpg`,
    width: hasSize ? fullWidth : null,
    height: hasSize ? Math.round((thumbHeight * fullWidth) / thumbWidth) : null,
    license: 'CC0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    pageUrl: `https://www.artic.edu/artworks/${raw.id}`,
    directDownload: true,
    note: 'Opens the image from artic.edu; save it from there.',
  };
}

export function parseSearch(json, page) {
  const pagination = json?.pagination ?? {};
  const total = typeof pagination.total === 'number' ? pagination.total : null;
  const hasMore =
    typeof pagination.current_page === 'number' && typeof pagination.total_pages === 'number'
      ? pagination.current_page < pagination.total_pages
      : false;

  const rawItems = Array.isArray(json?.data) ? json.data : [];
  const items = rawItems.map((record) => normalize(record)).filter((item) => item !== null);

  return { total, hasMore, items };
}

export async function search(q, page, deps = {}) {
  const doFetch = deps.fetchJson ?? fetchJson;
  const currentPage = Math.max(1, Number(page) || 1);
  const json = await doFetch(buildSearchUrl(q, currentPage), {
    headers: { 'AIC-User-Agent': AIC_USER_AGENT },
  });
  return parseSearch(json, currentPage);
}
