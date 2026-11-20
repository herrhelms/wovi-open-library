/**
 * Open Library Fetch — frontend entry module.
 * Plain ES module, no build step. All API data is inserted with DOM methods.
 */
import {
  DEFAULT_GROUPS,
  columnCount,
  distribute,
  downloadUrl,
  el,
  estimateCardHeight,
  groupSources,
  isSearchable,
  isUsable,
  itemKey,
  parseSavedSelection,
  pickColumn,
  rememberLimited,
  searchKey,
  serializeSelection,
  shouldAutoLoad,
  sleep,
  subtitleText,
  thumbCandidates,
} from './lib.js';
import { openViewer } from './viewer.js';

const STORAGE_KEY = 'olf.sources';
const OPEN_STORAGE_KEY = 'olf.openOnly';
const OPEN_DISABLED_TEXT =
  'No licence data. Not searched with Open licences only.';
const RETRY_DELAY = 15_000;
const MAX_RETRIES = 20;
const DOWNLOAD_DELAY = 800;

// ---------- DOM ----------
const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-input');
const groupsEl = document.getElementById('source-groups');
const allButton = document.getElementById('sources-all');
const noneButton = document.getElementById('sources-none');
const openOnlyInput = document.getElementById('open-only');
const errorListEl = document.getElementById('error-list');
const emptyStateEl = document.getElementById('empty-state');
const examplesEl = document.getElementById('examples');
const statusLineEl = document.getElementById('status-line');
const subtitleEl = document.querySelector('.site-header .subtitle');
const resultsEl = document.getElementById('results');
const loadMoreButton = document.getElementById('load-more');
const sentinelEl = document.getElementById('sentinel');
const selectionBarEl = document.getElementById('selection-bar');
const selectionCountEl = document.getElementById('selection-count');
const downloadSelectedButton = document.getElementById('download-selected');
const clearSelectionButton = document.getElementById('selection-clear');

// ---------- State ----------
/** @type {Array<{id:string,name:string,homepage:string,needsKey:boolean,keyConfigured:boolean}>} */
let registry = [];
let registryById = new Map();
let groups = DEFAULT_GROUPS;
let selected = new Set();
let openOnly = false;
let query = '';
let generation = 0;
let activeLoads = 0;
let hasAnswered = false;
let downloading = false;
let visibleAtLastAutoLoad = null;
let autoLoadsWithoutGain = 0;
let autoLoadStopped = false;

const states = new Map();
const controllers = new Map();
const retryTimers = new Map();
const errors = new Map();
const chipEls = new Map();
/** @type {Array<{el:HTMLElement,item:object,checkbox:HTMLInputElement,img:HTMLImageElement,key:string,sourceId:string,mediaId:string|null}>} */
const records = [];
const displayedKeys = new Set();
const displayedMedia = new Set();
const cardsByKey = new Map();
/** Search request token for each source id. */
const requestTokens = new Map();
/** mediaId values that already got a warm request. */
const warmSent = new Set();
let tokenCounter = 0;
let masonryEl = null;
let masonryCols = [];
let resizeTimer = 0;
/** Search key → Map(source id → { records, state }) */
const cardCache = new Map();
/** Key of the search that is on screen, or null when there is no query. */
let currentSearchKey = null;
/** @type {Map<string, object>} itemKey -> item */
const selection = new Map();

// ---------- Storage helpers ----------
function loadSavedSelection() {
  try {
    return parseSavedSelection(localStorage.getItem(STORAGE_KEY), registry);
  } catch {
    return null;
  }
}

function saveSelection() {
  try {
    localStorage.setItem(STORAGE_KEY, serializeSelection(selected, registry));
  } catch {
    // Storage may be blocked or full; selection still works for this session.
  }
}

