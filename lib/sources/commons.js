import { cleanText, stripHtml } from '../util.js';
import { fetchCommonsJson } from '../wikimedia.js';

export const id = 'commons';
export const name = 'Wikimedia Commons';
export const group = 'aggregators';
export const homepage = 'https://commons.wikimedia.org';
export const keyEnv = null;

const API_URL = 'https://commons.wikimedia.org/w/api.php';
const PAGE_SIZE = 24;

export function buildSearchUrl(q, page) {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    generator: 'search',
    gsrsearch: `${q} filetype:bitmap`,
    gsrnamespace: '6',
    gsrlimit: String(PAGE_SIZE),
    gsroffset: String((page - 1) * PAGE_SIZE),
    prop: 'imageinfo',
    iiprop: 'url|size|extmetadata|mime',
    iiurlwidth: '400',
  });
  return `${API_URL}?${params.toString()}`;
}

function metaValue(ii, key) {
  const value = ii?.extmetadata?.[key]?.value;
  return value === undefined || value === null ? null : value;
}

function withoutUtm(url) {
  if (!url) return url;
  try {
    const parsed = new URL(url);
    for (const key of [...parsed.searchParams.keys()]) {
      if (key.startsWith('utm_')) parsed.searchParams.delete(key);
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

function titleFromPageTitle(pageTitle) {
  if (typeof pageTitle !== 'string') return '';
  return pageTitle
    .replace(/^File:/i, '')
    .replace(/\.[A-Za-z0-9]+$/, '');
}

// The thumb path can have a prefix in the last segment (for example
// "lossy-page1-500px-X.tif.jpg"). Change only the number before "px-".
function withThumbWidth(url, width) {
  if (typeof url !== 'string' || url === '') return null;
  const queryIndex = url.indexOf('?');
  const base = queryIndex === -1 ? url : url.slice(0, queryIndex);
  const query = queryIndex === -1 ? '' : url.slice(queryIndex);
  const slash = base.lastIndexOf('/');
  if (slash === -1) return null;
  const head = base.slice(0, slash + 1);
  const segment = base.slice(slash + 1);
  if (!/\d+px-/.test(segment)) return null;
  const rewritten = segment.replace(/\d+px-/, `${width}px-`);
  return `${head}${rewritten}${query}`;
}

// The viewer can show these formats directly. Other formats (TIFF, …)
// need a JPEG thumbnail from the thumb server.
const VIEWER_MIMES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

export function normalize(raw) {
  const page = raw ?? {};
  const ii = page.imageinfo?.[0];
  if (!ii) return null;

  const objectName = metaValue(ii, 'ObjectName');
  const title = stripHtml(objectName) || titleFromPageTitle(page.title) || 'Untitled';

  const full = withoutUtm(ii.url ?? null);
  const width = Number.isFinite(ii.width) ? ii.width : null;
  const height = Number.isFinite(ii.height) ? ii.height : null;
  const thumb = withoutUtm(ii.thumburl || ii.url || null);

  let preview = full;
  const mime = typeof ii.mime === 'string' ? ii.mime : '';
  if (!VIEWER_MIMES.has(mime)) {
    // Never show the original file for a format that the browser cannot show.
    const rewritten = withThumbWidth(ii.thumburl, 1920);
    if (rewritten !== null) preview = withoutUtm(rewritten);
    else if (typeof ii.thumburl === 'string' && ii.thumburl !== '') {
      preview = withoutUtm(ii.thumburl);
    }
  } else if (width !== null && width > 1920) {
    const rewritten = withThumbWidth(ii.thumburl, 1920);
    if (rewritten !== null) preview = withoutUtm(rewritten);
  }

  let pageUrl = '';
  if (typeof ii.descriptionurl === 'string' && ii.descriptionurl !== '') {
    pageUrl = ii.descriptionurl;
  } else if (typeof page.title === 'string') {
    const encoded = encodeURIComponent(page.title.replaceAll(' ', '_')).replaceAll('%3A', ':');
    pageUrl = `https://commons.wikimedia.org/wiki/${encoded}`;
  }

  return {
    source: id,
    id: String(page.pageid ?? ''),
    title,
    creator: stripHtml(metaValue(ii, 'Artist')) || null,
    date: stripHtml(metaValue(ii, 'DateTimeOriginal')) || null,
    description: cleanText(metaValue(ii, 'ImageDescription'), 600),
    thumb,
    preview,
    full,
    width,
    height,
    license: stripHtml(metaValue(ii, 'LicenseShortName')) || 'See file page',
    licenseUrl: metaValue(ii, 'LicenseUrl') || null,
    pageUrl,
  };
}

export function parseSearch(json, page) {
  void page;
  const pages = json?.query?.pages;
  const items = pages && typeof pages === 'object'
    ? Object.values(pages)
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map(normalize)
      .filter(Boolean)
    : [];

  return {
    total: null,
    hasMore: Boolean(json?.continue),
    items,
  };
}

export async function search(q, page, deps = {}) {
  const json = await fetchCommonsJson(buildSearchUrl(q, page), deps);
  return parseSearch(json, page);
}
