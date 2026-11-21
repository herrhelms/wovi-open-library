/**
 * WOVI saves. Saves live only in `localStorage`; nothing is ever sent to the
 * server. This module also owns the first-save notice and the toast.
 */
import {
  addSave,
  backToTopBottom,
  clearAllText,
  el,
  isSaved,
  itemKey,
  makeSnapshot,
  parseSaves,
  removeSave,
  savedViewText,
} from './lib.js';
import { createGithubStrip } from './github-strip.js';

export const SAVES_KEY = 'wovi:saves:v1';
export const ACK_KEY = 'wovi:saves-ack:v1';
const TEST_KEY = 'wovi:saves-test';

const TOAST_MS = 5000;
const TOAST_FADE_MS = 200;
const SVG_NS = 'http://www.w3.org/2000/svg';

const BOOKMARK_PATH = 'M19 21 12 16 5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z';
const INFO_PATH = ['M12 8v5', 'M12 16v.01'];

/** @type {Set<(list: object[]) => void>} */
const listeners = new Set();

/** @type {HTMLDialogElement|null} */
let noticeEl = null;
let noticeOpen = false;
/** @type {((value: boolean) => void)|null} */
let noticeResolve = null;
/** @type {HTMLElement|null} */
let noticeTrigger = null;

/** @type {HTMLDialogElement|null} */
let confirmEl = null;
let confirmOpen = false;
/** @type {((value: boolean) => void)|null} */
let confirmResolve = null;
/** @type {HTMLElement|null} */
let confirmTrigger = null;

/** @type {HTMLElement|null} */
let toastEl = null;
let toastTimer = 0;
let toastHideTimer = 0;
let toastDeadline = 0;
let toastRemaining = TOAST_MS;
let toastVisible = false;

// ---------- Storage ----------

/**
 * Write and remove a test key. False when `localStorage` throws.
 * @returns {boolean}
 */