function loadSavedOpenOnly() {
  try {
    return localStorage.getItem(OPEN_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function saveOpenOnly() {
  try {
    localStorage.setItem(OPEN_STORAGE_KEY, openOnly ? '1' : '0');
  } catch {
    // Storage may be blocked or full; the filter still works for this session.
  }
}

function applyOpenOnlyUi() {
  if (openOnlyInput) openOnlyInput.checked = openOnly;
}

function defaultSelection() {
  return registry.filter(isUsable).map((source) => source.id);
}

function knownIds(ids) {
  return ids.filter((id) => {
    const source = registryById.get(id);
    return Boolean(source) && isUsable(source);
  });
}

// ---------- Source state ----------
function sourceState(id) {
  let state = states.get(id);
  if (!state) {
    state = {
      status: 'idle',
      total: null,
      hasMore: false,
      page: 0,
      error: null,
      code: null,
      retries: 0,
    };
    states.set(id, state);
  }
  return state;
}

function sourceName(id) {
  return registryById.get(id)?.name ?? id;
}

function searchableSelected() {
  return registry.filter(
    (source) => selected.has(source.id) && isSearchable(source, openOnly),
  );
}

function sourceShownCount(id) {
  let count = 0;
  for (const record of records) {
    if (record.sourceId !== id) continue;
    if (!record.el.hidden) count += 1;
  }
  return count;
}

// ---------- Chips ----------
function needsKeyText(source) {
  return `Set ${source.keyEnv ?? 'the key'} in .env to use ${source.name}.`;
}

function createChip(source) {
  const statusEl = el('span', { class: 'chip-status' });
  const button = el(
    'button',
    {
      type: 'button',
      class: 'chip',
      'aria-pressed': selected.has(source.id) ? 'true' : 'false',
    },
    [el('span', { class: 'chip-name', text: source.name }), statusEl],
  );

  if (!isUsable(source)) {
    const descriptionId = `source-key-${source.id}`;
    button.classList.add('chip-needs-key');
    button.removeAttribute('aria-pressed');
    button.setAttribute('aria-disabled', 'true');
    button.setAttribute('aria-describedby', descriptionId);
    button.title = needsKeyText(source);
    button.append(el('span', { class: 'chip-needs-key-text', text: 'needs key' }));
    button.append(
      el('span', {
        class: 'visually-hidden',
        id: descriptionId,
        text: needsKeyText(source),
      }),
    );
    // Keep the status element for layout consistency but never fill it.
    chipEls.set(source.id, { button, statusEl, usable: false });
    return button;
  }

  if (openOnly && source.openLicenses === false) {
    button.classList.add('chip-no-licence');
    button.removeAttribute('aria-pressed');
    button.setAttribute('aria-disabled', 'true');
    button.title = OPEN_DISABLED_TEXT;
    button.append(el('span', { class: 'visually-hidden', text: OPEN_DISABLED_TEXT }));
    chipEls.set(source.id, { button, statusEl, usable: false });
    return button;
  }

  button.addEventListener('click', () => toggleSource(source.id));
  chipEls.set(source.id, { button, statusEl, usable: true });
  updateChip(source.id);
  return button;
}

function createGroupAllButton(rowId, isOn) {
  return el('button', {
    class: 'text-button',
    type: 'button',
    text: isOn ? 'All' : 'None',
    onclick: () => setGroupAll(rowId, isOn),
  });
}

function renderChips() {
  groupsEl.replaceChildren();
  chipEls.clear();

  const rows = groupSources(registry, groups);
  for (const row of rows) {
    const chips = el(
      'div',
      { class: 'chips' },
      row.sources.map((source) => createChip(source)),
    );
    const actions = el('div', { class: 'source-actions source-actions-group' }, [
      el('span', { class: 'section-label', text: row.label }),
      createGroupAllButton(row.id, true),
      createGroupAllButton(row.id, false),
    ]);
    const groupEl = el(
      'div',
      { class: 'source-group', role: 'group', 'aria-label': row.label },
      [actions, chips],
    );
    groupsEl.append(groupEl);
  }
}

function updateChip(id) {
  const entry = chipEls.get(id);
  if (!entry) return;
  if (!entry.usable) return;
  const isOn = selected.has(id);
  entry.button.setAttribute('aria-pressed', isOn ? 'true' : 'false');
  entry.button.removeAttribute('title');
  entry.button.classList.remove('has-error');

  const statusEl = entry.statusEl;
  statusEl.replaceChildren();
  const state = sourceState(id);

  if (state.status === 'loading') {
    statusEl.append(el('span', { class: 'spinner', 'aria-label': 'loading' }));
  } else if (state.status === 'done') {
    const count = state.total !== null ? state.total : sourceShownCount(id);
    statusEl.textContent = Number(count).toLocaleString();
  } else if (state.status === 'error') {
    statusEl.append(el('span', { class: 'chip-error-dot', 'aria-hidden': 'true' }));
    entry.button.classList.add('has-error');
    entry.button.title = state.error || 'Search failed';
  }
}

// ---------- Errors ----------
function renderErrors() {
  errorListEl.replaceChildren();
  for (const [id, info] of errors) {
    if (!selected.has(id)) continue;
    const li = el('li', {}, [el('strong', { text: sourceName(id) })]);
    li.append(document.createTextNode(` ${info.message}`));
    errorListEl.append(li);
  }
}

// ---------- Selection bar ----------
function updateSelectionUi() {
  const count = selection.size;
  resultsEl.classList.toggle('has-selection', count > 0);
  selectionBarEl.hidden = count === 0;
  selectionCountEl.textContent = `${count} selected`;

  for (const [key, record] of cardsByKey) {
    record.el.classList.toggle('selected', selection.has(key));
    record.checkbox.checked = selection.has(key);
  }

  if (count > 0 && !downloading) {
    downloadSelectedButton.textContent = 'Download selected';
  }
}

function toggleSelection(key, isOn) {
  const record = cardsByKey.get(key);
  if (!record) return;
  if (isOn) selection.set(key, record.item);
  else selection.delete(key);
  updateSelectionUi();
}

// ---------- Cards ----------
function metaLine(item) {
  const parts = [];
  if (item.creator) parts.push(String(item.creator));
  if (item.date) parts.push(String(item.date));
  return parts.join(' · ');
}

function createCard(item, key, sourceId, mediaId) {
  const dataset = { uid: key, source: sourceId };
  if (mediaId !== null) dataset.mediaId = mediaId;
  const article = el('article', { class: 'card', dataset });
  const checkbox = el('input', {
    type: 'checkbox',
    'aria-label': `Select ${item.title || 'item'}`,
  });
  const checkWrap = el('label', { class: 'card-check' }, [checkbox]);

  const candidates = thumbCandidates(item);
  const img = el('img', {
    class: 'card-media',
    src: candidates[0],
    alt: item.title || '',
    loading: 'lazy',
    decoding: 'async',
  });
  const width = Number(item.width);
  const height = Number(item.height);
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    img.setAttribute('width', String(Math.round(width)));
    img.setAttribute('height', String(Math.round(height)));
  }

  let candidateIndex = 0;
  img.addEventListener('error', () => {
    if (candidateIndex + 1 < candidates.length) {
      candidateIndex += 1;
      img.src = candidates[candidateIndex];
      return;
    }
    article.hidden = true;
    if (selection.delete(key)) updateSelectionUi();
    updateUi();
  });

  img.addEventListener('load', () => {
    if (item.thumbCached === true) return;
    if (typeof mediaId !== 'string' || mediaId === '') return;
    if (candidates[candidateIndex] !== item.thumbSource) return;
    if (warmSent.has(mediaId)) return;
    warmSent.add(mediaId);
    try {
      Promise.resolve(
        fetch(`/api/thumb/${mediaId}/warm`, { method: 'POST' }),
      ).catch(() => {});
    } catch {
      // A warm request is a cache hint only; ignore all errors.
    }
  });

  const bodyChildren = [
    el('h3', { class: 'card-title', text: item.title || 'Untitled' }),
  ];
  const meta = metaLine(item);
  if (meta) bodyChildren.push(el('p', { class: 'card-meta', text: meta }));
  bodyChildren.push(el('p', { class: 'card-source', text: sourceName(item.source) }));

  const openButton = el('button', { type: 'button', class: 'card-open' }, [
    img,
    el('div', { class: 'card-body' }, bodyChildren),
  ]);
  openButton.addEventListener('click', () => openCard(key));

  checkbox.addEventListener('change', () => toggleSelection(key, checkbox.checked));
  article.append(checkWrap, openButton);

  return { el: article, item, checkbox, img, key, sourceId, mediaId };
}

function visibleRecords() {
  return records.filter((record) => !record.el.hidden);
}

function visibleItems() {
  return visibleRecords().map((record) => record.item);
}

function itemsOf(list) {
  return list.map((record) => record.item);
}

function openCard(key) {
  const shown = visibleRecords();
  const index = shown.findIndex((record) => record.key === key);
  if (index < 0) return;
  openViewer(itemsOf(shown), index);
}

// ---------- Masonry grid ----------
function masonryGap() {
  if (!masonryEl) return 0;
  const style = getComputedStyle(masonryEl);
  const raw = style.columnGap || style.gap || '';
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function createMasonry() {
  masonryEl = el('div', { class: 'masonry' });
  masonryCols = [];
  resultsEl.append(masonryEl);
  const count = columnCount(resultsEl.clientWidth, 240, masonryGap());
  for (let index = 0; index < count; index += 1) {
    const column = el('div', { class: 'masonry-col' });
    masonryCols.push(column);
    masonryEl.append(column);
  }
}

function addItems(sourceId, items) {
  if (!Array.isArray(items)) return;
  const prepared = [];

  for (const item of items) {
    if (!item) continue;
    if (item.id === undefined || item.id === null) continue;
    if (thumbCandidates(item).length === 0) continue;
    const key = itemKey(item);
    if (displayedKeys.has(key)) continue;
    const mediaId =
      typeof item.mediaId === 'string' && item.mediaId !== '' ? item.mediaId : null;
    if (mediaId !== null && displayedMedia.has(mediaId)) continue;
    displayedKeys.add(key);
    if (mediaId !== null) displayedMedia.add(mediaId);
    prepared.push({ item, key, mediaId, sourceId });
  }

  placeEntries(prepared);
}

/**
 * Put cards into the columns, shortest column first. Reads the column heights
 * one time. New cards use the estimated height. Restored cards also use their
 * real height when the browser can give one.
 * @param {Array<{item:object,key:string,mediaId:string|null,sourceId?:string,record?:object}>} entries
 * @param {{realHeights?:boolean}} [options]
 */
function placeEntries(entries, { realHeights = false } = {}) {
  if (!Array.isArray(entries) || entries.length === 0) return;
  if (!masonryEl || masonryCols.length === 0) createMasonry();

  const heights = masonryCols.map((column) => column.offsetHeight);
  const firstWidth = masonryCols[0]?.clientWidth ?? 0;
  const columnWidth = firstWidth > 0 ? firstWidth : resultsEl.clientWidth;
  const gap = masonryGap();

  for (const entry of entries) {
    const columnIndex = pickColumn(heights);
    const record =
      entry.record ??
      createCard(entry.item, entry.key, entry.sourceId, entry.mediaId);
    masonryCols[columnIndex].append(record.el);
    records.push(record);
    cardsByKey.set(record.key, record);

    let height = 0;
    if (realHeights) height = record.el.offsetHeight;
    if (!(height > 0)) height = estimateCardHeight(entry.item, columnWidth);
    heights[columnIndex] += height + gap;
  }
}

function reflowMasonry() {
  if (!masonryEl) return;
  const gap = masonryGap();
  const count = columnCount(resultsEl.clientWidth, 240, gap);
  if (count === masonryCols.length) return;

  const heights = records.map((record) => record.el.offsetHeight);
  masonryEl.replaceChildren();
  masonryCols = [];
  for (let index = 0; index < count; index += 1) {
    const column = el('div', { class: 'masonry-col' });
    masonryCols.push(column);
    masonryEl.append(column);
  }

  const indexes = distribute(heights, count, gap);
  records.forEach((record, index) => {
    masonryCols[indexes[index]].append(record.el);
  });
}

function removeSourceCards(id) {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    if (record.sourceId !== id) continue;
    records.splice(index, 1);
    record.el.remove();
    displayedKeys.delete(record.key);
    if (record.mediaId !== null) displayedMedia.delete(record.mediaId);
    cardsByKey.delete(record.key);
    selection.delete(record.key);
    // The record is no longer in cardsByKey, so updateSelectionUi cannot reset it.
    // Clear the visual selection state here, so a later restore starts unselected.
    record.el.classList.remove('selected');
    record.checkbox.checked = selection.has(record.key);
  }
  updateSelectionUi();
}

// ---------- Card cache ----------
/**
 * Save the records and a state copy of one source under the current search key.
 * A source without records and with status `idle` is not saved.
 * @param {string} id
 */
function saveSourceToCache(id) {
  if (currentSearchKey === null) return;
  const state = sourceState(id);
  const sourceRecords = records.filter((record) => record.sourceId === id);
  if (sourceRecords.length === 0 && state.status === 'idle') return;

  let map = cardCache.get(currentSearchKey);
  if (!map) map = new Map();
  rememberLimited(cardCache, currentSearchKey, map);
  map.set(id, { records: sourceRecords.slice(), state: { ...state } });
}

/** Save every source that has records or a state that is not idle. */
function saveAllToCache() {
  if (currentSearchKey === null) return;
  const ids = new Set(states.keys());
  for (const record of records) ids.add(record.sourceId);
  for (const id of ids) saveSourceToCache(id);
}

/**
 * Put the cached records of one source back into the grid.
 * Duplicate keys and media IDs are skipped. The cached state is copied again.
 * @param {string} id
 * @returns {boolean} true when an entry was restored
 */
function restoreSourceFromCache(id) {
  const entry = cardCache.get(currentSearchKey)?.get(id);
  if (!entry) return false;

  Object.assign(sourceState(id), { ...entry.state });

  const prepared = [];
  for (const record of entry.records) {
    if (displayedKeys.has(record.key)) continue;
    if (record.mediaId !== null && displayedMedia.has(record.mediaId)) continue;
    displayedKeys.add(record.key);
    if (record.mediaId !== null) displayedMedia.add(record.mediaId);
    prepared.push({
      item: record.item,
      key: record.key,
      mediaId: record.mediaId,
      sourceId: id,
      record,
    });
  }

  placeEntries(prepared, { realHeights: true });
  // Restored cards are not selected again unless their key is in the selection.
  updateSelectionUi();
  newToken(id);
  hasAnswered = true;
  updateChip(id);
  updateUi();
  return true;
}

/**
 * Restore a source from the cache only when its cached state is `done`.
 * @param {string} id
 * @returns {boolean}
 */
function restoreIfCached(id) {
  const entry = cardCache.get(currentSearchKey)?.get(id);
  if (!entry || entry.state.status !== 'done') return false;
  return restoreSourceFromCache(id);
}

// ---------- Search ----------
function abortAll() {
  for (const controller of controllers.values()) controller.abort();
  controllers.clear();
}

function cancelAllRetries() {
  for (const timer of retryTimers.values()) clearTimeout(timer);
  retryTimers.clear();
}

function cancelRetry(id) {
  const timer = retryTimers.get(id);
  if (timer) clearTimeout(timer);
  retryTimers.delete(id);
}

function isValidToken(id, token, gen) {
  if (gen !== generation) return false;
  return requestTokens.get(id) === token;
}

async function loadSource(id, page, token, gen) {
  if (!isValidToken(id, token, gen)) return;
  const state = sourceState(id);
  if (state.status === 'loading') return;
  state.status = 'loading';
  state.error = null;
  state.code = null;
  updateChip(id);
  updateUi();

  const controller = new AbortController();
  controllers.set(id, controller);
  activeLoads += 1;

  try {
    const params = new URLSearchParams({ source: id, q: query, page: String(page) });
    if (openOnly) params.set('open', '1');
    const response = await fetch(`/api/search?${params.toString()}`, {
      signal: controller.signal,
    });
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!isValidToken(id, token, gen)) return;
    if (!response.ok || !data || data.error) {
      const error = new Error(data?.error || `Search failed (HTTP ${response.status})`);
      error.code = data?.code ?? null;
      throw error;
    }

    state.status = 'done';
    state.error = null;
    state.code = null;
    state.total = Number.isFinite(data.total) ? data.total : null;
    state.hasMore = Boolean(data.hasMore);
    state.page = page;
    state.retries = 0;
    errors.delete(id);

    if (Array.isArray(data.items)) addItems(id, data.items);
    renderErrors();
    updateChip(id);
  } catch (error) {
    if (error?.name === 'AbortError') return;
    if (!isValidToken(id, token, gen)) return;
    state.status = 'error';
    state.error = error?.message || 'Search failed';
    state.code = error?.code ?? null;
    state.hasMore = false;
    errors.set(id, { message: state.error, code: state.code });
    renderErrors();
    updateChip(id);
    if (state.code === 'PREPARING' && state.retries < MAX_RETRIES) {
      scheduleRetry(id, page, token, gen);
    }
  } finally {
    if (controllers.get(id) === controller) controllers.delete(id);
    if (gen === generation) {
      activeLoads = Math.max(0, activeLoads - 1);
      hasAnswered = true;
      updateUi();
    }
  }
}

function scheduleRetry(id, page, token, gen) {
  const state = sourceState(id);
  state.retries += 1;
  cancelRetry(id);
  const timer = setTimeout(() => {
    retryTimers.delete(id);
    if (!isValidToken(id, token, gen)) return;
    if (!selected.has(id)) return;
    loadSource(id, page, token, gen);
  }, RETRY_DELAY);
  retryTimers.set(id, timer);
}

function newToken(id) {
  tokenCounter += 1;
  requestTokens.set(id, tokenCounter);
  return tokenCounter;
}

function invalidateToken(id) {
  tokenCounter += 1;
  requestTokens.set(id, tokenCounter);
}

function startLoad(id, page, gen) {
  const state = sourceState(id);
  if (state.status === 'loading') return;
  const token = newToken(id);
  loadSource(id, page, token, gen);
}

function resetAutoLoad() {
  visibleAtLastAutoLoad = null;
  autoLoadsWithoutGain = 0;
  autoLoadStopped = false;
}

function resetSearchState() {
  abortAll();
  cancelAllRetries();
  requestTokens.clear();
  resetAutoLoad();
  generation += 1;
  states.clear();
  errors.clear();
  // Cached elements keep their nodes; clear the visual selection before the
  // selection map is cleared, so a later restore starts unselected.
  for (const record of records) {
    record.el.classList.remove('selected');
    record.checkbox.checked = false;
  }
  records.length = 0;
  displayedKeys.clear();
  displayedMedia.clear();
  cardsByKey.clear();
  selection.clear();
  resultsEl.replaceChildren();
  masonryEl = null;
  masonryCols = [];
  createMasonry();
  errorListEl.replaceChildren();
  activeLoads = 0;
  hasAnswered = false;
  emptyStateEl.hidden = true;
  renderChips();
  updateSelectionUi();
}

function runSearch(rawQuery, { urlMode = 'push' } = {}) {
  const nextQuery = rawQuery.trim();
  if (!nextQuery) return;

  saveAllToCache();
  query = nextQuery;
  searchInput.value = nextQuery;
  resetSearchState();
  currentSearchKey = searchKey(openOnly, nextQuery);

  if (urlMode !== 'none') updateUrl(urlMode);

  if (selected.size === 0) {
    updateUi();
    return;
  }

  const gen = generation;
  for (const source of searchableSelected()) {
    if (restoreIfCached(source.id)) continue;
    startLoad(source.id, 1, gen);
  }
  updateUi();
}

function loadMore() {
  if (!canLoadMore()) return false;
  const targets = searchableSelected()
    .map((source) => ({ source, state: sourceState(source.id) }))
    .filter(({ state }) => state.hasMore && state.status !== 'error' && state.status !== 'loading');
  if (targets.length === 0) return false;

  const gen = generation;
  for (const { source, state } of targets) {
    startLoad(source.id, state.page + 1, gen);
  }
  updateUi();
  return true;
}

/**
 * Sentinel-triggered loading. Stops when pages no longer add visible cards,
 * so sources with broken thumbnails cannot cause endless requests.
 */
function autoLoad() {
  const visibleNow = visibleRecords().length;
  const mayLoad = shouldAutoLoad({
    visibleNow,
    visibleAtLastAutoLoad,
    autoLoadsWithoutGain,
  });

  if (!mayLoad) {
    autoLoadStopped = true;
    updateUi();
    return;
  }

  const noGain =
    typeof visibleAtLastAutoLoad === 'number' &&
    visibleNow <= visibleAtLastAutoLoad;

  if (!loadMore()) return;

  autoLoadStopped = false;
  autoLoadsWithoutGain = noGain ? autoLoadsWithoutGain + 1 : 0;
  visibleAtLastAutoLoad = visibleNow;
}

function canLoadMore() {
  if (!query || selected.size === 0) return false;
  if (activeLoads > 0 || !hasAnswered) return false;
  const started =
    Boolean(query) &&
    searchableSelected().some((source) => sourceState(source.id).status !== 'idle');
  if (!started) return false;
  for (const source of searchableSelected()) {
    const state = sourceState(source.id);
    if (state.hasMore && state.status !== 'error' && state.status !== 'loading') return true;
  }
  return false;
}

// ---------- Source toggles ----------
function toggleSource(id) {
  const source = registryById.get(id);
  if (!source || !isSearchable(source, openOnly)) return;
  if (selected.has(id)) {
    selected.delete(id);
    saveSourceToCache(id);
    abortSource(id);
    cancelRetry(id);
    removeSourceCards(id);
    errors.delete(id);
    states.delete(id);
    resetAutoLoad();
    renderErrors();
    updateChip(id);
  } else {
    selected.add(id);
    resetAutoLoad();
    if (query && !restoreIfCached(id)) {
      startLoad(id, 1, generation);
    }
  }
  saveSelection();
  updateUrl('replace');
  updateChip(id);
  renderErrors();
  updateUi();
}

function abortSource(id) {
  invalidateToken(id);
  const controller = controllers.get(id);
  if (controller) controller.abort();
  controllers.delete(id);
}

function setAll(isOn) {
  resetAutoLoad();
  if (isOn) {
    const added = registry.filter(
      (source) => isSearchable(source, openOnly) && !selected.has(source.id),
    );
    for (const source of added) selected.add(source.id);
    if (query && added.length > 0) {
      const gen = generation;
      for (const source of added) {
        if (restoreIfCached(source.id)) continue;
        startLoad(source.id, 1, gen);
      }
    }
  } else {
    for (const id of [...selected]) {
      saveSourceToCache(id);
      abortSource(id);
      cancelRetry(id);
      removeSourceCards(id);
      states.delete(id);
      errors.delete(id);
    }
    selected.clear();
    renderErrors();
  }

  for (const source of registry) updateChip(source.id);
  saveSelection();
  updateUrl('replace');
  updateUi();
}

function setGroupAll(groupId, isOn) {
  const row = groupSources(registry, groups).find((entry) => entry.id === groupId);
  if (!row) return;
  resetAutoLoad();
  const targets = row.sources.filter((source) => isSearchable(source, openOnly));
  if (isOn) {
    const added = targets.filter((source) => !selected.has(source.id));
    for (const source of added) selected.add(source.id);
    if (query && added.length > 0) {
      const gen = generation;
      for (const source of added) {
        if (restoreIfCached(source.id)) continue;
        startLoad(source.id, 1, gen);
      }
    }
  } else {
    for (const source of targets) {
      if (!selected.has(source.id)) continue;
      selected.delete(source.id);
      saveSourceToCache(source.id);
      abortSource(source.id);
      cancelRetry(source.id);
      removeSourceCards(source.id);
      states.delete(source.id);
      errors.delete(source.id);
    }
    renderErrors();
  }

  for (const source of registry) updateChip(source.id);
  saveSelection();
  updateUrl('replace');
  updateUi();
}

// ---------- Status ----------
function updateStatus() {
  if (!query) {
    statusLineEl.textContent = '';
    return;
  }
  if (selected.size === 0) {
    statusLineEl.textContent = 'Select at least one source.';
    return;
  }

  const searchable = searchableSelected();
  if (searchable.length === 0) {
    statusLineEl.textContent = 'Select at least one source.';
    return;
  }

  let loading = 0;
  let finished = 0;
  let knownTotal = 0;
  let totalsComplete = true;

  for (const source of searchable) {
    const state = sourceState(source.id);
    if (state.status === 'loading') loading += 1;
    if (state.status === 'done') {
      finished += 1;
      if (state.total !== null) knownTotal += state.total;
      else totalsComplete = false;
    } else if (state.status === 'error') {
      finished += 1;
      totalsComplete = false;
    } else if (state.status === 'idle') {
      totalsComplete = false;
    }
  }

  if (loading > 0) {
    const count = searchable.length;
    statusLineEl.textContent = `Searching ${count} source${count === 1 ? '' : 's'}…`;
    return;
  }

  if (autoLoadStopped && canLoadMore()) {
    statusLineEl.textContent =
      'Some results have no loadable preview images. Press "Load more" to continue.';
    return;
  }

  const shown = visibleItems().length;
  const allFinished = finished === searchable.length;

  if (allFinished && shown === 0) {
    statusLineEl.textContent = `No results for "${query}".`;
    return;
  }

  if (totalsComplete && knownTotal > 0) {
    statusLineEl.textContent = `${shown.toLocaleString()} results shown of ${knownTotal.toLocaleString()}`;
  } else {
    statusLineEl.textContent = `${shown.toLocaleString()} results shown`;
  }
}

function updateUi() {
  updateStatus();

  const showMore = canLoadMore();
  loadMoreButton.hidden = !showMore;

  const count = selection.size;
  selectionBarEl.hidden = count === 0;
  selectionCountEl.textContent = `${count} selected`;
  resultsEl.classList.toggle('has-selection', count > 0);
}

// ---------- URL ----------
function updateUrl(mode) {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  params.set('sources', registry.map((source) => source.id).filter((id) => selected.has(id)).join(','));
  if (openOnly) params.set('open', '1');
  const url = `${location.pathname}?${params.toString()}`;
  try {
    if (mode === 'push') history.pushState(null, '', url);
    else if (mode === 'replace') history.replaceState(null, '', url);
  } catch {
    // History can be unavailable in some embeddings; ignore.
  }
}

function applyUrlState() {
  const params = new URLSearchParams(location.search);
  if (params.has('q') || params.has('sources')) {
    openOnly = params.get('open') === '1';
  } else {
    openOnly = loadSavedOpenOnly();
  }
  applyOpenOnlyUi();

  const sourceParam = params.get('sources');
  if (sourceParam !== null) {
    selected = new Set(knownIds(sourceParam.split(',').filter(Boolean)));
    for (const id of [...selected]) {
      const source = registryById.get(id);
      if (!source || !isUsable(source)) selected.delete(id);
    }
  } else {
    const saved = loadSavedSelection();
    selected = new Set(knownIds(saved ?? defaultSelection()));
  }

  renderChips();
  updateUi();

  const nextQuery = (params.get('q') ?? '').trim();
  if (nextQuery) {
    runSearch(nextQuery, { urlMode: 'none' });
  } else {
    saveAllToCache();
    query = '';
    currentSearchKey = null;
    searchInput.value = '';
    resetSearchState();
    states.clear();
    errors.clear();
    renderErrors();
    emptyStateEl.hidden = false;
    updateUi();
  }
}

// ---------- Downloads ----------
function orderedSelection() {
  const items = [];
  const seen = new Set();
  for (const record of visibleRecords()) {
    if (selection.has(record.key) && !seen.has(record.key)) {
      seen.add(record.key);
      items.push(record.item);
    }
  }
  for (const [key, item] of selection) {
    if (!seen.has(key)) {
      seen.add(key);
      items.push(item);
    }
  }
  return items;
}

function directDownloadNote(items) {
  const counts = new Map();
  for (const item of items) {
    if (item.directDownload !== true) continue;
    const name = sourceName(item.source);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  if (counts.size === 0) return '';
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const names = [...counts.keys()].join(', ');
  return `${total} item${total === 1 ? '' : 's'} from ${names} were skipped: open them in the viewer and save them from there.`;
}

async function downloadSelected() {
  if (downloading) return;
  const items = orderedSelection();
  if (items.length === 0) return;

  downloading = true;
  downloadSelectedButton.disabled = true;
  const total = items.length;
  const skippedNote = directDownloadNote(items);

  for (let index = 0; index < total; index += 1) {
    const item = items[index];
    if (item.directDownload === true) continue;
    downloadSelectedButton.textContent = `Downloading ${index + 1} of ${total}`;
    const link = el('a', { href: downloadUrl(item), download: '' });
    document.body.append(link);
    link.click();
    link.remove();
    await sleep(DOWNLOAD_DELAY);
  }

  downloading = false;
  downloadSelectedButton.disabled = false;
  downloadSelectedButton.textContent = 'Download selected';

  if (skippedNote) statusLineEl.textContent = skippedNote;
}

// ---------- Init ----------
async function loadGroups() {
  try {
    const response = await fetch('/api/groups');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (Array.isArray(data) && data.length > 0) {
      const clean = data.filter(
        (entry) => entry && typeof entry.id === 'string' && typeof entry.label === 'string',
      );
      if (clean.length > 0) return clean;
    }
  } catch {
    // Use the fallback groups below.
  }
  return DEFAULT_GROUPS;
}

async function init() {
  let sourceListError = '';
  const [sourceResult, groupList] = await Promise.all([
    fetch('/api/sources')
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .catch(() => null),
    loadGroups(),
  ]);
  groups = groupList;

  if (Array.isArray(sourceResult)) {
    registry = sourceResult;
  } else {
    registry = [];
    sourceListError = 'The source list could not be loaded.';
  }
  registryById = new Map(registry.map((source) => [source.id, source]));

  if (subtitleEl) subtitleEl.textContent = subtitleText(registry);

  applyUrlState();
  if (sourceListError && statusLineEl.textContent === '') {
    statusLineEl.textContent = sourceListError;
  }
}

searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const value = searchInput.value.trim();
  if (!value) return;
  runSearch(value, { urlMode: 'push' });
});

