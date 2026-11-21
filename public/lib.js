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
 * `small` is the grid candidate list. `large` keeps `preview` and
 * `previewFallback`, without repeats and without the thumbnail URLs.
 * @param {object|null|undefined} item
 * @returns {{small: string[], large: string[]}}
 */
export function viewerPlan(item) {
  const small = thumbCandidates(item);

  const large = [];
  for (const value of [item?.preview, item?.previewFallback]) {
    if (typeof value !== 'string' || value === '') continue;
    if (value === item?.thumb || value === item?.thumbSource) continue;
    if (large.includes(value)) continue;
    large.push(value);
  }

  return { small, large };
}

/**
 * Image URLs to try for a card, best first, without empty values or repeats.
 * @param {object|null|undefined} item
 * @returns {string[]}
 */
export function thumbCandidates(item) {
  const list = [item?.thumb, item?.thumbSource, item?.thumbFallback];
  const result = [];
  for (const value of list) {
    if (typeof value !== 'string' || value === '') continue;
    if (result.includes(value)) continue;
    result.push(value);
  }
  return result;
}

/**
 * Number of masonry columns that fit into a container.
 * A width that is not a finite number greater than 0 gives 1. A gap that is
 * not a finite number >= 0 counts as 0.
 * @param {number} containerWidth
 * @param {number} [minColumnWidth]
 * @param {number} [gap]
 * @returns {number}
 */
export function columnCount(containerWidth, minColumnWidth = 240, gap = 0) {
  const safeGap = typeof gap === 'number' && Number.isFinite(gap) && gap >= 0 ? gap : 0;
  if (
    typeof containerWidth !== 'number' ||
    !Number.isFinite(containerWidth) ||
    containerWidth <= 0
  ) {
    return 1;
  }
  const count = Math.floor((containerWidth + safeGap) / (minColumnWidth + safeGap));
  return Math.max(1, count);
}

/**
 * Index of the first column with the smallest height.
 * An empty list or a value that is not an array gives 0.
 * @param {number[]} heights
 * @returns {number}
 */
export function pickColumn(heights) {
  if (!Array.isArray(heights) || heights.length === 0) return 0;
  let best = 0;
  for (let index = 1; index < heights.length; index += 1) {
    if (heights[index] < heights[best]) best = index;
  }
  return best;
}

/**
 * Rough height of a card in a column of the given width.
 * Uses the image aspect ratio when the item has a positive width and height,
 * else a square image. Adds 72 px for the card text.
 * @param {object|null|undefined} item
 * @param {number} columnWidth
 * @returns {number}
 */
export function estimateCardHeight(item, columnWidth) {
  const width = Number(item?.width);
  const height = Number(item?.height);
  if (
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0
  ) {
    return (columnWidth * height) / width + 72;
  }
  return columnWidth + 72;
}

/**
 * Put cards into columns, shortest column first.
 * Returns one column index for each height, in input order.
 * A column count below 1 counts as 1.
 * @param {number[]} heights
 * @param {number} columnCount
 * @param {number} [gap]
 * @returns {number[]}
 */
export function distribute(heights, columnCount, gap = 0) {
  const list = Array.isArray(heights) ? heights : [];
  const count =
    typeof columnCount === 'number' && Number.isFinite(columnCount) && columnCount >= 1
      ? Math.floor(columnCount)
      : 1;
  const safeGap = typeof gap === 'number' && Number.isFinite(gap) && gap >= 0 ? gap : 0;
  const columnHeights = new Array(count).fill(0);
  const result = [];
  for (let index = 0; index < list.length; index += 1) {
    const column = pickColumn(columnHeights);
    result.push(column);
    columnHeights[column] += list[index] + safeGap;
  }
  return result;
}

/**
 * Decide whether a candidate image is wider than the shown image.
 * A shown width that is not a finite number greater than 0 counts as 0, so any
 * candidate with a positive width is an upgrade.
 * @param {number} shownWidth
 * @param {number} candidateWidth
 * @returns {boolean}
 */
