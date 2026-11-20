import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import setsFixture from './fixtures/loc-free-to-use.json' with { type: 'json' };
import lighthousesFixture from './fixtures/loc-set-lighthouses.json' with { type: 'json' };
import { HttpError } from '../lib/http.js';
import {
  id,
  name,
  homepage,
  keyEnv,
  SETS_URL,
  PREPARING_MESSAGE,
  BLOCKED_MESSAGE,
  normalize,
  toBlockedError,
  probeIiif,
  createLocSource,
} from '../lib/sources/loc.js';

const OTHER_SET_URL = 'https://www.loc.gov/free-to-use/womens-history/';
const LIGHTHOUSES_SET_URL = 'https://www.loc.gov/free-to-use/lighthouses/';
const HIGHSM_BASE =
  'https://tile.loc.gov/image-services/iiif/service:pnp:highsm:12100:12127';

async function makeTempDir() {
  return mkdtemp(join(tmpdir(), 'olf-loc-'));
}

function waitFor(predicate, timeoutMs = 5000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - started > timeoutMs) {
        return reject(new Error('waitFor timed out'));
      }
      setTimeout(tick, 20);
    };
    tick();
  });
}

function httpError(status = 500, code = 'HTTP', bodySnippet) {
  const err = new HttpError(`test answered HTTP ${status}`, { status, code });
  if (bodySnippet !== undefined) err.bodySnippet = bodySnippet;
  return err;
}

function makeFetchJson({ setListError = null, otherSetError = null, override } = {}) {
  const calls = [];
  const state = { setListCalls: 0, setCalls: 0 };

  async function fetchJson(url) {
    calls.push(url);
    if (typeof override === 'function') {
      const result = await override(url, state);
      if (result !== undefined) return result;
    }

    if (url === SETS_URL) {
      state.setListCalls += 1;
      if (typeof setListError === 'function') {
        const err = setListError(state.setListCalls);
        if (err) throw err;
      } else if (setListError) {
        throw setListError;
      }
      return setsFixture;
    }

    if (url === `${LIGHTHOUSES_SET_URL}?fo=json`) {
      state.setCalls += 1;
      return lighthousesFixture;
    }

    if (url === `${OTHER_SET_URL}?fo=json`) {
      state.setCalls += 1;
      const err = typeof otherSetError === 'function' ? otherSetError() : otherSetError;
      if (err) throw err;
      return { content: { title: "Women's History", components: [] } };
    }

    throw httpError(404);
  }

  return { fetchJson, calls, state };
}

function makeProbe({ infoFor = HIGHSM_BASE, throwFor = () => false } = {}) {
  const bases = [];
  async function probe(base) {
    bases.push(base);
    if (throwFor(base)) throw new Error('network down');
    if (base === infoFor) return { width: 3500, height: 4225 };
    return null;
  }
  return { probe, bases };
}

async function expectPreparing(promise) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.code, 'PREPARING');
    assert.equal(err.message, PREPARING_MESSAGE);
    return true;
  });
}

test('module constants and normalize export', () => {
  assert.equal(id, 'loc');
  assert.equal(name, 'Library of Congress (Free to Use)');
  assert.equal(homepage, 'https://www.loc.gov/free-to-use/');
  assert.equal(keyEnv, null);
  assert.equal(typeof normalize, 'function');
});

test('toBlockedError detects a Cloudflare challenge', () => {
  const error = toBlockedError({
    code: 'HTTP',
    status: 403,
    bodySnippet: '<html>Just a moment...</html>',
  });
  assert.equal(error.message, BLOCKED_MESSAGE);
  assert.equal(error.code, 'BLOCKED');
});

test('toBlockedError returns null for other errors', () => {
  assert.equal(toBlockedError({ code: 'HTTP', status: 500, bodySnippet: 'oops' }), null);
  assert.equal(toBlockedError({ code: 'NETWORK', status: null }), null);
});

