/**
 * Full-screen viewer dialog for Open Library Fetch.
 * One dialog instance is created on first use and then reused.
 */
import {
  attributionText,
  downloadUrl,
  el,
  filmstripRange,
  firstLoaded,
  imageCandidates,
  isUpgrade,
  itemKey,
  licenceMeaning,
  needsAttribution,
  placeholderTone,
  searchWithoutItem,
  thumbCandidates,
  viewerPlan,
  withItemParam,
} from './lib.js';
import { isItemSaved, onSavesChange, toggleSave } from './saves.js';

const COPY_RESET_MS = 1400;
const SVG_NS = 'http://www.w3.org/2000/svg';

let dialog = null;
let dom = null;
let state = null;
let sourceNamesPromise = null;
let loadToken = 0;
let loadController = null;
const copyTimers = new Map();
let previouslyFocused = null;
let pushed = false;
let drag = null;
let dragEndedAt = 0;
/** Source name the panel shows for the current item. */
let currentSourceName = '';

// ---------- Icons ----------

/**
 * Inline stroke icon: 2 px stroke, round caps, currentColor.
 * @param {string[]} paths
 * @param {number} [size]
 * @param {number} [strokeWidth]
 * @returns {SVGSVGElement}
 */
function icon(paths, size = 18, strokeWidth = 2) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', String(strokeWidth));
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

const CHEVRON_LEFT = ['m15 18-6-6 6-6'];
const CHEVRON_RIGHT = ['m9 18 6-6-6-6'];
const CLOSE_ICON = ['M6 6l12 12M18 6 6 18'];
const DOWNLOAD_ICON = ['M12 3v12m0 0-5-5m5 5 5-5M5 21h14'];
const BOOKMARK_ICON = ['M19 21 12 16 5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z'];

// ---------- Source names ----------

/**
 * Load the source names one time and cache them.
 * @returns {Promise<Map<string, string>>}
 */
function getSourceNames() {
  if (!sourceNamesPromise) {
    sourceNamesPromise = fetch('/api/sources')
      .then((response) => (response.ok ? response.json() : []))
      .then((list) => {
        const names = new Map();
        if (Array.isArray(list)) {
          for (const source of list) {
            if (source && typeof source.id === 'string') {
              names.set(source.id, source.name || source.id);
            }
          }
        }
        return names;
      })
      .catch(() => new Map());
  }
  return sourceNamesPromise;
}

/**
 * Source name to show for an item, before and after the names arrive.
 * @param {object} item
 * @param {Map<string, string>|null} names
 * @returns {string}
 */
function sourceNameOf(item, names) {
  const fallback = item.source || 'Unknown source';
  if (!names) return fallback;
  return names.get(item.source) || fallback;
}

// ---------- Dialog construction ----------

/**
 * Create the dialog once. All item data is inserted later with DOM methods.
 */
