import { fetchJson } from '../http.js';
import { cleanText } from '../util.js';

export const id = 'inaturalist';
export const name = 'iNaturalist';
export const homepage = 'https://www.inaturalist.org';
export const group = 'science';
export const keyEnv = null;

const SEARCH_URL = 'https://api.inaturalist.org/v1/observations';
const PAGE_SIZE = 24;

const ALLOWED_LICENSES = new Set(['cc0', 'cc-by', 'cc-by-sa']);

const LICENSE_LABELS = {
  cc0: 'CC0',
  'cc-by': 'CC BY 4.0',
  'cc-by-sa': 'CC BY-SA 4.0',
};

const LICENSE_URLS = {
  cc0: 'https://creativecommons.org/publicdomain/zero/1.0/',
  'cc-by': 'https://creativecommons.org/licenses/by/4.0/',
  'cc-by-sa': 'https://creativecommons.org/licenses/by-sa/4.0/',
};

export function buildSearchUrl(q, page) {
  const currentPage = Math.max(1, Number(page) || 1);
  return (
    `${SEARCH_URL}?q=${encodeURIComponent(q ?? '')}` +
    `&photos=true&photo_license=cc0,cc-by,cc-by-sa` +
    `&quality_grade=research&per_page=${PAGE_SIZE}&page=${currentPage}&order_by=votes`
  );
}

function selectPhoto(photos) {
  if (!Array.isArray(photos)) return null;
  return (
    photos.find(
      (photo) =>
        photo && typeof photo.license_code === 'string' && ALLOWED_LICENSES.has(photo.license_code),
    ) ?? null
  );
}

function photoUrl(url, size) {
  if (typeof url !== 'string' || url === '') return null;
  const slash = url.lastIndexOf('/');
  const name = slash === -1 ? url : url.slice(slash + 1);
  if (!/^square\.[a-z0-9]+$/i.test(name)) return url;
  return `${url.slice(0, slash + 1)}${size}${name.slice('square'.length)}`;
}

function numberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function titleOf(record, taxon) {
  const scientific = typeof taxon?.name === 'string' && taxon.name !== '' ? taxon.name : null;
  const common =
    typeof taxon?.preferred_common_name === 'string' && taxon.preferred_common_name !== ''
      ? taxon.preferred_common_name
      : null;
  if (common && scientific) return `${common} (${scientific})`;
  if (scientific) return scientific;
  if (typeof record?.species_guess === 'string' && record.species_guess !== '') {
    return record.species_guess;
  }
  return 'Untitled';
}

export function normalize(raw) {
  const record = raw ?? {};
  const photo = selectPhoto(record.photos);
  if (!photo) return null;

  const url = photo.url;
  const thumb = photoUrl(url, 'medium');
  const preview = photoUrl(url, 'large');
  const full = photoUrl(url, 'original');
  if (!full) return null;

  const dimensions = photo.original_dimensions ?? {};
  const observationId = String(record.id ?? '');
  const uri =
    typeof record.uri === 'string' && record.uri !== ''
      ? record.uri
      : `https://www.inaturalist.org/observations/${observationId}`;

  return {
    source: id,
    id: observationId,
    title: titleOf(record, record.taxon),
    creator: record.user?.login || null,
    date: record.observed_on || null,
    description: cleanText(photo.attribution),
    thumb,
    preview,
    full,
    width: numberOrNull(dimensions.width),
    height: numberOrNull(dimensions.height),
    license: LICENSE_LABELS[photo.license_code],
    licenseUrl: LICENSE_URLS[photo.license_code],
    pageUrl: uri,
  };
}

export function parseSearch(json, page) {
  const rawItems = Array.isArray(json?.results) ? json.results : [];
  const items = rawItems.map((entry) => normalize(entry)).filter((item) => item !== null);
  const total = Number.isFinite(json?.total_results) ? json.total_results : null;
  const currentPage = Math.max(1, Number(page) || 1);
  const hasMore = total === null ? false : currentPage * PAGE_SIZE < total;

  return { total, hasMore, items };
}

function asRateLimitError(err) {
  if (err?.status === 429) {
    const rateErr = new Error('iNaturalist rate limit reached. Try again in a minute.');
    rateErr.code = 'RATE_LIMIT';
    return rateErr;
  }
  return err;
}

export async function search(q, page, deps = {}) {
  const doFetch = deps.fetchJson ?? fetchJson;
  try {
    const json = await doFetch(buildSearchUrl(q, page));
    return parseSearch(json, page);
  } catch (err) {
    throw asRateLimitError(err);
  }
}
