import { createHash } from 'node:crypto';

import { fetchJson, fetchWithTimeout } from '../../lib/http.js';
import { cleanText } from '../../lib/util.js';

export const id = 'gbif';

const SEARCH_URL = 'https://api.gbif.org/v1/occurrence/search';
const OCCURRENCE_URL = 'https://api.gbif.org/v1/occurrence';
const PAGE_SIZE = 24;

const CC0 = { label: 'CC0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' };
const PUBLIC_DOMAIN = {
  label: 'Public domain',
  url: 'https://creativecommons.org/publicdomain/mark/1.0/',
};

const NOT_OPEN = /(?:^|[^a-z])(?:nc|nd)(?:[^a-z]|$)/;

function versionIn(text, fallback) {
  const explicit = text.match(/licenses\/(?:by-sa|by)\/([0-9]+(?:\.[0-9]+)?)/i);
  if (explicit) return explicit[1];
  const short = text.match(/(?:cc[- ]?by[- ]?sa|cc[- ]?by)\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (short) return short[1];
  return fallback;
}

export function photoLicense(text) {
  if (typeof text !== 'string') return null;
  const value = text.trim();
  if (value === '') return null;
  const lower = value.toLowerCase();

  if (lower.includes('copyright') || lower.includes('all rights reserved')) return null;
  if (NOT_OPEN.test(lower)) return null;

  if (lower.includes('creativecommons.org/publicdomain/zero') || lower.includes('cc0')) {
    return { ...CC0 };
  }
  if (
    lower.includes('creativecommons.org/publicdomain/mark') ||
    lower.includes('public domain')
  ) {
    return { ...PUBLIC_DOMAIN };
  }
  if (
    lower.includes('cc-by-sa') ||
    lower.includes('cc by-sa') ||
    /licenses\/by-sa\//.test(lower)
  ) {
    const version = versionIn(value, '4.0');
    return {
      label: `CC BY-SA ${version}`,
      url: `https://creativecommons.org/licenses/by-sa/${version}/`,
    };
  }
  if (lower.includes('cc-by') || lower.includes('cc by') || /licenses\/by\//.test(lower)) {
    const version = versionIn(value, '4.0');
    return {
      label: `CC BY ${version}`,
      url: `https://creativecommons.org/licenses/by/${version}/`,
    };
  }
  return null;
}

export function cacheUrl(key, identifier, size) {
  const digest = createHash('md5').update(String(identifier), 'utf8').digest('hex');
  return `https://api.gbif.org/v1/image/cache/${size}/occurrence/${key}/media/${digest}`;
}

export function thumbUrl(key, identifier) {
  return cacheUrl(key, identifier, '200x');
}

function selectMedia(media) {
  if (!Array.isArray(media)) return null;
  return (
    media.find((entry) => {
      if (!entry || typeof entry !== 'object') return false;
      if (entry.type !== undefined && entry.type !== null && entry.type !== 'StillImage') {
        return false;
      }
      if (typeof entry.identifier !== 'string' || !entry.identifier.startsWith('http')) {
        return false;
      }
      return photoLicense(entry.license) !== null;
    }) ?? null
  );
}

function titleOf(record) {
  const scientific =
    typeof record.scientificName === 'string' && record.scientificName.trim() !== ''
      ? record.scientificName.trim()
      : null;
  const vernacular =
    typeof record.vernacularName === 'string' && record.vernacularName.trim() !== ''
      ? record.vernacularName.trim()
      : null;
  if (vernacular && scientific) return `${vernacular} (${scientific})`;
  if (vernacular) return vernacular;
  if (scientific) return scientific;
  return 'Untitled';
}

function dateOf(eventDate) {
  if (typeof eventDate !== 'string' || eventDate === '') return null;
  return eventDate.slice(0, 10);
}

export function normalize(raw) {
  const record = raw ?? {};
  const media = selectMedia(record.media);
  if (!media) return null;

  const license = photoLicense(media.license);
  if (!license) return null;

  const recordId = String(record.key ?? '');
  const identifier = media.identifier;

  const item = {
    source: id,
    id: recordId,
    title: titleOf(record),
    creator: media.creator || media.rightsHolder || record.recordedBy || null,
    date: dateOf(record.eventDate),
    description: cleanText(record.country),
    thumb: cacheUrl(record.key, identifier, '400x'),
    thumbFallback: cacheUrl(record.key, identifier, '200x'),
    preview: cacheUrl(record.key, identifier, '1600x'),
    full: identifier,
    width: null,
    height: null,
    license: license.label,
    licenseUrl: license.url,
    pageUrl: `https://www.gbif.org/occurrence/${recordId}`,
  };

  if (identifier.startsWith('https://')) item.previewFallback = identifier;

  return item;
}

export function parseSearch(json, page) {
  const rawItems = Array.isArray(json?.results) ? json.results : [];
  const items = rawItems.map((entry) => normalize(entry)).filter((item) => item !== null);
  const total = Number.isFinite(json?.count) ? json.count : null;
  const hasMore = json?.endOfRecords === false;

  return { total, hasMore, items };
}

export function buildSearchUrl(q, page) {
  const currentPage = Math.max(1, Number(page) || 1);
  const params = new URLSearchParams();
  params.append('q', q ?? '');
  params.append('mediaType', 'StillImage');
  params.append('license', 'CC0_1_0');
  params.append('license', 'CC_BY_4_0');
  params.append('limit', String(PAGE_SIZE));
  params.append('offset', String((currentPage - 1) * PAGE_SIZE));
  return `${SEARCH_URL}?${params.toString()}`;
}

export async function search(q, page, deps = {}) {
  const doFetch = deps.fetchJson ?? fetchJson;
  const json = await doFetch(buildSearchUrl(q, page));
  return parseSearch(json, page);
}

export async function resolveDownload(itemId, deps = {}) {
  if (typeof itemId !== 'string' || !/^[0-9]+$/.test(itemId)) {
    const err = new Error('Invalid GBIF item id');
    err.status = 400;
    throw err;
  }

  const doFetch = deps.fetchJson ?? fetchJson;
  const json = await doFetch(`${OCCURRENCE_URL}/${itemId}`);

  const media = selectMedia(json?.media);
  if (!media) throw new Error('GBIF record has no open image');

  const identifier = media.identifier;
  const candidates = identifier.startsWith('http://')
    ? [`https://${identifier.slice('http://'.length)}`, identifier]
    : [identifier];

  const doFetchHeaders = deps.fetch ?? fetchWithTimeout;
  for (const candidate of candidates) {
    try {
      const res = await doFetchHeaders(candidate);
      const type = res?.headers?.get?.('content-type') ?? '';
      const good = res?.status === 200 && type.startsWith('image/');
      try {
        await res?.body?.cancel?.();
      } catch {
        // The body is not needed. Ignore a failed cancel.
      }
      if (good) return { url: candidate, filename: titleOf(json ?? {}) };
    } catch {
      // A failed request means the candidate is not good.
    }
  }

  const key = json?.key ?? itemId;
  return {
    url: cacheUrl(key, identifier, '1600x'),
    filename: titleOf(json ?? {}),
  };
}