allButton.addEventListener('click', () => setAll(true));
noneButton.addEventListener('click', () => setAll(false));
if (openOnlyInput) {
  openOnlyInput.addEventListener('change', () => {
    openOnly = openOnlyInput.checked;
    saveOpenOnly();
    updateUrl('replace');
    renderChips();
    updateUi();
    if (query) runSearch(query, { urlMode: 'replace' });
  });
}
loadMoreButton.addEventListener('click', () => {
  resetAutoLoad();
  loadMore();
  updateUi();
});
downloadSelectedButton.addEventListener('click', downloadSelected);
clearSelectionButton.addEventListener('click', () => {
  selection.clear();
  updateSelectionUi();
  updateUi();
});

examplesEl.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-query]');
  if (!button) return;
  const value = button.dataset.query || '';
  searchInput.value = value;
  runSearch(value, { urlMode: 'push' });
});

if (typeof IntersectionObserver === 'function') {
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) autoLoad();
    },
    { rootMargin: '800px' },
  );
  observer.observe(sentinelEl);
}

if (typeof ResizeObserver === 'function') {
  const resizeObserver = new ResizeObserver(() => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeTimer = 0;
      reflowMasonry();
    }, 150);
  });
  resizeObserver.observe(resultsEl);
}

window.addEventListener('popstate', applyUrlState);

init();
