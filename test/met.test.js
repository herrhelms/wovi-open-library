import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { normalize, search } from '../lib/sources/met.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, 'fixtures/met.json'), 'utf8'));

test('met normalize returns null for a non-public-domain object', () => {
  assert.equal(normalize(fixture.objects[0]), null);
});

test('met normalize makes an Item', () => {
  const item = normalize(fixture.objects[1]);
  assert.equal(item.source, 'met');
  assert.equal(item.id, '262301');
  assert.equal(item.title, 'The Moon');
  assert.equal(item.creator, 'John Adams Whipple');
  assert.equal(item.date, '1857–60');
  assert.equal(item.description, null);
  assert.ok(item.full.endsWith('/original/DP-15797-001.jpg'));
  assert.equal(item.preview, item.full);
  assert.ok(item.thumb.includes('/web-large/'));
  assert.equal(item.width, null);
  assert.equal(item.height, null);
  assert.equal(item.license, 'CC0');
  assert.equal(item.licenseUrl, 'https://creativecommons.org/publicdomain/zero/1.0/');
  assert.equal(item.pageUrl, 'https://www.metmuseum.org/art/collection/search/262301');
});

test('met search uses the v1.1 endpoint and removes bad objects', async () => {
  const calls = [];
  async function fetchJson(url) {
    calls.push(url);
    if (url.includes('/search')) {
      return { total: 30, objectIDs: [286555, 262301, 999] };
    }
    if (url.endsWith('/999')) {
      const err = new Error('not found');
      err.status = 404;
      throw err;
    }
    const objectId = Number(url.slice(url.lastIndexOf('/') + 1));
    return fixture.objects.find((obj) => obj.objectID === objectId);
  }

  const result = await search('moon', 1, { fetchJson });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, '262301');
  assert.equal(result.total, 30);
  assert.equal(result.hasMore, true);

  assert.ok(calls[0].includes('/v1.1/search'));
  assert.ok(calls[0].includes('offset=0&limit=24'));
});

test('met search offset moves with the page', async () => {
  const calls = [];
  async function fetchJson(url) {
    calls.push(url);
    if (url.includes('/search')) return { total: 30, objectIDs: [] };
    return null;
  }

  await search('moon', 2, { fetchJson });
  assert.ok(calls[0].includes('offset=24&limit=24'));
});
