/**
 * Sources modal for Open Library Fetch.
 * Plain ES module, no build step. All API text is inserted with DOM methods.
 */
import {
  adaptorFilterCounts,
  adaptorMatchesFilter,
  el,
  filterAdapters,
  linkParts,
  sourcesSubline,
  splitNotes,
  statusPill,
} from './lib.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const COPY_RESET_MS = 1400;

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'ready', label: 'Ready' },
  { key: 'key', label: 'Needs key' },
  { key: 'off', label: 'Off' },
];

/** @type {HTMLElement|null} */
let openButton = null;
/** @type {HTMLDialogElement|null} */
let dialog = null;
/** Element that had focus when the dialog opened. @type {HTMLElement|null} */
let returnFocus = null;

/** Adapters from the last `GET /api/adapters`. @type {object[]} */
let adapters = [];
/** @type {Array<{id:string,label:string}>} */
let groups = [];
/** @type {Array<{folder:string,error:string}>} */
let invalid = [];
/** Whether the adaptor list is in memory. */
let dataLoaded = false;
/** Message of the last failed `GET /api/adapters`. @type {string|null} */
let dataError = null;
/** Shared running `GET /api/adapters`, or `null`. @type {Promise<boolean>|null} */
let loadPromise = null;
/** Token of the current open session. */
let session = 0;
/** Adaptor id the current session should focus once the data arrives. @type {string|null} */
let pendingFocusId = null;

/** Row elements by adaptor id. @type {Map<string, HTMLElement>} */
let rowById = new Map();
/** Adapter records by adaptor id. @type {Map<string, object>} */
let adapterById = new Map();
/** Group section elements by group id. @type {Map<string, HTMLElement>} */
let sectionByGroup = new Map();
/** Group count elements by group id. @type {Map<string, HTMLElement>} */
let groupCountById = new Map();
/** Segment button elements by filter key. @type {Map<string, HTMLElement>} */
let segmentByKey = new Map();

/** Search field. @type {HTMLInputElement|null} */
let filterInput = null;
/** Header sub line. @type {HTMLElement|null} */
let sublineEl = null;
/** Empty state block. @type {HTMLElement|null} */
let emptyEl = null;
/** Empty state text. @type {HTMLElement|null} */
let emptyTextEl = null;

/** Current segmented filter. @type {'all'|'ready'|'key'|'off'} */
let filter = 'all';
/** Copy reset timers, one per copy button. @type {Map<HTMLElement, number>} */
const copyTimers = new Map();

/** @type {((adapter: object) => void)|null} */
let changeListener = null;

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

const CLOSE_ICON = ['M6 6l12 12M18 6 6 18'];
const SEARCH_ICON = ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14', 'm20 20-4-4'];
const CHEVRON_DOWN = ['m6 9 6 6 6-6'];
const CHEVRON_UP = ['m6 15 6-6 6 6'];

function externalLink(href, text, className) {
  return el('a', {
    class: className,
    href,
    text,
    target: '_blank',
    rel: 'noopener',
  });
}

/** Cancel every copy reset timer. */
function clearCopyTimers() {
  for (const timer of copyTimers.values()) clearTimeout(timer);
  copyTimers.clear();
}

/**
 * Cancel the running reset timer of one copy button.
 * @param {HTMLElement} button
 */
function clearCopyTimer(button) {
  const timer = copyTimers.get(button);
  if (timer !== undefined) {
    clearTimeout(timer);
    copyTimers.delete(button);
  }
}

/**
 * Update the header sub line and the segment counts.
 */
function updateCounts() {
  if (sublineEl) sublineEl.textContent = sourcesSubline(adapters);

  const counts = adaptorFilterCounts(adapters);
  for (const [key, button] of segmentByKey) {
    const countEl = button.querySelector('.src-seg-count');
    if (countEl) countEl.textContent = counts[key].toLocaleString('en-US');
  }

  for (const [groupId, countEl] of groupCountById) {
    const list = adapters.filter((adapter) => adapter?.group === groupId);
    const on = list.filter((adapter) => adapter?.enabled === true).length;
    countEl.textContent = `${on.toLocaleString('en-US')} / ${list.length.toLocaleString('en-US')} on`;
  }
}

/**
 * Text parts of one key step, with link parts as external links.
 * @param {string} text
 * @returns {Array<Node|string>}
 */