function buildDialog() {
  // Stage top bar
  const logoText = el('span', { class: 'viewer-logo-mark', 'aria-hidden': 'true' }, [
    el('span', { class: 'viewer-logo-telescope', text: '\uD83D\uDD2D' }),
    document.createTextNode('WOVI'),
  ]);
  const divider = el('span', { class: 'viewer-logo-divider', 'aria-hidden': 'true' });
  const tagline = el('span', { class: 'viewer-logo-tagline', 'aria-hidden': 'true' }, [
    document.createTextNode('World of'),
    el('br'),
    document.createTextNode('Visual Inspiration'),
  ]);
  const logo = el(
    'a',
    { class: 'viewer-logo', href: '/', 'aria-label': 'WOVI, back to results' },
    [logoText, divider, tagline],
  );

  const fit = el('button', {
    class: 'viewer-seg',
    type: 'button',
    'aria-pressed': 'true',
    text: 'Fit',
  });
  const actual = el('button', {
    class: 'viewer-seg',
    type: 'button',
    'aria-pressed': 'false',
    text: 'Actual size',
  });
  const zoom = el('div', { class: 'viewer-zoom', role: 'group', 'aria-label': 'Zoom' }, [
    fit,
    actual,
  ]);

  const position = el('span', { class: 'viewer-position' });

  const top = el('div', { class: 'viewer-top' }, [logo, zoom, position]);

  // Stage middle row
  const prev = el('button', {
    class: 'viewer-nav viewer-prev',
    type: 'button',
    'aria-label': 'Previous image',
  });
  prev.append(icon(CHEVRON_LEFT, 22));

  const next = el('button', {
    class: 'viewer-nav viewer-next',
    type: 'button',
    'aria-label': 'Next image',
  });
  next.append(icon(CHEVRON_RIGHT, 22));

  const image = el('img', { class: 'viewer-image', alt: '', hidden: true });
  const spinner = el('span', { class: 'spinner viewer-spinner', 'aria-hidden': 'true' });
  const error = el('p', { class: 'viewer-error', hidden: true });
  error.textContent = 'Image could not be loaded';
  const canvas = el('div', { class: 'viewer-canvas is-fit' }, [image, spinner, error]);

  const middle = el('div', { class: 'viewer-middle' }, [prev, canvas, next]);

  const strip = el('div', { class: 'viewer-strip' });
  const hint = el('div', {
    class: 'viewer-hint',
    'aria-hidden': 'true',
    text: '\u2190 \u2192 browse \u00b7 esc close',
  });

  const stage = el('section', { class: 'viewer-stage', 'aria-label': 'Image stage' }, [
    top,
    middle,
    strip,
    hint,
  ]);

  // Panel
  const eyebrow = el('span', { class: 'viewer-eyebrow' });
  const close = el('button', {
    class: 'viewer-close',
    type: 'button',
    'aria-label': 'Close',
  });
  close.append(icon(CLOSE_ICON, 18));

  const save = el('button', {
    class: 'viewer-save',
    type: 'button',
    'aria-label': 'Save',
    'aria-pressed': 'false',
  });
  save.append(icon(BOOKMARK_ICON, 18));

  const headActions = el('div', { class: 'viewer-head-actions' }, [save, close]);
  const head = el('div', { class: 'viewer-panel-head' }, [eyebrow, headActions]);

  const body = el('div', { class: 'viewer-panel-body' });
  const panel = el('aside', { class: 'viewer-panel' }, [head, body]);

  const layout = el('div', { class: 'viewer-layout' }, [stage, panel]);
  const node = el('dialog', { class: 'viewer', 'aria-labelledby': 'viewer-title' }, [layout]);

  document.body.append(node);

  dom = {
    dialog: node,
    stage,
    logo,
    fit,
    actual,
    position,
    middle,
    canvas,
    image,
    spinner,
    error,
    prev,
    next,
    strip,
    eyebrow,
    save,
    close,
    panel,
    body,
  };

  prev.addEventListener('click', () => step(-1));
  next.addEventListener('click', () => step(1));
  close.addEventListener('click', () => node.close());
  save.addEventListener('click', () => {
    const item = state?.list[state.index];
    if (!item) return;
    void toggleSave(item, { sourceName: currentSourceName, trigger: save });
  });
  logo.addEventListener('click', (event) => {
    event.preventDefault();
    node.close();
  });
  fit.addEventListener('click', () => setZoom('fit'));
  actual.addEventListener('click', () => setZoom('actual'));
  canvas.addEventListener('click', (event) => {
    // A drag that moved must not toggle the zoom.
    if (Date.now() - dragEndedAt < 300) return;
    if (event.target !== image) return;
    if (image.hidden || image.classList.contains('is-empty')) return;
    toggleZoom();
  });
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  // A pointer that leaves the canvas before a drag starts still ends the drag.
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);

  node.addEventListener('keydown', onKeydown);
  node.addEventListener('close', onClose);

  onSavesChange(() => updateSaveButton());

  return node;
}

/**
 * Navigation keys: arrows for items, `f` for the zoom, Esc closes natively.
 * @param {KeyboardEvent} event
 */
function onKeydown(event) {
  if (
    targetIsTyping(event.target) ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey
  ) {
    return;
  }
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    step(event.key === 'ArrowLeft' ? -1 : 1);
    return;
  }
  if (event.key === 'f' || event.key === 'F') {
    event.preventDefault();
    toggleZoom();
  }
}

/**
 * Whether the event target is a text field or editable region.
 * @param {EventTarget|null} target
 * @returns {boolean}
 */
function targetIsTyping(target) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  );
}

function onClose() {
  loadToken += 1;
  if (loadController) {
    loadController.abort();
    loadController = null;
  }
  resetCopyButtons();
  drag = null;
  dragEndedAt = 0;
  if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
    previouslyFocused.focus();
  }
  if (pushed) {
    pushed = false;
    try {
      history.back();
    } catch {
      // History can be unavailable in some embeddings; ignore.
    }
  }
}

