import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  FLICKR_LICENSES,
  buildSearchUrl,
} from '../lib/sources/flickr.js';
import * as commons from '../lib/sources/flickr-commons.js';
import * as cc from '../lib/sources/flickr-cc.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, 'fixtures/flickr.json'), 'utf8'));

const modules = [
  ['flickr-commons', commons],
  ['flickr-cc', cc],
];

for (const [label, mod] of modules) {
  test(`${label} has group aggregators and key FLICKR_KEY`, () => {
    assert.equal(mod.group, 'aggregators');
    assert.equal(mod.keyEnv, 'FLICKR_KEY');
  });
}

test('flickr buildSearchUrl sets the documented parameters', () => {
  const url = new URL(
    buildSearchUrl({ key: 'K', q: 'moon', page: 2, extraParams: { is_commons: 'true' } }),
  );
  assert.equal(url.host, 'api.flickr.com');
  assert.equal(url.searchParams.get('method'), 'flickr.photos.search');
  assert.equal(url.searchParams.get('api_key'), 'K');
  assert.equal(url.searchParams.get('text'), 'moon');
  assert.equal(url.searchParams.get('page'), '2');
  assert.equal(url.searchParams.get('per_page'), '24');
  assert.equal(url.searchParams.get('nojsoncallback'), '1');
  assert.equal(url.searchParams.get('is_commons'), 'true');

  const extras = url.searchParams.get('extras');
  assert.ok(extras.includes('url_o'));
  assert.ok(extras.includes('owner_name'));
});

test('flickr-cc URL asks for the open licenses', async () => {
  const fake = async (url) => {
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get('license'), '4,5,7,8,9,10');
    return fixture.search;
  };
  const previous = process.env.FLICKR_KEY;
  process.env.FLICKR_KEY = 'test-key';
  try {
    await cc.search('moon', 1, { fetchJson: fake });
  } finally {
    if (previous === undefined) delete process.env.FLICKR_KEY;
    else process.env.FLICKR_KEY = previous;
  }
});

test('flickr parseSearch removes photos without image URLs', () => {
  const result = commons.parseSearch(fixture.search, 1);
  assert.equal(result.items.length, 2);
  assert.equal(typeof result.total, 'number');
  assert.equal(result.hasMore, true);
});

test('flickr normalize uses all sizes when present', () => {
  const raw = fixture.search.photos.photo[0];
  const item = commons.normalize(raw);

  assert.equal(item.source, 'flickr-commons');
  assert.equal(item.id, raw.id);
  assert.equal(item.title, raw.title);
  assert.equal(item.creator, raw.ownername);
  assert.equal(item.date, '1910-01-01');
  assert.equal(item.description, 'Text with HTML');
  assert.equal(item.thumb, raw.url_q);
  assert.equal(item.preview, raw.url_b);
  assert.equal(item.full, raw.url_o);
  assert.equal(item.width, raw.width_o);
  assert.equal(item.height, raw.height_o);
  assert.equal(item.license, 'No known copyright restrictions');
  assert.equal(item.licenseUrl, 'https://www.flickr.com/commons/usage/');
  assert.equal(item.pageUrl, `https://www.flickr.com/photos/${raw.owner}/${raw.id}`);
});

test('flickr normalize falls back to url_b when url_o and url_k are missing', () => {
  const raw = fixture.search.photos.photo[1];
  const item = commons.normalize(raw);

  assert.equal(item.full, raw.url_b);
  assert.equal(item.width, raw.width_b);
  assert.equal(item.height, raw.height_b);
  assert.equal(item.license, 'CC0');
  assert.equal(item.licenseUrl, FLICKR_LICENSES[9].url);
});

test('flickr normalize returns null without image URLs', () => {
  assert.equal(commons.normalize(fixture.search.photos.photo[2]), null);
});

test('flickr parseSearch throws the Flickr error message', () => {
  assert.throws(() => commons.parseSearch(fixture.fail, 1), (err) => {
    assert.ok(err.message.includes('Invalid API Key'));
    assert.ok(err.message.startsWith('Flickr: '));
    return true;
  });
});

test('flickr search needs the key and sends no request', async () => {
  const previous = process.env.FLICKR_KEY;
  delete process.env.FLICKR_KEY;

  let called = false;
  const fake = async () => {
    called = true;
    return fixture.search;
  };

  try {
    await assert.rejects(commons.search('moon', 1, { fetchJson: fake }), (err) => {
      assert.equal(err.code, 'NEEDS_KEY');
      assert.equal(err.message, 'Flickr Commons needs FLICKR_KEY in .env');
      return true;
    });
    assert.equal(called, false);
  } finally {
    if (previous === undefined) delete process.env.FLICKR_KEY;
    else process.env.FLICKR_KEY = previous;
  }
});

test('flickr search sends the key and returns items', async () => {
  const previous = process.env.FLICKR_KEY;
  process.env.FLICKR_KEY = 'test-key';

  let requested = '';
  const fake = async (url) => {
    requested = url;
    return fixture.search;
  };

  try {
    const result = await commons.search('moon', 1, { fetchJson: fake });
    assert.ok(new URL(requested).searchParams.get('api_key') === 'test-key');
    assert.equal(result.items.length, 2);
  } finally {
    if (previous === undefined) delete process.env.FLICKR_KEY;
    else process.env.FLICKR_KEY = previous;
  }
});

test('flickr search error does not contain the key', async () => {
  const previous = process.env.FLICKR_KEY;
  process.env.FLICKR_KEY = 'secret-key';

  const fake = async () => {
    throw new Error('boom');
  };

  try {
    await assert.rejects(commons.search('moon', 1, { fetchJson: fake }), (err) => {
      assert.equal(err.message, 'boom');
      assert.ok(!err.message.includes('secret-key'));
      return true;
    });
  } finally {
    if (previous === undefined) delete process.env.FLICKR_KEY;
    else process.env.FLICKR_KEY = previous;
  }
});
