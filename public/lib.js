/**
 * Shared browser helpers for Open Library Fetch.
 */

/**
 * Fallback source groups when `GET /api/groups` fails.
 * @type {Array<{id:string,label:string}>}
 */
export const DEFAULT_GROUPS = [
  { id: 'aggregators', label: 'Open-licence aggregators' },
  { id: 'museums', label: 'Museums and galleries' },
  { id: 'libraries', label: 'Libraries and archives' },
  { id: 'science', label: 'Science, nature and medicine' },
];

/** Source ids that existed before saved selections recorded `known` ids. */
const LEGACY_SOURCE_IDS = [
  'commons',
  'europeana',
  'archive',
  'loc',
  'smithsonian',
  'rijksmuseum',
  'met',
  'nypl',
  'nasa',
  'nga',
  'cleveland',
  'smk',
  'mia',
  'wellcome',
  'openverse',
];

const EMPTY_SUBTITLE = 'Search open image libraries and download the full resolution.';

/**
 * A source can be searched without a key, or its key is configured.
 * @param {object} source
 * @returns {boolean}
 */
export function isUsable(source) {
  return !(source?.needsKey && !source?.keyConfigured);
}

/**
 * A source can be searched, also with the open licence filter.
 * @param {object} source
 * @param {boolean} [openOnly]
 * @returns {boolean}
 */
export function isSearchable(source, openOnly) {
  if (!isUsable(source)) return false;
  if (openOnly === true && source?.openLicenses === false) return false;
  return true;
}

/**
 * Image URLs to try for one item, best first, without duplicates.
 * @param {object} item
 * @returns {string[]}
 */
export function imageCandidates(item) {
  const list = [item?.preview, item?.previewFallback, item?.thumb, item?.thumbFallback];
  const result = [];
  for (const value of list) {
    if (typeof value !== 'string' || value === '') continue;
    if (result.includes(value)) continue;
    result.push(value);
  }
  return result;
}

/** Time limit for one viewer probe. */
export const VIEWER_PROBE_TIMEOUT_MS = 20000;

/**
 * Split the image URLs of one item into the small (cached) and large groups.
 * @param {object|null|undefined} item
 * @returns {{small: string[], large: string[]}}
 */
export function viewerPlan(item) {
  const small = [];
  for (const value of [item?.thumb, item?.thumbFallback]) {
    if (typeof value !== 'string' || value === '') continue;
    if (!small.includes(value)) small.push(value);
  }

  const large = [];
  for (const value of [item?.preview, item?.previewFallback]) {
    if (typeof value !== 'string' || value === '') continue;
    if (small.includes(value) || large.includes(value)) continue;
    large.push(value);
  }

  return { small, large };
}

/**
 * Return the first URL whose probe answers `true`.
 * Each probe has its own AbortSignal and a time limit. A probe that runs out of
 * time is aborted and the next URL is tried. An aborted outer signal stops all
 * work and returns null.
 * @param {string[]} urls
 * @param {(url: string, signal: AbortSignal) => Promise<boolean>} probe
 * @param {{timeoutMs?: number, signal?: AbortSignal}} [options]
 * @returns {Promise<string|null>}
 */
export async function firstLoaded(
  urls,
  probe,
  { timeoutMs = VIEWER_PROBE_TIMEOUT_MS, signal } = {},
) {
  const list = Array.isArray(urls) ? urls : [];
  if (signal?.aborted) return null;

  for (const url of list) {
    if (signal?.aborted) return null;

    const controller = new AbortController();
    let timer = 0;
    let onOuterAbort = null;

    const outcome = await new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const cleanup = () => {
        if (timer) {
          clearTimeout(timer);
          timer = 0;
        }
        if (onOuterAbort && signal) {
          signal.removeEventListener('abort', onOuterAbort);
        }
      };

      if (signal) {
        onOuterAbort = () => {
          controller.abort();
          cleanup();
          finish('aborted');
        };
        signal.addEventListener('abort', onOuterAbort, { once: true });
      }

      timer = setTimeout(() => {
        cleanup();
        controller.abort();
        finish('timeout');
      }, timeoutMs);

      Promise.resolve()
        .then(() => probe(url, controller.signal))
        .then((ok) => {
          cleanup();
          finish(ok === true ? 'loaded' : 'failed');
        })
        .catch(() => {
          cleanup();
          finish('failed');
        });
    });

    if (outcome === 'aborted') {
      controller.abort();
      return null;
    }
    if (outcome === 'timeout') continue;
    if (outcome === 'loaded') return url;
  }

  return null;
}

/**
 * Build the display rows for the source bar.
 * Empty groups are left out. Sources with an unknown group id go to "Other".
 * @param {object[]} registry
 * @param {Array<{id:string,label:string}>} [groups]
 * @returns {Array<{id:string,label:string,sources:object[]}>}
 */
export function groupSources(registry, groups = DEFAULT_GROUPS) {
  const list = Array.isArray(registry) ? registry : [];
  const known =
    Array.isArray(groups) && groups.length > 0 ? groups : DEFAULT_GROUPS;
  const rows = known.map((group) => ({
    id: group.id,
    label: group.label,
    sources: [],
  }));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const other = { id: 'other', label: 'Other', sources: [] };

  for (const source of list) {
    if (!source || typeof source.id !== 'string') continue;
    const row = byId.get(source.group);
    if (row) row.sources.push(source);
    else other.sources.push(source);
  }

  const result = rows.filter((row) => row.sources.length > 0);
  if (other.sources.length > 0) result.push(other);
  return result;
}

