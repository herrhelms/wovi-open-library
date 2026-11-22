import { fetchJson } from '../../lib/http.js';
import { cleanText } from '../../lib/util.js';

export const id = 'webumenia';

const SEARCH_URL = 'https://www.webumenia.sk/api/v1/items';
const PAGE_SIZE = 24;
const ITEM_URL = 'https://www.webumenia.sk/dielo';
const LICENSE = 'Public domain';
const LICENSE_URL = 'https://creativecommons.org/publicdomain/mark/1.0/';

export function buildSearchUrl(q, page) {
  const currentPage = Math.max(1, Number(page) || 1);
  return (
    `${SEARCH_URL}?q=${encodeURIComponent(q ?? '')}` +
    '&filter%5Bis_free%5D=true' +
    '&filter%5Bhas_image%5D=true' +
    `&size=${PAGE_SIZE}&page=${currentPage}`
  );
}

function trimmedString(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function creators(content) {
  if (!Array.isArray(content.authors_formatted)) return null;
  const names = content.authors_formatted
    .filter((name) => typeof name === 'string')
    .map((name) => name.trim())
    .filter((name) => name !== '');
  return names.length > 0 ? names.join(', ') : null;
}

function dateValue(content) {
  const dating = trimmedString(content.dating);
  if (dating !== '') return dating;

  const earliest = content.date_earliest;
  const latest = content.date_latest;
  const hasEarliest = earliest !== null && earliest !== undefined && earliest !== '';
  const hasLatest = latest !== null && latest !== undefined && latest !== '';

  if (hasEarliest && hasLatest) {
    if (String(earliest) === String(latest)) return String(earliest);
    return `${earliest}–${latest}`;
  }
  if (hasEarliest) return String(earliest);
  if (hasLatest) return String(latest);
  return null;
}

export function normalize(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const content = raw.content;
  if (!content || typeof content !== 'object') return null;
  if (content.is_free !== true) return null;
  if (content.has_image !== true) return null;
  if (raw.id === null || raw.id === undefined || raw.id === '') return null;

  const itemId = String(raw.id);
  const encodedId = encodeURIComponent(itemId);
  const title = trimmedString(content.title) || 'Untitled';
  const provider = trimmedString(content.gallery);

  return {
    source: id,
    id: itemId,
    title,
    creator: creators(content),
    date: dateValue(content),
    description: cleanText(content.description),
    full: `${ITEM_URL}/${encodedId}/stiahnut`,
    preview: `${ITEM_URL}/nahlad/${encodedId}/800`,
    thumb: `${ITEM_URL}/nahlad/${encodedId}/400`,
    pageUrl: `${ITEM_URL}/${encodedId}`,
    license: LICENSE,
    licenseUrl: LICENSE_URL,
    provider: provider === '' ? null : provider,
    width: null,
    height: null,
  };
}

export function parseSearch(json) {
  const total = typeof json?.total === 'number' ? json.total : 0;
  const hasMore =
    typeof json?.current_page === 'number' && typeof json?.last_page === 'number'
      ? json.current_page < json.last_page
      : false;

  const rawItems = Array.isArray(json?.data) ? json.data : [];
  const items = rawItems.map((record) => normalize(record)).filter((item) => item !== null);

  return { total, hasMore, items };
}

export async function search(q, page, deps = {}) {
  const doFetch = deps.fetchJson ?? fetchJson;
  const currentPage = Math.max(1, Number(page) || 1);
  const json = await doFetch(buildSearchUrl(q, currentPage));
  return parseSearch(json);
}
