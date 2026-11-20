import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  buildSearchUrl,
  createTroveSource,
  group,
  keyEnv,
  name,
  normalize,
  parseSearch,
  resolveDownload,
  search,
  trustResolvedUrl,
} from '../lib/sources/trove.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, 'fixtures/trove.json'), 'utf8'));

const THUMB = 'https://nla.gov.au/nla.obj-123/image?wid=150';
const NOTE = 'Trove often gives a thumbnail only. Open the item page for the full image.';

function withKey(fn) {
  return async () => {
    const previous = process.env.TROVE_KEY;
    process.env.TROVE_KEY = 'test-key';
    try {
      await fn();
    } finally {
      if (previous === undefined) delete process.env.TROVE_KEY;
      else process.env.TROVE_KEY = previous;
    }
  };
}

function withoutKey(fn) {
  return async () => {
    const previous = process.env.TROVE_KEY;
    delete process.env.TROVE_KEY;
    try {
      await fn();
    } finally {
      if (previous !== undefined) process.env.TROVE_KEY = previous;
    }
  };
}

function makeFake() {
  const calls = [];
  async function fetchJson(url, opts = {}) {
    calls.push({ url, headers: opts.headers ?? {} });
    if (url.includes('/v3/result')) {
      const cursor = new URL(url).searchParams.get('s');
      if (cursor === '*') return fixture.page1;
      if (cursor === 'CURSOR2') return fixture.page2;
      throw new Error(`unexpected cursor ${cursor}`);
    }
    if (url.includes('/v3/work/')) return fixture.work;
    throw new Error(`unexpected URL ${url}`);
  }
  return { fetchJson, calls };
}

test('trove constants', () => {
  assert.equal(group, 'libraries');
  assert.equal(keyEnv, 'TROVE_KEY');
  assert.equal(trustResolvedUrl, true);
});

test('trove buildSearchUrl has the documented parameters and no key', () => {
  const url = new URL(buildSearchUrl('moon', '*'));
  assert.equal(url.host, 'api.trove.nla.gov.au');
  assert.equal(url.pathname, '/v3/result');
  assert.equal(url.searchParams.get('q'), 'moon');
  assert.equal(url.searchParams.get('category'), 'image');
  assert.equal(url.searchParams.get('n'), '24');
  assert.equal(url.searchParams.get('s'), '*');
  assert.equal(url.searchParams.get('include'), 'links');
  assert.equal(url.searchParams.get('reclevel'), 'full');
  assert.equal(url.searchParams.get('l-availability'), 'y/f');
  assert.equal(url.searchParams.get('key'), null);
  assert.equal(url.searchParams.get('api_key'), null);
  assert.equal(url.searchParams.get('apiKey'), null);
});

test('trove parseSearch reads items, total and nextStart', () => {
  const result = parseSearch(fixture.page1, 1);
  assert.equal(result.items.length, 2);
  assert.equal(result.total, 5321);
  assert.equal(result.hasMore, true);
  assert.equal(result.nextStart, 'CURSOR2');
});

test('trove parseSearch on the last page has no more', () => {
  const result = parseSearch(fixture.page2, 2);
  assert.equal(result.items.length, 1);
  assert.equal(result.hasMore, false);
  assert.equal(result.nextStart, null);
});

test('trove normalize makes an Item', () => {
  const raw = fixture.page1.category[0].records.work[0];
  const item = normalize(raw);

  assert.equal(item.source, 'trove');
  assert.equal(item.id, '12345678');
  assert.equal(item.title, raw.title);
  assert.equal(item.creator, 'Kerry, Charles, 1857-1928');
  assert.equal(item.date, '1890');
  assert.equal(item.description, null);
  assert.equal(item.thumb, THUMB);
  assert.equal(item.preview, THUMB);
  assert.equal(item.full, THUMB);
  assert.equal(item.width, null);
  assert.equal(item.height, null);
  assert.equal(item.license, 'See item page');
  assert.equal(item.licenseUrl, null);
  assert.equal(item.pageUrl, raw.troveUrl);
  assert.equal(item.note, NOTE);
});

test('trove normalize handles a single identifier object and a numeric issued', () => {
  const raw = fixture.page1.category[0].records.work[1];
  const item = normalize(raw);
  assert.equal(item.thumb, 'https://nla.gov.au/nla.obj-456/image?wid=150');
  assert.equal(item.creator, 'Phillips, John, 1800-1874');
  assert.equal(item.date, '1901');
});

