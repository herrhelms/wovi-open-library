import { fetchJson } from '../http.js';

export const id = 'wellcome';
export const name = 'Wellcome Collection';
export const group = 'science';
export const homepage = 'https://wellcomecollection.org';
export const keyEnv = null;

const SEARCH_URL = 'https://api.wellcomecollection.org/catalogue/v2/images';
const PAGE_SIZE = 24;

export function buildSearchUrl(q, page) {
  const currentPage = Math.max(1, Number(page) || 1);
  return (
    `${SEARCH_URL}?query=${encodeURIComponent(q ?? '')}` +
    `&locations.license=pdm,cc-0,cc-by` +
    `&pageSize=${PAGE_SIZE}&page=${currentPage}`
  );
}

function iiifBase(url) {
  if (typeof url !== 'string' || url === '') return null;
  return url.replace(/\/info\.json$/, '');
}

export function normalize(result) {
  const record = result ?? {};
  const loc = Array.isArray(record.locations) ? record.locations[0] : null;
  const base = iiifBase(loc?.url);
  if (!base) return null;

  const credit = loc.credit;
  const creator =
    typeof credit === 'string' && credit !== '' && credit !== 'Wellcome Collection'
      ? credit
      : null;

  const license = loc.license ?? {};
  const workId = record.source?.id ?? '';
  const imageId = String(record.id ?? '');

  return {
    source: id,
    id: imageId,
    title: record.source?.title || 'Untitled',
    creator,
    date: null,
    description: null,
    thumb: `${base}/full/400,/0/default.jpg`,
    preview: `${base}/full/1600,/0/default.jpg`,
    full: `${base}/full/full/0/default.jpg`,
    width: null,
    height: null,
    license: license.label || 'See item page',
    licenseUrl: license.url || null,
    pageUrl: `https://wellcomecollection.org/works/${workId}/images?id=${imageId}`,
  };
}

export function parseSearch(json, page) {
  const rawItems = Array.isArray(json?.results) ? json.results : [];
  const items = rawItems.map((entry) => normalize(entry)).filter((item) => item !== null);
  const total = Number.isFinite(json?.totalResults) ? json.totalResults : null;
  const hasMore = Boolean(json?.nextPage);

  return { total, hasMore, items };
}

export async function search(q, page, deps = {}) {
  const doFetch = deps.fetchJson ?? fetchJson;
  const json = await doFetch(buildSearchUrl(q, page));
  return parseSearch(json, page);
}