function stepNodes(text) {
  return linkParts(text).map((part) =>
    part.href ? externalLink(part.href, part.text, 'src-link') : part.text,
  );
}

/**
 * Build the copy button of the dark code row.
 * @param {string} envName
 * @returns {HTMLElement}
 */
function copyButton(envName) {
  const button = el('button', {
    type: 'button',
    class: 'src-copy',
    text: 'Copy',
  });

  button.addEventListener('click', async () => {
    clearCopyTimer(button);
    const value = `${envName}=`;
    try {
      await navigator.clipboard.writeText(value);
      button.textContent = 'Copied ✓';
    } catch {
      button.textContent = 'Copy failed';
    }
    clearCopyTimer(button);
    const timer = setTimeout(() => {
      copyTimers.delete(button);
      button.textContent = 'Copy';
    }, COPY_RESET_MS);
    copyTimers.set(button, timer);
  });

  return button;
}

/**
 * Build the key setup panel of one adaptor.
 * @param {object} adapter
 * @param {object} key
 * @param {string} panelId
 * @param {string} kind
 * @returns {HTMLElement}
 */
function keyPanel(adapter, key, panelId, kind) {
  const children = [];
  const steps = Array.isArray(key.steps)
    ? key.steps.filter((step) => typeof step === 'string' && step.trim() !== '')
    : [];
  const signup = typeof key.signupUrl === 'string' ? key.signupUrl : '';
  const stepItems = [];

  if (signup !== '' && !steps.some((step) => step.includes(signup))) {
    const step = el('li', {}, ['Get a key at ', externalLink(signup, signup, 'src-link')]);
    stepItems.push(step);
  }
  for (const text of steps) {
    stepItems.push(el('li', {}, stepNodes(text)));
  }
  if (stepItems.length > 0) children.push(el('ol', { class: 'src-steps' }, stepItems));

  if (typeof key.limits === 'string' && key.limits !== '') {
    children.push(el('p', { class: 'src-limits', text: key.limits }));
  }

  const envName = typeof key.env === 'string' ? key.env : '';
  children.push(
    el('div', { class: 'src-code' }, [
      el('span', { class: 'src-code-text' }, [
        el('span', { text: `${envName}=` }),
        el('span', { class: 'src-code-key', text: 'your-key' }),
      ]),
      copyButton(envName),
    ]),
    el('p', { class: 'src-hint' }, [
      'Add this line to ',
      el('span', { class: 'src-mono', text: '.env' }),
      ', then restart the server.',
    ]),
  );

  if (kind === 'optional' && typeof key.default === 'string' && key.default !== '') {
    children.push(
      el('p', { class: 'src-hint', text: 'Without a key, a demo key is used.' }),
    );
  }

  if (splitNotes(adapter.notes).untested) {
    children.push(
      el('p', {
        class: 'src-hint',
        text: 'Built from the public API docs, not yet tested with a live key.',
      }),
    );
  }

  return el(
    'div',
    {
      class: 'src-panel',
      id: panelId,
      hidden: true,
    },
    children,
  );
}

/**
 * Build the notes line and the "More" disclosure of one adaptor.
 * @param {object} adapter
 * @returns {HTMLElement[]}
 */
function notesNodes(adapter) {
  const { notes } = splitNotes(adapter.notes);
  if (notes.length === 0) return [];

  const nodes = [];
  const line = el('p', { class: 'src-note' }, [el('span', { text: notes[0] })]);

  if (notes.length > 1) {
    const listId = `src-notes-${adapter.id}`;
    const more = el('button', {
      type: 'button',
      class: 'src-more',
      text: 'More',
      'aria-expanded': 'false',
      'aria-controls': listId,
    });
    const extra = el(
      'ul',
      { class: 'src-note-list', id: listId, hidden: true },
      notes.slice(1).map((note) => el('li', { text: note })),
    );

    more.addEventListener('click', () => {
      const open = more.getAttribute('aria-expanded') === 'true';
      more.setAttribute('aria-expanded', open ? 'false' : 'true');
      more.textContent = open ? 'More' : 'Less';
      extra.hidden = open;
    });

    line.append(' ', more);
    nodes.push(line, extra);
  } else {
    nodes.push(line);
  }

  return nodes;
}

