import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { HttpError } from '../lib/http.js';
import * as pixabay from '../lib/sources/pixabay.js';
import * as pexels from '../lib/sources/pexels.js';
import * as unsplash from '../lib/sources/unsplash.js';
import * as harvard from '../lib/sources/harvard.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (name) => JSON.parse(readFileSync(join(here, 'fixtures', name), 'utf8'));

const rawUnsplash = read('unsplash.json');

const fixtures = {
  pixabay: read('pixabay.json'),
  pexels: read('pexels.json'),
  unsplash: rawUnsplash.search,
  harvard: read('harvard.json'),
};

function rateError(host) {
  return new HttpError(`${host} answered HTTP 429`, {
    status: 429,
    host,
    code: 'HTTP',
  });
}

function withEnv(t, keyEnv, value, fn) {
  const saved = process.env[keyEnv];
  if (value === undefined) delete process.env[keyEnv];
  else process.env[keyEnv] = value;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (saved === undefined) delete process.env[keyEnv];
      else process.env[keyEnv] = saved;
    });
}

const sources = [
  { module: pixabay, id: 'pixabay', name: 'Pixabay', group: 'aggregators', keyEnv: 'PIXABAY_KEY' },
  { module: pexels, id: 'pexels', name: 'Pexels', group: 'aggregators', keyEnv: 'PEXELS_KEY' },
  { module: unsplash, id: 'unsplash', name: 'Unsplash', group: 'aggregators', keyEnv: 'UNSPLASH_KEY' },
  { module: harvard, id: 'harvard', name: 'Harvard Art Museums', group: 'museums', keyEnv: 'HARVARD_KEY' },
];

for (const entry of sources) {
  const { module: source } = entry;
  const fixture = fixtures[entry.id];

  test(`${entry.id} constants`, () => {
    assert.equal(source.id, entry.id);
    assert.equal(source.name, entry.name);
    assert.equal(source.group, entry.group);
    assert.equal(source.keyEnv, entry.keyEnv);
    assert.equal(typeof source.homepage, 'string');
    assert.ok(source.homepage.startsWith('https://'));
  });

  test(`${entry.id} parseSearch keeps 2 of 3 records`, () => {
    const result = source.parseSearch(fixture.search ?? fixture, 1);
    assert.equal(result.items.length, 2);
    assert.equal(typeof result.total, 'number');
    assert.equal(typeof result.hasMore, 'boolean');
  });

  test(`${entry.id} search without a key throws NEEDS_KEY and sends no request`, async (t) => {
    await withEnv(t, entry.keyEnv, undefined, async () => {
      let called = false;
      const fake = async () => {
        called = true;
        return fixture;
      };
      await assert.rejects(source.search('moon', 1, { fetchJson: fake }), (err) => {
        assert.equal(err.code, 'NEEDS_KEY');
        assert.equal(err.message, `${entry.name} needs ${entry.keyEnv} in .env`);
        return true;
      });
      assert.equal(called, false);
    });
  });

  test(`${entry.id} search with a key sends the request`, async (t) => {
    await withEnv(t, entry.keyEnv, 'test-key-value', async () => {
      let requested = null;
      let options = null;
      const fake = async (url, opts) => {
        requested = url;
        options = opts ?? {};
        return fixture;
      };
      const result = await source.search('moon', 2, { fetchJson: fake });
      assert.equal(result.items.length, 2);

      const url = new URL(requested);
      const headers = options.headers ?? {};

      if (entry.id === 'pixabay') {
        assert.equal(url.origin + url.pathname, 'https://pixabay.com/api/');
        assert.equal(url.searchParams.get('key'), 'test-key-value');
        assert.equal(url.searchParams.get('q'), 'moon');
        assert.equal(url.searchParams.get('image_type'), 'photo');
        assert.equal(url.searchParams.get('per_page'), '24');
        assert.equal(url.searchParams.get('page'), '2');
        assert.equal(url.searchParams.get('safesearch'), 'true');
      } else if (entry.id === 'pexels') {
        assert.equal(url.origin + url.pathname, 'https://api.pexels.com/v1/search');
        assert.equal(url.searchParams.get('query'), 'moon');
        assert.equal(url.searchParams.get('per_page'), '24');
        assert.equal(url.searchParams.get('page'), '2');
        assert.equal(url.searchParams.has('key'), false);
        assert.equal(url.toString().includes('test-key-value'), false);
        assert.equal(headers.Authorization, 'test-key-value');
      } else if (entry.id === 'unsplash') {
        assert.equal(url.origin + url.pathname, 'https://api.unsplash.com/search/photos');
        assert.equal(url.searchParams.get('query'), 'moon');
        assert.equal(url.searchParams.get('per_page'), '24');
        assert.equal(url.searchParams.get('page'), '2');
        assert.equal(url.toString().includes('test-key-value'), false);
        assert.equal(headers.Authorization, 'Client-ID test-key-value');
        assert.equal(headers['Accept-Version'], 'v1');
      } else if (entry.id === 'harvard') {
        assert.equal(
          url.origin + url.pathname,
          'https://api.harvardartmuseums.org/object',
        );
        assert.equal(url.searchParams.get('apikey'), 'test-key-value');
        assert.equal(url.searchParams.get('q'), 'moon');
        assert.equal(url.searchParams.get('hasimage'), '1');
        assert.equal(url.searchParams.get('size'), '24');
        assert.equal(url.searchParams.get('page'), '2');
      }

    });
  });

  test(`${entry.id} search turns HTTP 429 into a rate limit error without the key`, async (t) => {
    await withEnv(t, entry.keyEnv, 'secret-key-123', async () => {
      const fake = async () => {
        throw rateError('example.org');
      };
      await assert.rejects(source.search('moon', 1, { fetchJson: fake }), (err) => {
        assert.equal(err.code, 'RATE_LIMIT');
        assert.equal(err.message, `${entry.name} rate limit reached. Try again later.`);
        assert.equal(err.message.includes('secret-key-123'), false);
        return true;
      });
    });
  });
}