/**
 * Header subtitle with the number of usable sources.
 * @param {object[]} registry
 * @returns {string}
 */
export function subtitleText(registry) {
  const list = Array.isArray(registry) ? registry : [];
  if (list.length === 0) return EMPTY_SUBTITLE;

  const usable = list.filter(isUsable).length;
  const missing = list.length - usable;
  const base = `Search ${usable} open image libraries and download the full resolution`;
  if (missing === 0) return `${base}.`;
  const more = missing === 1 ? '1 more needs a key' : `${missing} more need a key`;
  return `${base} (${more}).`;
}

function registryInfo(registry) {
  const list = Array.isArray(registry) ? registry : [];
  return {
    list,
    byId: new Map(
      list
        .filter((source) => source && typeof source.id === 'string')
        .map((source) => [source.id, source]),
    ),
  };
}

/**
 * Read the saved selection in either the new or the old format.
 * Returns null when nothing usable was saved, so the caller uses its default.
 * @param {string|null|undefined} raw
 * @param {object[]} registry
 * @returns {string[]|null}
 */
export function parseSavedSelection(raw, registry) {
  if (typeof raw !== 'string' || raw === '') return null;

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }

  const { list, byId } = registryInfo(registry);
  const usableIds = new Set(list.filter(isUsable).map((source) => source.id));
  let candidates;

  if (Array.isArray(data)) {
    candidates = data.filter((id) => typeof id === 'string');
    const known = new Set(LEGACY_SOURCE_IDS);
    for (const source of list) {
      if (isUsable(source) && !known.has(source.id)) candidates.push(source.id);
    }
  } else if (data && typeof data === 'object' && Array.isArray(data.selected)) {
    const known = new Set(
      Array.isArray(data.known)
        ? data.known.filter((id) => typeof id === 'string')
        : [],
    );
    candidates = data.selected.filter((id) => typeof id === 'string');
    for (const source of list) {
      if (isUsable(source) && !known.has(source.id)) candidates.push(source.id);
    }
  } else {
    return null;
  }

  const result = [];
  const seen = new Set();
  for (const id of candidates) {
    if (typeof id !== 'string') continue;
    if (!byId.has(id) || !usableIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

/**
 * Serialize the selection together with the known source ids.
 * @param {Iterable<string>} selectedIds
 * @param {object[]} registry
 * @returns {string}
 */
export function serializeSelection(selectedIds, registry) {
  const { list, byId } = registryInfo(registry);
  const chosen = [];
  const seen = new Set();
  for (const id of selectedIds ?? []) {
    if (typeof id !== 'string' || seen.has(id) || !byId.has(id)) continue;
    seen.add(id);
    chosen.push(id);
  }
  return JSON.stringify({
    selected: chosen,
    known: list.map((source) => source.id),
  });
}

/**
 * Build the local download URL for an item.
 * `url` replaces `item.full` as the remote URL when it is a non-empty string.
 * @param {object} item
 * @param {string} [url]
 * @returns {string}
 */
export function downloadUrl(item, url) {
  const params = new URLSearchParams();
  params.set('source', item.source ?? '');
  params.set('id', item.id ?? '');
  params.set('title', item.title ?? '');
  const target = typeof url === 'string' && url !== '' ? url : item.full;
  if (target && item.source !== 'europeana') {
    params.set('url', target);
  }
  return `/api/download?${params.toString()}`;
}

/**
 * Stable identity of one item across sources.
 * @param {object} item
 * @returns {string}
 */
export function itemKey(item) {
  return `${item.source}:${item.id}`;
}

/**
 * Create a DOM element.
 * `attrs` supports `class`, `text`, `dataset`, regular attributes and
 * `on<Event>` listener functions. `children` may contain nodes or strings.
 * @param {string} tag
 * @param {Record<string, unknown>} [attrs]
 * @param {Array<Node|string>} [children]
 * @returns {HTMLElement}
 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;

    if (key === 'class') {
      node.className = String(value);
    } else if (key === 'text') {
      node.textContent = String(value);
    } else if (key === 'dataset' && typeof value === 'object') {
      Object.assign(node.dataset, value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (typeof value === 'boolean') {
      if (value) node.setAttribute(key, '');
    } else {
      node.setAttribute(key, String(value));
    }
  }

  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === undefined || child === null) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }

  return node;
}

/**
 * Decide whether the sentinel may trigger another automatic page load.
 * When the last automatic load produced no new visible cards and the allowed
 * retries are used up, the caller should wait for a manual "Load more".
 * @param {object} options
 * @param {number} options.visibleNow
 * @param {number|null} options.visibleAtLastAutoLoad
 * @param {number} options.autoLoadsWithoutGain
 * @param {number} [options.maxWithoutGain]
 * @returns {boolean}
 */
export function shouldAutoLoad({
  visibleNow,
  visibleAtLastAutoLoad,
  autoLoadsWithoutGain,
  maxWithoutGain = 1,
}) {
  if (
    typeof visibleAtLastAutoLoad === 'number' &&
    visibleNow <= visibleAtLastAutoLoad &&
    autoLoadsWithoutGain >= maxWithoutGain
  ) {
    return false;
  }
  return true;
}

/**
 * Wait for a number of milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