export function isUpgrade(shownWidth, candidateWidth) {
  if (typeof candidateWidth !== 'number' || !Number.isFinite(candidateWidth)) {
    return false;
  }
  if (candidateWidth <= 0) return false;
  const shown =
    typeof shownWidth === 'number' && Number.isFinite(shownWidth) && shownWidth > 0
      ? shownWidth
      : 0;
  return shown === 0 || candidateWidth > shown;
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
 * Uses `uid` when it is a non-empty string, else `source:id`.
 * @param {object} item
 * @returns {string}
 */
export function itemKey(item) {
  if (typeof item?.uid === 'string' && item.uid !== '') return item.uid;
  return `${item?.source}:${item?.id}`;
}

/**
 * Key for one search in the browser card cache.
 * The open-licence filter is part of the key, so both variants stay separate.
 * @param {boolean} openOnly
 * @param {string} query
 * @returns {string}
 */
export function searchKey(openOnly, query) {
  return `${openOnly ? 1 : 0}|${query}`;
}

/**
 * Set a key in a map and keep the map at or below `max` entries.
 * An existing key is removed first, so that it becomes the newest entry.
 * The oldest keys are removed first. Only the given map changes.
 * @param {Map<string, unknown>} map
 * @param {string} key
 * @param {unknown} value
 * @param {number} [max]
 * @returns {void}
 */
export function rememberLimited(map, key, value, max = 10) {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  while (map.size > max) {
    const oldest = map.keys().next().value;
    map.delete(oldest);
  }
}

/**
 * Key state of one adaptor for the settings modal.
 * A missing or `null` key gives `none`. A configured key gives `set`.
 * A required key that is not configured gives `missing`. Any other key gives
 * `optional`; the text names the demo key when one exists.
 * @param {object} adapter
 * @returns {{kind: 'none'|'set'|'missing'|'optional', text: string}}
 */
export function keyStatus(adapter) {
  const key = adapter?.key;
  if (!key) return { kind: 'none', text: 'No key needed' };
  if (key.configured === true) return { kind: 'set', text: 'Key set' };
  if (key.required !== false) {
    return { kind: 'missing', text: 'Key required, not set' };
  }
  const hasDemo = typeof key.default === 'string' && key.default !== '';
  return {
    kind: 'optional',
    text: hasDemo
      ? 'Optional key not set, uses demo key'
      : 'Optional key not set',
  };
}

/**
 * Filter adaptors by a search text. The text matches `name`, `id` or
 * `description`, without case. A trimmed empty text gives a copy of the list.
 * A `null` field does not match. A value that is not an array gives `[]`.
 * The order is unchanged.
 * @param {object[]} list
 * @param {string} text
 * @returns {object[]}
 */
export function filterAdapters(list, text) {
  if (!Array.isArray(list)) return [];
  const needle = typeof text === 'string' ? text.trim().toLowerCase() : '';
  if (needle === '') return list.slice();
  return list.filter((adapter) => {
    if (!adapter || typeof adapter !== 'object') return false;
    for (const field of [adapter.name, adapter.id, adapter.description]) {
      if (typeof field === 'string' && field.toLowerCase().includes(needle)) {
        return true;
      }
    }
    return false;
  });
}

/**
 * Number of adaptors with `enabled === true`.
 * A value that is not an array gives 0.
 * @param {object[]} list
 * @returns {number}
 */
export function countActive(list) {
  if (!Array.isArray(list)) return 0;
  let count = 0;
  for (const adapter of list) {
    if (adapter?.enabled === true) count += 1;
  }
  return count;
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
 * Delay before the next automatic retry, or null when no retry is done.
 * `attempt` is the number of retries already done for this code (0 before the
 * first retry). `random` is a number in [0, 1), as from `Math.random()`.
 * @param {string|null|undefined} code
 * @param {number|null|undefined} retryAfterSeconds
 * @param {number} attempt
 * @param {number} random
 * @returns {number|null}
 */
export function retryDelay(code, retryAfterSeconds, attempt, random) {
  const done = Number(attempt) || 0;
  if (code === 'PREPARING') {
    return done < 20 ? 15000 : null;
  }
  if (code === 'RATE_LIMIT') {
    if (done >= 3) return null;
    const seconds =
      typeof retryAfterSeconds === 'number' &&
      Number.isFinite(retryAfterSeconds) &&
      retryAfterSeconds > 0
        ? retryAfterSeconds
        : 0;
    const base = Math.max(seconds * 1000, 15000);
    const jitter = Math.floor((Number(random) || 0) * 3000);
    return base + jitter;
  }
  return null;
}

/**
 * Error list text while a rate limit retry waits.
 * @param {string|null|undefined} message
 * @param {number} seconds
 * @returns {string}
 */
export function rateLimitWaitText(message, seconds) {
  if (typeof message === 'string' && message.startsWith('Wikimedia Commons')) {
    return `Wikimedia Commons rate limit reached. Trying again in ${seconds} s.`;
  }
  return `Rate limit reached. Trying again in ${seconds} s.`;
}

/**
 * Number of saved items in a raw localStorage value.
 * Never throws; anything that is not a JSON array counts as 0.
 * @param {string|null|undefined} raw
 * @returns {number}
 */
export function savedCount(raw) {
  if (typeof raw !== 'string' || raw === '') return 0;

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return 0;
  }

  return Array.isArray(data) ? data.length : 0;
}

/**
 * Wait for a number of milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Keyboard hint for the search field shortcut.
 * @param {string} platform
 * @returns {'⌘K' | 'Ctrl K'}
 */
export function shortcutLabel(platform) {
  if (typeof platform !== 'string') return 'Ctrl K';
  return /mac|iphone|ipad/i.test(platform) ? '⌘K' : 'Ctrl K';
}

/**
 * Whether a keydown event is the search shortcut (Cmd/Ctrl + K).
 * @param {KeyboardEvent|object|null|undefined} event
 * @returns {boolean}
 */
export function isShortcut(event) {
  if (!event || typeof event !== 'object') return false;
  if (event.key !== 'k' && event.key !== 'K') return false;
  if (Boolean(event.metaKey) === Boolean(event.ctrlKey)) return false;
  return !event.altKey;
}

/**
 * Placeholder for the search field, with the number of usable sources.
 * @param {number} count
 * @returns {string}
 */
export function searchPlaceholder(count) {
  const generic = 'Search open libraries — prints, maps, specimens, stars…';
  if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) {
    return generic;
  }
  return `Search ${count.toLocaleString('en-US')} open libraries — prints, maps, specimens, stars…`;
}

