import { fetchJson } from '../http.js';
import { cleanText } from '../util.js';

export const id = 'nasa';
export const name = 'NASA Image Library';
export const group = 'science';
export const homepage = 'https://images.nasa.gov';
export const keyEnv = null;

const SEARCH_URL = 'https://images-api.nasa.gov/search';
const IMAGE_EXTENSIONS = /\.(jpe?g|png|gif|tiff?|webp|bmp)(\?.*)?$/i;
const PREVIEW_IMAGE = /\.(jpe?g|png)$/i;
const MAX_PREVIEW_BYTES = 5000000;

function httpsUrl(value) {
  if (typeof value !== 'string' || value === '') return null;
  return value.replace(/^http:\/\//, 'https://');
}

function isImageUrl(value) {
  return (
    typeof value === 'string' &&
    !/\.json(\?.*)?$/i.test(value) &&
    (IMAGE_EXTENSIONS.test(value) || /~(orig|large|medium|small|thumb)\./i.test(value))
  );
}

export function normalize(item) {
  const d = item?.data?.[0];
  if (!d || !d.nasa_id) return null;

  const links = Array.isArray(item.links) ? item.links : [];
  if (links.length === 0) return null;

  const previewLink = links.find((link) => link?.rel === 'preview');
  const thumb = httpsUrl(previewLink?.href);

  const canonical = links.find((link) => link?.rel === 'canonical');

  const largeLink = links.find(
    (link) => typeof link?.href === 'string' && link.href.includes('~large.'),
  );
  const mediumLink = links.find(
    (link) => typeof link?.href === 'string' && link.href.includes('~medium.'),
  );
  const canonicalSize = Number(canonical?.size);
  const canonicalIsSmallImage =
    typeof canonical?.href === 'string' &&
    PREVIEW_IMAGE.test(canonical.href) &&
    Number.isFinite(canonicalSize) &&
    canonicalSize < MAX_PREVIEW_BYTES;

  const previewCandidate =
    largeLink ?? mediumLink ?? (canonicalIsSmallImage ? canonical : previewLink);
  const preview = httpsUrl(previewCandidate?.href);
  const hasOriginal =
    typeof canonical?.href === 'string' && canonical.href.includes('~orig.');
  const full = hasOriginal ? httpsUrl(canonical.href) : null;

  const nasaId = String(d.nasa_id);
  return {
    source: id,
    id: nasaId,
    title: d.title || 'Untitled',
    creator: d.photographer || d.secondary_creator || d.center || null,
    date: typeof d.date_created === 'string' ? d.date_created.slice(0, 10) : null,
    description: cleanText(d.description),
    thumb,
    preview,
    full,
    width: full ? (canonical.width ?? null) : null,
    height: full ? (canonical.height ?? null) : null,
    license: 'Public domain (NASA)',
    licenseUrl: 'https://www.nasa.gov/nasa-brand-center/images-and-media/',
    pageUrl: `https://images.nasa.gov/details/${encodeURIComponent(nasaId)}`,
  };
}

export function parseSearch(json) {
  const collection = json?.collection ?? {};
  const total = collection?.metadata?.total_hits ?? null;
  const hasMore =
    Array.isArray(collection?.links) && collection.links.some((link) => link?.rel === 'next');
  const rawItems = Array.isArray(collection?.items) ? collection.items : [];
  const items = rawItems.map((entry) => normalize(entry)).filter((item) => item !== null);

  return { total, hasMore, items };
}

export async function search(q, page, deps = {}) {
  const doFetch = deps.fetchJson ?? fetchJson;
  const currentPage = Math.max(1, Number(page) || 1);
  const url =
    `${SEARCH_URL}?q=${encodeURIComponent(q ?? '')}` +
    `&media_type=image&page=${currentPage}&page_size=24`;

  const json = await doFetch(url);
  return parseSearch(json);
}

export function pickOriginal(urls) {
  if (!Array.isArray(urls)) return null;
  const images = urls.filter(isImageUrl);
  const chosen =
    images.find((value) => value.includes('~orig.')) ??
    images.find((value) => value.includes('~large.')) ??
    images.find((value) => value.includes('~medium.')) ??
    null;
  return chosen ? httpsUrl(chosen) : null;
}

export async function resolveDownload(nasaId, deps = {}) {
  if (
    typeof nasaId !== 'string' ||
    nasaId === '' ||
    /[/\\?#]/.test(nasaId) ||
    nasaId.includes('..')
  ) {
    const err = new Error('Invalid NASA item id');
    err.status = 400;
    throw err;
  }

  const doFetch = deps.fetchJson ?? fetchJson;
  const url = `https://images-assets.nasa.gov/image/${encodeURIComponent(nasaId)}/collection.json`;
  const json = await doFetch(url);
  const found = pickOriginal(json);
  if (!found) throw new Error('No image file for this NASA item');
  return { url: found, filename: null };
}
