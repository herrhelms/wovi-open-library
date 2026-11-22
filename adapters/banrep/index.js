import { fetchJson } from '../../lib/http.js';
import { cleanText } from '../../lib/util.js';

export const id = 'banrep';

export const COLLECTIONS = ['p17054coll40', 'hidalgos', 'p17054coll13', 'p17054coll16', 'r_rendon'];

const PAGE_SIZE = 24;
const BASE_URL = 'https://babel.banrepcultural.org';
const SEARCH_BASE = `${BASE_URL}/digital/bl/dmwebservices/index.php?q=dmQuery`;
const IIIF_BASE = `${BASE_URL}/iiif/2`;

const PUBLIC_DOMAIN = 'Public domain';
const PUBLIC_DOMAIN_URL = 'https://creativecommons.org/publicdomain/mark/1.0/';

function toPage(page) {
  const number = Number(page);
  if (!Number.isFinite(number) || number < 1) return 1;
  return Math.floor(number);
}

export function cleanQuery(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/[\^!\/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildSearchUrl(q, page) {
  const query = cleanQuery(q);
  if (query === '') return null;
  const start = (toPage(page) - 1) * PAGE_SIZE + 1;
  return (
    `${SEARCH_BASE}/${COLLECTIONS.join('!')}/CISOSEARCHALL^${encodeURIComponent(query)}` +
    `^all^and!rights^dominio^all^and/title!creato!date!rights/nosort/24/${start}/0/0/0/0/json`
  );
}

function isPublicDomain(rights) {
  if (rights === null || rights === undefined) return false;
  const text = String(rights)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return text.includes('dominio p');
}

function textOrNull(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

export function normalize(record) {
  if (!record || typeof record !== 'object') return null;
  if (!isPublicDomain(record.rights)) return null;

  const filetype = typeof record.filetype === 'string' ? record.filetype.toLowerCase() : '';
  if (filetype === 'pdf' || filetype === 'cpd') return null;

  const collection = typeof record.collection === 'string' ? record.collection : '';
  const alias = collection.replace(/^\/+/, '');
  const pointer = Number(record.pointer);
  if (alias === '' || !Number.isFinite(pointer)) return null;

  const key = `${alias}:${pointer}`;
  const image = `${IIIF_BASE}/${key}`;

  const title = textOrNull(record.title) ?? 'Untitled';
  const creator = textOrNull(record.creato);

  const rawDate = textOrNull(record.date);
  let date = null;
  let description = null;
  if (rawDate !== null) {
    if (rawDate.length > 40) description = cleanText(rawDate);
    else date = rawDate;
  }

  return {
    source: id,
    id: key,
    title,
    creator,
    date,
    description,
    thumb: `${image}/full/400,/0/default.jpg`,
    preview: `${image}/full/1600,/0/default.jpg`,
    full: `${image}/full/max/0/default.jpg`,
    width: null,
    height: null,
    license: PUBLIC_DOMAIN,
    licenseUrl: PUBLIC_DOMAIN_URL,
    pageUrl: `${BASE_URL}/digital/collection/${alias}/id/${pointer}`,
  };
}

export function parseSearch(json, page = 1) {
  const total = Number(json?.pager?.total) || 0;
  const records = Array.isArray(json?.records) ? json.records : [];
  const items = records.map((record) => normalize(record)).filter((item) => item !== null);
  const start = (toPage(page) - 1) * PAGE_SIZE + 1;
  const hasMore = start - 1 + records.length < total;

  return { total, hasMore, items };
}

export async function search(q, page, deps = {}) {
  const currentPage = toPage(page);
  const url = buildSearchUrl(q, currentPage);
  if (url === null) return { total: 0, hasMore: false, items: [] };

  const doFetch = deps.fetchJson ?? fetchJson;
  const json = await doFetch(url);
  return parseSearch(json, currentPage);
}
