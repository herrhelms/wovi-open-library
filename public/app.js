/**
 * Open Library Fetch — frontend entry module.
 * Plain ES module, no build step. All API data is inserted with DOM methods.
 */
import { downloadUrl, el, itemKey, sleep } from './lib.js';
import { openViewer } from './viewer.js';

const STORAGE_KEY = 'olf.sources';
const RETRY_DELAY = 15_000;
const MAX_RETRIES = 20;
const DOWNLOAD_DELAY = 800;

// ---------- DOM ----------
const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-input');
const chipsEl = document.getElementById('source-chips');
const allButton = document.getElementById('sources-all');
const noneButton = document.getElementById('sources-none');
const errorListEl = document.getElementById('error-list');
const emptyStateEl = document.getElementById('empty-state');
const examplesEl = document.getElementById('examples');
const statusLineEl = document.getElementById('status-line');
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
let selected = new Set();
let query = '';
let generation = 0;
let activeLoads = 0;
let hasAnswered = false;
let downloading = false;

const states = new Map();
const controllers = new Map();
const retryTimers = new Map();
const errors = new Map();
const chipEls = new Map();
const batches = [];
const displayedKeys = new Set();
const cardsByKey = new Map();
/** @type {Map<string, object>} itemKey -> item */
const selection = new Map();

// ---------- Storage helpers ----------
function loadSavedSelection() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((entry) => typeof entry === 'string');
  } catch {
    return null;
  }
}

function saveSelection() {
  try {
    const ids = registry.map((source) => source.id).filter((id) => selected.has(id));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Storage may be blocked or full; selection still works for this session.
  }
}

function defaultSelection() {
  return registry
    .filter((source) => !(source.needsKey && !source.keyConfigured))
    .map((source) => source.id);
}

