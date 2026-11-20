/**
 * Adaptor settings modal for Open Library Fetch.
 * Plain ES module, no build step. All API text is inserted with DOM methods.
 */
import { countActive, el, filterAdapters, keyStatus } from './lib.js';

/** @type {HTMLElement|null} */
let openButton = null;
/** @type {HTMLDialogElement|null} */
let dialog = null;

/** Adapters from the last `GET /api/adapters`. @type {object[]} */
let adapters = [];
/** @type {Array<{id:string,label:string}>} */
let groups = [];
/** @type {Array<{folder:string,error:string}>} */
let invalid = [];

/** Row elements by adaptor id. @type {Map<string, HTMLElement>} */
let rowById = new Map();
/** Group section elements by group id. @type {Map<string, HTMLElement>} */
let sectionByGroup = new Map();

/** Search field. @type {HTMLInputElement|null} */
let filterInput = null;
/** Count line. @type {HTMLElement|null} */
let countEl = null;
/** Content area of the dialog. @type {HTMLElement|null} */
let contentEl = null;
/** @type {((adapter: object) => void)|null} */
let changeListener = null;

function updateCount() {
  if (!countEl) return;
  countEl.textContent = `${countActive(adapters)} of ${adapters.length} active`;
}

function externalLink(href, text) {
  return el('a', {
    href,
    text,
    target: '_blank',
    rel: 'noopener',
  });
}

/**
 * Build the optional key help for one adaptor.
 * @param {object} adapter
 * @returns {HTMLElement|null}
 */
function keyDetails(adapter) {
  const key = adapter.key;
  if (!key) return null;

  const children = [];

  if (typeof key.signupUrl === 'string' && key.signupUrl !== '') {
    children.push(
      el('p', { class: 'adaptor-detail' }, [
        externalLink(key.signupUrl, key.signupUrl),
      ]),
    );
  }

  if (Array.isArray(key.steps) && key.steps.length > 0) {
    children.push(
      el(
        'ol',
        { class: 'adaptor-steps' },
        key.steps.map((step) => el('li', { text: String(step) })),
      ),
    );
  }

  if (typeof key.limits === 'string' && key.limits !== '') {
    children.push(el('p', { class: 'adaptor-detail', text: key.limits }));
  }

  const envName = typeof key.env === 'string' ? key.env : '';
  children.push(
    el('p', { class: 'adaptor-detail' }, [
      'Add ',
      el('code', { text: `${envName}=…` }),
      ' to .env, then restart the server.',
    ]),
  );

  return el('details', { class: 'adaptor-key' }, [
    el('summary', { text: 'How to get a key' }),
    ...children,
  ]);
}

/**
 * Build one adaptor row.
 * @param {object} adapter
 * @returns {HTMLElement}
 */
function createRow(adapter) {
  const status = keyStatus(adapter);
  const rowError = el('p', { class: 'adaptor-error', role: 'status' });

  const toggleInput = el('input', {
    type: 'checkbox',
    role: 'switch',
    id: `adaptor-switch-${adapter.id}`,
  });
  toggleInput.checked = adapter.enabled === true;

  const toggleLabel = el('label', {
    class: 'adaptor-toggle-label',
    for: toggleInput.id,
    text: 'Active',
  });

  toggleInput.addEventListener('change', () => {
    toggleAdapter(adapter.id, toggleInput, rowError);
  });

  const head = el('div', { class: 'adaptor-head' }, [
    el('div', { class: 'adaptor-title' }, [
      externalLink(adapter.homepage, adapter.name),
    ]),
    el('div', { class: 'adaptor-switch' }, [
      toggleInput,
      toggleLabel,
      el('span', { class: `key-badge key-${status.kind}`, text: status.text }),
    ]),
  ]);

  const children = [head];

  if (typeof adapter.description === 'string' && adapter.description !== '') {
    children.push(
      el('p', { class: 'adaptor-description', text: adapter.description }),
    );
  }

  const details = keyDetails(adapter);
  if (details) children.push(details);

  if (Array.isArray(adapter.notes) && adapter.notes.length > 0) {
    children.push(
      el(
        'ul',
        { class: 'adaptor-notes' },
        adapter.notes.map((note) => el('li', { text: String(note) })),
      ),
    );
  }

  if (adapter.openLicenses === false) {
    children.push(
      el('p', {
        class: 'adaptor-warning',
        text: 'No licence data. Not searched with Open licences only.',
      }),
    );
  }

  if (typeof adapter.docsUrl === 'string' && adapter.docsUrl !== '') {
    children.push(
      el('p', { class: 'adaptor-doc-link' }, [
        externalLink(adapter.docsUrl, 'API documentation'),
      ]),
    );
  }

  children.push(rowError);

  return el('li', { class: 'adaptor-row', dataset: { adaptorId: adapter.id } }, children);
}

/**
 * Send one toggle and update the stored adapter on success.
 * @param {string} id
 * @param {HTMLInputElement} input
 * @param {HTMLElement} rowError
 */
async function toggleAdapter(id, input, rowError) {
  const index = adapters.findIndex((adapter) => adapter.id === id);
  if (index < 0) return;

  const before = adapters[index].enabled === true;
  const next = input.checked;
  input.disabled = true;

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
    input.checked = data.enabled === true;
    rowError.textContent = '';
    updateCount();
    input.disabled = false;
    if (changeListener) changeListener(data);
  } catch (error) {
    input.checked = before;
    input.disabled = false;
    rowError.textContent = error?.message || 'The setting could not be saved.';
  }
}

