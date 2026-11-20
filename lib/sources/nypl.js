import { fetchJson } from '../http.js';

export const id = 'nypl';
export const name = 'New York Public Library';
export const group = 'libraries';
export const homepage = 'https://digitalcollections.nypl.org';
export const keyEnv = 'NYPL_TOKEN';

const SEARCH_URL = 'https://api.repo.nypl.org/api/v2/items/search';
const IIIF = 'https://iiif.nypl.org/iiif/3';

function httpsUrl(value) {
  if (typeof value !== 'string' || value === '') return null;
  return value.replace(/^http:\/\//, 'https://');
}

export function normalize(r) {
  if (!r || r.imageID === null || r.imageID === undefined || r.imageID === '') return null;

  const imageId = String(r.imageID);
  return {
    source: id,
    id: String(r.uuid),
    title: r.title || 'Untitled',
    creator: null,
    date: null,
    description: null,
    thumb: `${IIIF}/${imageId}/full/400,/0/default.jpg`,
    preview: `${IIIF}/${imageId}/full/1600,/0/default.jpg`,
    full: `${IIIF}/${imageId}/full/max/0/default.jpg`,
    width: null,
    height: null,
    license: 'Public domain',
    licenseUrl: r.rightsStatementURI || null,
    pageUrl: httpsUrl(r.itemLink),
  };
}

export function parseSearch(json, page) {
  const response = json?.nyplAPI?.response;
  const request = json?.nyplAPI?.request;

  let raw = response?.result;
  if (raw === null || raw === undefined) raw = [];
  else if (!Array.isArray(raw)) raw = [raw];

  const items = raw.map((entry) => normalize(entry)).filter((item) => item !== null);

  const totalValue = Number(response?.numResults);
  const total = Number.isFinite(totalValue) ? totalValue : null;
  const totalPages = Number(request?.totalPages);
  const currentPage = Number(page) || 1;
  const hasMore = Number.isFinite(totalPages) ? currentPage < totalPages : false;

  return { total, hasMore, items };
}

export async function search(q, page, deps = {}) {
  const token = process.env.NYPL_TOKEN;
  if (!token) {
    const err = new Error('NYPL needs NYPL_TOKEN in .env');
    err.code = 'KEY';
    throw err;
  }

  const doFetch = deps.fetchJson ?? fetchJson;
  const currentPage = Math.max(1, Number(page) || 1);
  const url =
    `${SEARCH_URL}?q=${encodeURIComponent(q ?? '')}` +
    `&publicDomainOnly=true&per_page=24&page=${currentPage}`;

  let json;
  try {
    json = await doFetch(url, {
      headers: { Authorization: `Token token="${token}"` },
    });
  } catch (err) {
    if (err?.status === 401 || err?.status === 403) {
      throw new Error('NYPL rejected the token. Check NYPL_TOKEN in .env.');
    }
    throw err;
  }

  return parseSearch(json, currentPage);
}
