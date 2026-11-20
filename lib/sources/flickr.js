import { fetchJson } from '../http.js';
import { cleanText } from '../util.js';

export const FLICKR_LICENSES = {
  4: { label: 'CC BY 2.0', url: 'https://creativecommons.org/licenses/by/2.0/' },
  5: { label: 'CC BY-SA 2.0', url: 'https://creativecommons.org/licenses/by-sa/2.0/' },
  7: { label: 'No known copyright restrictions', url: 'https://www.flickr.com/commons/usage/' },
  8: { label: 'United States Government Work', url: 'http://www.usa.gov/copyright.shtml' },
  9: { label: 'CC0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' },
  10: { label: 'Public Domain Mark', url: 'https://creativecommons.org/publicdomain/mark/1.0/' },
};

const API_URL = 'https://api.flickr.com/services/rest/';
const PAGE_SIZE = 24;
const EXTRAS = 'url_w,url_n,url_q,url_h,url_z,url_b,url_k,url_o,o_dims,owner_name,license,date_taken,description';
const FULL_SIZES = ['o', 'k', 'b', 'z'];

export function buildSearchUrl({ key, q, page, extraParams = {} }) {
  const currentPage = Math.max(1, Number(page) || 1);
  const params = new URLSearchParams({
    method: 'flickr.photos.search',
    api_key: key,
    text: q ?? '',
    format: 'json',
    nojsoncallback: '1',
    media: 'photos',
    per_page: String(PAGE_SIZE),
    page: String(currentPage),
    extras: EXTRAS,
    sort: 'relevance',
    safe_search: '1',
  });
  for (const [name, value] of Object.entries(extraParams)) {
    params.set(name, String(value));
  }
  return `${API_URL}?${params.toString()}`;
}

function stringOrNull(value) {
  return typeof value === 'string' && value !== '' ? value : null;
}

function firstUrl(raw, suffixes) {
  for (const suffix of suffixes) {
    const url = stringOrNull(raw[`url_${suffix}`]);
    if (url !== null) return url;
  }
  return null;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function dateOnly(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const text = value.trim().replace(/ 00:00:00$/, '');
  return text === '' ? null : text;
}

function licenseOf(rawLicense) {
  const entry = FLICKR_LICENSES[String(rawLicense)];
  if (!entry) return { license: 'See Flickr page', licenseUrl: null };
  return { license: entry.label, licenseUrl: entry.url };
}

export function createFlickrSource({ id, name, homepage, extraParams = {} }) {
  function normalize(photo) {
    const raw = photo ?? {};

    const preview = firstUrl(raw, ['h', 'b', 'z']);

    let full = null;
    let size = null;
    for (const suffix of FULL_SIZES) {
      const url = stringOrNull(raw[`url_${suffix}`]);
      if (url !== null) {
        full = url;
        size = suffix;
        break;
      }
    }
    if (full === null) return null;
    if (preview === null) return null;
    const thumb = firstUrl(raw, ['w', 'n', 'q', 'z']) ?? preview;

    const { license, licenseUrl } = licenseOf(raw.license);
    const photoId = String(raw.id ?? '');

    return {
      source: id,
      id: photoId,
      title: typeof raw.title === 'string' && raw.title !== '' ? raw.title : 'Untitled',
      creator: typeof raw.ownername === 'string' && raw.ownername !== '' ? raw.ownername : null,
      date: dateOnly(raw.datetaken),
      description: cleanText(raw.description?._content, 600),
      thumb,
      preview,
      full,
      width: numberOrNull(raw[`width_${size}`]),
      height: numberOrNull(raw[`height_${size}`]),
      license,
      licenseUrl,
      pageUrl: `https://www.flickr.com/photos/${raw.owner ?? ''}/${photoId}`,
    };
  }

  function parseSearch(json, page) {
    if (json?.stat === 'fail') {
      const message = typeof json.message === 'string' && json.message !== ''
        ? json.message
        : 'request failed';
      throw new Error(`Flickr: ${message}`);
    }

    const photos = json?.photos ?? {};
    const rawItems = Array.isArray(photos.photo) ? photos.photo : [];
    const items = rawItems.map((entry) => normalize(entry)).filter((item) => item !== null);

    const total = numberOrNull(photos.total);
    const currentPage = Number(photos.page);
    const pages = Number(photos.pages);
    const hasMore = Number.isFinite(currentPage) && Number.isFinite(pages)
      ? currentPage < pages
      : false;

    void page;
    return { total, hasMore, items };
  }

  async function search(q, page, deps = {}) {
    const key = process.env.FLICKR_KEY;
    if (typeof key !== 'string' || key === '') {
      const err = new Error(`${name} needs FLICKR_KEY in .env`);
      err.code = 'NEEDS_KEY';
      throw err;
    }

    const doFetch = deps.fetchJson ?? fetchJson;
    const json = await doFetch(buildSearchUrl({ key, q, page, extraParams }));
    return parseSearch(json, page);
  }

  return {
    id,
    name,
    homepage,
    group: 'aggregators',
    keyEnv: 'FLICKR_KEY',
    normalize,
    parseSearch,
    search,
  };
}