/** Short labels for the source groups in the fieldset. */
const GROUP_SHORT_LABELS = {
  aggregators: 'Aggregators',
  museums: 'Museums & galleries',
  libraries: 'Libraries & archives',
  science: 'Science & nature',
};

/**
 * Short label for a source group, or the API label when there is no short one.
 * @param {string} id
 * @param {string} apiLabel
 * @returns {string}
 */
export function groupShortLabel(id, apiLabel) {
  if (typeof id === 'string' && Object.prototype.hasOwnProperty.call(GROUP_SHORT_LABELS, id)) {
    return GROUP_SHORT_LABELS[id];
  }
  return typeof apiLabel === 'string' ? apiLabel : '';
}

/**
 * Read a hit count from a Map or a plain object.
 * @param {Map<string, number|null>|Record<string, number|null>|null|undefined} hitsById
 * @param {string} id
 * @returns {unknown}
 */
function readHits(hitsById, id) {
  if (!hitsById || typeof hitsById !== 'object') return undefined;
  if (typeof hitsById.get === 'function') return hitsById.get(id);
  return hitsById[id];
}

/**
 * Sort chip ids for display inside a group: ids with a count first, by count
 * descending (stable for equal counts), then ids without a count in input order.
 * The input array is not changed.
 * @param {string[]} ids
 * @param {Map<string, number|null>|Record<string, number|null>} hitsById
 * @returns {string[]}
 */
export function sortChipIds(ids, hitsById) {
  const list = Array.isArray(ids) ? ids : [];
  const ranked = [];
  const unranked = [];

  list.forEach((id, index) => {
    const value = readHits(hitsById, id);
    if (typeof value === 'number' && Number.isFinite(value)) {
      ranked.push({ id, value, index });
    } else {
      unranked.push(id);
    }
  });

  ranked.sort((a, b) => b.value - a.value || a.index - b.index);
  return ranked.map((entry) => entry.id).concat(unranked);
}

/**
 * Total number of images for the results header.
 * `totals` holds the reported total of each searched source, or null when that
 * total is not known. The result is the sum of the numeric, finite, non-negative
 * values, but never less than `shown` (a non-number `shown` counts as 0).
 * @param {Array<number|null>} totals
 * @param {number} shown
 * @returns {number}
 */
export function imagesTotal(totals, shown) {
  const list = Array.isArray(totals) ? totals : [];
  let sum = 0;
  for (const value of list) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) continue;
    sum += value;
  }
  const floor =
    typeof shown === 'number' && Number.isFinite(shown) && shown > 0
      ? Math.floor(shown)
      : 0;
  return Math.max(sum, floor);
}

/**
 * Header text for a number of images: '1 image', else 'N images' with en-US
 * grouping. A value that is not a finite number counts as 0.
 * @param {number} total
 * @returns {string}
 */
export function imagesText(total) {
  const value = typeof total === 'number' && Number.isFinite(total) ? total : 0;
  if (value === 1) return '1 image';
  return `${value.toLocaleString('en-US')} images`;
}

/**
 * Build the segments of the results source bar.
 * Only entries with a positive hit count count. They are sorted by hits
 * descending, stable for equal counts. The first two keep their own segment;
 * all others merge into one "{N} other sources" segment. `share` is the part of
 * all hits, from 0 to 1. No entry with hits > 0 gives an empty list.
 * @param {Array<{name: string, hits: number|null}>} list
 * @returns {Array<{name: string, hits: number, share: number, tone: 'first'|'second'|'rest'}>}
 */
