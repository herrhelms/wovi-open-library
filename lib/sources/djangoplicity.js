import { fetchWithTimeout } from '../http.js';
import { cleanText, stripHtml } from '../util.js';

const LIST_MARKER = 'var images = [';
const ID_PATTERN = /^[a-z0-9_-]+$/i;
const LICENSE = 'CC BY 4.0';
const LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/';

export const SEARCH_TIMEOUT_MS = 45000;
export const ITEM_TIMEOUT_MS = 30000;

function isWhitespace(ch) {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v';
}

function readString(text, start) {
  let i = start + 1;
  let value = '';
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\') {
      const next = text[i + 1];
      if (next === "'" || next === '\\') {
        value += next;
        i += 2;
        continue;
      }
      value += ch;
      i += 1;
      continue;
    }
    if (ch === "'") return { value, end: i + 1 };
    value += ch;
    i += 1;
  }
  return null;
}

function readObject(text, start) {
  const obj = {};
  let i = start + 1;
  const n = text.length;
  const skip = () => {
    while (i < n && isWhitespace(text[i])) i += 1;
  };

  while (i < n) {
    skip();
    if (i >= n) return null;
    const ch = text[i];
    if (ch === '}') return { value: obj, end: i + 1 };
    if (ch === ',') {
      i += 1;
      continue;
    }

    const keyMatch = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(text.slice(i, i + 64));
    if (!keyMatch) return null;
    const key = keyMatch[0];
    i += key.length;
    skip();
    if (text[i] !== ':') return null;
    i += 1;
    skip();

    const valueStart = text[i];
    if (valueStart === "'") {
      const parsed = readString(text, i);
      if (parsed === null) return null;
      obj[key] = parsed.value;
      i = parsed.end;
    } else if (valueStart === '-' || (valueStart >= '0' && valueStart <= '9')) {
      const numberMatch = /^-?\d+(?:\.\d+)?/.exec(text.slice(i, i + 64));
      if (!numberMatch) return null;
      obj[key] = Number(numberMatch[0]);
      i += numberMatch[0].length;
    } else {
      return null;
    }

    skip();
    if (text[i] === ',') {
      i += 1;
      continue;
    }
    if (text[i] === '}') return { value: obj, end: i + 1 };
    return null;
  }

  return null;
}

export function parseImageList(html) {
  const text = String(html ?? '');
  const markerIndex = text.indexOf(LIST_MARKER);
  if (markerIndex === -1) return [];

  const results = [];
  let i = markerIndex + LIST_MARKER.length;
  const n = text.length;
  const skip = () => {
    while (i < n && isWhitespace(text[i])) i += 1;
  };

  while (i < n) {
    skip();
    if (i >= n) break;
    const ch = text[i];
    if (ch === ']') break;
    if (ch === ',') {
      i += 1;
      continue;
    }
    if (ch !== '{') break;

    const parsed = readObject(text, i);
    if (parsed === null) break;
    const entry = parsed.value;
    if (typeof entry.title === 'string') entry.title = stripHtml(entry.title);
    results.push(entry);
    i = parsed.end;

    skip();
    if (text[i] === ']') break;
    if (text[i] === ',') {
      i += 1;
      continue;
    }
    if (i >= n) break;
    break;
  }

  return results;
}

export function parseTotal(html) {
  const match = /Showing\s+[^<]*?of\s+([\d,]+)/.exec(String(html ?? ''));
  if (!match) return null;
  const total = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(total) ? total : null;
}

export function parseFormats(html, origin) {
  const text = String(html ?? '');
  const formats = [];
  const pattern = /<span class="archive_dl_text"><a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const href = match[1];
    let url;
    try {
      url = new URL(href, origin).href;
    } catch {
      continue;
    }
    if (!/^https?:\/\//i.test(url)) continue;
    formats.push({ url, label: stripHtml(match[2]) });
  }
  return formats;
}

function findFormat(formats, predicate) {
  for (const format of formats) {
    try {
      const path = new URL(format.url).pathname;
      if (predicate(path)) return format.url;
    } catch {
      continue;
    }
  }
  return null;
}