/**
 * Build one adaptor row.
 * @param {object} adapter
 * @returns {HTMLElement}
 */
function createRow(adapter) {
  const status = statusPill(adapter);
  const key = adapter.key && typeof adapter.key === 'object' ? adapter.key : null;
  const hasPanel = Boolean(key) && key.configured !== true;
  const panelId = `src-key-${adapter.id}`;

  const nameRow = el('div', { class: 'src-name-row' }, [
    externalLink(adapter.homepage, adapter.name, 'src-name'),
  ]);
  if (splitNotes(adapter.notes).untested) {
    nameRow.append(el('span', { class: 'src-untested', text: 'untested' }));
  }

  const main = el('div', { class: 'src-main' }, [nameRow]);

  if (typeof adapter.description === 'string' && adapter.description !== '') {
    main.append(el('p', { class: 'src-desc', text: adapter.description }));
  }

  main.append(...notesNodes(adapter));

  if (adapter.openLicenses === false) {
    main.append(
      el('p', {
        class: 'src-warn',
        text: 'No licence data. Not searched with Open licences only.',
      }),
    );
  }

  if (typeof adapter.docsUrl === 'string' && adapter.docsUrl !== '') {
    main.append(
      el('p', { class: 'src-docs' }, [
        externalLink(adapter.docsUrl, 'API documentation ↗', 'src-docs-link'),
      ]),
    );
  }

  const actions = el('div', { class: 'src-actions' });
  let setup = null;
  let panel = null;

  if (hasPanel) {
    setup = el(
      'button',
      {
        type: 'button',
        class: `src-setup src-setup-${status.kind}`,
        'aria-expanded': 'false',
        'aria-controls': panelId,
      },
      [
        el('span', { text: 'Set up key' }),
        icon(CHEVRON_DOWN, 12),
      ],
    );
    actions.append(setup);
  }

  actions.append(
    el('span', { class: `src-pill src-pill-${status.kind}`, text: status.text }),
  );

  const track = el('span', { class: 'src-track' }, [el('span', { class: 'src-knob' })]);
  const toggle = el(
    'button',
    {
      type: 'button',
      class: 'src-switch',
      role: 'switch',
      'aria-checked': adapter.enabled === true ? 'true' : 'false',
      'aria-label': adapter.name,
    },
    [track],
  );

  const rowError = el('p', { class: 'src-row-error', role: 'status' });

  const row = el('li', { class: 'src-row', dataset: { adaptorId: adapter.id } }, [
    main,
    actions,
    toggle,
    rowError,
  ]);

  if (hasPanel) {
    panel = keyPanel(adapter, key, panelId, status.kind);
    row.append(panel);
    setup.addEventListener('click', () => {
      setPanelOpen(row, setup, panel, !isPanelOpen(row));
    });
  }

  toggle.addEventListener('click', () => {
    toggleAdapter(adapter.id, toggle, rowError, row);
  });

  return row;
}

/**
 * @param {HTMLElement} row
 * @returns {boolean}
 */
function isPanelOpen(row) {
  return row.classList.contains('open');
}

/**
 * Open or close the key panel of one row.
 * @param {HTMLElement} row
 * @param {HTMLElement} setup
 * @param {HTMLElement} panel
 * @param {boolean} open
 */
function setPanelOpen(row, setup, panel, open) {
  panel.hidden = !open;
  row.classList.toggle('open', open);
  setup.setAttribute('aria-expanded', open ? 'true' : 'false');
  setup.replaceChildren(
    el('span', { text: 'Set up key' }),
    icon(open ? CHEVRON_UP : CHEVRON_DOWN, 12),
  );
}

/**
 * Send one toggle and update the stored adapter on success.
 * @param {string} id
 * @param {HTMLElement} toggle
 * @param {HTMLElement} rowError
 * @param {HTMLElement} row
 */