// --- Pixabay -------------------------------------------------------------

test('pixabay normalize makes an Item with scaled size', () => {
  const raw = fixtures.pixabay.hits[0];
  const item = pixabay.normalize(raw);

  assert.equal(item.source, 'pixabay');
  assert.equal(item.id, String(raw.id));
  assert.equal(item.title, 'moon, night sky, crescent');
  assert.equal(item.creator, raw.user);
  assert.equal(item.thumb, raw.webformatURL.replace('_640', '_340'));
  assert.equal(item.thumbFallback, raw.webformatURL);
  assert.equal(item.preview, raw.largeImageURL);
  assert.equal(item.full, raw.largeImageURL);
  assert.equal(item.width, 1280);
  assert.equal(item.height, 853);
  assert.equal(item.pageUrl, raw.pageURL);
  assert.equal(item.license, 'Pixabay Content License');
  assert.equal(item.licenseUrl, 'https://pixabay.com/service/license-summary/');
  assert.equal(item.date, null);
});

test('pixabay normalize scales the second record too', () => {
  const item = pixabay.normalize(fixtures.pixabay.hits[1]);
  assert.equal(item.width, 1280);
  assert.equal(item.height, 904);
});

test('pixabay normalize returns null without image URLs', () => {
  assert.equal(pixabay.normalize(fixtures.pixabay.hits[2]), null);
  assert.equal(pixabay.normalize({ id: 1, tags: 'x' }), null);
});

test('pixabay normalize changes _640 to _340 and keeps the fallback', () => {
  const item = pixabay.normalize({
    id: 1,
    tags: 'x',
    webformatURL: 'https://pixabay.com/get/abc_640.jpg',
    largeImageURL: 'https://pixabay.com/get/abc_1280.jpg',
  });
  assert.equal(item.thumb, 'https://pixabay.com/get/abc_340.jpg');
  assert.equal(item.thumbFallback, 'https://pixabay.com/get/abc_640.jpg');
});

test('pixabay normalize keeps webformatURL without _640 and sets no fallback', () => {
  const item = pixabay.normalize({
    id: 2,
    tags: 'y',
    webformatURL: 'https://pixabay.com/get/abc.jpg',
    largeImageURL: 'https://pixabay.com/get/abc_1280.jpg',
  });
  assert.equal(item.thumb, 'https://pixabay.com/get/abc.jpg');
  assert.equal('thumbFallback' in item, false);
});

test('pixabay parseSearch hasMore uses totalHits and the page size', () => {
  const result = pixabay.parseSearch(fixtures.pixabay, 1);
  assert.equal(result.total, fixtures.pixabay.totalHits);
  assert.equal(result.hasMore, 24 < fixtures.pixabay.totalHits);
  const last = pixabay.parseSearch(fixtures.pixabay, 3);
  assert.equal(last.hasMore, false);
});

// --- Pexels --------------------------------------------------------------

