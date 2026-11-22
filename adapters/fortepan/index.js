import { fetchJson } from '../../lib/http.js';
import { cleanText } from '../../lib/util.js';

export const id = 'fortepan';

export const SEARCH_URL = 'https://fortepan.hu/api/elastic/prod/media/_search';
export const PAGE_SIZE = 24;

const IMAGE_BASE = 'https://fortepan.download/file/fortepan-eu';
const LICENSE = 'CC BY-SA 3.0';
const LICENSE_URL = 'https://creativecommons.org/licenses/by-sa/3.0/';

export function foldQuery(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function currentPage(page) {
  return typeof page === 'number' && Number.isFinite(page) && page >= 1 ? page : 1;
}

export function buildSearchBody(q, page) {
  const p = currentPage(page);
  return {
    size: PAGE_SIZE,
    from: (p - 1) * PAGE_SIZE,
    track_total_hits: true,
    query: {
      bool: {
        must: [
          {
            multi_match: {
              query: foldQuery(q),
              fields: [
                'description_search',
                'cimke_en_search',
                'orszag_en_search',
                'varos_en_search',
                'helyszin_en_search',
                'szerzo_search',
              ],
              type: 'bool_prefix',
              operator: 'and',
            },
          },
        ],
      },
    },
  };
}

function firstValue(value) {
  if (!Array.isArray(value)) return value ?? null;
  for (const entry of value) {
    if (entry === null || entry === undefined) continue;
    if (typeof entry === 'string' && entry.trim() === '') continue;
    return entry;
  }
  return null;
}

function firstText(value) {
  const raw = firstValue(value);
  return raw === null ? null : String(raw);
}

function titleOf(source, mid) {
  const description = cleanText(source.description, 600);
  if (description !== null) return description;

  const tags = Array.isArray(source.cimke_en)
    ? source.cimke_en
        .filter((value) => value !== null && value !== undefined && String(value).trim() !== '')
        .map((value) => String(value))
    : [];
  const parts = [];
  if (tags.length > 0) parts.push(tags.join(', '));

  const city = firstText(source.varos_en);
  if (city !== null) parts.push(city);

  const year = firstText(source.year);
  if (year !== null) parts.push(year);

  if (parts.length > 0) return parts.join(' · ');
  return `Fortepan ${mid}`;
}

export function normalize(source) {
  if (!source || typeof source !== 'object') return null;

  const mid = firstText(source.mid);
  if (mid === null) return null;

  const donor = firstText(source.adomanyozo_name);
  const photographer = firstText(source.szerzo_name);
  const year = firstText(source.year);

  return {
    source: id,
    id: mid,
    title: titleOf(source, mid),
    creator: donor === null ? 'FORTEPAN' : `FORTEPAN / ${donor}`,
    description: photographer === null ? null : `Photographer: ${photographer}`,
    date: year === null ? null : year,
    thumb: `${IMAGE_BASE}/480/fortepan_${mid}.jpg`,
    preview: `${IMAGE_BASE}/1600/fortepan_${mid}.jpg`,
    full: `${IMAGE_BASE}/download/fortepan_${mid}.jpg`,
    width: null,
    height: null,
    license: LICENSE,
    licenseUrl: LICENSE_URL,
    pageUrl: `https://fortepan.hu/en/photos/?id=${mid}`,
  };
}

export function parseSearch(json, page) {
  const p = currentPage(page);
  const hits = Array.isArray(json?.hits?.hits) ? json.hits.hits : [];
  const rawTotal = json?.hits?.total?.value;
  const total = Number.isFinite(rawTotal) ? rawTotal : 0;

  return {
    total,
    hasMore: (p - 1) * PAGE_SIZE + hits.length < total,
    items: hits
      .map((hit) => normalize(hit?._source))
      .filter((item) => item !== null),
  };
}

export async function search(q, page, deps = {}) {
  const query = foldQuery(q);
  if (query === '') return { total: 0, hasMore: false, items: [] };

  const doFetch = deps.fetchJson ?? fetchJson;
  const body = JSON.stringify(buildSearchBody(query, page));
  const json = await doFetch(SEARCH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  return parseSearch(json, page);
}
