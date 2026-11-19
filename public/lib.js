/**
 * Shared browser helpers for Open Library Fetch.
 */

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
 * Wait for a number of milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
