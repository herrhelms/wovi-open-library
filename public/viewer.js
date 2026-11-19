/**
 * Full-screen viewer dialog for Open Library Fetch.
 * One dialog instance is created on first use and then reused.
 */
import { downloadUrl, el } from './lib.js';

const COPY_RESET_MS = 1500;

let dialog = null;
let dom = null;
let state = null;
let sourceNamesPromise = null;
let loadToken = 0;
let copyTimer = 0;
let previouslyFocused = null;

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

// ---------- Dialog construction ----------

/**
 * Create the dialog once. All item data is inserted later with DOM methods.
 */
function buildDialog() {
  const image = el('img', { class: 'viewer-image', alt: '', hidden: true });
  const spinner = el('span', { class: 'spinner viewer-spinner', 'aria-hidden': 'true' });
  const error = el('p', { class: 'viewer-error', hidden: true });
  error.textContent = 'Image could not be loaded';

  const canvas = el('div', { class: 'viewer-canvas' }, [image, spinner, error]);

  const prev = el('button', {
    class: 'viewer-nav viewer-prev',
    type: 'button',
    'aria-label': 'Previous item',
  });
  prev.append(el('span', { class: 'viewer-nav-glyph', 'aria-hidden': 'true', text: '\u2039' }));

  const next = el('button', {
    class: 'viewer-nav viewer-next',
    type: 'button',
    'aria-label': 'Next item',
  });
  next.append(el('span', { class: 'viewer-nav-glyph', 'aria-hidden': 'true', text: '\u203a' }));

  const stage = el('section', { class: 'viewer-stage', 'aria-label': 'Image stage' }, [
    canvas,
    prev,
    next,
  ]);

  const close = el('button', {
    class: 'viewer-close',
    type: 'button',
    'aria-label': 'Close viewer',
    text: '\u00d7',
  });

  const panelInner = el('div', { class: 'viewer-panel-inner' });
  const panel = el('aside', { class: 'viewer-panel' }, [close, panelInner]);

  const layout = el('div', { class: 'viewer-layout' }, [stage, panel]);
  const node = el('dialog', { class: 'viewer', 'aria-label': 'Image viewer' }, [layout]);

  document.body.append(node);

  dom = {
    dialog: node,
    stage,
    canvas,
    image,
    spinner,
    error,
    prev,
    next,
    close,
    panel,
    panelInner,
  };

  prev.addEventListener('click', () => step(-1));
  next.addEventListener('click', () => step(1));
  close.addEventListener('click', () => node.close());
  image.addEventListener('click', () => {
    if (image.hidden || image.classList.contains('is-empty')) return;
    toggleZoom();
  });

  node.addEventListener('keydown', onKeydown);
  node.addEventListener('close', onClose);

  return node;
}

/**
 * Arrow keys move between items, except while typing in a text field.
 * @param {KeyboardEvent} event
 */
function onKeydown(event) {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  const target = event.target;
  if (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT')
  ) {
    return;
  }
  event.preventDefault();
  step(event.key === 'ArrowLeft' ? -1 : 1);
}

function onClose() {
  loadToken += 1;
  if (copyTimer) {
    clearTimeout(copyTimer);
    copyTimer = 0;
  }
  if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
    previouslyFocused.focus();
  }
}

// ---------- Image loading ----------

/**
 * Probe an image URL without changing the visible image.
 * @param {string} src
 * @returns {Promise<boolean>}
 */
function probeImage(src) {
  return new Promise((resolve) => {
    const probe = new Image();
    probe.onload = () => resolve(true);
    probe.onerror = () => resolve(false);
    probe.src = src;
  });
}

/**
 * Show the preview image, fall back to the thumbnail, then show an error.
 * @param {object} item
 */
async function loadImage(item) {
  const token = ++loadToken;
  const candidates = [item.preview, item.thumb].filter(
    (src, index, list) => typeof src === 'string' && src !== '' && list.indexOf(src) === index,
  );

  dom.image.hidden = true;
  dom.image.classList.remove('is-empty');
  dom.error.hidden = true;
  dom.spinner.hidden = candidates.length === 0;

  if (candidates.length === 0) {
    dom.image.classList.add('is-empty');
    dom.error.hidden = false;
    return;
  }

  for (const src of candidates) {
    const ok = await probeImage(src);
    if (token !== loadToken) return;
    if (ok) {
      dom.image.src = src;
      dom.image.alt = item.title || 'Image';
      dom.image.hidden = false;
      dom.spinner.hidden = true;
      dom.error.hidden = true;
      preloadNext();
      return;
    }
  }

  if (token !== loadToken) return;
  dom.image.removeAttribute('src');
  dom.image.classList.add('is-empty');
  dom.spinner.hidden = true;
  dom.error.hidden = false;
}

function preloadNext() {
  if (!state) return;
  const nextItem = state.list[state.index + 1];
  if (!nextItem) return;
  const src = nextItem.preview || nextItem.thumb;
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
}

function toggleZoom() {
  if (!state) return;
  state.zoom = state.zoom === 'actual' ? 'fit' : 'actual';
  applyZoom();
}

// ---------- Panel ----------

/**
 * Fill the metadata panel for one item.
 * @param {object} item
 */
