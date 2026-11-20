import { fetchJson } from '../http.js';
import { cleanText, firstString } from '../util.js';

export const id = 'japan-search';
export const name = 'Japan Search';
export const homepage = 'https://jpsearch.go.jp';
export const group = 'aggregators';
export const keyEnv = null;
export const trustResolvedUrl = true;

const SEARCH_URL = 'https://jpsearch.go.jp/api/item/search/jps-cross';
const ITEM_URL = 'https://jpsearch.go.jp/api/item';
const PAGE_SIZE = 24;
const ID_PATTERN = /^[A-Za-z0-9_.-]+$/;
const IIIF_THUMB_PATTERN = /\/full\/\d+,\/0\/default\.jpg$/;

export const LICENSE = 'Public domain';
export const LICENSE_URL = 'https://creativecommons.org/publicdomain/mark/1.0/';

export function buildSearchUrl(q, page) {
  const currentPage = Math.max(1, Number(page) || 1);
  const from = (currentPage - 1) * PAGE_SIZE;
  return (
    `${SEARCH_URL}?keyword=${encodeURIComponent(q ?? '')}` +
    `&f-rights=pdm&f-contents=image&size=${PAGE_SIZE}&from=${from}`
  );
}

function iiifBase(url) {
  const match = url.match(IIIF_THUMB_PATTERN);
  if (!match) return null;
  return url.slice(0, url.length - match[0].length);
}

function creatorOf(common) {
  const value = firstString(common?.contributor);
  if (value === null) return null;
  const text = value.replace(/\u3000/g, ' ').trim();
  return text === '' ? null : text;
}

function dateOf(common) {
  const values = common?.temporal;
  if (!Array.isArray(values)) return null;
  for (let i = values.length - 1; i >= 0; i -= 1) {
    const value = values[i];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return null;
}

function pageUrlOf(common, itemId) {
  const link = firstString(common?.linkUrl);
  if (link !== null) {
    try {
      if (new URL(link).host === 'dl.ndl.go.jp') {
        return link.replace(/^http:\/\//i, 'https://');
      }
    } catch {
      // keep the raw link
    }
    return link;
  }
  return `https://jpsearch.go.jp/item/${encodeURIComponent(itemId)}`;
}

export function normalize(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const common = entry.common ?? {};

  if (
    typeof common.contentsRightsType === 'string' &&
    common.contentsRightsType !== '' &&
    common.contentsRightsType !== 'pdm'
  ) {
    return null;
  }

  const imageUrl = firstString(common.contentsUrl) ?? firstString(common.thumbnailUrl);
  if (imageUrl === null) return null;

  const thumbnail = firstString(common.thumbnailUrl);
  const base = thumbnail === null ? null : iiifBase(thumbnail);

  let thumb;
  let preview;
  let full;
  if (base !== null) {
    thumb = `${base}/full/400,/0/default.jpg`;
    preview = `${base}/full/1600,/0/default.jpg`;
    full = `${base}/full/full/0/default.jpg`;
  } else {
    thumb = thumbnail ?? imageUrl;
    preview = imageUrl;
    full = imageUrl;
  }

  const itemId = String(entry.id ?? '');
  const titleEn = typeof common.titleEn === 'string' ? common.titleEn.trim() : '';
  const titleOriginal = typeof common.title === 'string' ? common.title.trim() : '';
  const title = titleEn !== '' ? titleEn : titleOriginal !== '' ? titleOriginal : 'Untitled';
  const description =
    titleEn !== '' && titleOriginal !== '' && titleEn !== titleOriginal
      ? cleanText(titleOriginal)
      : null;

  return {
    source: id,
    id: itemId,
    title,
    creator: creatorOf(common),
    date: dateOf(common),
    description,
    thumb,
    preview,
    full,
    width: null,
    height: null,
    license: LICENSE,
    licenseUrl: LICENSE_URL,
    pageUrl: pageUrlOf(common, itemId),
    provider: firstString(common.ownerOrg) ?? firstString(common.provider) ?? null,
  };
}

export function parseSearch(json, page) {
  const rawItems = Array.isArray(json?.list) ? json.list : [];
  const items = rawItems.map((entry) => normalize(entry)).filter((item) => item !== null);
  const total = Number.isFinite(json?.hit) ? json.hit : null;
  const currentPage = Math.max(1, Number(page) || 1);
  const hasMore = total === null ? false : (currentPage - 1) * PAGE_SIZE + rawItems.length < total;

  return { total, hasMore, items };
}

export async function search(q, page, deps = {}) {
  const doFetch = deps.fetchJson ?? fetchJson;
  const json = await doFetch(buildSearchUrl(q, page));
  return parseSearch(json, page);
}

export async function resolveDownload(itemId, deps = {}) {
  if (typeof itemId !== 'string' || !ID_PATTERN.test(itemId)) {
    const err = new Error('Invalid Japan Search item id');
    err.status = 400;
    throw err;
  }

  const doFetch = deps.fetchJson ?? fetchJson;
  const json = await doFetch(`${ITEM_URL}/${encodeURIComponent(itemId)}`);
  const item = normalize({ id: itemId, common: json?.common });

  if (item === null || !item.full) {
    throw new Error('Japan Search item has no image URL');
  }

  return { url: item.full, filename: item.title };
}
