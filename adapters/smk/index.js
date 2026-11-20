import { fetchJson } from '../../lib/http.js';
import { cleanText } from '../../lib/util.js';

export const id = 'smk';

const PAGE_SIZE = 24;
const SEARCH_URL = 'https://api.smk.dk/api/v1/art/search/';
const FILTERS = '%5Bhas_image:true%5D,%5Bpublic_domain:true%5D';

function toDimension(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function chooseTitle(titles) {
  if (!Array.isArray(titles) || titles.length === 0) return 'Untitled';
  const english = titles.find(
    (entry) => entry?.language === 'engelsk' && typeof entry?.title === 'string' && entry.title !== '',
  );
  if (english) return english.title;
  const first = titles[0]?.title;
  return typeof first === 'string' && first !== '' ? first : 'Untitled';
}

function chooseCreator(production) {
  const p = Array.isArray(production) ? production[0] : null;
  if (!p) return null;
  const forename = typeof p.creator_forename === 'string' ? p.creator_forename.trim() : '';
  const surname = typeof p.creator_surname === 'string' ? p.creator_surname.trim() : '';
  if (forename !== '' && surname !== '') return `${forename} ${surname}`;
  if (typeof p.creator === 'string' && p.creator !== '') return p.creator;
  return null;
}

export function normalize(record) {
  if (!record || typeof record !== 'object') return null;

  const native =
    typeof record.image_native === 'string' && record.image_native !== ''
      ? record.image_native
      : null;
  const iiifId =
    typeof record.image_iiif_id === 'string' && record.image_iiif_id !== ''
      ? record.image_iiif_id.replace(/\/+$/, '')
      : null;

  if (!native && !iiifId) return null;

  const thumb = iiifId ? `${iiifId}/full/400,/0/default.jpg` : native;
  const preview = iiifId ? `${iiifId}/full/1600,/0/default.jpg` : native;
  const full = native ?? iiifId;

  return {
    source: id,
    id: String(record.object_number ?? ''),
    title: chooseTitle(record.titles),
    creator: chooseCreator(record.production),
    date: record.production_date?.[0]?.period || null,
    description: cleanText(record.content_description?.[0]),
    thumb,
    preview,
    full,
    width: toDimension(record.image_width),
    height: toDimension(record.image_height),
    license: 'Public domain',
    licenseUrl: typeof record.rights === 'string' && record.rights !== '' ? record.rights : null,
    pageUrl: record.frontend_url ?? null,
  };
}

export function parseSearch(json, page = 1) {
  const total = typeof json?.found === 'number' ? json.found : null;
  const rawItems = Array.isArray(json?.items) ? json.items : [];
  const items = rawItems.map((record) => normalize(record)).filter((item) => item !== null);
  const currentPage = Math.max(1, Number(page) || 1);
  const offset = (currentPage - 1) * PAGE_SIZE;
  const hasMore = total !== null && offset + rawItems.length < total;

  return { total, hasMore, items };
}

export async function search(q, page, deps = {}) {
  const doFetch = deps.fetchJson ?? fetchJson;
  const currentPage = Math.max(1, Number(page) || 1);
  const offset = (currentPage - 1) * PAGE_SIZE;
  const url =
    `${SEARCH_URL}?keys=${encodeURIComponent(q ?? '')}` +
    `&filters=${FILTERS}&offset=${offset}&rows=${PAGE_SIZE}&lang=en`;

  const json = await doFetch(url);
  return parseSearch(json, currentPage);
}
