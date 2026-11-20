import { cleanText } from '../util.js';

export const IIIF_PREFIX = 'https://tile.loc.gov/image-services/iiif/service:pnp:';
export const SITE = 'https://www.loc.gov';
export const LICENSE = 'Free to use (no known restrictions)';
export const LICENSE_URL = 'https://www.loc.gov/free-to-use/';

const MAX_DESCRIPTION = 600;
const MAX_TITLE = 200;
const RESOURCE_MARKER = '/resource/';
const SET_URL_PREFIX = 'https://www.loc.gov/free-to-use/';

function positiveNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return number;
}

export function parseResourceId(link) {
  if (typeof link !== 'string') return null;
  const marker = link.indexOf(RESOURCE_MARKER);
  if (marker === -1) return null;

  const rest = link.slice(marker + RESOURCE_MARKER.length);
  const pathEnd = rest.search(/[/?#]/);
  const resourceId = pathEnd === -1 ? rest : rest.slice(0, pathEnd);
  if (resourceId === '') return null;

  const queryStart = link.indexOf('?');
  if (queryStart !== -1) {
    const params = new URLSearchParams(link.slice(queryStart + 1));
    const sp = params.get('sp');
    if (sp) return `${resourceId}~sp=${sp}`;
  }

  return resourceId;
}

export function splitTitle(rawTitle) {
  const text = cleanText(rawTitle, MAX_DESCRIPTION);
  if (text === null) return { title: 'Untitled', creator: null };

  const position = text.lastIndexOf('. ');
  if (position !== -1) {
    const creator = text.slice(position + 2).trim();
    if (creator.endsWith('Division')) {
      const title = text.slice(0, position).trim();
      if (title !== '') return { title, creator };
    }
  }

  return { title: text, creator: null };
}

export function iiifCandidates(itemId) {
  if (typeof itemId !== 'string') return [];

  let match = /^([a-z]+)\.(\d{5})$/.exec(itemId);
  if (match) {
    const [, coll, digits] = match;
    const bucket = `${digits.slice(0, 3)}00`;
    const base = `${IIIF_PREFIX}${coll}:${bucket}:${digits}`;
    return [base, `${base}v`];
  }

  match = /^([a-z]+)\.(\d[a-z])(\d{5})$/.exec(itemId);
  if (match) {
    const [, coll, prefix, digits] = match;
    const one = `${prefix}${digits.slice(0, 1)}0000`;
    const two = `${prefix}${digits.slice(0, 2)}000`;
    const three = `${prefix}${digits.slice(0, 3)}00`;
    const full = `${prefix}${digits}`;
    const base = `${IIIF_PREFIX}${coll}:${one}:${two}:${three}:${full}`;
    return [base, `${base}v`];
  }

  return [];
}

function absoluteUrl(value) {
  if (typeof value !== 'string' || value === '') return null;
  if (value.startsWith('/')) return `${SITE}${value}`;
  if (value.startsWith('https://')) return value;
  return null;
}

export function normalize(raw, setTitles = []) {
  if (!raw || typeof raw !== 'object') return null;

  const resourceId = parseResourceId(raw.link);
  if (resourceId === null) return null;

  const image = absoluteUrl(raw.image);
  if (image === null) return null;

  const pageUrl = absoluteUrl(raw.link);
  if (pageUrl === null) return null;

  const { title, creator } = splitTitle(raw.title);

  const sets = Array.isArray(setTitles)
    ? setTitles.filter((entry) => typeof entry === 'string')
    : [];

  return {
    source: 'loc',
    id: resourceId,
    title,
    creator,
    date: null,
    description: cleanText(raw.alt, MAX_DESCRIPTION),
    thumb: image,
    preview: image,
    full: image,
    width: null,
    height: null,
    license: LICENSE,
    licenseUrl: LICENSE_URL,
    pageUrl,
    sets: [...sets],
  };
}

export function applyIiif(item, info) {
  const copy = { ...item };
  if (!info || typeof info !== 'object' || !info.base) return copy;

  const base = String(info.base);
  const full = `${base}/full/full/0/default.jpg`;
  const width = positiveNumber(info.width);
  const height = positiveNumber(info.height);

  return {
    ...copy,
    preview: width !== null && width > 1600 ? `${base}/full/1600,/0/default.jpg` : full,
    full,
    width,
    height,
  };
}

export function parseSetList(json) {
  const results = json?.content?.components?.[0]?.results;
  if (!Array.isArray(results)) return [];

  const sets = [];
  for (const entry of results) {
    if (!entry || typeof entry !== 'object') continue;
    const title = cleanText(entry.title, MAX_TITLE);
    if (title === null) continue;
    if (typeof entry.url !== 'string') continue;
    if (!entry.url.startsWith(SET_URL_PREFIX)) continue;
    sets.push({ title, url: entry.url });
  }
  return sets;
}

export function parseSet(json) {
  const title = cleanText(json?.content?.title, MAX_TITLE);

  const items = [];
  const components = json?.content?.components;
  if (Array.isArray(components)) {
    for (const component of components) {
      const gallery = component?.masonry_gallery;
      if (!Array.isArray(gallery)) continue;
      for (const group of gallery) {
        const groupItems = group?.items;
        if (!Array.isArray(groupItems)) continue;
        for (const item of groupItems) {
          if (item && typeof item === 'object') items.push(item);
        }
      }
    }
  }

  return { title, items };
}

export function buildIndex(sets) {
  const items = [];
  const texts = [];
  const titles = [];
  const byKey = new Map();

  const list = Array.isArray(sets) ? sets : [];
  for (const set of list) {
    const setTitle = set?.title;
    const setItems = Array.isArray(set?.items) ? set.items : [];

    for (const raw of setItems) {
      const key = parseResourceId(raw?.link);
      if (key === null) continue;

      const existing = byKey.get(key);
      if (existing) {
        if (typeof setTitle === 'string' && !existing.sets.includes(setTitle)) {
          existing.sets.push(setTitle);
        }
        continue;
      }

      const item = normalize(raw, typeof setTitle === 'string' ? [setTitle] : []);
      if (!item) continue;

      byKey.set(key, item);
      items.push(item);
    }
  }

  for (const item of items) {
    const text = [item.title, item.creator, item.description, ...item.sets]
      .filter((value) => value !== null && value !== undefined && value !== '')
      .join(' ');
    texts.push(text.toLowerCase());
    titles.push(item.title.toLowerCase());
  }

  return { items, texts, titles };
}

export { searchIndex } from './nga.js';