/**
 * Show only the rows that match the filter, and hide empty group sections.
 * @param {string} text
 */
function applyFilter(text) {
  const matches = new Set(filterAdapters(adapters, text).map((adapter) => adapter.id));
  const filtering = typeof text === 'string' && text.trim() !== '';

  for (const [id, row] of rowById) {
    row.hidden = filtering && !matches.has(id);
  }

  for (const section of sectionByGroup.values()) {
    const rows = section.querySelectorAll('.adaptor-row');
    let anyVisible = false;
    for (const row of rows) {
      if (!row.hidden) {
        anyVisible = true;
        break;
      }
    }
    section.hidden = filtering && !anyVisible;
  }
}

function createInvalidSection() {
  return el('section', { class: 'adaptor-group adaptor-invalid' }, [
    el('h3', { class: 'adaptor-group-title', text: 'These adaptor folders have errors' }),
    el(
      'ul',
      { class: 'adaptor-invalid-list' },
      invalid.map((entry) =>
        el('li', {}, [
          el('strong', { text: String(entry.folder) }),
          document.createTextNode(` ${entry.error}`),
        ]),
      ),
    ),
  ]);
}

function createErrorContent(message) {
  return el('div', { class: 'adaptor-content' }, [
    el('div', { class: 'adaptor-header' }, [
      el('h2', { class: 'adaptor-heading', id: 'adaptors-title', text: 'Adaptors' }),
      el('button', {
        type: 'button',
        class: 'text-button adaptor-close',
        text: 'Close',
        onclick: () => dialog?.close(),
      }),
    ]),
    el('p', { class: 'adaptor-load-error', role: 'alert', text: message }),
    el('div', { class: 'adaptor-footer' }, [
      el('button', {
        type: 'button',
        class: 'text-button',
        text: 'Close',
        onclick: () => dialog?.close(),
      }),
    ]),
  ]);
}

function fillDialog() {
  if (!dialog) return;

  contentEl = el('div', { class: 'adaptor-content' });

  filterInput = el('input', {
    type: 'search',
    id: 'adaptor-filter',
    class: 'adaptor-filter',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  filterInput.addEventListener('input', () => applyFilter(filterInput.value));

  countEl = el('p', { class: 'adaptor-count', 'aria-live': 'polite' });

  const toolbar = el('div', { class: 'adaptor-toolbar' }, [
    el('div', { class: 'adaptor-field' }, [
      el('label', { class: 'adaptor-field-label', for: filterInput.id, text: 'Find adaptor' }),
      filterInput,
    ]),
    countEl,
  ]);

  const header = el('div', { class: 'adaptor-header' }, [
    el('h2', { class: 'adaptor-heading', id: 'adaptors-title', text: 'Adaptors' }),
    el('button', {
      type: 'button',
      class: 'text-button adaptor-close',
      text: 'Close',
      onclick: () => dialog?.close(),
    }),
  ]);

  const body = el('div', { class: 'adaptor-body' });

  for (const group of groups) {
    const groupAdapters = adapters.filter((adapter) => adapter.group === group.id);
    if (groupAdapters.length === 0) continue;
    const section = el(
      'section',
      { class: 'adaptor-group', dataset: { groupId: group.id } },
      [
        el('h3', { class: 'adaptor-group-title', text: group.label }),
        el(
          'ul',
          { class: 'adaptor-rows' },
          groupAdapters.map((adapter) => {
            const row = createRow(adapter);
            rowById.set(adapter.id, row);
            return row;
          }),
        ),
      ],
    );
    sectionByGroup.set(group.id, section);
    body.append(section);
  }

  if (invalid.length > 0) body.append(createInvalidSection());

  contentEl.append(header, toolbar, body);
  dialog.replaceChildren(contentEl);
  updateCount();
}

async function openSettings() {
  if (!dialog || !openButton) return;
  openButton.disabled = true;

  try {
    const response = await fetch('/api/adapters');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    groups = Array.isArray(data?.groups) ? data.groups : [];
    adapters = Array.isArray(data?.adapters) ? data.adapters : [];
    invalid = Array.isArray(data?.invalid) ? data.invalid : [];
    rowById = new Map();
    sectionByGroup = new Map();
    filterInput = null;
    countEl = null;

    fillDialog();
    dialog.showModal();
  } catch (error) {
    adapters = [];
    groups = [];
    invalid = [];
    rowById = new Map();
    sectionByGroup = new Map();
    dialog.replaceChildren(
      createErrorContent(error?.message || 'The adaptor list could not be loaded.'),
    );
    dialog.showModal();
  } finally {
    openButton.disabled = false;
  }
}

/**
 * Connect the "Adaptors" button and the settings dialog.
 * `onChange(adapter)` runs after each successful toggle.
 * @param {{onChange?: (adapter: object) => void}} [options]
 */
export function initSettings({ onChange } = {}) {
  changeListener = typeof onChange === 'function' ? onChange : null;
  openButton = document.getElementById('adaptors-open');
  dialog = document.getElementById('adaptors-dialog');

  if (!openButton || !dialog) return;

  openButton.addEventListener('click', openSettings);

  dialog.addEventListener('close', () => {
    if (openButton) openButton.focus();
  });
}