function renderPanel(item) {
  if (copyTimer) {
    clearTimeout(copyTimer);
    copyTimer = 0;
  }

  const panel = dom.panelInner;
  panel.replaceChildren();

  const sourceLabel = el('p', {
    class: 'viewer-source',
    text: item.source || 'Unknown source',
  });
  panel.append(sourceLabel);

  panel.append(
    el('h2', {
      class: 'viewer-title',
      text: item.title || 'Untitled',
    }),
  );

  const bylineParts = [item.creator, item.date].filter(
    (value) => typeof value === 'string' && value.trim() !== '',
  );
  if (bylineParts.length > 0) {
    panel.append(el('p', { class: 'viewer-byline', text: bylineParts.join(' \u00b7 ') }));
  }

  if (typeof item.description === 'string' && item.description.trim() !== '') {
    panel.append(
      el('div', { class: 'viewer-block' }, [
        el('p', { class: 'viewer-description', text: item.description }),
      ]),
    );
  }

  // Definition list
  const facts = el('dl', { class: 'viewer-facts' });
  const addFact = (label, value) => {
    facts.append(el('dt', { text: label }));
    const dd = el('dd', {}, [value]);
    facts.append(dd);
    return dd;
  };

  const provider =
    typeof item.provider === 'string' && item.provider.trim() !== ''
      ? item.provider.trim()
      : null;
  const withProvider = (name) => (provider ? `${name} via ${provider}` : name);

  const sourceValue = addFact(
    'Source',
    document.createTextNode(withProvider(item.source || 'Unknown source')),
  );

  if (item.license || item.licenseUrl) {
    if (item.licenseUrl) {
      addFact(
        'License',
        el('a', {
          href: item.licenseUrl,
          target: '_blank',
          rel: 'noopener',
          text: item.license || item.licenseUrl,
        }),
      );
    } else {
      addFact('License', document.createTextNode(item.license));
    }
  }

  const width = Number(item.width);
  const height = Number(item.height);
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    addFact('Pixel size', document.createTextNode(`${width} \u00d7 ${height} px`));
  }

  if (facts.childElementCount > 0) {
    panel.append(el('div', { class: 'viewer-block' }, [facts]));
  }

  // Page link
  let pageLink = null;
  if (item.pageUrl) {
    pageLink = el('a', {
      class: 'viewer-page-link',
      href: item.pageUrl,
      target: '_blank',
      rel: 'noopener',
      text: `View on ${item.source || 'source'}`,
    });
    panel.append(el('div', { class: 'viewer-block' }, [pageLink]));
  }

  // Download and copy
  const downloadButton = el('button', {
    class: 'button-primary viewer-download',
    type: 'button',
    text: 'Download full resolution',
  });
  downloadButton.addEventListener('click', () => startDownload(item));

  let tiffLink = null;
  if (typeof item.fullTiff === 'string' && item.fullTiff !== '') {
    tiffLink = el('a', {
      class: 'viewer-tiff-link',
      href: downloadUrl(item, item.fullTiff),
      download: true,
      text: 'Download TIFF (very large)',
    });
  }

  const copyButton = el('button', {
    class: 'viewer-button',
    type: 'button',
    text: 'Copy image URL',
  });
  copyButton.addEventListener('click', () => copyUrl(item, copyButton));

  const zoomButton = el('button', {
    class: 'viewer-button',
    type: 'button',
    text: 'Fit / Actual size',
  });
  zoomButton.addEventListener('click', () => toggleZoom());

  panel.append(
    el('div', { class: 'viewer-block viewer-actions' }, [
      downloadButton,
      tiffLink,
      el('div', { class: 'viewer-action-row' }, [copyButton, zoomButton]),
    ]),
  );

  const position = el('p', { class: 'viewer-position' });
  panel.append(position);

  // Fill source-dependent text now (fallback) and update when names arrive.
  updatePosition();
  getSourceNames().then((names) => {
    if (!state || state.list[state.index] !== item) return;
    const name = names.get(item.source) || item.source || 'source';
    sourceLabel.textContent = name;
    sourceValue.textContent = withProvider(name);
    if (pageLink) pageLink.textContent = `View on ${name}`;
  });
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
    flashCopy(button, 'Copy failed');
    return;
  }
  try {
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
      throw new Error('Clipboard unavailable');
    }
    await navigator.clipboard.writeText(value);
    flashCopy(button, 'Copied');
  } catch {
    flashCopy(button, 'Copy failed');
  }
}

function flashCopy(button, message) {
  if (copyTimer) clearTimeout(copyTimer);
  button.textContent = message;
  copyTimer = window.setTimeout(() => {
    copyTimer = 0;
    if (button.isConnected) button.textContent = 'Copy image URL';
  }, COPY_RESET_MS);
}

function updatePosition() {
  if (!state || !dom) return;
  const position = dom.panelInner.querySelector('.viewer-position');
  if (position) {
    position.textContent = `${state.index + 1} of ${state.list.length}`;
  }
  dom.prev.disabled = state.index <= 0;
  dom.next.disabled = state.index >= state.list.length - 1;
}

// ---------- Navigation ----------

function show(index) {
  const list = state.list;
  const nextIndex = Math.min(Math.max(index, 0), list.length - 1);
  state.index = nextIndex;
  state.zoom = 'fit';
  applyZoom();

  const item = list[nextIndex];
  if (!item) return;

  renderPanel(item);
  loadImage(item);
  updatePosition();
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

  show(state.index);

  if (!dialog.open) {
    dialog.showModal();
  }
  dom.close.focus();
}
