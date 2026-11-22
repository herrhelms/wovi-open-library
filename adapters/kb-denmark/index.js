import { fetchJson } from '../../lib/http.js';

export const id = 'kb-denmark';

const SEARCH_URL = 'https://digitalesamlinger.kb.dk/catalog.json';
const PAGE_SIZE = 24;
const RIGHTS_QUERY = '(rights_tsim:"fri af ophavsret" OR rights_tsim:"CC BY")';
const PUBLIC_DOMAIN_URL = 'https://creativecommons.org/publicdomain/mark/1.0/';
const PAGE_HOST = 'https://digitalesamlinger.kb.dk';

const SOLR_SPECIALS = /[+\-&|!(){}[\]^"~*?:\\/]/g;
const WHITESPACE = /\s+/g;

function cleanWhitespace(value) {
  return String(value).replace(WHITESPACE, ' ').trim();
}

function httpsUrl(value) {
  return String(value).replace(/^http:\/\//, 'https://');
}

function firstCleanString(value) {
  if (!Array.isArray(value)) return null;
  const found = value.find((entry) => typeof entry === 'string' && entry.trim() !== '');
  return found === undefined ? null : cleanWhitespace(found);
}

function firstString(value) {
  if (!Array.isArray(value)) return null;
  const found = value.find((entry) => typeof entry === 'string' && entry.trim() !== '');
  return found === undefined ? null : found.trim();
}

export function cleanQuery(text) {
  const source = text === null || text === undefined ? '' : String(text);
  return source.replace(SOLR_SPECIALS, ' ').replace(WHITESPACE, ' ').trim();
}

export function buildSearchUrl(q, page) {
  const cleaned = cleanQuery(q);
  if (cleaned === '') return null;

  const currentPage = Math.max(1, Number(page) || 1);
  const query = `(${cleaned}) AND ${RIGHTS_QUERY}`;
  return `${SEARCH_URL}?q=${encodeURIComponent(query)}&search_field=all_fields&f%5Bmedium_ssi%5D%5B%5D=images&per_page=${PAGE_SIZE}&page=${currentPage}`;
}

function rightsOf(doc) {
  const rights = Array.isArray(doc.rights_tsim) ? doc.rights_tsim : [];
  const values = rights.filter((entry) => typeof entry === 'string');

  const publicDomain = values.find((entry) => /fri af ophavsret/i.test(entry));
  if (publicDomain !== undefined) {
    return { license: 'Public domain', licenseUrl: PUBLIC_DOMAIN_URL };
  }

  const ccBy = values.find((entry) => entry.trim().toLowerCase() === 'cc by');
  if (ccBy !== undefined) {
    return { license: 'CC BY', licenseUrl: null };
  }

  return null;
}

export function normalize(doc) {
  const record = doc ?? {};
  const rights = rightsOf(record);
  if (rights === null) return null;

  const rawFull = firstString(record.full_image_url_ssm);
  if (rawFull === null) return null;

  const full = httpsUrl(rawFull);
  const itemId = record.id === null || record.id === undefined ? '' : String(record.id);

  const rawThumb = firstString(record.thumbnail_url_ssm);
  const thumb = rawThumb === null
    ? full.replace('/full/full/0/', '/full/!400,/0/')
    : httpsUrl(rawThumb);

  const title = firstCleanString(record.full_title_tsi === undefined ? null : [record.full_title_tsi])
    ?? firstCleanString(record.title_tdsim)
    ?? 'Untitled';

  const date = firstCleanString(record.readable_dat_string_tsim)
    ?? (typeof record.pub_dat_tsi === 'string' && record.pub_dat_tsi.trim() !== ''
      ? record.pub_dat_tsi.trim()
      : null);

  return {
    source: id,
    id: itemId,
    title,
    creator: firstString(record.creator_display_tsim),
    date,
    description: null,
    thumb,
    preview: full.replace('/full/full/0/', '/full/1600,/0/'),
    full,
    width: null,
    height: null,
    license: rights.license,
    licenseUrl: rights.licenseUrl,
    pageUrl: `${PAGE_HOST}${itemId}/da/`,
  };
}

export function parseSearch(json) {
  const response = json?.response ?? {};
  const rawItems = Array.isArray(response.docs) ? response.docs : [];
  const items = rawItems.map((entry) => normalize(entry)).filter((item) => item !== null);

  const pages = response.pages ?? {};
  const total = Number.isFinite(pages.total_count) ? pages.total_count : 0;
  const hasMore = Number.isFinite(pages.next_page);

  return { total, hasMore, items };
}

export async function search(q, page, deps = {}) {
  const url = buildSearchUrl(q, page);
  if (url === null) return { total: 0, hasMore: false, items: [] };

  const doFetch = deps.fetchJson ?? fetchJson;
  const json = await doFetch(url);
  return parseSearch(json, page);
}
