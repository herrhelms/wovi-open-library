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
  everythingText,
  groupShortLabel,
  groupSources,
  imagesText,
  imagesTotal,
  isSearchable,
  isShortcut,
  isUsable,
  itemKey,
  parseSavedSelection,
  pickColumn,
  placeholderTone,
  pullingText,
  rateLimitWaitText,
  rememberLimited,
  retryDelay,
  searchKey,
  searchWithoutItem,
  searchPlaceholder,
  serializeSelection,
  shouldAutoLoad,
  shortcutLabel,
  sleep,
  sortChipIds,
  sourceBarSegments,
  sourceSummary,
  thumbCandidates,
  wallLayout,
  backToTopBottom,
  showBackToTop,
} from './lib.js';
import { initSettings, openSources } from './settings.js';
import { onSavesChange, readSaves, savedIds, toggleSave } from './saves.js';
import { openViewer } from './viewer.js';

const STORAGE_KEY = 'olf.sources';
const OPEN_STORAGE_KEY = 'olf.openOnly';
const SOURCES_OPEN_KEY = 'wovi:sources-open:v1';
const OPEN_DISABLED_TEXT =
  'No licence data. Not searched with Open licences only.';
const DOWNLOAD_DELAY = 800;
// The results header can show sort, orientation and colour dropdowns, but the
// search API has no data for them, so the controls stay off (no dead controls).
const SHOW_RESULT_FILTERS = false;

// ---------- DOM ----------
const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-input');
const searchShortcutEl = document.getElementById('search-shortcut');
const groupsEl = document.getElementById('src-panel');
const sourcesDisc = document.getElementById('sources-disc');
const sourcesCountEl = document.getElementById('sources-count');
const sourcesSummaryEl = document.getElementById('sources-summary');
const allButton = document.getElementById('sources-all');
const noneButton = document.getElementById('sources-none');
const openOnlySwitch = document.getElementById('sources-licence-switch');
const errorListEl = document.getElementById('error-list');
const emptyStateEl = document.getElementById('empty-state');
const examplesEl = document.getElementById('examples');
const resultsTitleEl = document.getElementById('results-title');
const resultsSubEl = document.getElementById('results-sub');
const sourceBarEl = document.getElementById('source-bar');
const sourceLegendEl = document.getElementById('source-legend');
const noResultsEl = document.getElementById('no-results');
const noResultsTextEl = document.getElementById('no-results-text');
const noResultsSourcesButton = document.getElementById('no-results-sources');
const statusLineEl = document.getElementById('status-line');
const savedCountEl = document.getElementById('saved-count');
const resultsEl = document.getElementById('results');
const wallSkeletonsEl = document.getElementById('wall-skeletons');
const loadRowEl = document.getElementById('load-row');
const loadMoreButton = document.getElementById('load-more');
const sentinelEl = document.getElementById('sentinel');
const selectionBarEl = document.getElementById('selection-bar');
const selectionCountEl = document.getElementById('selection-count');
const downloadSelectedButton = document.getElementById('download-selected');
const clearSelectionButton = document.getElementById('selection-clear');
const backToTopButton = document.getElementById('back-to-top');

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
/** @type {Map<string,{sources:object[],chipsEl:HTMLElement,hitsEl:HTMLElement}>} */
const groupRows = new Map();
/** True while renderChips builds the fieldsets, so updateChip skips the re-layout. */
let layingOutSources = false;
/** @type {Array<{el:HTMLElement,item:object,selectButton:HTMLButtonElement,img:HTMLImageElement,key:string,sourceId:string,mediaId:string|null}>} */
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
/** Native `display: grid-lanes` takes over the column placement when available. */
const nativeWall =
  typeof CSS !== 'undefined' &&
  typeof CSS.supports === 'function' &&
  CSS.supports('display', 'grid-lanes');
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
  if (openOnlySwitch) {
    openOnlySwitch.setAttribute('aria-checked', openOnly ? 'true' : 'false');
  }
}

