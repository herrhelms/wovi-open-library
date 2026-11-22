import { fetchJson } from '../../lib/http.js';
import { cleanText, firstString } from '../../lib/util.js';

export const id = 'japan-search';

const SEARCH_URL = 'https://jpsearch.go.jp/api/item/search/jps-cross';
const ITEM_URL = 'https://jpsearch.go.jp/api/item';
const ID_PATTERN = /^[A-Za-z0-9_.-]+$/;
const IIIF_THUMB_PATTERN = /\/full\/\d+,\/0\/default\.jpg$/;

export const RIGHTS = ['pdm', 'cc0', 'ccby', 'ccbysa'];
export const PAGE_SIZE_PER_RIGHT = 6;

export const LICENSES = {
  pdm: {
    license: 'Public domain',
    licenseUrl: 'https://creativecommons.org/publicdomain/mark/1.0/',
  },
  cc0: {
    license: 'CC0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
  },
  ccby: { license: 'CC BY', licenseUrl: null },
  ccbysa: { license: 'CC BY-SA', licenseUrl: null },
};

function pageNumber(page) {
  return Math.max(1, Number(page) || 1);
}

export function buildSearchUrl(q, page, rights) {
  const currentPage = pageNumber(page);
  const from = (currentPage - 1) * PAGE_SIZE_PER_RIGHT;
  const rightsType = RIGHTS.includes(rights) ? rights : 'pdm';
  return (
    `${SEARCH_URL}?keyword=${encodeURIComponent(q ?? '')}` +
    `&f-rights=${rightsType}&f-contents=thumb&size=${PAGE_SIZE_PER_RIGHT}&from=${from}`
  );
}

function iiifBase(url) {
  const match = url.match(IIIF_THUMB_PATTERN);
  if (!match) return null;
  return url.slice(0, url.length - match[0].length);
}

function colbaseLargeUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.host !== 'colbase.nich.go.jp') return null;
    if (!parsed.pathname.includes('/slideshow_s/')) return null;
    parsed.pathname = parsed.pathname.replace('/slideshow_s/', '/');
    return parsed.toString();
  } catch {
    return null;
  }
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

  const rightsType = common.contentsRightsType;
  if (typeof rightsType !== 'string' || !RIGHTS.includes(rightsType)) {
    return null;
  }
  const licence = LICENSES[rightsType];

  const imageUrl = firstString(common.contentsUrl) ?? firstString(common.thumbnailUrl);
  if (imageUrl === null) return null;

  const thumbnail = firstString(common.thumbnailUrl);
  const base = thumbnail === null ? null : iiifBase(thumbnail);
  const colbaseLarge = colbaseLargeUrl(imageUrl);

  let thumb;
  let preview;
  let full;
  if (colbaseLarge !== null) {
    thumb = thumbnail ?? imageUrl;
    preview = colbaseLarge;
    full = colbaseLarge;
  } else if (base !== null) {
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
    license: licence.license,
    licenseUrl: licence.licenseUrl,
    pageUrl: pageUrlOf(common, itemId),
    provider: firstString(common.ownerOrg) ?? firstString(common.provider) ?? null,
  };
}

export function parseSearch(json, page) {
  const rawItems = Array.isArray(json?.list) ? json.list : [];
  const items = rawItems.map((entry) => normalize(entry)).filter((item) => item !== null);
  const total = Number.isFinite(json?.hit) ? json.hit : null;
  const currentPage = pageNumber(page);
  const hasMore =
    total === null ? false : (currentPage - 1) * PAGE_SIZE_PER_RIGHT + rawItems.length < total;

  return { total, hasMore, items };
}

export async function search(q, page, deps = {}) {
  const doFetch = deps.fetchJson ?? fetchJson;
  const currentPage = pageNumber(page);

  const results = await Promise.allSettled(
    RIGHTS.map((rights) => doFetch(buildSearchUrl(q, currentPage, rights))),
  );

  const answered = results.filter((result) => result.status === 'fulfilled');
  if (answered.length === 0) {
    throw results[0].reason;
  }

  let total = 0;
  let hasMore = false;
  const items = [];
  results.forEach((result) => {
    if (result.status !== 'fulfilled') return;
    const parsed = parseSearch(result.value, currentPage);
    total += Number.isFinite(parsed.total) ? parsed.total : 0;
    if (parsed.hasMore) hasMore = true;
    items.push(...parsed.items);
  });

  return { total, hasMore, items };
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