test('pexels normalize makes an Item', () => {
  const raw = fixtures.pexels.photos[0];
  const item = pexels.normalize(raw);

  assert.equal(item.source, 'pexels');
  assert.equal(item.id, String(raw.id));
  assert.equal(item.title, raw.alt);
  assert.equal(item.creator, raw.photographer);
  assert.equal(item.thumb, raw.src.medium);
  assert.equal(item.preview, raw.src.large2x);
  assert.equal(item.full, raw.src.original);
  assert.equal(item.width, raw.width);
  assert.equal(item.height, raw.height);
  assert.equal(item.pageUrl, raw.url);
  assert.equal(item.license, 'Pexels License');
  assert.equal(item.licenseUrl, 'https://www.pexels.com/license/');
});

test('pexels normalize returns null without src.original', () => {
  assert.equal(pexels.normalize(fixtures.pexels.photos[2]), null);
  assert.equal(pexels.normalize({ id: 1, src: { medium: 'https://x/y.jpg' } }), null);
});

test('pexels parseSearch reads total and next_page', () => {
  const result = pexels.parseSearch(fixtures.pexels);
  assert.equal(result.total, fixtures.pexels.total_results);
  assert.equal(result.hasMore, Boolean(fixtures.pexels.next_page));
  assert.equal(pexels.parseSearch({ ...fixtures.pexels, next_page: undefined }).hasMore, false);
});

// --- Unsplash ------------------------------------------------------------

test('unsplash constants', () => {
  assert.equal(unsplash.trustResolvedUrl, true);
});

test('unsplash normalize makes an Item', () => {
  const raw = fixtures.unsplash.results[0];
  const item = unsplash.normalize(raw);

  assert.equal(item.source, 'unsplash');
  assert.equal(item.id, raw.id);
  assert.equal(item.title, raw.description);
  assert.equal(item.creator, raw.user.name);
  assert.equal(item.date, '2020-03-14');
  assert.equal(item.thumb, raw.urls.small);
  assert.equal(
    item.preview,
    `${raw.urls.raw}&w=1600&fm=jpg&q=85`,
  );
  assert.equal(item.previewFallback, raw.urls.regular);
  assert.equal(item.full, raw.urls.full);
  assert.equal(item.width, raw.width);
  assert.equal(item.height, raw.height);
  assert.equal(item.pageUrl, raw.links.html);
  assert.equal(item.license, 'Unsplash License');
  assert.equal(item.licenseUrl, 'https://unsplash.com/license');
  assert.equal(item.provider, null);
});

test('unsplash normalize falls back to alt_description and null date', () => {
  const raw = fixtures.unsplash.results[1];
  const item = unsplash.normalize(raw);
  assert.equal(item.title, raw.alt_description);
  assert.equal(item.date, '2019-01-02');
});

test('unsplash normalize returns null without urls.full', () => {
  assert.equal(unsplash.normalize(fixtures.unsplash.results[2]), null);
  assert.equal(unsplash.normalize({ id: 'x', urls: { regular: 'https://x/y.jpg' } }), null);
});

test('unsplash normalize adds the viewer size to urls.raw', () => {
  const withQuery = unsplash.normalize({
    id: 'p1',
    urls: {
      raw: 'https://images.unsplash.com/photo-1?ixid=x',
      full: 'https://images.unsplash.com/photo-1',
      regular: 'https://images.unsplash.com/photo-1?w=1080',
    },
  });
  assert.equal(
    withQuery.preview,
    'https://images.unsplash.com/photo-1?ixid=x&w=1600&fm=jpg&q=85',
  );
  assert.equal(withQuery.previewFallback, 'https://images.unsplash.com/photo-1?w=1080');

  const withoutQuery = unsplash.normalize({
    id: 'p2',
    urls: {
      raw: 'https://images.unsplash.com/photo-2',
      full: 'https://images.unsplash.com/photo-2',
      regular: 'https://images.unsplash.com/photo-2?w=1080',
    },
  });
  assert.equal(
    withoutQuery.preview,
    'https://images.unsplash.com/photo-2?w=1600&fm=jpg&q=85',
  );
  assert.equal(withoutQuery.previewFallback, 'https://images.unsplash.com/photo-2?w=1080');
});

test('unsplash normalize uses urls.regular without raw and sets no fallback', () => {
  const item = unsplash.normalize({
    id: 'p3',
    urls: {
      full: 'https://images.unsplash.com/photo-3',
      regular: 'https://images.unsplash.com/photo-3?w=1080',
      small: 'https://images.unsplash.com/photo-3?w=400',
    },
  });
  assert.equal(item.preview, 'https://images.unsplash.com/photo-3?w=1080');
  assert.equal('previewFallback' in item, false);
});

test('unsplash parseSearch reads total and total_pages', () => {
  const result = unsplash.parseSearch(fixtures.unsplash, 1);
  assert.equal(result.total, fixtures.unsplash.total);
  assert.equal(result.hasMore, 1 < fixtures.unsplash.total_pages);
  assert.equal(unsplash.parseSearch(fixtures.unsplash, fixtures.unsplash.total_pages).hasMore, false);
});

