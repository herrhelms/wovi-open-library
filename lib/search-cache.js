import { cacheSet } from './util.js';

/**
 * Build the cache key for one search request.
 *
 * The key keeps the source ID, the open filter as 0 or 1, the page and the
 * trimmed query. JSON encoding keeps inputs with separator characters apart.
 *
 * @param {{ sourceId: unknown, openOnly: unknown, page: unknown, q: unknown }} entry
 * @returns {string}
 */
export function searchCacheKey({ sourceId, openOnly, page, q }) {
  return JSON.stringify([
    String(sourceId ?? ''),
    openOnly ? 1 : 0,
    Number(page) || 1,
    String(q ?? '').trim(),
  ]);
}

/**
 * Create a small in-memory search answer cache.
 *
 * Entries expire after `ttlMs`. A run of `load()` for one key is shared by
 * all callers that wait for it, and a thrown error is not stored.
 *
 * @param {{
 *   ttlMs?: number,
 *   maxEntries?: number,
 *   now?: () => number,
 * }} [options]
 * @returns {{
 *   get: (key: string, load: () => Promise<unknown>) => Promise<{ value: unknown, hit: boolean }>,
 *   size: () => number,
 * }}
 */
export function createSearchCache({
  ttlMs = 1_800_000,
  maxEntries = 500,
  now = Date.now,
} = {}) {
  const entries = new Map();
  const running = new Map();

  async function get(key, load) {
    const entry = entries.get(key);
    if (entry) {
      if (now() - entry.storedAt < ttlMs) {
        return { value: entry.value, hit: true };
      }
      entries.delete(key);
    }

    const pending = running.get(key);
    if (pending) {
      const value = await pending;
      return { value, hit: true };
    }

    const promise = (async () => {
      const value = await load();
      cacheSet(entries, key, { value, storedAt: now() }, maxEntries);
      return value;
    })();
    running.set(key, promise);

    try {
      const value = await promise;
      return { value, hit: false };
    } finally {
      if (running.get(key) === promise) running.delete(key);
    }
  }

  return {
    get,
    size() {
      return entries.size;
    },
  };
}