function knownIds(ids) {
  return ids.filter((id) => registryById.has(id));
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

function sourceShownCount(id) {
  let count = 0;
  for (const batch of batches) {
    const items = batch.sourceItems.get(id);
    if (!items) continue;
    for (const record of items) {
      if (!record.el.hidden) count += 1;
    }
  }
  return count;
}

// ---------- Chips ----------
function renderChips() {
  chipsEl.replaceChildren();
  chipEls.clear();
  for (const source of registry) {
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
    if (source.needsKey && !source.keyConfigured) {
      button.append(el('span', { class: 'chip-key-missing', text: 'key missing' }));
    }
    button.addEventListener('click', () => toggleSource(source.id));
    chipEls.set(source.id, { button, statusEl });
    chipsEl.append(button);
    updateChip(source.id);
  }
}

function updateChip(id) {
  const entry = chipEls.get(id);
  if (!entry) return;
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

function createCard(item, key) {
  const article = el('article', { class: 'card', 'data-key': key });
  const checkbox = el('input', {
    type: 'checkbox',
    'aria-label': `Select ${item.title || 'item'}`,
  });
  const checkWrap = el('label', { class: 'card-check' }, [checkbox]);

  const img = el('img', {
    class: 'card-media',
    src: item.thumb,
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
  img.addEventListener('error', () => {
    article.hidden = true;
    if (selection.delete(key)) updateSelectionUi();
    updateUi();
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

  return { el: article, item, checkbox, img };
}

function visibleRecords() {
  const records = [];
  for (const batch of batches) {
    for (const child of batch.el.children) {
      if (!child.classList.contains('card') || child.hidden) continue;
      const record = cardsByKey.get(child.dataset.key);
      if (record) records.push(record);
    }
  }
  return records;
}

function visibleItems() {
  return visibleRecords().map((record) => record.item);
}

function itemsOf(records) {
  return records.map((record) => record.item);
}

function openCard(key) {
  const records = visibleRecords();
  const index = records.findIndex((record) => `${record.item.source}:${record.item.id}` === key);
  if (index < 0) return;
  openViewer(itemsOf(records), index);
}

// ---------- Batch handling ----------
function createBatch() {
  const batch = {
    el: el('div', { class: 'batch' }),
    sourceItems: new Map(),
  };
  batches.push(batch);
  resultsEl.append(batch.el);
  return batch;
}

function addItems(batch, sourceId, items) {
  let sourceItems = batch.sourceItems.get(sourceId);
  if (!sourceItems) {
    sourceItems = [];
    batch.sourceItems.set(sourceId, sourceItems);
  }

  for (const item of items) {
    if (!item || item.id === undefined || item.id === null || !item.thumb) continue;
    const key = itemKey(item);
    if (displayedKeys.has(key)) continue;
    displayedKeys.add(key);
    const record = createCard(item, key);
    cardsByKey.set(key, record);
    sourceItems.push(record);
  }
}

function reorderBatch(batch) {
  const order = registry.map((source) => source.id);
  let max = 0;
  for (const items of batch.sourceItems.values()) {
    if (items.length > max) max = items.length;
  }

  const fragment = document.createDocumentFragment();
  for (let index = 0; index < max; index += 1) {
    for (const id of order) {
      const items = batch.sourceItems.get(id);
      if (items && items[index]) fragment.append(items[index].el);
    }
  }
  batch.el.append(fragment);
}

function removeSourceCards(id) {
  for (const batch of batches) {
    const items = batch.sourceItems.get(id);
    if (!items) continue;
    for (const record of items) {
      const key = `${record.item.source}:${record.item.id}`;
      record.el.remove();
      displayedKeys.delete(key);
      cardsByKey.delete(key);
      selection.delete(key);
    }
    batch.sourceItems.delete(id);
  }
  updateSelectionUi();
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

async function loadSource(id, page, batch, gen) {
  if (!batch || !batch.el.isConnected) return;
  const state = sourceState(id);
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
    const response = await fetch(`/api/search?${params.toString()}`, {
      signal: controller.signal,
    });
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (gen !== generation || !batch.el.isConnected) return;
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

    if (Array.isArray(data.items)) addItems(batch, id, data.items);
    reorderBatch(batch);
    renderErrors();
    updateChip(id);
  } catch (error) {
    if (error?.name === 'AbortError') return;
    if (gen !== generation || !batch.el.isConnected) return;
    state.status = 'error';
    state.error = error?.message || 'Search failed';
    state.code = error?.code ?? null;
    state.hasMore = false;
    errors.set(id, { message: state.error, code: state.code });
    renderErrors();
    updateChip(id);
    if (state.code === 'PREPARING' && state.retries < MAX_RETRIES) {
      scheduleRetry(id, batch, page, gen);
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

function scheduleRetry(id, batch, page, gen) {
  const state = sourceState(id);
  state.retries += 1;
  cancelRetry(id);
  const timer = setTimeout(() => {
    retryTimers.delete(id);
    if (gen !== generation || !selected.has(id) || !batch.el.isConnected) return;
    loadSource(id, page, batch, gen);
  }, RETRY_DELAY);
  retryTimers.set(id, timer);
}

function resetSearchState() {
  abortAll();
  cancelAllRetries();
  generation += 1;
  states.clear();
  errors.clear();
  batches.length = 0;
  displayedKeys.clear();
  cardsByKey.clear();
  selection.clear();
  resultsEl.replaceChildren();
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

  query = nextQuery;
  searchInput.value = nextQuery;
  resetSearchState();

  if (urlMode !== 'none') updateUrl(urlMode);

  if (selected.size === 0) {
    updateUi();
    return;
  }

  const batch = createBatch();
  const gen = generation;
  for (const source of registry) {
    if (!selected.has(source.id)) continue;
    loadSource(source.id, 1, batch, gen);
  }
  updateUi();
}

function loadMore() {
  if (!canLoadMore()) return;
  const targets = registry
    .filter((source) => selected.has(source.id))
    .map((source) => ({ source, state: sourceState(source.id) }))
    .filter(({ state }) => state.hasMore && state.status !== 'error' && state.status !== 'loading');
  if (targets.length === 0) return;

  const batch = createBatch();
  const gen = generation;
  for (const { source, state } of targets) {
    loadSource(source.id, state.page + 1, batch, gen);
  }
  updateUi();
}

function canLoadMore() {
  if (!query || selected.size === 0) return false;
  if (activeLoads > 0 || !hasAnswered) return false;
  if (batches.length === 0) return false;
  for (const id of selected) {
    const state = sourceState(id);
    if (state.hasMore && state.status !== 'error' && state.status !== 'loading') return true;
  }
  return false;
}

// ---------- Source toggles ----------
function toggleSource(id) {
  if (selected.has(id)) {
    selected.delete(id);
    abortSource(id);
    cancelRetry(id);
    removeSourceCards(id);
    errors.delete(id);
    states.delete(id);
    renderErrors();
    updateChip(id);
  } else {
    selected.add(id);
    if (query) {
      const batch = createBatch();
      loadSource(id, 1, batch, generation);
    }
  }
  saveSelection();
  updateUrl('replace');
  updateChip(id);
  renderErrors();
  updateUi();
}

function abortSource(id) {
  const controller = controllers.get(id);
  if (controller) controller.abort();
  controllers.delete(id);
}

function setAll(isOn) {
  if (isOn) {
    const added = registry.filter((source) => !selected.has(source.id));
    for (const source of added) selected.add(source.id);
    if (query && added.length > 0) {
      const batch = createBatch();
      const gen = generation;
      for (const source of added) loadSource(source.id, 1, batch, gen);
    }
  } else {
    for (const id of [...selected]) {
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

  let loading = 0;
  let finished = 0;
  let knownTotal = 0;
  let totalsComplete = true;

  for (const id of selected) {
    const state = sourceState(id);
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
    const count = selected.size;
    statusLineEl.textContent = `Searching ${count} source${count === 1 ? '' : 's'}…`;
    return;
  }

  const shown = visibleItems().length;
  const allFinished = finished === selected.size;

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
  const sourceParam = params.get('sources');
  if (sourceParam !== null) {
    selected = new Set(knownIds(sourceParam.split(',').filter(Boolean)));
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
    query = '';
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
    const key = `${record.item.source}:${record.item.id}`;
    if (selection.has(key) && !seen.has(key)) {
      seen.add(key);
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

async function downloadSelected() {
  if (downloading) return;
  const items = orderedSelection();
  if (items.length === 0) return;

  downloading = true;
  downloadSelectedButton.disabled = true;
  const total = items.length;

  for (let index = 0; index < total; index += 1) {
    const item = items[index];
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
}

// ---------- Init ----------
async function init() {
  let sourceListError = '';
  try {
    const response = await fetch('/api/sources');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    registry = Array.isArray(data) ? data : [];
  } catch {
    registry = [];
    sourceListError = 'The source list could not be loaded.';
  }
  registryById = new Map(registry.map((source) => [source.id, source]));

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
loadMoreButton.addEventListener('click', loadMore);
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
      if (entries.some((entry) => entry.isIntersecting)) loadMore();
    },
    { rootMargin: '800px' },
  );
  observer.observe(sentinelEl);
}

window.addEventListener('popstate', applyUrlState);

init();