test('unsplash resolveDownload calls download_location with the auth header', async (t) => {
  await withEnv(t, 'UNSPLASH_KEY', 'test-key-value', async () => {
    let requested = '';
    let options = null;
    const fake = async (url, opts) => {
      requested = url;
      options = opts ?? {};
      return rawUnsplash.download;
    };
    const resolved = await unsplash.resolveDownload('abc_1', { fetchJson: fake });
    assert.equal(requested, 'https://api.unsplash.com/photos/abc_1/download');
    assert.equal(options.headers.Authorization, 'Client-ID test-key-value');
    assert.equal(options.headers['Accept-Version'], 'v1');
    assert.equal(resolved.url, rawUnsplash.download.url);
    assert.equal(resolved.filename, 'abc_1');
  });
});

test('unsplash resolveDownload rejects a bad id without a request', async (t) => {
  await withEnv(t, 'UNSPLASH_KEY', 'test-key-value', async () => {
    let called = false;
    const fake = async () => {
      called = true;
      return rawUnsplash.download;
    };
    await assert.rejects(unsplash.resolveDownload('a/b', { fetchJson: fake }), (err) => err.status === 400);
    assert.equal(called, false);
  });
});

test('unsplash resolveDownload without a key throws NEEDS_KEY', async (t) => {
  await withEnv(t, 'UNSPLASH_KEY', undefined, async () => {
    let called = false;
    const fake = async () => {
      called = true;
      return rawUnsplash.download;
    };
    await assert.rejects(unsplash.resolveDownload('abc_1', { fetchJson: fake }), (err) => {
      assert.equal(err.code, 'NEEDS_KEY');
      assert.equal(err.message, 'Unsplash needs UNSPLASH_KEY in .env');
      return true;
    });
    assert.equal(called, false);
  });
});

test('unsplash resolveDownload reports a missing url', async (t) => {
  await withEnv(t, 'UNSPLASH_KEY', 'test-key-value', async () => {
    const fake = async () => ({});
    await assert.rejects(unsplash.resolveDownload('abc_1', { fetchJson: fake }), (err) => {
      assert.equal(err.message, 'Unsplash gave no download URL');
      return true;
    });
  });
});

// --- Harvard -------------------------------------------------------------

test('harvard normalize uses the IIIF base', () => {
  const raw = fixtures.harvard.records[0];
  const item = harvard.normalize(raw);

  assert.equal(item.source, 'harvard');
  assert.equal(item.id, String(raw.objectid));
  assert.equal(item.title, raw.title);
  assert.equal(item.creator, raw.people[0].name);
  assert.equal(item.date, raw.dated);
  assert.equal(
    item.thumb,
    'https://ids.lib.harvard.edu/ids/iiif/299843/full/400,/0/default.jpg',
  );
  assert.equal(
    item.preview,
    'https://ids.lib.harvard.edu/ids/iiif/299843/full/1600,/0/default.jpg',
  );
  assert.equal(
    item.full,
    'https://ids.lib.harvard.edu/ids/iiif/299843/full/full/0/default.jpg',
  );
  assert.equal(item.width, 2400);
  assert.equal(item.height, 1800);
  assert.equal(item.pageUrl, raw.url);
  assert.equal(item.license, 'See Harvard Art Museums image terms');
  assert.equal(item.licenseUrl, 'https://harvardartmuseums.org/collections/about');
});

test('harvard normalize falls back to primaryimageurl', () => {
  const raw = fixtures.harvard.records[1];
  const item = harvard.normalize(raw);

  assert.equal(item.creator, null);
  assert.equal(item.thumb, raw.primaryimageurl);
  assert.equal(item.preview, raw.primaryimageurl);
  assert.equal(item.full, raw.primaryimageurl);
  assert.equal(item.width, null);
  assert.equal(item.height, null);
  assert.equal(
    item.pageUrl,
    `https://harvardartmuseums.org/collections/object/${raw.objectid}`,
  );
});

test('harvard normalize removes records without image permission', () => {
  assert.equal(harvard.normalize(fixtures.harvard.records[2]), null);
  assert.equal(harvard.normalize({ objectid: 1, imagepermissionlevel: 0 }), null);
});

test('harvard parseSearch reads info totals', () => {
  const result = harvard.parseSearch(fixtures.harvard);
  assert.equal(result.total, fixtures.harvard.info.totalrecords);
  assert.equal(result.hasMore, fixtures.harvard.info.page < fixtures.harvard.info.pages);
});
