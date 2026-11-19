import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { normalize, parseSearch, buildSearchUrl } from '../lib/sources/commons.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, 'fixtures/commons.json'), 'utf8'));

test('commons parseSearch sorts by index and reads continue', () => {
  const result = parseSearch(fixture, 1);
  assert.equal(result.items.length, 2);
  assert.equal(result.total, null);
  assert.equal(result.hasMore, true);
  assert.equal(result.items[0].id, '11901243');
  assert.equal(result.items[1].id, '10726475');
});

test('commons normalize makes an Item', () => {
  const page = fixture.query.pages['10726475'];
  const item = normalize(page);

  assert.equal(item.source, 'commons');
  assert.equal(item.title, 'Mercury, Venus and the Moon Align');
  assert.ok(item.full.startsWith('https://upload.wikimedia.org/'));
  assert.ok(!item.thumb.includes('utm_'));
  assert.ok(!item.preview.includes('utm_'));
  assert.equal(item.width, 1691);
  assert.equal(item.height, 2500);
  assert.equal(item.preview, item.full);
  assert.ok(item.pageUrl.startsWith('https://commons.wikimedia.org/wiki/File:'));
  assert.equal(typeof item.license, 'string');
  assert.ok(item.license.length > 0);
  assert.equal(item.creator, 'ESO/Y. Beletsky');
  assert.equal(item.date, '2008-03-06');
});

test('commons preview uses 1920px for wide images', () => {
  const page = {
    pageid: 1,
    title: 'File:X.jpg',
    imageinfo: [
      {
        url: 'https://upload.wikimedia.org/x.jpg',
        width: 4000,
        height: 3000,
        thumburl: 'https://thumb.wikimedia.org/x/500px-X.jpg',
        extmetadata: {},
      },
    ],
  };
  const item = normalize(page);
  assert.ok(item.preview.includes('/1920px-X.jpg'));
  assert.equal(item.thumb, 'https://thumb.wikimedia.org/x/500px-X.jpg');
});

test('commons normalize returns null without imageinfo', () => {
  assert.equal(normalize({ pageid: 1, title: 'File:X.jpg' }), null);
});

test('commons buildSearchUrl encodes the query', () => {
  const url = buildSearchUrl('a b', 2);
  assert.ok(url.includes('gsrsearch=a+b+filetype%3Abitmap'));
  assert.ok(url.includes('gsroffset=24'));
  assert.ok(url.includes('gsrlimit=24'));
});