async function toggleAdapter(id, toggle, rowError, row) {
  const index = adapters.findIndex((adapter) => adapter.id === id);
  if (index < 0) return;

  if (toggle.getAttribute('aria-disabled') === 'true') return;

  const before = adapters[index].enabled === true;
  const next = toggle.getAttribute('aria-checked') !== 'true';
  toggle.setAttribute('aria-disabled', 'true');

  try {
    const response = await fetch(`/api/adapters/${encodeURIComponent(id)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: next }),
    });

    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok || !data || typeof data !== 'object') {
      throw new Error(data?.error || `HTTP ${response.status}`);
    }

    adapters[index] = data;
    adapterById.set(id, data);
    toggle.setAttribute('aria-checked', data.enabled === true ? 'true' : 'false');
    rowError.textContent = '';

    const pill = row.querySelector('.src-pill');
    const status = statusPill(data);
    if (pill) {
      pill.className = `src-pill src-pill-${status.kind}`;
      pill.textContent = status.text;
    }

    updateCounts();
    toggle.removeAttribute('aria-disabled');
    if (changeListener) changeListener(data);
  } catch (error) {
    toggle.setAttribute('aria-checked', before ? 'true' : 'false');
    toggle.removeAttribute('aria-disabled');
    rowError.textContent = error?.message || 'The setting could not be saved.';
  }
}

/**
 * Show only the rows that match the find text and the segmented filter.
 */
function applyFilter() {
  if (!filterInput) return;

  const text = filterInput.value;
  const matches = new Set(filterAdapters(adapters, text).map((adapter) => adapter.id));
  let shown = 0;

  for (const [id, row] of rowById) {
    const adapter = adapterById.get(id);
    const visible = matches.has(id) && adaptorMatchesFilter(adapter, filter);
    row.hidden = !visible;
    if (visible) shown += 1;
  }

  for (const section of sectionByGroup.values()) {
    let anyVisible = false;
    for (const row of section.querySelectorAll('.src-row')) {
      if (!row.hidden) {
        anyVisible = true;
        break;
      }
    }
    section.hidden = !anyVisible;
  }

  if (emptyEl) {
    emptyEl.hidden = shown > 0;
    if (emptyTextEl) {
      const query = text.trim();
      emptyTextEl.textContent =
        query === '' ? 'No source in this view.' : `No source matches “${query}”.`;
    }
  }
}

/**
 * Pick a segmented filter, with or without re-applying the row filter.
 * @param {'all'|'ready'|'key'|'off'} key
 * @param {boolean} [rebuild]
 */
function setFilter(key, rebuild = true) {
  filter = FILTERS.some((entry) => entry.key === key) ? key : 'all';
  for (const [name, button] of segmentByKey) {
    button.setAttribute('aria-pressed', name === filter ? 'true' : 'false');
  }
  if (rebuild) applyFilter();
}

function createInvalidSection() {
  return el('section', { class: 'src-section src-invalid' }, [
    el('div', { class: 'src-section-head' }, [
      el('h3', { class: 'src-section-title', text: 'These adaptor folders have errors' }),
    ]),
    el(
      'ul',
      { class: 'src-invalid-list' },
      invalid.map((entry) =>
        el('li', { class: 'src-invalid-row' }, [
          el('strong', { class: 'src-invalid-name', text: String(entry.folder) }),
          el('span', { class: 'src-invalid-error', text: String(entry.error) }),
        ]),
      ),
    ),
  ]);
}

/**
 * Build the content shown when the adaptor list could not be loaded.
 * @param {string} message
 * @returns {HTMLElement}
 */
function createErrorContent(message) {
  return el('div', { class: 'src-modal' }, [
    createHead(),
    el('p', { class: 'src-load-error', role: 'alert', text: message }),
    createFooter(),
  ]);
}

/**
 * Build the shared dialog header with the title and the close button.
 * @returns {HTMLElement}
 */
function createHead() {
  return el('div', { class: 'src-head' }, [
    el('div', { class: 'src-head-top' }, [
      el('div', {}, [
        el('h2', { class: 'src-title', id: 'adaptors-title', text: 'Sources' }),
      ]),
      closeButton(),
    ]),
  ]);
}

function closeButton() {
  return el(
    'button',
    {
      type: 'button',
      class: 'src-close',
      'aria-label': 'Close',
      onclick: () => dialog?.close(),
    },
    [icon(CLOSE_ICON, 18)],
  );
}

/**
 * Build the content shown while the adaptor list is still loading.
 * @returns {HTMLElement}
 */
function createLoadingContent() {
  return el('div', { class: 'src-modal' }, [
    createHead(),
    el('p', { class: 'src-loading', role: 'status', text: 'Loading sources…' }),
    createFooter(),
  ]);
}

function createFooter() {
  return el('div', { class: 'src-foot' }, [
    el('span', { class: 'src-foot-text' }, [
      'Keys live in ',
      el('span', { class: 'src-mono', text: '.env' }),
      ' on your server, never in the browser.',
    ]),
    el('button', {
      type: 'button',
      class: 'src-done',
      text: 'Done',
      onclick: () => dialog?.close(),
    }),
  ]);
}

/**
 * Create the empty state block.
 * @returns {HTMLElement}
 */
function createEmptyState() {
  emptyTextEl = el('p', { class: 'src-empty-text' });
  const clear = el('button', {
    type: 'button',
    class: 'src-clear',
    text: 'Clear',
  });
  clear.addEventListener('click', () => {
    if (filterInput) filterInput.value = '';
    setFilter('all', false);
    applyFilter();
    filterInput?.focus();
  });
  emptyEl = el('div', { class: 'src-empty', hidden: true }, [emptyTextEl, clear]);
  return emptyEl;
}

function fillDialog() {
  if (!dialog) return;

  clearCopyTimers();
  rowById = new Map();
  adapterById = new Map();
  sectionByGroup = new Map();
  groupCountById = new Map();
  segmentByKey = new Map();
  filter = 'all';

  sublineEl = el('p', { class: 'src-sub', 'aria-live': 'polite' });

  filterInput = el('input', {
    type: 'search',
    class: 'src-input',
    placeholder: 'Find a source',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  filterInput.addEventListener('input', applyFilter);

  const find = el('label', { class: 'src-find' }, [
    icon(SEARCH_ICON, 18),
    el('span', { class: 'visually-hidden', text: 'Find a source' }),
    filterInput,
  ]);

  const segments = el(
    'div',
    { class: 'src-seg', role: 'group', 'aria-label': 'Show' },
    FILTERS.map((entry) => {
      const button = el(
        'button',
        {
          type: 'button',
          class: 'src-seg-btn',
          'aria-pressed': entry.key === 'all' ? 'true' : 'false',
        },
        [
          el('span', { text: entry.label }),
          el('span', { class: 'src-seg-count' }),
        ],
      );
      button.addEventListener('click', () => setFilter(entry.key));
      segmentByKey.set(entry.key, button);
      return button;
    }),
  );

  const header = el('div', { class: 'src-head' }, [
    el('div', { class: 'src-head-top' }, [
      el('div', {}, [
        el('h2', { class: 'src-title', id: 'adaptors-title', text: 'Sources' }),
        sublineEl,
      ]),
      closeButton(),
    ]),
    el('div', { class: 'src-tools' }, [find, segments]),
  ]);

  const list = el('div', { class: 'src-list' });

  for (const group of groups) {
    const groupAdapters = adapters.filter((adapter) => adapter.group === group.id);
    if (groupAdapters.length === 0) continue;

    const countEl = el('span', { class: 'src-section-count' });
    groupCountById.set(group.id, countEl);

    const section = el(
      'section',
      { class: 'src-section', dataset: { groupId: group.id } },
      [
        el('div', { class: 'src-section-head' }, [
          el('h3', { class: 'src-section-title', text: group.label }),
          countEl,
        ]),
        el(
          'ul',
          { class: 'src-rows' },
          groupAdapters.map((adapter) => {
            const row = createRow(adapter);
            rowById.set(adapter.id, row);
            adapterById.set(adapter.id, adapter);
            return row;
          }),
        ),
      ],
    );
    sectionByGroup.set(group.id, section);
    list.append(section);
  }

  if (invalid.length > 0) list.append(createInvalidSection());

  list.append(createEmptyState());

  dialog.replaceChildren(el('div', { class: 'src-modal' }, [header, list, createFooter()]));
  updateCounts();
  applyFilter();
}

/**
 * Fetch `GET /api/adapters` once and keep the answer in memory.
 * A running fetch is shared, so no second request is sent meanwhile.
 * @returns {Promise<boolean>} whether the list is loaded
 */
function ensureData() {
  if (dataLoaded) return Promise.resolve(true);
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      const response = await fetch('/api/adapters');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();

      groups = Array.isArray(data?.groups) ? data.groups : [];
      adapters = Array.isArray(data?.adapters) ? data.adapters : [];
      invalid = Array.isArray(data?.invalid) ? data.invalid : [];
      dataLoaded = true;
      dataError = null;
      return true;
    } catch (error) {
      dataLoaded = false;
      dataError = error?.message || 'The adaptor list could not be loaded.';
      return false;
    } finally {
      loadPromise = null;
    }
  })();

  return loadPromise;
}

/**
 * Open the dialog, at one adaptor row when an id is given.
 * Uses the adaptor list in memory; a first open shows a loading line and
 * fills the dialog as soon as the shared fetch answers.
 * @param {string|null} adaptorId
 * @returns {Promise<void>}
 */
async function openSettings(adaptorId = null) {
  if (!dialog || !openButton) return;
  const id = typeof adaptorId === 'string' ? adaptorId : null;

  if (dialog.open) {
    if (id !== null) {
      pendingFocusId = id;
      focusRow(id);
    }
    return;
  }

  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const token = ++session;

  if (dataLoaded) {
    fillDialog();
    dialog.showModal();
    if (id !== null) focusRow(id);
    return;
  }

  pendingFocusId = id;
  dialog.replaceChildren(createLoadingContent());
  dialog.showModal();

  const loaded = await ensureData();
  if (token !== session || !dialog.open) return;

  const active = document.activeElement;
  const wasDone =
    active instanceof HTMLElement &&
    dialog.contains(active) &&
    active.classList.contains('src-done');
  const focusId = pendingFocusId;

  if (loaded) {
    fillDialog();
    if (focusId !== null) {
      focusRow(focusId);
    } else {
      const target = dialog.querySelector(wasDone ? '.src-done' : '.src-close');
      if (target instanceof HTMLElement) target.focus();
    }
    return;
  }

  clearCopyTimers();
  dialog.replaceChildren(createErrorContent(dataError || 'The adaptor list could not be loaded.'));
  const target = dialog.querySelector(wasDone ? '.src-done' : '.src-close');
  if (target instanceof HTMLElement) target.focus();
}

/**
 * Scroll one row into view, open its key panel and focus its setup button.
 * @param {string} adaptorId
 */
function focusRow(adaptorId) {
  const row = rowById.get(adaptorId);
  if (!row) return;

  if (filterInput) filterInput.value = '';
  setFilter('all', false);
  applyFilter();

  const setup = row.querySelector('.src-setup');
  const panel = row.querySelector('.src-panel');
  if (setup && panel) setPanelOpen(row, setup, panel, true);

  const reduceMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  row.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });

  const target = setup ?? row.querySelector('.src-switch');
  if (target instanceof HTMLElement) target.focus();
}

/**
 * Close the dialog when the backdrop is clicked.
 * @param {MouseEvent} event
 */
function onDialogClick(event) {
  if (!dialog || event.target !== dialog) return;
  const rect = dialog.getBoundingClientRect();
  const outside =
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom;
  if (outside) dialog.close();
}

/**
 * Connect the "Sources" button and the sources dialog.
 * `onChange(adapter)` runs after each successful toggle.
 * @param {{onChange?: (adapter: object) => void}} [options]
 */
export function initSettings({ onChange } = {}) {
  changeListener = typeof onChange === 'function' ? onChange : null;
  openButton = document.getElementById('adaptors-open');
  dialog = /** @type {HTMLDialogElement|null} */ (
    document.getElementById('adaptors-dialog')
  );

  if (!openButton || !dialog) return;

  void ensureData();

  openButton.addEventListener('click', () => {
    void openSettings(null);
  });
  dialog.addEventListener('click', onDialogClick);

  dialog.addEventListener('close', () => {
    clearCopyTimers();
    const target =
      returnFocus && returnFocus.isConnected && !returnFocus.closest('[hidden]')
        ? returnFocus
        : openButton;
    returnFocus = null;
    target?.focus();
  });
}

/**
 * Open the Sources modal, optionally at one adaptor.
 * @param {string} [adaptorId]
 * @returns {Promise<void>}
 */
export async function openSources(adaptorId) {
  if (!dialog) {
    const listener = changeListener;
    initSettings(listener ? { onChange: listener } : {});
    if (!dialog) return;
  }
  await openSettings(typeof adaptorId === 'string' ? adaptorId : null);
}
