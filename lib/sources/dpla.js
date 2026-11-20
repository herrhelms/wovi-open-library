import { fetchJson, fetchWithTimeout } from '../http.js';
import { cleanText, firstString } from '../util.js';

export const id = 'dpla';
export const name = 'DPLA';
export const homepage = 'https://dp.la';
export const group = 'aggregators';
export const keyEnv = 'DPLA_KEY';
export const trustResolvedUrl = true;

const SEARCH_URL = 'https://api.dp.la/v2/items';
const ITEM_URL = 'https://api.dp.la/v2/items';
const PAGE_SIZE = 24;
const NOTE = 'DPLA gives a thumbnail only. Open the partner page for the full image.';

const RIGHTS_STATEMENTS = {
  'NoC-US': 'No Copyright - United States',
  'NoC-NC': 'No Copyright - Non-Commercial Use Only',
  'NoC-OKLR': 'No Copyright - Other Known Legal Restrictions',
  NKC: 'No Known Copyright',
  'InC-EDU': 'In Copyright - Educational Use Permitted',
  'InC-NC': 'In Copyright - Non-Commercial Use Permitted',
  'InC-RUU': 'In Copyright - Rights-holder(s) Unlocatable or Unidentifiable',
  InC: 'In Copyright',
  'NoC-CR': 'No Copyright - Contractual Restrictions',
  CNE: 'Copyright Not Evaluated',
  UND: 'Copyright Undetermined',
};

function currentKey() {
  return process.env.DPLA_KEY || '';
}

function needsKeyError() {
  const err = new Error(`${name} needs ${keyEnv} in .env`);
  err.code = 'NEEDS_KEY';
  return err;
}

