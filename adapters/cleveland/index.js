import { fetchJson } from '../../lib/http.js';
import { cleanText } from '../../lib/util.js';

export const id = 'cleveland';

const PAGE_SIZE = 24;
const SEARCH_URL = 'https://openaccess-api.clevelandart.org/api/artworks/';

function toDimension(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalize(record) {
  if (!record || typeof record !== 'object') return null;

  const images = record.images ?? {};
  const web = images.web;
  const print = images.print;
  const webUrl = typeof web?.url === 'string' && web.url !== '' ? web.url : null;
  const printUrl = typeof print?.url === 'string' && print.url !== '' ? print.url : null;

  if (!webUrl && !printUrl) return null;

  const fullEntry = printUrl ? print : web;
  const full = printUrl ?? webUrl;
  const fullTiff =
    typeof images.full?.url === 'string' && images.full.url !== '' ? images.full.url : null;
  const creator =
    typeof record.creators?.[0]?.description === 'string' && record.creators[0].description !== ''
      ? record.creators[0].description
      : null;

  return {
    source: id,
    id: String(record.id),
    title: record.title || 'Untitled',
    creator,
    date: record.creation_date || null,
    description: cleanText(record.description),
    thumb: webUrl,
    preview: printUrl ?? webUrl,
    full,
    width: toDimension(fullEntry.width),
    height: toDimension(fullEntry.height),
    license: 'CC0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    pageUrl: record.url ?? null,
    fullTiff,
  };
}

export function parseSearch(json, page = 1) {
  const total = typeof json?.info?.total === 'number' ? json.info.total : null;
  const rawItems = Array.isArray(json?.data) ? json.data : [];
  const items = rawItems.map((record) => normalize(record)).filter((item) => item !== null);
  const currentPage = Math.max(1, Number(page) || 1);
  const skip = (currentPage - 1) * PAGE_SIZE;
  const hasMore = total !== null && skip + rawItems.length < total;

  return { total, hasMore, items };
}

export async function search(q, page, deps = {}) {
  const doFetch = deps.fetchJson ?? fetchJson;
  const currentPage = Math.max(1, Number(page) || 1);
  const skip = (currentPage - 1) * PAGE_SIZE;
  const params = new URLSearchParams({
    q: q ?? '',
    has_image: '1',
    cc0: '1',
    limit: String(PAGE_SIZE),
    skip: String(skip),
  });

  const json = await doFetch(`${SEARCH_URL}?${params.toString()}`);
  return parseSearch(json, currentPage);
}