// ---------- URL ----------

/**
 * Current URL with the `i` parameter set to one item.
 * @param {string} uid
 * @returns {string}
 */
function viewerUrl(uid) {
  return `${location.pathname}${withItemParam(location.search, uid)}${location.hash}`;
}

/**
 * Replace the history entry so it points at the current item.
 * @param {object} item
 */
function replaceItemUrl(item) {
  if (!pushed) return;
  try {
    history.replaceState({ woviViewer: true }, '', viewerUrl(itemKey(item)));
  } catch {
    // History can be unavailable in some embeddings; ignore.
  }
}

/**
 * Push a history entry for the viewer and set the item parameter.
 * @param {object} item
 */
function pushItemUrl(item) {
  try {
    history.pushState(
      { woviViewer: true },
      '',
      viewerUrl(itemKey(item)),
    );
    pushed = true;
  } catch {
    pushed = false;
  }
}

/**
 * Back closes the viewer: when the item parameter is gone, close the dialog.
 */
function onPopState() {
  if (!dom || !dom.dialog.open) return;
  if (new URLSearchParams(location.search).has('i')) return;
  pushed = false;
  dom.dialog.close();
}

// ---------- Image loading ----------

/**
 * Probe an image URL without changing the visible image.
 * When the signal aborts, the request is stopped and the probe resolves with 0.
 * @param {string} src
 * @param {AbortSignal} [signal]
 * @returns {Promise<number>} the natural width, or 0 on error and on abort
 */