export function rightsLabel(rights) {
  if (typeof rights !== 'string' || rights === '') return 'See partner page';

  const url = rights.replace(/^https?:\/\//i, '').replace(/^www\./i, '');

  const statement = url.match(/^rightsstatements\.org\/vocab\/([^/?#]+)/i);
  if (statement) {
    const code = statement[1];
    return RIGHTS_STATEMENTS[code] ?? `Rights statement: ${code}`;
  }

  if (/^creativecommons\.org\/publicdomain\/zero\//i.test(url)) return 'CC0';
  if (/^creativecommons\.org\/publicdomain\/mark\//i.test(url)) return 'Public domain';

  const cc = url.match(/^creativecommons\.org\/licenses\/([^/?#]+)\/([^/?#]+)/i);
  if (cc) return `CC ${cc[1].toUpperCase()} ${cc[2]}`;

  return 'See partner page';
}

function rightsUrl(rights) {
  if (typeof rights !== 'string') return null;
  return /^https?:\/\//i.test(rights) ? rights : null;
}

function objectUrl(value) {
  const first = firstString(value);
  return first && first !== '' ? first : null;
}

function providerName(value) {
  if (typeof value === 'string' && value !== '') return value;
  if (value && typeof value === 'object') {
    const nested = firstString(value.name);
    if (nested) return nested;
  }
  return null;
}

function dateValue(value) {
  if (Array.isArray(value)) return dateValue(value[0]);
  if (!value || typeof value !== 'object') return null;
  return firstString(value.displayDate);
}

function replaceLastSegment(pathname, value) {
  const index = pathname.lastIndexOf('/');
  return `${pathname.slice(0, index + 1)}${value}`;
}

/**
 * Rewrite a known partner thumbnail URL to a large preview and a full-size URL.
 * Returns null when no rule matches.
 */
export function rewriteObject(object) {
  if (typeof object !== 'string' || object === '') return null;

  let url;
  try {
    url = new URL(object);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const host = url.hostname.toLowerCase();
  // Cloudflare blocks the IIIF paths of hosted CONTENTdm. Do not rewrite them.
  if (host.endsWith('contentdm.oclc.org')) return null;

  // New York Public Library.
  if (host === 'images.nypl.org' && url.pathname === '/index.php') {
    if (!url.searchParams.get('id') || !url.searchParams.get('t')) return null;
    url.protocol = 'https:';
    url.searchParams.set('t', 'q');
    const preview = url.toString();
    url.searchParams.set('t', 'g');
    return { preview, full: url.toString() };
  }

  // Smithsonian Open Access.
  if (host === 'ids.si.edu' && url.pathname === '/ids/deliveryService') {
    if (!url.searchParams.get('id')) return null;
    url.protocol = 'https:';
    url.searchParams.set('max', '1600');
    const preview = url.toString();
    url.searchParams.delete('max');
    return { preview, full: url.toString() };
  }

  // Self-hosted CONTENTdm.
  const contentdm = url.pathname.match(
    /^\/utils\/getthumbnail\/collection\/([^/]+)\/id\/([^/]+)\/?$/,
  );
  if (contentdm) {
    const [, collection, item] = contentdm;
    const base = `${url.origin}/digital/iiif/${collection}/${item}`;
    return {
      preview: `${base}/full/1600,/0/default.jpg`,
      full: `${base}/full/max/0/default.jpg`,
    };
  }

  // Any IIIF Image API URL.
  if (/\/full\/[^/]+\/0\/default\.[A-Za-z0-9]+$/.test(url.pathname)) {
    const previewPath = url.pathname.replace(
      /\/full\/[^/]+\/0\/default(\.[A-Za-z0-9]+)$/,
      '/full/1600,/0/default$1',
    );
    const fullPath = url.pathname.replace(
      /\/full\/[^/]+\/0\/default(\.[A-Za-z0-9]+)$/,
      '/full/max/0/default$1',
    );
    url.pathname = previewPath;
    const preview = url.toString();
    url.pathname = fullPath;
    return { preview, full: url.toString() };
  }

  // Indiana University.
  if (host === 'purl.dlib.indiana.edu' && url.pathname.includes('/thumbnail/')) {
    url.pathname = url.pathname.replace('/thumbnail/', '/large/');
    const large = url.toString();
    return { preview: large, full: large };
  }

  // Digital Commonwealth.
  if (host === 'ark.digitalcommonwealth.org') {
    const parts = url.pathname.split('/');
    if (parts[parts.length - 1] !== 'thumbnail') return null;
    url.pathname = replaceLastSegment(url.pathname, 'large_image');
    const large = url.toString();
    return { preview: large, full: large };
  }

  return null;
}

export function normalize(doc) {
  const record = doc ?? {};
  const object = objectUrl(record.object);
  if (!object) return null;

  const source = record.sourceResource ?? {};
  const itemId = String(record.id ?? '');
  const rights = typeof record.rights === 'string' ? record.rights : null;
  const thumb = `https://dp.la/thumb/${itemId}`;
  const rewrite = rewriteObject(object);

  return {
    source: id,
    id: itemId,
    title: firstString(source.title) || 'Untitled',
    creator: firstString(source.creator),
    date: dateValue(source.date),
    description: cleanText(source.description, 600),
    thumb,
    thumbFallback: object,
    preview: rewrite ? rewrite.preview : thumb,
    previewFallback: object,
    full: rewrite ? rewrite.full : object,
    width: null,
    height: null,
    license: rightsLabel(rights),
    licenseUrl: rightsUrl(rights),
    pageUrl: firstString(record.isShownAt) || `https://dp.la/item/${itemId}`,
    provider: providerName(record.dataProvider) ?? providerName(record.provider),
    note: rewrite ? null : NOTE,
  };
}

export function parseSearch(json, page) {
  const docs = Array.isArray(json?.docs) ? json.docs : [];
  const items = docs.map((entry) => normalize(entry)).filter((item) => item !== null);

  const count = json?.count;
  const total = typeof count === 'number' && Number.isFinite(count) ? count : null;
  const startValue = json?.start;
  const start =
    typeof startValue === 'number' && Number.isFinite(startValue)
      ? startValue
      : (Math.max(1, Number(page) || 1) - 1) * PAGE_SIZE;
  const hasMore = total === null ? false : start + docs.length < total;

  return { total, hasMore, items };
}

export function buildSearchUrl(key, q, page, openOnly = false) {
  const currentPage = Math.max(1, Number(page) || 1);
  const params = new URLSearchParams({
    q: q ?? '',
    api_key: key,
    'sourceResource.type': 'image',
    page_size: String(PAGE_SIZE),
    page: String(currentPage),
  });
  if (openOnly === true) {
    params.set('rightsCategory', '"Unlimited Re-Use" OR "Re-use With Conditions"');
  }
  return `${SEARCH_URL}?${params.toString()}`;
}

export async function search(q, page, deps = {}) {
  const key = currentKey();
  if (!key) throw needsKeyError();

  const doFetch = deps.fetchJson ?? fetchJson;
  const json = await doFetch(buildSearchUrl(key, q, page, deps.openOnly === true));
  return parseSearch(json, page);
}

export async function resolveDownload(itemId, deps = {}) {
  if (typeof itemId !== 'string' || !/^[A-Za-z0-9]+$/.test(itemId)) {
    const err = new Error('Invalid DPLA item id');
    err.status = 400;
    throw err;
  }

  const key = currentKey();
  if (!key) throw needsKeyError();

  const doFetch = deps.fetchJson ?? fetchJson;
  const json = await doFetch(`${ITEM_URL}/${itemId}?api_key=${encodeURIComponent(key)}`);

  const doc = Array.isArray(json?.docs) ? json.docs[0] : null;
  const object = objectUrl(doc?.object);
  if (!object) throw new Error('DPLA item has no image URL');

  const rewrite = rewriteObject(object);
  let url = object;
  if (rewrite) {
    const doFetchHeaders = deps.fetch ?? fetchWithTimeout;
    try {
      const res = await doFetchHeaders(rewrite.full);
      const type = res?.headers?.get?.('content-type') ?? '';
      if (res?.status === 200 && type.startsWith('image/')) {
        url = rewrite.full;
      }
      try {
        await res?.body?.cancel?.();
      } catch {
        // The body is not needed. Ignore a failed cancel.
      }
    } catch {
      url = object;
    }
  }

  const title = firstString(doc?.sourceResource?.title);
  return { url, filename: title || null };
}
