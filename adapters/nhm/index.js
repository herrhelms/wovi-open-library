import { fetchJson } from '../../lib/http.js';
import { cleanText } from '../../lib/util.js';

export const id = 'nhm';

export const RESOURCE_ID = '05ff2255-c38a-40c9-b657-4ccb55ab2feb';

const SEARCH_URL = 'https://data.nhm.ac.uk/api/3/action/datastore_search';
const MEDIA_PREFIX = 'https://data.nhm.ac.uk/media/';
const PAGE_SIZE = 24;
const DEFAULT_LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/';
const BY_4_URL_PATTERN = /creativecommons\.org\/licenses\/by\/4\.0/i;
const CC0_URL_PATTERN = /creativecommons\.org\/publicdomain\/zero/i;

export function buildSearchUrl(q, page) {
  const currentPage = Math.max(1, Number(page) || 1);
  const params = new URLSearchParams({
    resource_id: RESOURCE_ID,
    q: q ?? '',
    limit: String(PAGE_SIZE),
    offset: String((currentPage - 1) * PAGE_SIZE),
    filters: JSON.stringify({ _has_image: true }),
  });
  return `${SEARCH_URL}?${params.toString()}`;
}

function firstMedia(record) {
  const media = Array.isArray(record?.associatedMedia) ? record.associatedMedia : [];
  return (
    media.find(
      (entry) =>
        entry &&
        typeof entry.identifier === 'string' &&
        entry.identifier.startsWith(MEDIA_PREFIX),
    ) ?? null
  );
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function licenseOf(media) {
  const url = typeof media.license === 'string' && media.license !== '' ? media.license : null;
  if (url === null || BY_4_URL_PATTERN.test(url)) {
    return { license: 'CC BY 4.0', licenseUrl: url ?? DEFAULT_LICENSE_URL };
  }
  if (CC0_URL_PATTERN.test(url)) {
    return { license: 'CC0', licenseUrl: url };
  }
  return { license: 'See record page', licenseUrl: url };
}

export function normalize(record) {
  const raw = record ?? {};
  const media = firstMedia(raw);
  if (media === null) return null;

  const mediaTitle = cleanText(media.title);
  const scientificName =
    typeof raw.scientificName === 'string' && raw.scientificName.trim() !== ''
      ? raw.scientificName.trim()
      : null;

  let title = scientificName ?? mediaTitle ?? 'Untitled';
  const catalogNumber =
    typeof raw.catalogNumber === 'string' && raw.catalogNumber.trim() !== ''
      ? raw.catalogNumber.trim()
      : null;
  if (catalogNumber !== null) title = `${title} (${catalogNumber})`;

  const identifier = media.identifier.replace(/\/+$/, '');
  const { license, licenseUrl } = licenseOf(media);

  const pageUrl =
    typeof raw.occurrenceID === 'string' && raw.occurrenceID !== ''
      ? `https://data.nhm.ac.uk/object/${raw.occurrenceID}`
      : `https://data.nhm.ac.uk/dataset/collection-specimens/resource/${RESOURCE_ID}/record/${raw._id}`;

  return {
    source: id,
    id: String(raw._id ?? ''),
    title,
    creator: null,
    date: null,
    description: mediaTitle,
    thumb: `${identifier}/thumbnail`,
    preview: `${identifier}/preview`,
    full: `${identifier}/full/max/0/default.jpg`,
    fullTiff: `${identifier}/original`,
    width: positiveNumber(media.PixelXDimension),
    height: positiveNumber(media.PixelYDimension),
    license,
    licenseUrl,
    pageUrl,
    provider: null,
  };
}

function errorText(error) {
  if (typeof error === 'string') return error;
  if (error && typeof error.message === 'string' && error.message !== '') return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function parseSearch(json, page) {
  if (json?.success === false) {
    throw new Error(`NHM Data Portal: ${errorText(json.error ?? 'request failed')}`);
  }

  const currentPage = Math.max(1, Number(page) || 1);
  const records = Array.isArray(json?.result?.records) ? json.result.records : [];
  const items = records.map((entry) => normalize(entry)).filter((item) => item !== null);
  const total = Number.isFinite(json?.result?.total) ? json.result.total : null;
  const hasMore = total === null ? false : (currentPage - 1) * PAGE_SIZE + records.length < total;

  return { total, hasMore, items };
}

export async function search(q, page, deps = {}) {
  const doFetch = deps.fetchJson ?? fetchJson;
  const json = await doFetch(buildSearchUrl(q, page), { timeoutMs: 20000 });
  return parseSearch(json, page);
}