test('trove normalize returns null without a thumbnail', () => {
  const raw = fixture.page1.category[0].records.work[2];
  assert.equal(normalize(raw), null);
  assert.equal(normalize({ id: '1', title: 'x' }), null);
});

test(
  'trove search pages with the stored cursor',
  withKey(async () => {
    const { fetchJson, calls } = makeFake();
    const source = createTroveSource({ fetchJson });

    const first = await source.search('moon', 1);
    assert.equal(first.items.length, 2);
    assert.equal(calls.length, 1);
    assert.equal(new URL(calls[0].url).searchParams.get('s'), '*');
    assert.equal(calls[0].headers['X-API-KEY'], 'test-key');
    assert.ok(!calls[0].url.includes('test-key'));

    const second = await source.search('moon', 2);
    assert.equal(second.items.length, 1);
    assert.equal(second.hasMore, false);
    assert.equal(calls.length, 2);
    assert.equal(new URL(calls[1].url).searchParams.get('s'), 'CURSOR2');
    assert.equal(calls[1].headers['X-API-KEY'], 'test-key');
    assert.ok(!calls[1].url.includes('test-key'));
  }),
);

test(
  'trove search on a new instance loads page 1 first',
  withKey(async () => {
    const { fetchJson, calls } = makeFake();
    const source = createTroveSource({ fetchJson });

    const result = await source.search('moon', 2);
    assert.equal(result.items.length, 1);
    assert.equal(calls.length, 2);
    assert.equal(new URL(calls[0].url).searchParams.get('s'), '*');
    assert.equal(new URL(calls[1].url).searchParams.get('s'), 'CURSOR2');
  }),
);

test(
  'trove search rejects a page that is too far away',
  withKey(async () => {
    const { fetchJson, calls } = makeFake();
    const source = createTroveSource({ fetchJson });

    await assert.rejects(source.search('moon', 50), (err) => {
      assert.match(err.message, /too far/);
      return true;
    });
    assert.ok(calls.length <= 10);
  }),
);

test(
  'trove needs a key for search',
  withoutKey(async () => {
    let called = false;
    const source = createTroveSource({
      fetchJson: async () => {
        called = true;
        return fixture.page1;
      },
    });
    await assert.rejects(source.search('moon', 1), (err) => {
      assert.equal(err.code, 'NEEDS_KEY');
      assert.equal(err.message, 'Trove (National Library of Australia) needs TROVE_KEY in .env');
      return true;
    });
    assert.equal(called, false);
  }),
);

test(
  'trove needs a key for resolveDownload',
  withoutKey(async () => {
    let called = false;
    const source = createTroveSource({
      fetchJson: async () => {
        called = true;
        return fixture.work;
      },
    });
    await assert.rejects(source.resolveDownload('12345678'), (err) => {
      assert.equal(err.code, 'NEEDS_KEY');
      assert.equal(err.message, `${name} needs TROVE_KEY in .env`);
      return true;
    });
    assert.equal(called, false);
  }),
);

test(
  'trove resolveDownload gets the work and returns the thumbnail',
  withKey(async () => {
    const { fetchJson, calls } = makeFake();
    const source = createTroveSource({ fetchJson });

    const resolved = await source.resolveDownload('12345678');
    assert.equal(resolved.url, THUMB);
    assert.equal(resolved.filename, fixture.work.title);
    assert.equal(calls.length, 1);
    assert.equal(new URL(calls[0].url).host, 'api.trove.nla.gov.au');
    assert.equal(new URL(calls[0].url).pathname, '/v3/work/12345678');
    assert.equal(calls[0].headers['X-API-KEY'], 'test-key');
    assert.ok(!calls[0].url.includes('test-key'));
  }),
);

test(
  'trove resolveDownload rejects a bad id without a request',
  withKey(async () => {
    const { fetchJson, calls } = makeFake();
    const source = createTroveSource({ fetchJson });
    await assert.rejects(source.resolveDownload('abc'), (err) => err.status === 400);
    assert.equal(calls.length, 0);
  }),
);

test(
  'trove module-level search and resolveDownload use the key',
  withKey(async () => {
    const calls = [];
    const fake = async (url) => {
      calls.push(url);
      if (url.includes('/v3/result')) return fixture.page1;
      return fixture.work;
    };
    const first = await search('moon', 1, { fetchJson: fake });
    assert.equal(first.items.length, 2);
    const resolved = await resolveDownload('12345678', { fetchJson: fake });
    assert.equal(resolved.url, THUMB);
    assert.ok(calls.every((url) => !url.includes('test-key')));
  }),
);