function loadSourcesOpen() {
  try {
    return localStorage.getItem(SOURCES_OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

function saveSourcesOpen(open) {
  try {
    localStorage.setItem(SOURCES_OPEN_KEY, open ? '1' : '0');
  } catch {
    // Storage may be blocked or full; the fieldset still works for this session.
  }
}

function setSourcesOpen(open, { persist = true } = {}) {
  if (sourcesDisc) {
    sourcesDisc.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  if (groupsEl) groupsEl.hidden = !open;
  if (persist) saveSourcesOpen(open);
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
      rateLimitRetries: 0,
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

/**
 * Hits of one source for its chip: the reported total when it is known, else
 * the number of cards that are shown. A count exists only after a search
 * finished (`done`).
 * @param {string} id
 * @returns {number|null}
 */
function chipHits(id) {
  const state = states.get(id);
  if (!state || state.status !== 'done') return null;
  return state.total !== null ? state.total : sourceShownCount(id);
}

/**
 * Selected sources that can be searched right now, in registry order, with
 * their hit counts.
 * @returns {Array<{name:string,hits:number|null}>}
 */
function summaryList() {
  const list = [];
  for (const source of registry) {
    if (!selected.has(source.id)) continue;
    if (!isSearchable(source, openOnly)) continue;
    list.push({ name: source.name, hits: chipHits(source.id) });
  }
  return list;
}

/**
 * Move the chips of one group into hit order. Existing elements are moved, not
 * recreated, so keyboard focus stays on the same source.
 * @param {{sources:object[],chipsEl:HTMLElement}} row
 */
function sortGroupChips(row) {
  const ids = row.sources.map((source) => source.id);
  const hitsById = new Map(ids.map((id) => [id, chipHits(id)]));
  const sorted = sortChipIds(ids, hitsById);

  let changed = false;
  let index = 0;
  for (const id of sorted) {
    const entry = chipEls.get(id);
    if (!entry) continue;
    if (row.chipsEl.children[index] !== entry.button) changed = true;
    index += 1;
  }
  if (!changed) return;

  // Moving nodes can drop focus in some browsers; put it back afterwards.
  const active = document.activeElement;
  for (const id of sorted) {
    const entry = chipEls.get(id);
    if (entry) row.chipsEl.append(entry.button);
  }
  if (active instanceof HTMLElement && row.chipsEl.contains(active)) {
    active.focus({ preventScroll: true });
  }
}

/**
 * Refresh the header count, the summary line and the per-group hit counts.
 */
function refreshSourceMeta() {
  const total = registry.length;
  let on = 0;
  for (const source of registry) {
    if (!selected.has(source.id)) continue;
    if (!isUsable(source)) continue;
    if (openOnly && source.openLicenses === false) continue;
    on += 1;
  }

  if (sourcesCountEl) {
    sourcesCountEl.textContent = `${on.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} on`;
  }
  if (sourcesSummaryEl) {
    sourcesSummaryEl.textContent = sourceSummary(summaryList());
  }

  for (const [, row] of groupRows) {
    let hits = 0;
    for (const source of row.sources) {
      if (!selected.has(source.id)) continue;
      if (!isSearchable(source, openOnly)) continue;
      const value = chipHits(source.id);
      if (typeof value === 'number') hits += value;
    }
    row.hitsEl.textContent = `${hits.toLocaleString('en-US')} hits`;
    sortGroupChips(row);
  }
}

// ---------- Chips ----------
function needsKeyText(source) {
  return `Set ${source.keyEnv ?? 'the key'} in .env to use ${source.name}.`;
}

function createChip(source) {
  const countEl = el('span', { class: 'chip-count' });
  const button = el(
    'button',
    {
      type: 'button',
      class: 'chip',
      'aria-pressed': selected.has(source.id) ? 'true' : 'false',
    },
    [
      el('span', { class: 'dot', 'aria-hidden': 'true' }),
      el('span', { class: 'chip-name', text: source.name }),
      countEl,
    ],
  );

  if (!isUsable(source)) {
    const descriptionId = `source-key-${source.id}`;
    const description = needsKeyText(source);
    button.classList.add('key');
    button.removeAttribute('aria-pressed');
    button.setAttribute('aria-disabled', 'true');
    button.setAttribute('aria-describedby', descriptionId);
    button.title = description;
    countEl.remove();
    button.append(
      el('span', { class: 'keytag', text: 'KEY' }),
      el('span', { class: 'visually-hidden', id: descriptionId, text: description }),
    );
    button.addEventListener('click', () => {
      void openSources(source.id);
    });
    chipEls.set(source.id, { button, countEl, usable: false });
    return button;
  }

  if (openOnly && source.openLicenses === false) {
    button.classList.add('off');
    button.removeAttribute('aria-pressed');
    button.setAttribute('aria-disabled', 'true');
    button.title = OPEN_DISABLED_TEXT;
    countEl.remove();
    button.append(
      el('span', { class: 'visually-hidden', text: OPEN_DISABLED_TEXT }),
    );
    chipEls.set(source.id, { button, countEl, usable: false });
    return button;
  }

  button.addEventListener('click', () => toggleSource(source.id));
  chipEls.set(source.id, { button, countEl, usable: true });
  updateChip(source.id);
  return button;
}

function createGroupButton(rowId, isOn) {
  return el('button', {
    class: 'mini',
    type: 'button',
    text: isOn ? 'All' : 'None',
    onclick: () => setGroupAll(rowId, isOn),
  });
}

function renderChips() {
  if (!groupsEl) return;
  layingOutSources = true;
  groupsEl.replaceChildren();
  chipEls.clear();
  groupRows.clear();

  const rows = groupSources(registry, groups);
  for (const row of rows) {
    const chipsEl = el('div', { class: 'chips' });
    const hitsEl = el('span', { class: 'src-group-hits' });
    const legend = el('legend', {}, [
      el('span', {
        class: 'src-group-name',
        text: groupShortLabel(row.id, row.label),
      }),
      el('div', { class: 'src-group-meta' }, [
        hitsEl,
        createGroupButton(row.id, true),
        createGroupButton(row.id, false),
      ]),
    ]);
    const groupEl = el('fieldset', { class: 'src-group' }, [legend, chipsEl]);
    for (const source of row.sources) chipsEl.append(createChip(source));
    groupRows.set(row.id, { sources: row.sources, chipsEl, hitsEl });
    groupsEl.append(groupEl);
  }

  layingOutSources = false;
  refreshSourceMeta();
}

function updateChip(id) {
  const entry = chipEls.get(id);
  if (!entry) return;

  if (entry.usable) {
    const isOn = selected.has(id);
    const state = states.get(id);
    const button = entry.button;
    const countEl = entry.countEl;

    button.classList.remove('on', 'off', 'zero', 'loading', 'has-error');
    button.removeAttribute('title');
    countEl.textContent = '';
    button.classList.toggle('on', isOn);
    button.classList.toggle('off', !isOn);
    button.setAttribute('aria-pressed', isOn ? 'true' : 'false');

    if (isOn && state?.status === 'loading') {
      button.classList.add('loading');
    } else if (state?.status === 'error') {
      button.classList.add('has-error');
      countEl.textContent =
        state.code === 'RATE_LIMIT'
          ? 'limit'
          : state.code === 'PREPARING'
            ? 'wait'
            : 'error';
      button.title = state.error || 'Search failed';
    } else if (state?.status === 'done') {
      const count = chipHits(id);
      countEl.textContent = Number(count).toLocaleString('en-US');
      if (isOn && count === 0) button.classList.add('zero');
    }
  }

  if (!layingOutSources) refreshSourceMeta();
}

// ---------- Errors ----------
function renderErrors() {
  errorListEl.replaceChildren();
  for (const [id, info] of errors) {
    if (!selected.has(id)) continue;
    const li = el('li', {}, [el('strong', { text: sourceName(id) })]);
    const text =
      typeof info.waitSeconds === 'number' && Number.isFinite(info.waitSeconds)
        ? rateLimitWaitText(info.message, info.waitSeconds)
        : info.message;
    li.append(document.createTextNode(` ${text}`));
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
    const isOn = selection.has(key);
    record.el.classList.toggle('selected', isOn);
    record.selectButton.setAttribute('aria-pressed', isOn ? 'true' : 'false');
  }

  if (count > 0 && !downloading) {
    downloadSelectedButton.textContent = 'Download selected';
  }

  updateBackToTopPosition();
}

// ---------- Back to top ----------
const narrowQuery = window.matchMedia('(max-width: 600px)');
const reduceMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

/**
 * Keep the back-to-top button above the selection bar when that bar shows.
 */
function updateBackToTopPosition() {
  if (!backToTopButton) return;
  const base = narrowQuery.matches ? 16 : 28;
  let height = 0;
  let bottom = 0;
  if (!selectionBarEl.hidden) {
    height = selectionBarEl.offsetHeight;
    const raw = parseFloat(window.getComputedStyle(selectionBarEl).bottom);
    bottom = Number.isFinite(raw) ? raw : 0;
  }
  backToTopButton.style.bottom = `${backToTopBottom(height, bottom, base)}px`;
}

/**
 * Show or hide the back-to-top button for a scroll position.
 * @param {number} scrollY
 */
function applyBackToTop(scrollY) {
  if (!backToTopButton) return;
  const visible = showBackToTop(scrollY);
  backToTopButton.classList.toggle('is-visible', visible);
  if (visible) {
    backToTopButton.removeAttribute('tabindex');
    backToTopButton.removeAttribute('aria-hidden');
  } else {
    if (document.activeElement === backToTopButton) {
      searchInput.focus({ preventScroll: true });
    }
    backToTopButton.setAttribute('tabindex', '-1');
    backToTopButton.setAttribute('aria-hidden', 'true');
  }
}

if (backToTopButton) {
  let backToTopFrame = 0;
  const checkBackToTop = () => {
    backToTopFrame = 0;
    applyBackToTop(window.scrollY);
  };
  window.addEventListener(
    'scroll',
    () => {
      if (backToTopFrame) return;
      backToTopFrame = requestAnimationFrame(checkBackToTop);
    },
    { passive: true },
  );
  window.addEventListener('resize', updateBackToTopPosition);
  checkBackToTop();
  updateBackToTopPosition();

  backToTopButton.addEventListener('click', () => {
    const reduced = reduceMotionQuery.matches;
    window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
    searchInput.focus({ preventScroll: true });
  });
}

function toggleSelection(key, isOn) {
  const record = cardsByKey.get(key);
  if (!record) return;
  if (isOn) selection.set(key, record.item);
  else selection.delete(key);
  updateSelectionUi();
}

// ---------- Cards ----------
const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Inline stroke icon: 2 px stroke, round caps, currentColor.
 * @param {string[]} paths
 * @param {number} [size]
 * @returns {SVGSVGElement}
 */
function icon(paths, size = 18) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

const DOWNLOAD_ICON = ['M12 3v12m0 0-5-5m5 5 5-5M5 21h14'];
const CHECK_ICON = ['m5 13 4 4L19 7'];
const BOOKMARK_ICON = ['M19 21 12 16 5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z'];

/**
 * Accessible label of a tile Save button.
 * @param {object} item
 * @param {boolean} saved
 * @returns {string}
 */
function saveLabel(item, saved) {
  const title = item.title || 'Untitled';
  return saved ? `Saved: ${title}` : `Save ${title}`;
}

/**
 * Show the saved state on one tile Save button.
 * @param {{item: object, saveButton: HTMLButtonElement}} record
 * @param {Set<string>} ids
 */
function applyTileSave(record, ids) {
  if (!record.saveButton) return;
  const saved = ids.has(record.key);
  record.saveButton.setAttribute('aria-pressed', saved ? 'true' : 'false');
  record.saveButton.setAttribute('aria-label', saveLabel(record.item, saved));
}

/** Saved ids, kept current for the tiles that are created next. */
let savedIdSet = savedIds();

/**
 * Sync every tile Save button with the saved ids.
 */
function updateTileSaves() {
  savedIdSet = savedIds();
  for (const record of records) applyTileSave(record, savedIdSet);
}

/**
 * Open the full resolution of a tile in the same way as the viewer: direct
 * download items open in a new tab, everything else goes through /api/download.
 * @param {object} item
 */
function downloadItem(item) {
  if (item.directDownload === true && typeof item.full === 'string' && item.full !== '') {
    window.open(item.full, '_blank', 'noopener,noreferrer');
    return;
  }
  const link = el('a', { href: downloadUrl(item), download: '' });
  document.body.append(link);
  link.click();
  link.remove();
}

/**
 * Licence text of one item, with the "Rights reserved" fallback for closed items.
 * @param {object} item
 * @returns {{text:string, reserved:boolean}}
 */
function licenceInfo(item) {
  const text = typeof item.license === 'string' ? item.license.trim() : '';
  if (text !== '') return { text, reserved: false };
  if (item.open !== true) return { text: 'Rights reserved', reserved: true };
  return { text: '', reserved: false };
}

function createCard(item, key, sourceId, mediaId) {
  const dataset = { uid: key, source: sourceId };
  if (mediaId !== null) dataset.mediaId = mediaId;
  const article = el('article', { class: 'tile', dataset });
  const title = item.title || 'Untitled';

  const width = Number(item.width);
  const height = Number(item.height);
  const hasSize =
    Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;

  const imageBox = el('div', { class: 'tile-img' });
  if (hasSize) {
    imageBox.style.aspectRatio = `${Math.round(width)} / ${Math.round(height)}`;
  } else {
    // Unknown size: keep the placeholder at the square shape that
    // estimateCardHeight assumes, so the box is never 0 px high.
    imageBox.style.aspectRatio = '1 / 1';
  }
  imageBox.style.background = `var(--wovi-ph-${placeholderTone(records.length)})`;

  const candidates = thumbCandidates(item);
  const img = el('img', {
    class: 'tile-media',
    src: candidates[0],
    alt: title,
    loading: 'lazy',
    decoding: 'async',
  });
  if (hasSize) {
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
    const naturalWidth = Number(img.naturalWidth);
    const naturalHeight = Number(img.naturalHeight);
    if (
      Number.isFinite(naturalWidth) &&
      Number.isFinite(naturalHeight) &&
      naturalWidth > 0 &&
      naturalHeight > 0
    ) {
      imageBox.style.aspectRatio = `${naturalWidth} / ${naturalHeight}`;
    }
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

  const openButton = el('button', {
    type: 'button',
    class: 'tile-open',
    'aria-label': title,
  });
  openButton.addEventListener('click', () => openCard(key));

  const selectButton = el(
    'button',
    {
      type: 'button',
      class: 'ibtn tile-select',
      'aria-pressed': selection.has(key) ? 'true' : 'false',
      'aria-label': `Select ${title}`,
    },
    [icon(CHECK_ICON)],
  );
  selectButton.addEventListener('click', () => {
    toggleSelection(key, selectButton.getAttribute('aria-pressed') !== 'true');
  });

  const saved = savedIdSet.has(key);
  const saveButton = el(
    'button',
    {
      type: 'button',
      class: 'ibtn tile-save',
      'aria-pressed': saved ? 'true' : 'false',
      'aria-label': saveLabel(item, saved),
    },
    [icon(BOOKMARK_ICON)],
  );
  saveButton.addEventListener('click', () => {
    void toggleSave(item, { sourceName: sourceName(item.source), trigger: saveButton });
  });

  const downloadButton = el(
    'button',
    {
      type: 'button',
      class: 'ibtn tile-download',
      'aria-label': 'Download full resolution',
    },
    [icon(DOWNLOAD_ICON)],
  );
  downloadButton.addEventListener('click', () => downloadItem(item));

  const overlayText = el('div', { class: 'tile-ov-text', 'aria-hidden': 'true' }, [
    el('span', { class: 'tile-title', text: title }),
    el('span', { class: 'tile-ov-source', text: sourceName(item.source) }),
  ]);

  const overlay = el('div', { class: 'tile-ov' }, [
    el('div', { class: 'tile-ov-top' }, [selectButton, saveButton, downloadButton]),
    overlayText,
  ]);

  imageBox.append(img, openButton, overlay);

  const licence = licenceInfo(item);
  const metaChildren = [
    el('span', { class: 'tile-source', text: sourceName(item.source) }),
  ];
  if (licence.text !== '') {
    const tag = el('span', {
      class: licence.reserved ? 'lic lic-rr' : 'lic',
      text: licence.text,
      title: licence.text,
    });
    metaChildren.push(tag);
  }
  const meta = el('div', { class: 'tile-meta' }, metaChildren);

  article.append(imageBox, meta);

  return { el: article, item, selectButton, saveButton, img, key, sourceId, mediaId };
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
  if (!masonryEl) return wallLayout(window.innerWidth).gap;
  const style = getComputedStyle(masonryEl);
  const raw = style.columnGap || style.gap || '';
  const value = Number.parseFloat(raw);
  if (Number.isFinite(value) && value >= 0) return value;
  return wallLayout(window.innerWidth).gap;
}

/**
 * Build the wall. In native `grid-lanes` mode the cards go straight into
 * `.masonry`; otherwise one `.masonry-col` per column holds them.
 */
function createMasonry() {
  masonryEl = el('div', { class: 'masonry' });
  masonryCols = [];
  resultsEl.append(masonryEl);
  if (nativeWall) return;
  const layout = wallLayout(window.innerWidth);
  const count = Math.min(
    layout.maxColumns,
    columnCount(resultsEl.clientWidth, layout.minColumn, masonryGap()),
  );
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
 * Put cards into the wall. In native mode they keep their insertion order; in
 * JS mode they go to the shortest column, whose heights are read one time.
 * New cards use the estimated height; restored cards also use their real height
 * when the browser can give one.
 * @param {Array<{item:object,key:string,mediaId:string|null,sourceId?:string,record?:object}>} entries
 * @param {{realHeights?:boolean}} [options]
 */
function placeEntries(entries, { realHeights = false } = {}) {
  if (!Array.isArray(entries) || entries.length === 0) return;
  if (!masonryEl) createMasonry();
  if (!nativeWall && masonryCols.length === 0) createMasonry();

  const heights = nativeWall ? [] : masonryCols.map((column) => column.offsetHeight);
  const firstWidth = masonryCols[0]?.clientWidth ?? 0;
  const columnWidth = firstWidth > 0 ? firstWidth : resultsEl.clientWidth;
  const gap = masonryGap();

  for (const entry of entries) {
    const columnIndex = nativeWall ? 0 : pickColumn(heights);
    const record =
      entry.record ??
      createCard(entry.item, entry.key, entry.sourceId, entry.mediaId);
    if (nativeWall) masonryEl.append(record.el);
    else masonryCols[columnIndex].append(record.el);
    records.push(record);
    cardsByKey.set(record.key, record);

    if (nativeWall) continue;
    let height = 0;
    if (realHeights) height = record.el.offsetHeight;
    if (!(height > 0)) height = estimateCardHeight(entry.item, columnWidth);
    heights[columnIndex] += height + gap;
  }
}

/** Re-lay the JS column wall after a resize. Native mode does nothing. */
function reflowMasonry() {
  if (!masonryEl || nativeWall) return;
  const layout = wallLayout(window.innerWidth);
  const gap = masonryGap();
  const count = Math.min(
    layout.maxColumns,
    columnCount(resultsEl.clientWidth, layout.minColumn, gap),
  );
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
    record.selectButton.setAttribute('aria-pressed', 'false');
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
      error.retryAfterSeconds = Number.isFinite(data?.retryAfterSeconds)
        ? data.retryAfterSeconds
        : null;
      throw error;
    }

    state.status = 'done';
    state.error = null;
    state.code = null;
    state.total = Number.isFinite(data.total) ? data.total : null;
    state.hasMore = Boolean(data.hasMore);
    state.page = page;
    state.retries = 0;
    state.rateLimitRetries = 0;
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

    const delay =
      state.code === 'PREPARING'
        ? retryDelay('PREPARING', null, state.retries, Math.random())
        : state.code === 'RATE_LIMIT'
          ? retryDelay(
              'RATE_LIMIT',
              error?.retryAfterSeconds ?? null,
              state.rateLimitRetries,
              Math.random(),
            )
          : null;

    if (typeof delay === 'number' && state.code === 'RATE_LIMIT') {
      errors.set(id, {
        message: state.error,
        code: state.code,
        waitSeconds: Math.ceil(delay / 1000),
      });
    } else {
      errors.set(id, { message: state.error, code: state.code });
    }
    renderErrors();
    updateChip(id);

    if (typeof delay === 'number') {
      if (state.code === 'RATE_LIMIT') state.rateLimitRetries += 1;
      else state.retries += 1;
      scheduleRetry(id, page, token, gen, delay);
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

function scheduleRetry(id, page, token, gen, delay) {
  cancelRetry(id);
  const timer = setTimeout(() => {
    retryTimers.delete(id);
    if (!isValidToken(id, token, gen)) return;
    if (!selected.has(id)) return;
    loadSource(id, page, token, gen);
  }, delay);
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
  state.rateLimitRetries = 0;
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
    record.selectButton.setAttribute('aria-pressed', 'false');
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
/**
 * Stop one source, save its cards and remove them from the grid.
 * Shared by the chip toggles, the group actions and the settings modal.
 * @param {string} id
 */
function turnSourceOff(id) {
  saveSourceToCache(id);
  abortSource(id);
  cancelRetry(id);
  removeSourceCards(id);
  errors.delete(id);
  states.delete(id);
}

function toggleSource(id) {
  const source = registryById.get(id);
  if (!source || !isSearchable(source, openOnly)) return;
  if (selected.has(id)) {
    selected.delete(id);
    turnSourceOff(id);
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

/**
 * Reload the source list after an adaptor changed in the settings modal.
 * @param {object} adapter
 */
async function reloadSources(adapter) {
  try {
    const response = await fetch('/api/sources');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error('Bad source list');
    registry = data;
  } catch {
    // Keep the current registry when the new list cannot be loaded.
    return;
  }

  registryById = new Map(registry.map((source) => [source.id, source]));
  updateSearchPlaceholder();
  renderChips();

  if (adapter && adapter.enabled === false) {
    if (selected.has(adapter.id)) {
      selected.delete(adapter.id);
      turnSourceOff(adapter.id);
      resetAutoLoad();
    }
    updateChip(adapter.id);
  } else if (adapter && adapter.enabled === true) {
    const source = registryById.get(adapter.id);
    if (source && isSearchable(source, openOnly) && !selected.has(source.id)) {
      selected.add(source.id);
      resetAutoLoad();
      if (query && !restoreIfCached(source.id)) {
        startLoad(source.id, 1, generation);
      }
    }
    updateChip(adapter.id);
  }

  saveSelection();
  updateUrl('replace');
  renderErrors();
  updateUi();
}

/**
 * Handle one successful adaptor toggle from the settings modal.
 * @param {object} adapter
 */
function onAdapterChange(adapter) {
  reloadSources(adapter);
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
      turnSourceOff(id);
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
      turnSourceOff(source.id);
    }
    renderErrors();
  }

  for (const source of registry) updateChip(source.id);
  saveSelection();
  updateUrl('replace');
  updateUi();
}

// ---------- Results header ----------
/**
 * Per-source hit list of the searched sources, for the header and the bar.
 * @returns {Array<{id:string, name:string, hits:number|null}>}
 */
function headerSourceList() {
  const list = [];
  for (const source of searchableSelected()) {
    list.push({ id: source.id, name: source.name, hits: chipHits(source.id) });
  }
  return list;
}

/**
 * Number of searched sources that gave at least one hit.
 * @param {Array<{name:string, hits:number|null}>} list
 * @returns {number}
 */
function sourcesWithHits(list) {
  return list.filter(
    (entry) => typeof entry.hits === 'number' && Number.isFinite(entry.hits) && entry.hits > 0,
  ).length;
}

/**
 * Show the query, the image total, the source line and the source bar.
 * Without a query the h1 is visually hidden and the rest is hidden.
 * The marks and text of the header are set with textContent only.
 */
function updateResultsHeader() {
  if (!resultsTitleEl) return;

  if (!query) {
    resultsTitleEl.classList.add('visually-hidden');
    resultsTitleEl.textContent = 'WOVI — World of Visual Inspiration';
    if (resultsSubEl) {
      resultsSubEl.hidden = true;
      resultsSubEl.textContent = '';
    }
    if (sourceBarEl) {
      sourceBarEl.hidden = true;
      sourceBarEl.replaceChildren();
    }
    if (sourceLegendEl) {
      sourceLegendEl.hidden = true;
      sourceLegendEl.replaceChildren();
    }
    return;
  }

  const list = headerSourceList();
  const totals = list.map((entry) => entry.hits);
  const shown = visibleItems().length;
  const total = imagesTotal(totals, shown);

  resultsTitleEl.classList.remove('visually-hidden');
  const totalEl = el('span', { class: 'results-total', text: `· ${imagesText(total)}` });
  resultsTitleEl.replaceChildren(document.createTextNode(`${query} `), totalEl);

  const withHits = sourcesWithHits(list);
  const segments = sourceBarSegments(list);

  if (resultsSubEl) {
    if (withHits === 0) {
      resultsSubEl.hidden = true;
      resultsSubEl.textContent = '';
    } else {
      resultsSubEl.hidden = false;
      resultsSubEl.textContent = `from ${withHits.toLocaleString('en-US')} of ${registry.length.toLocaleString('en-US')} sources`;
    }
  }

  if (sourceBarEl) {
    sourceBarEl.replaceChildren();
    sourceBarEl.hidden = segments.length === 0;
    for (const segment of segments) {
      const part = el('span', { class: `source-bar-seg ${segment.tone}` });
      part.style.flexGrow = String(segment.hits);
      sourceBarEl.append(part);
    }
  }

  if (sourceLegendEl) {
    sourceLegendEl.replaceChildren();
    sourceLegendEl.hidden = segments.length === 0;
    for (const segment of segments) {
      sourceLegendEl.append(
        el('li', {}, [
          el('span', { class: `legend-swatch ${segment.tone}`, 'aria-hidden': 'true' }),
          el('span', { text: segment.name }),
          el('span', {
            class: 'legend-count',
            text: segment.hits.toLocaleString('en-US'),
          }),
        ]),
      );
    }
  }
}

/**
 * Show the empty-result block when every searched source finished without a
 * card. It stays hidden while sources are still loading.
 * @param {Array<{id:string, name:string, hits:number|null}>} searchable
 */
function updateNoResults(searchable) {
  if (!noResultsEl) return;

  const show =
    query !== '' &&
    searchable.length > 0 &&
    visibleItems().length === 0 &&
    searchable.every((entry) => states.get(entry.id)?.status === 'done');

  noResultsEl.hidden = !show;
  if (!show) {
    if (noResultsTextEl) noResultsTextEl.textContent = '';
    return;
  }

  if (noResultsTextEl) {
    const sources = searchable.length === 1 ? '1 source' : `${searchable.length.toLocaleString('en-US')} sources`;
    noResultsTextEl.textContent = `Nothing in ${sources}. Try fewer words, or turn on more sources.`;
  }
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
  for (const source of searchable) {
    const state = sourceState(source.id);
    if (state.status === 'loading') loading += 1;
  }

  // The infinite-load row is the live loading message; the status line stays
  // quiet while sources are loading.
  if (loading > 0) {
    statusLineEl.textContent = '';
    return;
  }

  if (autoLoadStopped && canLoadMore()) {
    statusLineEl.textContent =
      'Some results have no loadable preview images. Press "Load more" to continue.';
    return;
  }

  statusLineEl.textContent = '';
}

// ---------- Wall chrome ----------
const SKELETON_HEIGHTS = [200, 260, 340, 220, 300];

/** Show five skeleton tiles while at least one searched source is loading. */
function updateSkeletons() {
  if (!wallSkeletonsEl) return;
  const loading =
    Boolean(query) &&
    searchableSelected().some((source) => sourceState(source.id).status === 'loading');
  wallSkeletonsEl.hidden = !loading;
  if (!loading) {
    wallSkeletonsEl.replaceChildren();
    return;
  }
  if (wallSkeletonsEl.childElementCount === SKELETON_HEIGHTS.length) return;
  wallSkeletonsEl.replaceChildren(
    ...SKELETON_HEIGHTS.map((height) => {
      const tile = el('div', { class: 'wall-skeleton' });
      tile.style.height = `${height}px`;
      return tile;
    }),
  );
}

/** Text of the infinite-load row: pulling names, the exhausted line, or nothing. */
function updateLoadRow() {
  if (!loadRowEl) return;
  const searchable = searchableSelected();
  const loadingNames = searchable
    .filter((source) => sourceState(source.id).status === 'loading')
    .map((source) => source.name);

  if (query && loadingNames.length > 0) {
    const text = pullingText(loadingNames);
    if (text === '') {
      loadRowEl.hidden = true;
      loadRowEl.replaceChildren();
      return;
    }
    loadRowEl.hidden = false;
    loadRowEl.replaceChildren(
      el('span', { class: 'load-dots', 'aria-hidden': 'true' }, [
        el('span', { class: 'load-dot' }),
        el('span', { class: 'load-dot' }),
        el('span', { class: 'load-dot' }),
      ]),
      el('span', { text }),
    );
    return;
  }

  const withHits = searchable.filter((source) => {
    const hits = chipHits(source.id);
    return typeof hits === 'number' && Number.isFinite(hits) && hits > 0;
  }).length;
  const exhausted =
    Boolean(query) &&
    loadingNames.length === 0 &&
    !canLoadMore() &&
    !searchable.some((source) => sourceState(source.id).hasMore) &&
    visibleRecords().length > 0;

  if (exhausted) {
    loadRowEl.hidden = false;
    loadRowEl.replaceChildren(el('span', { text: everythingText(withHits) }));
    return;
  }

  loadRowEl.hidden = true;
  loadRowEl.replaceChildren();
}

function updateUi() {
  updateStatus();
  const searchable = searchableSelected();
  updateResultsHeader();
  updateNoResults(searchable);
  refreshSourceMeta();
  updateSkeletons();
  updateLoadRow();

  const showMore = canLoadMore();
  loadMoreButton.hidden = !showMore;

  const count = selection.size;
  selectionBarEl.hidden = count === 0;
  selectionCountEl.textContent = `${count} selected`;
  resultsEl.classList.toggle('has-selection', count > 0);
  updateBackToTopPosition();
}

// ---------- URL ----------
// Last search applied without the viewer's `i` parameter. The viewer changes
// only `i`, so popstate can skip a full search re-apply in that case.
let lastSearchWithoutItem = searchWithoutItem(location.search);

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
  lastSearchWithoutItem = searchWithoutItem(location.search);
}

function applyUrlState() {
  lastSearchWithoutItem = searchWithoutItem(location.search);
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

/**
 * Show the number of usable sources in the search field placeholder.
 */
function updateSearchPlaceholder() {
  if (!searchInput) return;
  const usable = Array.isArray(registry) ? registry.filter(isUsable).length : 0;
  searchInput.placeholder = searchPlaceholder(usable);
}

/**
 * Show the platform keyboard shortcut in the search field.
 */
function updateShortcutLabel() {
  if (!searchShortcutEl) return;
  const platform =
    navigator.userAgentData?.platform || navigator.platform || '';
  searchShortcutEl.textContent = shortcutLabel(platform);
}

/**
 * Whether the focused element is a text field other than the search input.
 * @returns {boolean}
 */
function focusIsOtherTextField() {
  const active = document.activeElement;
  if (!active || active === searchInput) return false;
  const tag = active.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    active.isContentEditable === true
  );
}

/**
 * Focus the search field from anywhere on the page (Cmd/Ctrl + K).
 * @param {KeyboardEvent} event
 */
function onShortcutKeydown(event) {
  if (!isShortcut(event)) return;
  if (document.querySelector('dialog[open]')) return;
  if (focusIsOtherTextField()) return;
  event.preventDefault();
  if (!searchInput) return;
  searchInput.focus();
  searchInput.select();
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
  updateSearchPlaceholder();

  updateSavedCount();
  applyUrlState();
  if (sourceListError && statusLineEl.textContent === '') {
    statusLineEl.textContent = sourceListError;
  }
}

updateShortcutLabel();
document.addEventListener('keydown', onShortcutKeydown);
setSourcesOpen(loadSourcesOpen(), { persist: false });

searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const value = searchInput.value.trim();
  if (!value) return;
  runSearch(value, { urlMode: 'push' });
});

allButton.addEventListener('click', () => setAll(true));
noneButton.addEventListener('click', () => setAll(false));
if (sourcesDisc) {
  sourcesDisc.addEventListener('click', () => {
    const open = sourcesDisc.getAttribute('aria-expanded') !== 'true';
    setSourcesOpen(open);
  });
}
if (openOnlySwitch) {
  openOnlySwitch.addEventListener('click', () => {
    openOnly = !openOnly;
    applyOpenOnlyUi();
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
if (noResultsSourcesButton) {
  noResultsSourcesButton.addEventListener('click', () => {
    setSourcesOpen(true);
    sourcesDisc?.focus();
  });
}
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

window.addEventListener('popstate', () => {
  if (searchWithoutItem(location.search) === lastSearchWithoutItem) return;
  applyUrlState();
});

/**
 * Show the number of saved items in the header nav.
 * @param {object[]} [list] saved snapshots; read from storage when not given
 */
function updateSavedCount(list) {
  if (!savedCountEl) return;
  const saves = Array.isArray(list) ? list : readSaves();
  savedCountEl.textContent = saves.length.toLocaleString('en-US');
}

onSavesChange((list) => {
  updateSavedCount(list);
  updateTileSaves();
});

initSettings({ onChange: onAdapterChange });

// There is no deep link to a viewer item: drop `i` before the first read.
try {
  if (new URLSearchParams(location.search).has('i')) {
    const search = searchWithoutItem(location.search);
    history.replaceState(null, '', `${location.pathname}${search}${location.hash}`);
  }
} catch {
  // History can be unavailable in some embeddings; ignore.
}

init();
