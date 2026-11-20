import { fetchJson } from '../../lib/http.js';
import { cleanText } from '../../lib/util.js';

export const id = 'nb-norway';

const SEARCH_URL = 'https://api.nb.no/catalog/v1/items';
const PAGE_SIZE = 24;
const LICENSE_URL = 'https://creativecommons.org/publicdomain/mark/1.0/';

export function buildSearchUrl(q, page) {
  const currentPage = Math.max(1, Number(page) || 1);
  const params = new URLSearchParams();
  params.append('q', q ?? '');
  params.append('filter', 'mediatype:bilder');
  params.append('filter', 'contentClasses:public');
  params.append('size', String(PAGE_SIZE));
  params.append('page', String(currentPage - 1));
  return `${SEARCH_URL}?${params.toString()}`;
}

function imageBase(item) {
  const href = item?._links?.thumbnail_custom?.href;
  if (typeof href === 'string' && href.includes('/full/')) {
    return href.split('/full/')[0];
  }

  const urn = item?.metadata?.identifiers?.urn;
  if (typeof urn === 'string' && urn !== '') {
    return `https://www.nb.no/services/image/resolver/${urn}`;
  }

  return null;
}

export function normalize(raw) {
  const item = raw ?? {};
  const access = item.accessInfo ?? {};
  if (access.isPublicDomain !== true) return null;
  if (access.accessAllowedFrom !== 'EVERYWHERE') return null;

  const base = imageBase(item);
  if (base === null) return null;

  const urn = item.metadata?.identifiers?.urn;
  const hasUrn = typeof urn === 'string' && urn !== '';
  const itemId = item.id === null || item.id === undefined ? '' : String(item.id);
  if (itemId === '' && !hasUrn) return null;

  const creators = Array.isArray(item.metadata?.creators)
    ? item.metadata.creators.filter((entry) => typeof entry === 'string' && entry.trim() !== '')
    : [];
  const dateValue = item.metadata?.dateCreated;

  return {
    source: id,
    id: itemId,
    title: cleanText(item.metadata?.title) ?? 'Untitled',
    creator: creators.length > 0 ? creators.join(', ') : null,
    date: typeof dateValue === 'string' && dateValue !== '' ? dateValue : null,
    description: null,
    thumb: `${base}/full/400,/0/native.jpg`,
    preview: `${base}/full/1600,/0/native.jpg`,
    full: `${base}/full/full/0/native.jpg`,
    width: null,
    height: null,
    license: 'Public domain',
    licenseUrl: LICENSE_URL,
    pageUrl: hasUrn
      ? `https://www.nb.no/items/${urn}`
      : `https://www.nb.no/items/${itemId}`,
    provider: null,
  };
}

export function parseSearch(json, page) {
  const pageInfo = json?.page ?? {};
  const rawItems = Array.isArray(json?._embedded?.items) ? json._embedded.items : [];
  const items = rawItems.map((entry) => normalize(entry)).filter((item) => item !== null);

  const total = Number.isFinite(pageInfo.totalElements) ? pageInfo.totalElements : null;
  const number = Number.isFinite(pageInfo.number)
    ? pageInfo.number
    : Math.max(1, Number(page) || 1) - 1;
  const totalPages = Number.isFinite(pageInfo.totalPages) ? pageInfo.totalPages : null;
  const hasMore = totalPages === null ? false : number + 1 < totalPages;

  return { total, hasMore, items };
}

export async function search(q, page, deps = {}) {
  const doFetch = deps.fetchJson ?? fetchJson;
  const json = await doFetch(buildSearchUrl(q, page));
  return parseSearch(json, page);
}
