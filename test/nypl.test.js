import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { normalize, parseSearch, search } from '../lib/sources/nypl.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, 'fixtures/nypl.json'), 'utf8'));

test('nypl parseSearch reads the fixture', () => {
  const result = parseSearch(fixture, 1);
  assert.equal(result.items.length, 2);
  assert.equal(result.total, 535);
  assert.equal(result.hasMore, true);

  const item = result.items[0];
  assert.equal(item.source, 'nypl');
  assert.equal(item.id, 'a20567c0-c598-012f-fd27-58d385a7bc34');
  assert.equal(item.title, 'Moon, moon');
  assert.equal(item.creator, null);
  assert.equal(item.date, null);
  assert.equal(item.description, null);
  assert.equal(item.thumb, 'https://iiif.nypl.org/iiif/3/1992631/full/400,/0/default.jpg');
  assert.equal(item.preview, 'https://iiif.nypl.org/iiif/3/1992631/full/1600,/0/default.jpg');
  assert.ok(item.full.endsWith('/full/max/0/default.jpg'));
  assert.equal(item.license, 'Public domain');
  assert.equal(item.licenseUrl, 'http://rightsstatements.org/vocab/NoC-US/1.0/');
  assert.ok(item.pageUrl.startsWith('https://digitalcollections.nypl.org/items/'));
});

test('nypl parseSearch handles one result object', () => {
  const json = {
    nyplAPI: {
      request: { totalPages: '1' },
      response: { numResults: '1', result: fixture.nyplAPI.response.result[0] },
    },
  };
  const result = parseSearch(json, 1);
  assert.equal(result.items.length, 1);
  assert.equal(result.hasMore, false);
});

test('nypl parseSearch handles a missing result', () => {
  const json = {
    nyplAPI: { request: { totalPages: '3' }, response: { numResults: '0' } },
  };
  const result = parseSearch(json, 1);
  assert.equal(result.items.length, 0);
  assert.equal(result.total, 0);
  assert.equal(result.hasMore, true);
});

test('nypl normalize removes results without an imageID', () => {
  assert.equal(normalize({ uuid: 'x', title: 'No image' }), null);
});

test('nypl search rejects without a token and never calls the fetch', async () => {
  const previous = process.env.NYPL_TOKEN;
  process.env.NYPL_TOKEN = '';

  let called = false;
  const fetchJson = async () => {
    called = true;
    return {};
  };

  try {
    await assert.rejects(search('moon', 1, { fetchJson }), (err) => {
      assert.equal(err.message, 'NYPL needs NYPL_TOKEN in .env');
      assert.equal(err.code, 'KEY');
      return true;
    });
    assert.equal(called, false);
  } finally {
    if (previous === undefined) delete process.env.NYPL_TOKEN;
    else process.env.NYPL_TOKEN = previous;
  }
});