function probeImage(src, signal) {
  return new Promise((resolve) => {
    const probe = new Image();
    let onAbort = null;
    const cleanup = () => {
      if (onAbort && signal) signal.removeEventListener('abort', onAbort);
    };
    probe.onload = () => {
      cleanup();
      const width = Number(probe.naturalWidth);
      resolve(Number.isFinite(width) && width > 0 ? width : 0);
    };
    probe.onerror = () => {
      cleanup();
      resolve(0);
    };
    if (signal) {
      onAbort = () => {
        probe.src = '';
        cleanup();
        resolve(0);
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }
    probe.src = src;
  });
}

/**
 * Show the thumbnail at once and probe the large image in parallel.
 * The thumbnail stays when no large candidate loads.
 * @param {object} item
 */
async function loadImage(item) {
  const token = ++loadToken;
  if (loadController) loadController.abort();
  const controller = new AbortController();
  loadController = controller;

  const { small, large } = viewerPlan(item);
  const alt = item.title || 'Image';
  let largeVisible = false;
  let smallWidth = 0;

  dom.image.hidden = true;
  dom.image.removeAttribute('src');
  dom.image.alt = alt;
  dom.image.classList.remove('is-empty');
  dom.error.hidden = true;
  dom.canvas.classList.remove('is-loading-small');

  if (small.length === 0 && large.length === 0) {
    dom.spinner.hidden = true;
    dom.image.classList.add('is-empty');
    dom.error.hidden = false;
    return;
  }

  dom.spinner.hidden = false;

  const smallPromise = (async () => {
    for (const src of small) {
      if (controller.signal.aborted) return null;
      const width = await probeImage(src, controller.signal);
      if (token !== loadToken) return null;
      if (width <= 0) continue;
      smallWidth = width;
      if (!largeVisible) {
        dom.image.src = src;
        dom.image.alt = alt;
        dom.image.hidden = false;
        dom.canvas.classList.add('is-loading-small');
        if (large.length === 0) dom.spinner.hidden = true;
      }
      return src;
    }
    return null;
  })();

  const largePromise = (async () => {
    if (large.length === 0) return null;
    const probe = async (src, signal) => {
      const width = await probeImage(src, signal);
      return isUpgrade(smallWidth, width);
    };
    return firstLoaded(large, probe, { signal: controller.signal });
  })();

  const largeUrl = await largePromise;
  if (token !== loadToken) return;

  if (largeUrl) {
    largeVisible = true;
    dom.image.src = largeUrl;
    dom.image.alt = alt;
    dom.image.hidden = false;
    dom.image.classList.remove('is-empty');
    dom.canvas.classList.remove('is-loading-small');
    dom.spinner.hidden = true;
    dom.error.hidden = true;
    preloadNext();
    return;
  }

  const smallUrl = await smallPromise;
  if (token !== loadToken) return;

  dom.spinner.hidden = true;

  if (smallUrl && !dom.image.hidden) {
    dom.canvas.classList.remove('is-loading-small');
    return;
  }

  dom.image.removeAttribute('src');
  dom.image.classList.add('is-empty');
  dom.image.hidden = true;
  dom.canvas.classList.remove('is-loading-small');
  dom.error.hidden = false;
}

function preloadNext() {
  if (!state) return;
  const nextItem = state.list[state.index + 1];
  if (!nextItem) return;
  const src = imageCandidates(nextItem)[0];
  if (typeof src === 'string' && src !== '') {
    const preload = new Image();
    preload.src = src;
  }
}

// ---------- Zoom ----------

function applyZoom() {
  const actual = state?.zoom === 'actual';
  dom.canvas.classList.toggle('is-actual', actual);
  dom.canvas.classList.toggle('is-fit', !actual);
  dom.fit.setAttribute('aria-pressed', actual ? 'false' : 'true');
  dom.actual.setAttribute('aria-pressed', actual ? 'true' : 'false');
}

/**
 * Set the zoom mode and reset the canvas scroll when fitting.
 * @param {'fit'|'actual'} mode
 */
function setZoom(mode) {
  if (!state) return;
  state.zoom = mode === 'actual' ? 'actual' : 'fit';
  if (state.zoom === 'fit') {
    dom.canvas.scrollLeft = 0;
    dom.canvas.scrollTop = 0;
  }
  applyZoom();
}

function toggleZoom() {
  if (!state) return;
  setZoom(state.zoom === 'actual' ? 'fit' : 'actual');
}

// ---------- Drag to pan ----------

/**
 * Start a drag in Actual mode.
 * @param {PointerEvent} event
 */
function onPointerDown(event) {
  if (!state || state.zoom !== 'actual') return;
  if (event.button !== 0) return;
  drag = {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    left: dom.canvas.scrollLeft,
    top: dom.canvas.scrollTop,
    moved: false,
  };
  dom.canvas.classList.add('is-dragging');
}

/**
 * Move the canvas while dragging.
 * @param {PointerEvent} event
 */
function onPointerMove(event) {
  if (!drag || event.pointerId !== drag.id) return;
  const dx = event.clientX - drag.x;
  const dy = event.clientY - drag.y;
  if (!drag.moved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
    drag.moved = true;
    // Capture only once the drag starts, so a click without movement still
    // reaches the image and toggles the zoom.
    try {
      dom.canvas.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is optional.
    }
  }
  if (!drag.moved) return;
  dom.canvas.scrollLeft = drag.left - dx;
  dom.canvas.scrollTop = drag.top - dy;
}

/**
 * End a drag. A drag that moved must not toggle the zoom.
 * @param {PointerEvent} event
 */
function onPointerUp(event) {
  if (!drag || event.pointerId !== drag.id) return;
  dragEndedAt = drag.moved ? Date.now() : 0;
  drag = null;
  dom.canvas.classList.remove('is-dragging');
  try {
    dom.canvas.releasePointerCapture(event.pointerId);
  } catch {
    // Pointer capture is optional.
  }
}

// ---------- Filmstrip ----------

/**
 * Rebuild the filmstrip for the current item.
 * @param {object[]} list
 * @param {number} index
 */
function renderStrip(list, index) {
  const hadFocus = dom.strip.contains(document.activeElement);
  const { start, end } = filmstripRange(index, list.length);
  const total = list.length.toLocaleString('en-US');
  const buttons = [];
  for (let i = start; i < end; i += 1) {
    const item = list[i];
    const current = i === index;
    const button = el('button', {
      class: current ? 'viewer-thumb is-current' : 'viewer-thumb',
      type: 'button',
      'aria-label': `Image ${(i + 1).toLocaleString('en-US')} of ${total}`,
    });
    if (current) button.setAttribute('aria-current', 'true');
    button.style.backgroundColor = `var(--wovi-ph-${placeholderTone(i)})`;
    const src = thumbCandidates(item)[0];
    if (typeof src === 'string' && src !== '') {
      const thumb = el('img', { src, alt: '', loading: 'lazy' });
      thumb.addEventListener('error', () => thumb.remove());
      button.append(thumb);
    }
    button.addEventListener('click', () => show(i));
    buttons.push(button);
  }
  dom.strip.replaceChildren(...buttons);
  if (hadFocus) {
    const current = buttons[index - start];
    if (current) current.focus();
  }
}

// ---------- Panel ----------

/**
 * Fill the metadata panel for one item.
 * @param {object} item
 */
function renderPanel(item) {
  resetCopyButtons();

  const body = dom.body;
  body.replaceChildren();

  let resolvedName = sourceNameOf(item, null);
  currentSourceName = resolvedName;
  const sourceEl = dom.eyebrow;
  sourceEl.textContent = resolvedName;

  body.append(
    el('h2', { class: 'viewer-title', id: 'viewer-title', text: item.title || 'Untitled' }),
  );

  const description =
    typeof item.description === 'string' ? item.description.trim() : '';
  let showMoreButton = null;
  let descriptionEl = null;
  if (description !== '') {
    descriptionEl = el('p', { class: 'viewer-description', text: description });
    body.append(descriptionEl);
  }

  // Actions
  const actions = el('div', { class: 'viewer-actions' });

  let downloadControl;
  if (item.directDownload === true && typeof item.full === 'string' && item.full !== '') {
    downloadControl = el(
      'a',
      {
        class: 'button-primary viewer-download viewer-download-direct',
        href: item.full,
        target: '_blank',
        rel: 'noopener noreferrer',
      },
      [icon(DOWNLOAD_ICON, 18, 2.2), document.createTextNode('Open full resolution')],
    );
  } else {
    downloadControl = el('button', { class: 'button-primary viewer-download', type: 'button' }, [
      icon(DOWNLOAD_ICON, 18, 2.2),
      document.createTextNode('Download full resolution'),
    ]);
    downloadControl.addEventListener('click', () => startDownload(item));
  }
  actions.append(downloadControl);

  if (typeof item.fullTiff === 'string' && item.fullTiff !== '') {
    actions.append(
      el('a', {
        class: 'viewer-tiff-link',
        href: downloadUrl(item, item.fullTiff),
        download: true,
        text: 'Download TIFF (very large)',
      }),
    );
  }

  const copyButton = el('button', {
    class: 'viewer-secondary viewer-copy',
    type: 'button',
    text: 'Copy image URL',
  });
  copyButton.addEventListener('click', () => copyUrl(item, copyButton));

  let pageLink = null;
  if (item.pageUrl) {
    pageLink = el(
      'a',
      {
        class: 'viewer-secondary viewer-page-link',
        href: item.pageUrl,
        target: '_blank',
        rel: 'noopener',
      },
      [document.createTextNode(`View on ${resolvedName} \u2197`)],
    );
  } else {
    copyButton.classList.add('is-wide');
  }

  const actionGrid = el('div', { class: 'viewer-actions-grid' }, [copyButton, pageLink]);
  actions.append(actionGrid);
  body.append(actions);

  // Facts
  const facts = el('dl', { class: 'viewer-facts' });
  const addFact = (label, ...values) => {
    facts.append(el('dt', { text: label }));
    facts.append(el('dd', {}, values));
  };

  const provider =
    typeof item.provider === 'string' && item.provider.trim() !== '' ? item.provider.trim() : '';
  const withProvider = (name) => (provider ? `${name} via ${provider}` : name);

  const licenseText = typeof item.license === 'string' ? item.license.trim() : '';
  const licenseUrl = typeof item.licenseUrl === 'string' ? item.licenseUrl.trim() : '';
  if (licenseText !== '' || licenseUrl !== '') {
    const meaning = licenceMeaning(licenseText, licenseUrl, item.open === true);
    let licenceEl;
    if (licenseUrl !== '') {
      licenceEl = el('a', {
        href: licenseUrl,
        target: '_blank',
        rel: 'noopener',
        text: licenseText || licenseUrl,
      });
    } else {
      licenceEl = document.createTextNode(licenseText);
    }
    addFact(
      'Licence',
      licenceEl,
      el('span', { class: 'viewer-fact-soft', text: ` \u00b7 ${meaning}` }),
    );
  } else if (item.open !== true) {
    addFact(
      'Licence',
      el('span', {
        class: 'viewer-fact-soft',
        text: `Rights reserved \u00b7 ${licenceMeaning('', '', false)}`,
      }),
    );
  }

  const sourceValue = el('dd', {}, [document.createTextNode(withProvider(resolvedName))]);
  facts.append(el('dt', { text: 'Source' }));
  facts.append(sourceValue);

  if (typeof item.creator === 'string' && item.creator.trim() !== '') {
    addFact('Creator', document.createTextNode(item.creator.trim()));
  }
  if (typeof item.date === 'string' && item.date.trim() !== '') {
    addFact('Date', document.createTextNode(item.date.trim()));
  }

  if (Array.isArray(item.sets)) {
    const setNames = item.sets
      .filter((value) => typeof value === 'string' && value.trim() !== '')
      .map((value) => value.trim());
    if (setNames.length > 0) {
      addFact('In sets', document.createTextNode(setNames.join(', ')));
    }
  }

  const width = Number(item.width);
  const height = Number(item.height);
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    addFact(
      'Dimensions',
      document.createTextNode(
        `${width.toLocaleString('en-US')} \u00d7 ${height.toLocaleString('en-US')} px`,
      ),
    );
  }

  if (facts.childElementCount > 0) {
    body.append(facts);
  }

  if (typeof item.note === 'string' && item.note.trim() !== '') {
    body.append(el('p', { class: 'viewer-note', text: item.note.trim() }));
  }

  // Attribution box
  const attribution = buildAttribution(item);
  if (attribution) {
    body.append(attribution.node);
  }

  // "Show more" for a clamped description. Measured after layout, because the
  // dialog is not rendered yet on the first open.
  if (descriptionEl) {
    const measure = () => {
      if (!state || state.list[state.index] !== item) return;
      if (!descriptionEl.isConnected) return;
      if (descriptionEl.scrollHeight <= descriptionEl.clientHeight + 1) return;
      if (showMoreButton) return;
      showMoreButton = el('button', {
        class: 'viewer-text-action',
        type: 'button',
        'aria-expanded': 'false',
        text: 'Show more',
      });
      showMoreButton.addEventListener('click', () => {
        const open = descriptionEl.classList.toggle('is-open');
        showMoreButton.textContent = open ? 'Show less' : 'Show more';
        showMoreButton.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      descriptionEl.after(showMoreButton);
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(measure);
    else measure();
  }

  // Fill source-dependent text when the names arrive.
  getSourceNames().then((names) => {
    if (!state || state.list[state.index] !== item) return;
    resolvedName = sourceNameOf(item, names);
    currentSourceName = resolvedName;
    sourceEl.textContent = resolvedName;
    sourceValue.textContent = withProvider(resolvedName);
    if (pageLink) pageLink.textContent = `View on ${resolvedName} \u2197`;
    if (attribution) attribution.setSource(resolvedName);
  });
}

/**
 * Attribution card, or null when the licence does not need credit.
 * @param {object} item
 * @returns {{node: HTMLElement, setSource: (name: string) => void}|null}
 */
function buildAttribution(item) {
  if (!needsAttribution(item.license, item.licenseUrl)) return null;
  let sourceName = sourceNameOf(item, null);
  const license = typeof item.license === 'string' ? item.license : '';
  const text = () => attributionText({
    title: item.title,
    creator: item.creator,
    source: sourceName,
    license,
  });

  const paragraph = el('p', { class: 'viewer-attribution-text', text: text() });
  const copyButton = el('button', {
    class: 'viewer-text-action',
    type: 'button',
    text: 'Copy',
  });
  copyButton.addEventListener('click', () =>
    copyValue(text(), copyButton, 'Copy'),
  );

  const node = el('div', { class: 'viewer-attribution' }, [
    el('div', { class: 'viewer-attribution-head' }, [
      el('span', { class: 'viewer-attribution-label', text: 'Attribution' }),
      copyButton,
    ]),
    paragraph,
  ]);

  return {
    node,
    setSource(name) {
      sourceName = name;
      paragraph.textContent = text();
    },
  };
}

function startDownload(item) {
  const link = document.createElement('a');
  link.href = downloadUrl(item);
  link.download = '';
  document.body.append(link);
  link.click();
  link.remove();
}

async function copyUrl(item, button) {
  const value = item.full || item.preview || '';
  if (!value) {
    flashCopy(button, 'Copy failed', 'Copy image URL');
    return;
  }
  try {
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
      throw new Error('Clipboard unavailable');
    }
    await navigator.clipboard.writeText(value);
    flashCopy(button, 'Copied \u2713', 'Copy image URL');
  } catch {
    flashCopy(button, 'Copy failed', 'Copy image URL');
  }
}

/**
 * Copy a value and show the feedback on the button.
 * @param {string} value
 * @param {HTMLElement} button
 * @param {string} label
 */
async function copyValue(value, button, label) {
  try {
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
      throw new Error('Clipboard unavailable');
    }
    await navigator.clipboard.writeText(value);
    flashCopy(button, 'Copied \u2713', label);
  } catch {
    flashCopy(button, 'Copy failed', label);
  }
}

/**
 * Show a temporary copy message on a button.
 * @param {HTMLElement} button
 * @param {string} message
 * @param {string} label text to restore
 */
function flashCopy(button, message, label) {
  // Another button may still be showing its feedback: restore it at once.
  resetCopyButtons();
  button.textContent = message;
  const timer = window.setTimeout(() => {
    copyTimers.delete(button);
    if (button.isConnected) button.textContent = label;
  }, COPY_RESET_MS);
  copyTimers.set(button, { timer, label });
}

/**
 * Restore every button with pending copy feedback and cancel its timer.
 */
function resetCopyButtons() {
  for (const [button, entry] of copyTimers) {
    clearTimeout(entry.timer);
    if (button.isConnected) button.textContent = entry.label;
  }
  copyTimers.clear();
}

/**
 * Show the saved state of the current item on the panel Save button.
 */
function updateSaveButton() {
  if (!dom || !dom.save) return;
  const item = state?.list[state.index];
  const saved = item ? isItemSaved(item) : false;
  dom.save.setAttribute('aria-pressed', saved ? 'true' : 'false');
  dom.save.setAttribute('aria-label', saved ? 'Saved' : 'Save');
}

/**
 * Update the position, the nav buttons and the logo link.
 */
function updateChrome() {
  if (!state || !dom) return;
  const total = state.list.length;
  dom.position.textContent = `${(state.index + 1).toLocaleString('en-US')} / ${total.toLocaleString('en-US')}`;
  const hadPrevFocus = document.activeElement === dom.prev;
  const hadNextFocus = document.activeElement === dom.next;
  dom.prev.hidden = state.index <= 0;
  dom.next.hidden = state.index >= total - 1;
  // Keep focus on a visible control when the focused arrow disappears.
  if ((hadPrevFocus && dom.prev.hidden) || (hadNextFocus && dom.next.hidden)) {
    const other = hadPrevFocus ? dom.next : dom.prev;
    if (!other.hidden) other.focus();
    else dom.close.focus();
  }
  dom.logo.href = `${location.pathname}${searchWithoutItem(location.search)}`;
}

// ---------- Navigation ----------

function show(index) {
  const list = state.list;
  const nextIndex = Math.min(Math.max(index, 0), list.length - 1);
  state.index = nextIndex;
  state.zoom = 'fit';
  applyZoom();
  dom.canvas.scrollLeft = 0;
  dom.canvas.scrollTop = 0;
  dom.panel.scrollTop = 0;

  const item = list[nextIndex];
  if (!item) return;

  renderPanel(item);
  updateSaveButton();
  loadImage(item);
  renderStrip(list, nextIndex);
  updateChrome();
  replaceItemUrl(item);
}

function step(delta) {
  if (!state) return;
  show(state.index + delta);
}

// ---------- Public API ----------

/**
 * Open the viewer for one item of a list.
 * @param {object[]} list visible items in display order
 * @param {number} index index of the requested item
 */
export function openViewer(list, index) {
  if (!Array.isArray(list) || list.length === 0) return;
  const startIndex = Number.isInteger(index) ? index : 0;
  if (!dialog) {
    dialog = buildDialog();
    window.addEventListener('popstate', onPopState);
  }

  const hadFocus = document.activeElement;
  if (!dialog.open) {
    previouslyFocused = hadFocus instanceof HTMLElement ? hadFocus : null;
  }

  state = {
    list: list.slice(),
    index: Math.min(Math.max(startIndex, 0), list.length - 1),
    zoom: 'fit',
  };

  const wasOpen = dialog.open;
  show(state.index);

  if (!wasOpen) {
    const item = state.list[state.index];
    if (item) pushItemUrl(item);
    dialog.showModal();
  }
  dom.close.focus();
}