test('first search prepares once, then searches the index', async () => {
  const dir = await makeTempDir();
  try {
    const fake = makeFetchJson({ otherSetError: () => httpError(500) });
    const source = createLocSource({
      dataDir: dir,
      fetchJson: fake.fetchJson,
      probeIiif: async () => null,
      retryDelayMs: 0,
    });

    assert.equal(source.status(), 'idle');
    await expectPreparing(source.search('lighthouse', 1));
    await expectPreparing(source.search('lighthouse', 1));

    await waitFor(() => source.status() === 'ready');
    assert.equal(fake.state.setListCalls, 1);

    const result = await source.search('lighthouse', 1);
    assert.ok(result.items.length > 0);
    assert.ok(result.total > 0);

    const saved = JSON.parse(await readFile(join(dir, 'free-to-use.json'), 'utf8'));
    assert.equal(saved.version, 1);
    assert.equal(saved.sets.length, 1);
    assert.equal(saved.sets[0].title, 'Lighthouses');
    await source.flushCache();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a fresh saved index is used without network requests', async () => {
  const dir = await makeTempDir();
  try {
    const first = makeFetchJson({ otherSetError: () => httpError(500) });
    const source = createLocSource({
      dataDir: dir,
      fetchJson: first.fetchJson,
      retryDelayMs: 0,
    });
    await expectPreparing(source.search('lighthouse', 1));
    await waitFor(() => source.status() === 'ready');
    await source.flushCache();

    const calls = [];
    const second = createLocSource({
      dataDir: dir,
      fetchJson: async (url) => {
        calls.push(url);
        throw new Error('must not fetch');
      },
      probeIiif: async () => null,
    });
    await expectPreparing(second.search('lighthouse', 1));
    await waitFor(() => second.status() === 'ready');
    assert.equal((await second.search('lighthouse', 1)).items.length > 0, true);
    assert.deepEqual(calls, []);
    await second.flushCache();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('an old saved index is fetched again', async () => {
  const dir = await makeTempDir();
  try {
    const first = makeFetchJson({ otherSetError: () => httpError(500) });
    const source = createLocSource({
      dataDir: dir,
      fetchJson: first.fetchJson,
      retryDelayMs: 0,
    });
    await expectPreparing(source.search('lighthouse', 1));
    await waitFor(() => source.status() === 'ready');

    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await utimes(join(dir, 'free-to-use.json'), old, old);

    const second = makeFetchJson({ otherSetError: () => httpError(500) });
    const next = createLocSource({
      dataDir: dir,
      fetchJson: second.fetchJson,
      retryDelayMs: 0,
    });
    await expectPreparing(next.search('lighthouse', 1));
    await waitFor(() => next.status() === 'ready');
    assert.ok(second.state.setListCalls >= 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a blocked set list gives BLOCKED once and starts again later', async () => {
  const dir = await makeTempDir();
  try {
    const fake = makeFetchJson({ setListError: httpError(403) });
    const source = createLocSource({
      dataDir: dir,
      fetchJson: fake.fetchJson,
      retryDelayMs: 0,
    });

    await expectPreparing(source.search('lighthouse', 1));
    await waitFor(() => source.status() === 'idle');

    await assert.rejects(source.search('lighthouse', 1), (err) => {
      assert.equal(err.code, 'BLOCKED');
      assert.equal(err.message, BLOCKED_MESSAGE);
      return true;
    });

    await expectPreparing(source.search('lighthouse', 1));
    await waitFor(() => source.status() === 'idle');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a non-JSON HTML set list counts as blocked', async () => {
  const dir = await makeTempDir();
  try {
    const fake = makeFetchJson({
      setListError: httpError(200, 'NOT_JSON', '<html>Just a moment...</html>'),
    });
    const source = createLocSource({
      dataDir: dir,
      fetchJson: fake.fetchJson,
      retryDelayMs: 0,
    });

    await expectPreparing(source.search('lighthouse', 1));
    await waitFor(() => source.status() === 'idle');
    await assert.rejects(source.search('lighthouse', 1), { code: 'BLOCKED' });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a network error on the set list is retried one time', async () => {
  const dir = await makeTempDir();
  try {
    const fake = makeFetchJson({
      setListError: (n) => (n === 1 ? httpError(null, 'NETWORK') : null),
      otherSetError: () => httpError(500),
    });
    const source = createLocSource({
      dataDir: dir,
      fetchJson: fake.fetchJson,
      retryDelayMs: 0,
    });

    await expectPreparing(source.search('lighthouse', 1));
    await waitFor(() => source.status() === 'ready');
    assert.equal(fake.state.setListCalls, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('an HTTP error on the set list fails without retry', async () => {
  const dir = await makeTempDir();
  try {
    const fake = makeFetchJson({ setListError: httpError(500) });
    const source = createLocSource({
      dataDir: dir,
      fetchJson: fake.fetchJson,
      retryDelayMs: 0,
    });

    await expectPreparing(source.search('lighthouse', 1));
    await waitFor(() => source.status() === 'idle');

    await assert.rejects(source.search('lighthouse', 1), (err) => {
      assert.equal(err.code, 'PREPARE_FAILED');
      assert.ok(
        err.message.startsWith('Library of Congress data preparation failed: '),
      );
      assert.match(err.message, /HTTP 500/);
      return true;
    });
    assert.equal(fake.state.setListCalls, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('all sets failing gives PREPARE_FAILED', async () => {
  const dir = await makeTempDir();
  try {
    const fake = makeFetchJson({
      otherSetError: () => httpError(500),
      override: (url) => {
        if (url === `${LIGHTHOUSES_SET_URL}?fo=json`) throw httpError(500);
        return undefined;
      },
    });

    const source = createLocSource({
      dataDir: dir,
      fetchJson: fake.fetchJson,
      retryDelayMs: 0,
    });
    await expectPreparing(source.search('lighthouse', 1));
    await waitFor(() => source.status() === 'idle');

    await assert.rejects(source.search('lighthouse', 1), (err) => {
      assert.equal(err.code, 'PREPARE_FAILED');
      assert.match(err.message, /no Free to Use items could be read/);
      return true;
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('IIIF resolution, caching and failures', async () => {
  const dir = await makeTempDir();
  try {
    const fake = makeFetchJson({ otherSetError: () => httpError(500) });
    const { probe, bases } = makeProbe({
      throwFor: (base) => base.includes('mrg'),
    });
    const source = createLocSource({
      dataDir: dir,
      fetchJson: fake.fetchJson,
      probeIiif: probe,
      retryDelayMs: 0,
    });

    await expectPreparing(source.search('heceta', 1));
    await waitFor(() => source.status() === 'ready');

    const heceta = await source.search('heceta', 1);
    assert.equal(heceta.items.length, 1);
    const item = heceta.items[0];
    assert.equal(
      item.full,
      `${HIGHSM_BASE}/full/full/0/default.jpg`,
    );
    assert.ok(item.preview.endsWith('/full/1600,/0/default.jpg'));
    assert.equal(item.width, 3500);
    assert.equal(item.height, 4225);
    assert.ok(item.thumb.startsWith('https://www.loc.gov/static/'));
    assert.deepEqual(bases, [HIGHSM_BASE]);

    bases.length = 0;
    const first = await source.search('lighthouse', 1);

    const hhh = first.items.find((entry) => entry.id === 'hhh.nc0497.photos~sp=24');
    assert.ok(hhh);
    assert.equal(hhh.full, hhh.thumb);

    for (const base of bases) {
      assert.ok(!base.includes('hhh'));
      assert.ok(!base.includes('g3721p'));
      assert.ok(!base.includes('ihas'));
    }

    const ppmscaBases = bases.filter((base) => base.includes('ppmsca'));
    assert.equal(ppmscaBases.length, 2);

    const mrg = first.items.find((entry) => entry.id === 'mrg.10350');
    assert.ok(mrg);
    assert.equal(mrg.full, mrg.thumb);

    bases.length = 0;
    await source.search('lighthouse', 1);
    assert.equal(bases.filter((base) => base.includes('ppmsca')).length, 0);
    assert.ok(bases.some((base) => base.includes('mrg')));

    await source.flushCache();
    const cache = JSON.parse(await readFile(join(dir, 'iiif-cache-2.json'), 'utf8'));
    assert.deepEqual(cache['highsm.12127'], {
      base: HIGHSM_BASE,
      width: 3500,
      height: 4225,
    });
    assert.equal(cache['ppmsca.09037'], null);
    assert.equal(Object.hasOwn(cache, 'mrg.10350'), false);

    const cachedProbes = [];
    const second = createLocSource({
      dataDir: dir,
      fetchJson: async () => {
        throw new Error('must not fetch');
      },
      probeIiif: async (base) => {
        cachedProbes.push(base);
        return null;
      },
    });
    await expectPreparing(second.search('heceta', 1));
    await waitFor(() => second.status() === 'ready');
    const cached = await second.search('heceta', 1);
    assert.equal(cached.items[0].width, 3500);
    assert.deepEqual(cachedProbes, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the index items are not changed by IIIF resolution', async () => {
  const dir = await makeTempDir();
  try {
    const fake = makeFetchJson({ otherSetError: () => httpError(500) });
    const source = createLocSource({
      dataDir: dir,
      fetchJson: fake.fetchJson,
      probeIiif: async () => null,
      retryDelayMs: 0,
    });

    await expectPreparing(source.search('heceta', 1));
    await waitFor(() => source.status() === 'ready');

    const first = await source.search('heceta', 1);
    assert.equal(first.items[0].full, first.items[0].thumb);
    assert.equal(first.items[0].width, null);

    const second = await source.search('heceta', 1);
    assert.equal(second.items[0].full, second.items[0].thumb);
    await source.flushCache();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('probeIiif reads info.json', async () => {
  const base = 'https://tile.loc.gov/image-services/iiif/service:pnp:highsm:12100:12127';
  const seen = [];

  const ok = await probeIiif(base, {
    fetch: async (url, opts) => {
      seen.push({ url, opts });
      return {
        status: 200,
        text: async () => '{"width":3500,"height":4225}',
      };
    },
  });
  assert.deepEqual(ok, { width: 3500, height: 4225 });
  assert.equal(seen[0].url, `${base}/info.json`);
  assert.equal(seen[0].opts.timeoutMs, 8000);
  assert.equal(seen[0].opts.headers.Accept, 'application/json');

  const notFound = await probeIiif(base, {
    fetch: async () => ({ status: 404, text: async () => 'not found' }),
  });
  assert.equal(notFound, null);

  const html = await probeIiif(base, {
    fetch: async () => ({ status: 200, text: async () => '<html></html>' }),
  });
  assert.equal(html, null);

  const noSize = await probeIiif(base, {
    fetch: async () => ({ status: 200, text: async () => '{"width":0}' }),
  });
  assert.equal(noSize, null);

  await assert.rejects(
    probeIiif(base, {
      fetch: async () => {
        throw new Error('network down');
      },
    }),
    /network down/,
  );
});

test('flushCache does nothing without a pending write', async () => {
  const dir = await makeTempDir();
  try {
    const source = createLocSource({ dataDir: dir, fetchJson: async () => ({}) });
    await source.flushCache();
    let exists = true;
    try {
      await stat(join(dir, 'iiif-cache-2.json'));
    } catch {
      exists = false;
    }
    assert.equal(exists, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the cache ignores bad entries', async () => {
  const dir = await makeTempDir();
  try {
    await writeFile(
      join(dir, 'iiif-cache-2.json'),
      JSON.stringify({
        'highsm.12127': { base: HIGHSM_BASE, width: 3500, height: 4225 },
        'ppmsca.09037': null,
        bad1: { base: '', width: 10, height: 10 },
        bad2: { base: 'x', width: 0, height: 10 },
        bad3: 'nope',
      }),
    );

    const fake = makeFetchJson({ otherSetError: () => httpError(500) });
    const probes = [];
    const source = createLocSource({
      dataDir: dir,
      fetchJson: fake.fetchJson,
      probeIiif: async (base) => {
        probes.push(base);
        return null;
      },
      retryDelayMs: 0,
    });

    await expectPreparing(source.search('heceta', 1));
    await waitFor(() => source.status() === 'ready');
    const result = await source.search('heceta', 1);
    assert.equal(result.items[0].width, 3500);
    assert.deepEqual(probes, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a probe time-out caches null in memory only', async () => {
  const dir = await makeTempDir();
  try {
    const fake = makeFetchJson({ otherSetError: () => httpError(500) });
    const bases = [];
    async function probe(base) {
      bases.push(base);
      if (base.includes('mrg:10300:10350')) {
        if (base.endsWith('v')) return null;
        throw new HttpError('tile.loc.gov did not answer in 8 s', {
          status: null,
          code: 'TIMEOUT',
        });
      }
      return null;
    }
    const source = createLocSource({
      dataDir: dir,
      fetchJson: fake.fetchJson,
      probeIiif: probe,
      retryDelayMs: 0,
    });

    await expectPreparing(source.search('lighthouse', 1));
    await waitFor(() => source.status() === 'ready');

    const first = await source.search('lighthouse', 1);
    const mrg = first.items.find((entry) => entry.id === 'mrg.10350');
    assert.ok(mrg);
    assert.equal(mrg.full, mrg.thumb);

    const mrgProbes = bases.filter((base) => base.includes('mrg:10300:10350'));
    assert.equal(mrgProbes.length, 2);

    bases.length = 0;
    await source.search('lighthouse', 1);
    assert.equal(
      bases.filter((base) => base.includes('mrg:10300:10350')).length,
      0,
    );

    await source.flushCache();
    const cache = JSON.parse(await readFile(join(dir, 'iiif-cache-2.json'), 'utf8'));
    assert.equal(Object.hasOwn(cache, 'mrg.10350'), false);

    const again = [];
    const second = createLocSource({
      dataDir: dir,
      fetchJson: async () => {
        throw new Error('must not fetch');
      },
      probeIiif: async (base) => {
        again.push(base);
        return null;
      },
    });
    await expectPreparing(second.search('lighthouse', 1));
    await waitFor(() => second.status() === 'ready');
    await second.search('lighthouse', 1);
    assert.ok(again.some((base) => base.includes('mrg:10300:10350')));
    await second.flushCache();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a time-out followed by a size is cached and written', async () => {
  const dir = await makeTempDir();
  try {
    const fake = makeFetchJson({ otherSetError: () => httpError(500) });
    const bases = [];
    async function probe(base) {
      bases.push(base);
      if (base === HIGHSM_BASE) {
        throw new HttpError('tile.loc.gov did not answer in 8 s', {
          status: null,
          code: 'TIMEOUT',
        });
      }
      if (base === `${HIGHSM_BASE}v`) return { width: 848, height: 1024 };
      return null;
    }
    const source = createLocSource({
      dataDir: dir,
      fetchJson: fake.fetchJson,
      probeIiif: probe,
      retryDelayMs: 0,
    });

    await expectPreparing(source.search('heceta', 1));
    await waitFor(() => source.status() === 'ready');

    const result = await source.search('heceta', 1);
    const item = result.items.find((entry) => entry.id === 'highsm.12127');
    assert.ok(item);
    assert.equal(item.full, `${HIGHSM_BASE}v/full/full/0/default.jpg`);
    assert.equal(item.width, 848);
    assert.deepEqual(bases, [HIGHSM_BASE, `${HIGHSM_BASE}v`]);

    await source.flushCache();
    const cache = JSON.parse(await readFile(join(dir, 'iiif-cache-2.json'), 'utf8'));
    assert.deepEqual(cache['highsm.12127'], {
      base: `${HIGHSM_BASE}v`,
      width: 848,
      height: 1024,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a network error during a probe is not cached', async () => {
  const dir = await makeTempDir();
  try {
    const fake = makeFetchJson({ otherSetError: () => httpError(500) });
    const bases = [];
    const source = createLocSource({
      dataDir: dir,
      fetchJson: fake.fetchJson,
      probeIiif: async (base) => {
        bases.push(base);
        throw new HttpError('tile.loc.gov network down', {
          status: null,
          code: 'NETWORK',
        });
      },
      retryDelayMs: 0,
    });

    await expectPreparing(source.search('heceta', 1));
    await waitFor(() => source.status() === 'ready');

    const first = await source.search('heceta', 1);
    assert.equal(first.items[0].full, first.items[0].thumb);
    assert.ok(bases.length > 0);

    bases.length = 0;
    await source.search('heceta', 1);
    assert.deepEqual(bases, [HIGHSM_BASE]);

    await source.flushCache();
    let cache = null;
    try {
      cache = JSON.parse(await readFile(join(dir, 'iiif-cache-2.json'), 'utf8'));
    } catch {
      cache = null;
    }
    assert.equal(cache === null || !Object.hasOwn(cache, 'highsm.12127'), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a failed set writes the reason to stderr', async () => {
  const dir = await makeTempDir();
  const chunks = [];
  const original = process.stderr.write;
  process.stderr.write = (chunk, ...args) => {
    chunks.push(String(chunk));
    return true;
  };
  try {
    const fake = makeFetchJson({
      otherSetError: () => httpError(500),
      override: (url) => {
        if (url === `${LIGHTHOUSES_SET_URL}?fo=json`) throw httpError(403);
        return undefined;
      },
    });
    const source = createLocSource({
      dataDir: dir,
      fetchJson: fake.fetchJson,
      probeIiif: async () => null,
      retryDelayMs: 0,
    });

    await expectPreparing(source.search('lighthouse', 1));
    await waitFor(() => source.status() === 'idle');

    const output = chunks.join('');
    assert.match(output, /\[loc\] set failed: Lighthouses: test answered HTTP 403/);
  } finally {
    process.stderr.write = original;
    await rm(dir, { recursive: true, force: true });
  }
});

const LIGHTHOUSES_SET = {
  title: 'Lighthouses',
  url: LIGHTHOUSES_SET_URL,
  items: lighthousesFixture.content.components[0].masonry_gallery[0].items,
};

const WOMEN_SET = {
  title: "Women's History",
  url: OTHER_SET_URL,
  items: [],
};

const HOUR = 60 * 60 * 1000;

async function writeSavedIndex(dir, { sets, failed, savedAt, ageMs = 2 * HOUR }) {
  const data = {
    version: 1,
    savedAt: savedAt ?? new Date(Date.now() - ageMs).toISOString(),
    sets,
  };
  if (failed !== undefined) data.failed = failed;
  const file = join(dir, 'free-to-use.json');
  await writeFile(file, JSON.stringify(data));
  const date = new Date(Date.now() - ageMs);
  await utimes(file, date, date);
  return data;
}

function onlyFailedSetFetch() {
  const calls = [];
  async function fetchJson(url) {
    calls.push(url);
    if (url === `${LIGHTHOUSES_SET_URL}?fo=json`) return lighthousesFixture;
    throw httpError(500);
  }
  return { fetchJson, calls };
}

test('a full read saves the failed sets', async () => {
  const dir = await makeTempDir();
  try {
    const fake = makeFetchJson({ otherSetError: () => httpError(500) });
    const source = createLocSource({
      dataDir: dir,
      fetchJson: fake.fetchJson,
      probeIiif: async () => null,
      retryDelayMs: 0,
    });

    await expectPreparing(source.search('lighthouse', 1));
    await waitFor(() => source.status() === 'ready');
    await source.refreshDone();

    const saved = JSON.parse(await readFile(join(dir, 'free-to-use.json'), 'utf8'));
    assert.equal(saved.sets.length, 1);
    assert.deepEqual(saved.failed, [
      { title: "Women's History", url: OTHER_SET_URL },
    ]);
    await source.flushCache();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('an old index with failed sets refreshes only those sets', async () => {
  const dir = await makeTempDir();
  try {
    const savedAt = '2024-01-02T03:04:05.000Z';
    await writeSavedIndex(dir, {
      sets: [WOMEN_SET],
      failed: [{ title: 'Lighthouses', url: LIGHTHOUSES_SET_URL }],
      savedAt,
    });
    const before = await stat(join(dir, 'free-to-use.json'));

    const fake = onlyFailedSetFetch();
    const source = createLocSource({
      dataDir: dir,
      fetchJson: fake.fetchJson,
      probeIiif: async () => null,
      retryDelayMs: 0,
    });

    await expectPreparing(source.search('heceta', 1));
    await waitFor(() => source.status() === 'ready');
    await source.refreshDone();

    const saved = JSON.parse(await readFile(join(dir, 'free-to-use.json'), 'utf8'));
    assert.equal(saved.sets.length, 2);
    assert.deepEqual(saved.failed, []);
    assert.equal(saved.savedAt, savedAt);

    const after = await stat(join(dir, 'free-to-use.json'));
    assert.ok(Math.abs(after.mtimeMs - before.mtimeMs) < 5000);

    const result = await source.search('heceta', 1);
    assert.ok(result.items.some((item) => item.id === 'highsm.12127'));

    assert.deepEqual(fake.calls, [`${LIGHTHOUSES_SET_URL}?fo=json`]);
    await source.flushCache();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a young index with failed sets is not refreshed', async () => {
  const dir = await makeTempDir();
  try {
    await writeSavedIndex(dir, {
      sets: [WOMEN_SET],
      failed: [{ title: 'Lighthouses', url: LIGHTHOUSES_SET_URL }],
      ageMs: 10 * 60 * 1000,
    });

    const fake = onlyFailedSetFetch();
    const source = createLocSource({
      dataDir: dir,
      fetchJson: fake.fetchJson,
      probeIiif: async () => null,
      retryDelayMs: 0,
    });

    await expectPreparing(source.search('heceta', 1));
    await waitFor(() => source.status() === 'ready');
    await source.refreshDone();

    assert.deepEqual(fake.calls, []);
    await source.flushCache();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a failed refresh leaves the index file unchanged', async () => {
  const dir = await makeTempDir();
  try {
    await writeSavedIndex(dir, {
      sets: [LIGHTHOUSES_SET],
      failed: [{ title: "Women's History", url: OTHER_SET_URL }],
    });
    const file = join(dir, 'free-to-use.json');
    const beforeText = await readFile(file, 'utf8');
    const before = await stat(file);

    const calls = [];
    const source = createLocSource({
      dataDir: dir,
      fetchJson: async (url) => {
        calls.push(url);
        throw httpError(500);
      },
      probeIiif: async () => null,
      retryDelayMs: 0,
    });

    await expectPreparing(source.search('heceta', 1));
    await waitFor(() => source.status() === 'ready');
    await source.refreshDone();

    assert.deepEqual(calls, [`${OTHER_SET_URL}?fo=json`]);
    assert.equal(await readFile(file, 'utf8'), beforeText);
    const after = await stat(file);
    assert.equal(after.mtimeMs, before.mtimeMs);

    const result = await source.search('heceta', 1);
    assert.ok(result.items.some((item) => item.id === 'highsm.12127'));
    await source.flushCache();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('an old index without a failed key fetches the missing sets', async () => {
  const dir = await makeTempDir();
  try {
    await writeSavedIndex(dir, { sets: [LIGHTHOUSES_SET], failed: undefined });

    const fake = makeFetchJson();
    const source = createLocSource({
      dataDir: dir,
      fetchJson: fake.fetchJson,
      probeIiif: async () => null,
      retryDelayMs: 0,
    });

    await expectPreparing(source.search('heceta', 1));
    await waitFor(() => source.status() === 'ready');
    await source.refreshDone();

    assert.equal(fake.state.setListCalls, 1);
    assert.equal(fake.state.setCalls, 1);
    assert.deepEqual(fake.calls, [
      SETS_URL,
      `${OTHER_SET_URL}?fo=json`,
    ]);

    const saved = JSON.parse(await readFile(join(dir, 'free-to-use.json'), 'utf8'));
    assert.equal(saved.sets.length, 2);
    assert.deepEqual(saved.failed, []);
    await source.flushCache();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('an old index with all sets only rewrites the format', async () => {
  const dir = await makeTempDir();
  try {
    await writeSavedIndex(dir, {
      sets: [LIGHTHOUSES_SET, WOMEN_SET],
      failed: undefined,
    });

    const fake = makeFetchJson();
    const source = createLocSource({
      dataDir: dir,
      fetchJson: fake.fetchJson,
      probeIiif: async () => null,
      retryDelayMs: 0,
    });

    await expectPreparing(source.search('heceta', 1));
    await waitFor(() => source.status() === 'ready');
    await source.refreshDone();

    assert.deepEqual(fake.calls, [SETS_URL]);

    const saved = JSON.parse(await readFile(join(dir, 'free-to-use.json'), 'utf8'));
    assert.deepEqual(saved.failed, []);
    await source.flushCache();

    const nextFake = makeFetchJson();
    const next = createLocSource({
      dataDir: dir,
      fetchJson: nextFake.fetchJson,
      probeIiif: async () => null,
      retryDelayMs: 0,
    });
    await expectPreparing(next.search('heceta', 1));
    await waitFor(() => next.status() === 'ready');
    await next.refreshDone();
    assert.deepEqual(nextFake.calls, []);
    await next.flushCache();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('an old index with no failed sets is not refreshed', async () => {
  const dir = await makeTempDir();
  try {
    await writeSavedIndex(dir, { sets: [LIGHTHOUSES_SET], failed: [] });

    const fake = makeFetchJson();
    const source = createLocSource({
      dataDir: dir,
      fetchJson: fake.fetchJson,
      probeIiif: async () => null,
      retryDelayMs: 0,
    });

    await expectPreparing(source.search('heceta', 1));
    await waitFor(() => source.status() === 'ready');
    await source.refreshDone();
    assert.deepEqual(fake.calls, []);
    await source.flushCache();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('refreshDone resolves at once without a refresh', async () => {
  const dir = await makeTempDir();
  try {
    const source = createLocSource({
      dataDir: dir,
      fetchJson: async () => {
        throw new Error('must not fetch');
      },
    });
    await source.refreshDone();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the failed set refresh does not block a search', async () => {
  const dir = await makeTempDir();
  try {
    await writeSavedIndex(dir, {
      sets: [LIGHTHOUSES_SET],
      failed: [{ title: "Women's History", url: OTHER_SET_URL }],
    });

    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const calls = [];
    const source = createLocSource({
      dataDir: dir,
      fetchJson: async (url) => {
        calls.push(url);
        if (url === `${OTHER_SET_URL}?fo=json`) {
          await gate;
          return { content: { title: "Women's History", components: [] } };
        }
        throw new Error(`unexpected ${url}`);
      },
      probeIiif: async () => null,
      retryDelayMs: 0,
    });

    await expectPreparing(source.search('heceta', 1));
    await waitFor(() => source.status() === 'ready');
    assert.deepEqual(calls, [`${OTHER_SET_URL}?fo=json`]);

    const result = await source.search('heceta', 1);
    assert.ok(result.items.some((item) => item.id === 'highsm.12127'));

    release();
    await source.refreshDone();
    await source.flushCache();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