export function pickDownload(formats) {
  const list = Array.isArray(formats) ? formats : [];
  return (
    findFormat(list, (path) => path.includes('/large/') && path.toLowerCase().endsWith('.jpg')) ??
    findFormat(list, (path) => path.includes('/publicationjpg/')) ??
    findFormat(list, (path) => path.includes('/screen/')) ??
    null
  );
}

export function createDjangoplicitySource({ id, name, homepage, origin, imagesPath, cdn, creator }) {
  function buildSearchUrl(q, page) {
    const currentPage = Math.max(1, Number(page) || 1);
    const query = `?search=${encodeURIComponent(q ?? '')}`;
    if (currentPage === 1) return `${origin}${imagesPath}${query}`;
    return `${origin}${imagesPath}page/${currentPage}/${query}`;
  }

  function buildItemUrl(itemId) {
    return `${origin}${imagesPath}${itemId}/`;
  }

  function normalize(entry) {
    if (!entry || entry.id === null || entry.id === undefined || entry.id === '') return null;
    const itemId = String(entry.id);
    const title = cleanText(entry.title) ?? itemId;
    const thumb = typeof entry.src === 'string' && entry.src !== '' ? entry.src : null;
    const pageUrl =
      typeof entry.url === 'string' && entry.url !== ''
        ? new URL(entry.url, origin).href
        : buildItemUrl(itemId);
    const screen = `${cdn}screen/${itemId}.jpg`;
    const width = Number.isFinite(entry.width) ? entry.width : null;
    const preview =
      width === null
        ? screen
        : width > 4000
          ? `${cdn}publicationjpg/${itemId}.jpg`
          : `${cdn}large/${itemId}.jpg`;

    const item = {
      source: id,
      id: itemId,
      title,
      creator,
      date: null,
      description: null,
      thumb,
      preview,
      full: null,
      width,
      height: Number.isFinite(entry.height) ? entry.height : null,
      license: LICENSE,
      licenseUrl: LICENSE_URL,
      pageUrl,
    };
    if (preview !== screen) item.previewFallback = screen;
    return item;
  }

  function parseSearch(html, page) {
    const list = parseImageList(html);
    const items = list.map((entry) => normalize(entry)).filter((item) => item !== null);
    return {
      total: parseTotal(html),
      hasMore: list.length >= 50,
      items,
    };
  }

  async function search(q, page, deps = {}) {
    const doFetch = deps.fetch ?? fetchWithTimeout;
    const res = await doFetch(buildSearchUrl(q, page), {
      timeoutMs: SEARCH_TIMEOUT_MS,
      headers: { Accept: 'text/html' },
    });
    if (res.status !== 200) {
      try {
        await res.body?.cancel();
      } catch {
        // Ignore a failing cancel and keep the original error.
      }
      throw new Error(`${name} answered HTTP ${res.status}`);
    }
    const html = await res.text();
    return parseSearch(html, page);
  }

  async function resolveDownload(itemId, deps = {}) {
    if (typeof itemId !== 'string' || !ID_PATTERN.test(itemId)) {
      const err = new Error('Invalid item id');
      err.status = 400;
      throw err;
    }

    const doFetch = deps.fetch ?? fetchWithTimeout;
    const res = await doFetch(buildItemUrl(itemId), {
      timeoutMs: ITEM_TIMEOUT_MS,
      headers: { Accept: 'text/html' },
    });
    if (res.status !== 200) {
      try {
        await res.body?.cancel();
      } catch {
        // Ignore a failing cancel and keep the original error.
      }
      throw new Error(`${name} answered HTTP ${res.status}`);
    }
    const html = await res.text();
    const formats = parseFormats(html, origin);
    const url = pickDownload(formats);
    if (!url) throw new Error(`No JPEG download found for ${itemId}`);
    return { url, filename: itemId };
  }

  return {
    id,
    name,
    homepage,
    group: 'science',
    keyEnv: null,
    normalize,
    parseSearch,
    search,
    resolveDownload,
    buildSearchUrl,
    buildItemUrl,
  };
}
