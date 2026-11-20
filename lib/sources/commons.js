import { fetchJson } from '../http.js';
import { cleanText, stripHtml } from '../util.js';

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
  if (width !== null && width > 1920 && typeof ii.thumburl === 'string') {
    if (/\/\d+px-/.test(ii.thumburl)) {
      preview = withoutUtm(ii.thumburl.replace(/\/\d+px-/, '/1920px-'));
    }
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

export async function search(q, page) {
  const json = await fetchJson(buildSearchUrl(q, page));
  return parseSearch(json, page);
}
