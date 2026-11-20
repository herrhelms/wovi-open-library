import { fetchJson } from '../http.js';
import { cleanText, firstString } from '../util.js';

export const id = 'digital-commonwealth';
export const name = 'Digital Commonwealth (Massachusetts)';
export const homepage = 'https://www.digitalcommonwealth.org';
export const group = 'libraries';
export const keyEnv = null;

const SEARCH_URL = 'https://www.digitalcommonwealth.org/search.json';
const IIIF_BASE = 'https://iiif.digitalcommonwealth.org/iiif/2';
const PAGE_SIZE = 24;
const ALLOWED_REUSE = 'no restrictions';

export function normalize(entry) {
  const record = entry ?? {};
  const attributes = record.attributes ?? {};

  const imageId = firstString(attributes.exemplary_image_ssi);
  if (!imageId) return null;

  const reuse = attributes.reuse_allowed_ssi;
  if (reuse !== undefined && reuse !== null && reuse !== ALLOWED_REUSE) return null;

  const base = `${IIIF_BASE}/${imageId}`;
  const itemId = record.id === undefined || record.id === null ? '' : String(record.id);

  const licenseText = licenseLabel(attributes.license_ss, attributes.rights_ss);

  return {
    source: id,
    id: itemId,
    title: cleanText(attributes.title_info_primary_tsi) || 'Untitled',
    creator: firstString(attributes.name_tsim),
    date: firstString(attributes.date_tsim),
    description: null,
    thumb: `${base}/full/400,/0/default.jpg`,
    preview: `${base}/full/1600,/0/default.jpg`,
    full: `${base}/full/full/0/default.jpg`,
    width: null,
    height: null,
    license: licenseText,
    licenseUrl: null,
    pageUrl: `https://www.digitalcommonwealth.org/search/${itemId}`,
    provider: firstString(attributes.institution_name_ssi),
  };
}

function saysNoKnown(value) {
  return typeof value === 'string' && /no known/i.test(value);
}

export function licenseLabel(license, rights) {
  if (saysNoKnown(license) || saysNoKnown(rights)) return 'No known restrictions';
  const fromLicense = cleanText(license, 80);
  if (fromLicense) return fromLicense;
  const fromRights = cleanText(rights, 80);
  if (fromRights) return fromRights;
  return 'See item page';
}

export function parseSearch(json, page) {
  const rawItems = Array.isArray(json?.data) ? json.data : [];
  const items = rawItems.map((entry) => normalize(entry)).filter((item) => item !== null);

  const pages = json?.meta?.pages ?? {};
  const total = Number.isFinite(pages.total_count) ? pages.total_count : null;
  const hasMore = Number.isFinite(pages.next_page);

  return { total, hasMore, items };
}

export function buildSearchUrl(q, page) {
  const currentPage = Math.max(1, Number(page) || 1);
  const params = new URLSearchParams();
  params.set('q', q ?? '');
  params.set('per_page', String(PAGE_SIZE));
  params.set('page', String(currentPage));
  params.append('f[reuse_allowed_ssi][]', ALLOWED_REUSE);
  return `${SEARCH_URL}?${params.toString()}`;
}

export async function search(q, page, deps = {}) {
  const doFetch = deps.fetchJson ?? fetchJson;
  const json = await doFetch(buildSearchUrl(q, page));
  return parseSearch(json, page);
}