export function sourceBarSegments(list) {
  const entries = [];
  if (Array.isArray(list)) {
    list.forEach((entry, index) => {
      const hits = entry?.hits;
      if (typeof hits !== 'number' || !Number.isFinite(hits) || hits <= 0) return;
      entries.push({ name: String(entry.name ?? ''), hits, index });
    });
  }
  if (entries.length === 0) return [];

  entries.sort((a, b) => b.hits - a.hits || a.index - b.index);
  const total = entries.reduce((sum, entry) => sum + entry.hits, 0);
  const result = [];

  entries.slice(0, 2).forEach((entry, index) => {
    result.push({
      name: entry.name,
      hits: entry.hits,
      share: entry.hits / total,
      tone: index === 0 ? 'first' : 'second',
    });
  });

  const rest = entries.slice(2);
  if (rest.length > 0) {
    const hits = rest.reduce((sum, entry) => sum + entry.hits, 0);
    result.push({
      name: `${rest.length} other source${rest.length === 1 ? '' : 's'}`,
      hits,
      share: hits / total,
      tone: 'rest',
    });
  }

  return result;
}

/**
 * Summary line for the collapsed sources fieldset: the top three sources with
 * results, by hits, then how many more have results.
 * @param {Array<{name: string, hits: number|null}>} list selected, usable sources in registry order
 * @returns {string}
 */
export function sourceSummary(list) {
  if (!Array.isArray(list) || list.length === 0) return 'No sources selected';

  const withResults = [];
  list.forEach((entry, index) => {
    const hits = entry?.hits;
    if (typeof hits !== 'number' || !Number.isFinite(hits) || hits <= 0) return;
    withResults.push({ name: entry.name, hits, index });
  });

  if (withResults.length === 0) return '';

  withResults.sort((a, b) => b.hits - a.hits || a.index - b.index);
  const names = withResults.slice(0, 3).map((entry) => entry.name);
  const rest = withResults.length - 3;
  return rest > 0
    ? `${names.join(', ')} + ${rest} more with results`
    : names.join(', ');
}

/**
 * Loading line for the infinite-load row: the sources that are loading now.
 * `[]` gives an empty string.
 * @param {string[]} names
 * @returns {string}
 */
export function pullingText(names) {
  const list = Array.isArray(names)
    ? names.filter((name) => typeof name === 'string' && name !== '')
    : [];
  if (list.length === 0) return '';
  if (list.length === 1) return `Pulling more from ${list[0]}`;
  if (list.length === 2) return `Pulling more from ${list[0]} and ${list[1]}`;
  const rest = list.length - 2;
  return `Pulling more from ${list[0]}, ${list[1]} and ${rest} other${rest === 1 ? '' : 's'}`;
}

/**
 * Exhausted line for the infinite-load row.
 * @param {number} n
 * @returns {string}
 */
export function everythingText(n) {
  const count = typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  return count === 1
    ? 'That’s everything from 1 source.'
    : `That’s everything from ${count.toLocaleString('en-US')} sources.`;
}

/**
 * Column rules of the wall for a viewport width. A value that is not a finite
 * number counts as a wide screen.
 * @param {number} viewportWidth
 * @returns {{minColumn:number, gap:number, maxColumns:number}}
 */
export function wallLayout(viewportWidth) {
  if (
    typeof viewportWidth !== 'number' ||
    !Number.isFinite(viewportWidth) ||
    viewportWidth > 600
  ) {
    return { minColumn: 250, gap: 20, maxColumns: Infinity };
  }
  if (viewportWidth > 380) {
    return { minColumn: 160, gap: 12, maxColumns: Infinity };
  }
  return { minColumn: 160, gap: 12, maxColumns: 1 };
}

/**
 * Placeholder tone (1 to 10) for a tile, by its insertion index.
 * Anything other than an integer >= 0 gives 1.
 * @param {number} index
 * @returns {number}
 */
export function placeholderTone(index) {
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) return 1;
  return (index % 10) + 1;
}

/**
 * Whether the back-to-top button shows for a scroll position.
 * Only a finite number greater than 600 counts.
 * @param {number} scrollY
 * @returns {boolean}
 */
export function showBackToTop(scrollY) {
  return typeof scrollY === 'number' && Number.isFinite(scrollY) && scrollY > 600;
}

/**
 * Bottom offset in px for the back-to-top button, so it clears the selection
 * bar when that bar is visible. A bar height that is not a finite number > 0
 * means no bar; a non-finite or negative bar bottom counts as 0.
 * @param {number} barHeight
 * @param {number} barBottom
 * @param {number} [base]
 * @returns {number}
 */
export function backToTopBottom(barHeight, barBottom, base = 28) {
  if (typeof barHeight !== 'number' || !Number.isFinite(barHeight) || barHeight <= 0) {
    return base;
  }
  const bottom =
    typeof barBottom === 'number' && Number.isFinite(barBottom) && barBottom > 0
      ? barBottom
      : 0;
  return bottom + barHeight + 12;
}