function storageWorks() {
  try {
    localStorage.setItem(TEST_KEY, '1');
    localStorage.removeItem(TEST_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether the first-save notice was confirmed.
 * @returns {boolean}
 */
function isAcknowledged() {
  try {
    return localStorage.getItem(ACK_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Remember that the notice was confirmed.
 * @returns {boolean}
 */
function setAcknowledged() {
  try {
    localStorage.setItem(ACK_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

/**
 * Write one snapshot list. False when the write fails or is too large.
 * @param {object[]} list
 * @returns {boolean}
 */
function writeSaves(list) {
  try {
    localStorage.setItem(SAVES_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

/**
 * The saved snapshots, newest first. A read error gives an empty list.
 * @returns {object[]}
 */
export function readSaves() {
  try {
    return parseSaves(localStorage.getItem(SAVES_KEY));
  } catch {
    return [];
  }
}

/**
 * Ids of every saved snapshot.
 * @returns {Set<string>}
 */
export function savedIds() {
  return new Set(readSaves().map((snapshot) => snapshot.id));
}

/**
 * Whether one item is saved.
 * @param {object} item
 * @returns {boolean}
 */
export function isItemSaved(item) {
  if (!item || typeof item !== 'object') return false;
  return isSaved(readSaves(), itemKey(item));
}

/**
 * Remove every save, keeping the first-save acknowledgement. False when
 * `localStorage` throws; nothing changes then.
 * @returns {boolean}
 */
export function clearSaves() {
  if (!storageWorks()) return false;
  try {
    localStorage.removeItem(SAVES_KEY);
  } catch {
    return false;
  }
  notify([]);
  return true;
}

// ---------- Change listeners ----------

/**
 * Run the listeners with a snapshot list.
 * @param {object[]} list
 */
function notify(list) {
  for (const listener of [...listeners]) {
    try {
      listener(list);
    } catch {
      // A broken listener must not stop the others.
    }
  }
}

/**
 * Subscribe to saves changes, from this tab and from other tabs.
 * @param {(list: object[]) => void} listener
 * @returns {() => void} unsubscribe
 */
export function onSavesChange(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

window.addEventListener('storage', (event) => {
  if (event.key !== SAVES_KEY && event.key !== null) return;
  notify(parseSaves(event.newValue));
});

// ---------- Toast ----------

/**
 * Offset from the bottom of the window for the toast, above the selection bar.
 * @returns {number}
 */
function toastBottom() {
  let height = 0;
  let bottom = 0;
  const bar = document.getElementById('selection-bar');
  if (bar && !bar.hidden) {
    height = bar.offsetHeight;
    const raw = Number.parseFloat(window.getComputedStyle(bar).bottom);
    bottom = Number.isFinite(raw) ? raw : 0;
  }
  return backToTopBottom(height, bottom, 36);
}

function prefersReducedMotion() {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Stop the auto-hide timer and remember the remaining time.
 */
function pauseToast() {
  if (!toastTimer) return;
  clearTimeout(toastTimer);
  toastTimer = 0;
  toastRemaining = Math.max(0, toastDeadline - Date.now());
}

/**
 * Start the auto-hide timer again after a pause.
 */
function resumeToast() {
  if (toastTimer || !toastVisible) return;
  if (toastRemaining <= 0) {
    hideToast();
    return;
  }
  toastDeadline = Date.now() + toastRemaining;
  toastTimer = window.setTimeout(hideToast, toastRemaining);
}

/**
 * Create the one toast element and bind the pause handlers.
 * @returns {HTMLElement}
 */
function ensureToast() {
  if (toastEl) return toastEl;
  toastEl = el('div', {
    class: 'wovi-toast',
    role: 'status',
    'aria-live': 'polite',
  });
  toastEl.setAttribute('popover', 'manual');
  document.body.append(toastEl);

  toastEl.addEventListener('pointerenter', pauseToast);
  toastEl.addEventListener('pointerleave', resumeToast);
  toastEl.addEventListener('focusin', pauseToast);
  toastEl.addEventListener('focusout', (event) => {
    if (toastEl.contains(event.relatedTarget)) return;
    resumeToast();
  });

  return toastEl;
}

/**
 * Show a toast above everything, including an open modal dialog.
 * @param {{text: string, link?: {text: string, href: string}, action?: {text: string, onClick: () => void}}} options
 */
export function showToast({ text, link, action } = {}) {
  const node = ensureToast();
  const children = [el('span', { class: 'wovi-toast-text', text: text ?? '' })];
  if (link && typeof link.href === 'string') {
    children.push(
      el('a', {
        class: 'wovi-toast-link',
        href: link.href,
        text: link.text ?? '',
      }),
    );
  }
  if (action && typeof action.onClick === 'function') {
    const button = el('button', {
      class: 'wovi-toast-action',
      type: 'button',
      text: action.text ?? '',
    });
    button.addEventListener('click', () => action.onClick());
    children.push(button);
  }
  node.replaceChildren(...children);

  node.style.bottom = `${toastBottom()}px`;

  const popover = typeof node.showPopover === 'function';
  if (popover) {
    try {
      if (node.matches(':popover-open')) node.hidePopover();
      node.showPopover();
    } catch {
      node.removeAttribute('popover');
    }
  } else {
    node.removeAttribute('popover');
  }

  if (toastHideTimer) {
    clearTimeout(toastHideTimer);
    toastHideTimer = 0;
  }
  node.classList.add('is-visible');
  toastVisible = true;

  if (toastTimer) clearTimeout(toastTimer);
  toastRemaining = TOAST_MS;
  toastDeadline = Date.now() + TOAST_MS;
  toastTimer = window.setTimeout(hideToast, TOAST_MS);
}

/**
 * Hide the toast at once.
 */
export function hideToast() {
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = 0;
  }
  toastRemaining = TOAST_MS;
  if (!toastEl || !toastVisible) return;
  toastVisible = false;
  toastEl.classList.remove('is-visible');

  const wait = prefersReducedMotion() ? 0 : TOAST_FADE_MS;
  if (toastHideTimer) clearTimeout(toastHideTimer);
  if (wait === 0) {
    closeToastPopover();
    return;
  }
  toastHideTimer = window.setTimeout(() => {
    toastHideTimer = 0;
    closeToastPopover();
  }, wait);
}

function closeToastPopover() {
  if (!toastEl) return;
  if (typeof toastEl.hidePopover !== 'function') return;
  try {
    if (toastEl.matches(':popover-open')) toastEl.hidePopover();
  } catch {
    // Nothing to close.
  }
}

function showUnavailableToast() {
  showToast({ text: "Saving isn't available in this browser." });
}

// ---------- Notice ----------

/**
 * A stroke icon for the notice.
 * @param {string[]} paths
 * @param {number} size
 * @param {string} [fill]
 * @returns {SVGSVGElement}
 */
function noticeIcon(paths, size, fill = 'none') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', fill);
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

/**
 * Rust info-circle icon for the notice bullets.
 * @returns {SVGSVGElement}
 */
function infoIcon() {
  const svg = noticeIcon(INFO_PATH, 18);
  const circle = document.createElementNS(SVG_NS, 'circle');
  circle.setAttribute('cx', '12');
  circle.setAttribute('cy', '12');
  circle.setAttribute('r', '9');
  svg.prepend(circle);
  return svg;
}

/**
 * Create the first-save notice once.
 * @returns {HTMLDialogElement}
 */
function buildNotice() {
  const chip = el('div', { class: 'save-notice-chip', 'aria-hidden': 'true' }, [
    noticeIcon([BOOKMARK_PATH], 22),
  ]);

  const title = el('h2', {
    class: 'save-notice-title',
    id: 'save-notice-title',
    text: 'Your saves stay in this browser',
  });

  const body = el('p', {
    class: 'save-notice-body',
    id: 'save-notice-desc',
    text: 'No account, no cloud. WOVI keeps your saved images in this browser’s local storage, only on this device.',
  });

  const bullets = el('ul', { class: 'save-notice-points' }, [
    el('li', { class: 'save-notice-point' }, [
      infoIcon(),
      document.createTextNode('Clearing site data or browsing privately removes them.'),
    ]),
    el('li', { class: 'save-notice-point' }, [
      infoIcon(),
      document.createTextNode('They won’t show up on another browser or device.'),
    ]),
  ]);

  const cancel = el('button', {
    class: 'save-notice-btn save-notice-secondary',
    type: 'button',
    text: 'Not now',
  });
  const confirm = el('button', {
    class: 'save-notice-btn save-notice-primary',
    type: 'button',
    text: 'Got it, save',
  });

  const buttons = el('div', { class: 'save-notice-actions' }, [cancel, confirm]);

  const note = el('p', {
    class: 'save-notice-note',
    text: 'You’ll only see this once.',
  });

  const inner = el('div', { class: 'save-notice-inner' }, [
    chip,
    title,
    body,
    bullets,
    buttons,
    note,
    createGithubStrip(),
  ]);

  const dialog = el(
    'dialog',
    {
      class: 'save-notice',
      'aria-labelledby': 'save-notice-title',
      'aria-describedby': 'save-notice-desc',
    },
    [inner],
  );
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');

  cancel.addEventListener('click', () => settleNotice(false));
  confirm.addEventListener('click', () => settleNotice(true));
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    settleNotice(false);
  });
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    const outside =
      event.clientX < box.left ||
      event.clientX > box.right ||
      event.clientY < box.top ||
      event.clientY > box.bottom;
    if (outside) settleNotice(false);
  });

  document.body.append(dialog);
  return dialog;
}

/**
 * Close the notice, give focus back and resolve the waiting save.
 * @param {boolean} confirmed
 */
function settleNotice(confirmed) {
  if (!noticeEl || !noticeOpen) return;
  noticeOpen = false;
  const resolve = noticeResolve;
  noticeResolve = null;
  const trigger = noticeTrigger;
  noticeTrigger = null;

  if (noticeEl.open) noticeEl.close();
  if (trigger instanceof HTMLElement && trigger.isConnected) {
    trigger.focus({ preventScroll: true });
  }
  if (resolve) resolve(confirmed === true);
}

/**
 * Open the notice and resolve with the user's answer.
 * @param {HTMLElement|null} trigger
 * @returns {Promise<boolean>}
 */
function openNotice(trigger) {
  if (noticeOpen) return Promise.resolve(false);
  if (!noticeEl) noticeEl = buildNotice();
  noticeOpen = true;
  noticeTrigger = trigger instanceof HTMLElement ? trigger : null;

  const promise = new Promise((resolve) => {
    noticeResolve = resolve;
  });

  try {
    noticeEl.showModal();
  } catch {
    // A dialog that cannot open must not block the save.
    noticeOpen = false;
    const resolve = noticeResolve;
    noticeResolve = null;
    noticeTrigger = null;
    if (resolve) resolve(false);
    return promise;
  }

  const confirm = noticeEl.querySelector('.save-notice-primary');
  if (confirm instanceof HTMLElement) confirm.focus();
  return promise;
}

// ---------- Clear-all confirm ----------

/**
 * Build the clear-all confirm dialog once.
 * @returns {HTMLDialogElement}
 */
function buildConfirm() {
  const title = el('h2', {
    class: 'save-notice-title',
    id: 'save-confirm-title',
    text: 'Clear all saves?',
  });
  const body = el('p', { class: 'save-notice-body', id: 'save-confirm-desc' });

  const cancel = el('button', {
    class: 'save-notice-btn save-notice-secondary',
    type: 'button',
    text: 'Cancel',
  });
  const confirm = el('button', {
    class: 'save-notice-btn save-notice-primary',
    type: 'button',
    text: 'Clear all',
  });

  const actions = el('div', { class: 'save-notice-actions' }, [cancel, confirm]);
  const inner = el('div', { class: 'save-notice-inner' }, [title, body, actions]);

  const dialog = el(
    'dialog',
    {
      class: 'save-notice save-confirm',
      'aria-labelledby': 'save-confirm-title',
      'aria-describedby': 'save-confirm-desc',
    },
    [inner],
  );
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');

  cancel.addEventListener('click', () => settleConfirm(false));
  confirm.addEventListener('click', () => settleConfirm(true));
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    settleConfirm(false);
  });
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    const outside =
      event.clientX < box.left ||
      event.clientX > box.right ||
      event.clientY < box.top ||
      event.clientY > box.bottom;
    if (outside) settleConfirm(false);
  });

  document.body.append(dialog);
  return dialog;
}

/**
 * Close the confirm, give focus back and resolve the waiting choice.
 * @param {boolean} confirmed
 */
function settleConfirm(confirmed) {
  if (!confirmEl || !confirmOpen) return;
  confirmOpen = false;
  const resolve = confirmResolve;
  confirmResolve = null;
  const trigger = confirmTrigger;
  confirmTrigger = null;

  if (confirmEl.open) confirmEl.close();
  if (trigger instanceof HTMLElement && trigger.isConnected) {
    trigger.focus({ preventScroll: true });
  }
  if (resolve) resolve(confirmed === true);
}

/**
 * Ask before clearing all saves. Resolves with true only on "Clear all".
 * @param {number} n number of saves, for the confirm text
 * @param {HTMLElement|null} [trigger]
 * @returns {Promise<boolean>}
 */
export function confirmClearAll(n, trigger = null) {
  if (confirmOpen) return Promise.resolve(false);
  if (!confirmEl) confirmEl = buildConfirm();
  confirmOpen = true;
  confirmTrigger = trigger instanceof HTMLElement ? trigger : null;

  const promise = new Promise((resolve) => {
    confirmResolve = resolve;
  });

  const desc = confirmEl.querySelector('.save-notice-body');
  if (desc) desc.textContent = clearAllText(n);
  const primary = confirmEl.querySelector('.save-notice-primary');
  const cancel = confirmEl.querySelector('.save-notice-secondary');
  if (primary instanceof HTMLButtonElement) primary.disabled = !(Number(n) > 0);

  try {
    confirmEl.showModal();
  } catch {
    confirmOpen = false;
    const resolve = confirmResolve;
    confirmResolve = null;
    confirmTrigger = null;
    if (resolve) resolve(false);
    return promise;
  }

  if (cancel instanceof HTMLElement) cancel.focus();
  return promise;
}

// ---------- Changes ----------

/**
 * Write a changed list, tell the listeners and hide the toast on failure.
 * @param {object[]} list
 * @returns {boolean}
 */
function commit(list) {
  if (!storageWorks() || !writeSaves(list)) {
    showUnavailableToast();
    return false;
  }
  notify(list);
  return true;
}

/**
 * Save one item at the top of the list and show the saved toast.
 * @param {object} item
 * @param {string} sourceName
 * @returns {boolean}
 */
function saveItem(item, sourceName) {
  const snapshot = makeSnapshot(item, sourceName, Date.now());
  const list = readSaves();
  const next = addSave(list, snapshot, 0);
  if (!commit(next)) return false;

  showToast({
    text: 'Saved to this browser',
    link: { text: savedViewText(next.length), href: '/saved' },
    action: {
      text: 'Undo',
      onClick: () => {
        const removed = removeSave(readSaves(), snapshot.id);
        if (!commit(removed.list)) return;
        hideToast();
      },
    },
  });
  return true;
}

/**
 * Save or unsave one item. New saved state, or null when nothing changed.
 * @param {object} item
 * @param {{sourceName?: string, trigger?: HTMLElement|null}} [options]
 * @returns {Promise<boolean|null>}
 */
export async function toggleSave(item, { sourceName = '', trigger = null } = {}) {
  if (!item || typeof item !== 'object') return null;
  if (noticeOpen) return null;
  if (!storageWorks()) {
    showUnavailableToast();
    return null;
  }

  const id = itemKey(item);
  const list = readSaves();

  if (isSaved(list, id)) {
    const removed = removeSave(list, id);
    const snapshot = removed.snapshot;
    const index = removed.index;
    if (!commit(removed.list)) return null;
    showToast({
      text: 'Removed from saved',
      action: {
        text: 'Undo',
        onClick: () => {
          if (!commit(addSave(readSaves(), snapshot, index))) return;
          hideToast();
        },
      },
    });
    return false;
  }

  if (isAcknowledged()) {
    return saveItem(item, sourceName) ? true : null;
  }

  const confirmed = await openNotice(trigger);
  if (!confirmed) return null;
  if (!storageWorks()) {
    showUnavailableToast();
    return null;
  }
  setAcknowledged();
  return saveItem(item, sourceName) ? true : null;
}
