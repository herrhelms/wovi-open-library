import test from 'node:test';
import assert from 'node:assert/strict';

import { createSearchCache, searchCacheKey } from '../lib/search-cache.js';

test('two get calls with the same key load one time', async () => {
  let loads = 0;
  const cache = createSearchCache();
  const load = async () => {
    loads += 1;
    return { value: 42 };
  };

  const first = await cache.get('k', load);
  const second = await cache.get('k', load);

  assert.equal(loads, 1);
  assert.equal(first.hit, false);
  assert.equal(second.hit, true);
  assert.equal(first.value, second.value);
});

test('the cache key separates its inputs', () => {
  const base = { sourceId: 'a', openOnly: false, page: 1, q: 'moon' };
  const key = searchCacheKey(base);

  assert.notEqual(key, searchCacheKey({ ...base, page: 2 }));
  assert.notEqual(key, searchCacheKey({ ...base, openOnly: true }));
  assert.notEqual(key, searchCacheKey({ ...base, q: 'sun' }));
  assert.notEqual(key, searchCacheKey({ ...base, sourceId: 'b' }));
});

test('the cache key trims q but keeps its case', () => {
  const base = { sourceId: 'a', openOnly: false, page: 1 };
  assert.equal(searchCacheKey({ ...base, q: ' moon ' }), searchCacheKey({ ...base, q: 'moon' }));
  assert.notEqual(searchCacheKey({ ...base, q: 'Moon' }), searchCacheKey({ ...base, q: 'moon' }));
});

test('the cache key does not collide on separator characters', () => {
  assert.notEqual(
    searchCacheKey({ sourceId: 'a', openOnly: false, page: 1, q: 'x|1' }),
    searchCacheKey({ sourceId: 'a', openOnly: false, page: 11, q: 'x' }),
  );
  assert.notEqual(
    searchCacheKey({ sourceId: 'a:b', openOnly: true, page: 1, q: 'c' }),
    searchCacheKey({ sourceId: 'a', openOnly: true, page: 1, q: 'b:c' }),
  );
});

test('entries expire at the TTL', async () => {
  let clock = 0;
  let loads = 0;
  const cache = createSearchCache({ ttlMs: 1000, now: () => clock });
  const load = async () => {
    loads += 1;
    return loads;
  };

  await cache.get('k', load);

  clock = 999;
  const stillYoung = await cache.get('k', load);
  assert.equal(stillYoung.hit, true);
  assert.equal(loads, 1);

  clock = 1000;
  const expired = await cache.get('k', load);
  assert.equal(expired.hit, false);
  assert.equal(loads, 2);
});

test('a rejected load is not stored', async () => {
  let loads = 0;
  const cache = createSearchCache();
  const load = async () => {
    loads += 1;
    throw new Error('boom');
  };

  await assert.rejects(() => cache.get('k', load), /boom/);
  await assert.rejects(() => cache.get('k', load), /boom/);
  assert.equal(loads, 2);
});

test('parallel get calls share one load', async () => {
  let loads = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const cache = createSearchCache();
  const load = async () => {
    loads += 1;
    await gate;
    return { value: 'shared' };
  };

  const first = cache.get('k', load);
  const second = cache.get('k', load);
  release();
  const [a, b] = await Promise.all([first, second]);

  assert.equal(loads, 1);
  assert.equal(a.value, b.value);
  assert.equal(a.hit, false);
  assert.equal(b.hit, true);
});

test('maxEntries removes the oldest entry', async () => {
  const cache = createSearchCache({ maxEntries: 2 });
  let loads = 0;
  const load = async () => {
    loads += 1;
    return loads;
  };

  await cache.get('a', load);
  await cache.get('b', load);
  await cache.get('c', load);

  assert.equal(cache.size(), 2);
  const again = await cache.get('a', load);
  assert.equal(again.hit, false);
  assert.equal(loads, 4);
});
