import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { normalize, parseSearch, buildSearchUrl } from './index.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, '../../test/fixtures/commons.json'), 'utf8'));

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

test('commons TIFF preview changes the thumb width and keeps the original as full', () => {
  const item = normalize(fixture.tiff);
  const base = 'Verklaar-steen_over_de_inwijding_der_Hebreeuse_republyk%2C_objectnr_A_19751.tif';

  assert.equal(
    item.preview,
    `https://thumb.wikimedia.org/wikipedia/commons/thumb/e/ea/${base}/lossy-page1-1920px-${base}.jpg`,
  );
  assert.ok(item.preview.includes('lossy-page1-1920px-'));
  assert.ok(!item.preview.includes('utm_'));
  assert.equal(
    item.full,
    `https://upload.wikimedia.org/wikipedia/commons/e/ea/${base}`,
  );
  assert.ok(item.full.endsWith('.tif'));
  assert.equal(item.width, 1410);
});

test('commons TIFF preview uses 1920px also for a width of 5000', () => {
  const page = {
    ...fixture.tiff,
    imageinfo: [
      {
        ...fixture.tiff.imageinfo[0],
        width: 5000,
        thumburl: 'https://thumb.wikimedia.org/x/400px-X.tif.jpg',
        url: 'https://upload.wikimedia.org/x.tif',
      },
    ],
  };
  const item = normalize(page);
  assert.equal(item.preview, 'https://thumb.wikimedia.org/x/1920px-X.tif.jpg');
  assert.equal(item.full, 'https://upload.wikimedia.org/x.tif');
});

test('commons JPEG keeps the original when the width is small', () => {
  const page = {
    pageid: 2,
    title: 'File:Y.jpg',
    imageinfo: [
      {
        url: 'https://upload.wikimedia.org/Y.jpg',
        width: 1200,
        height: 800,
        thumburl: 'https://thumb.wikimedia.org/x/400px-Y.jpg',
        mime: 'image/jpeg',
        extmetadata: {},
      },
    ],
  };
  const item = normalize(page);
  assert.equal(item.preview, item.full);
  assert.equal(item.preview, 'https://upload.wikimedia.org/Y.jpg');
});

test('commons JPEG uses 1920px for a wide image', () => {
  const page = {
    pageid: 3,
    title: 'File:Y.jpg',
    imageinfo: [
      {
        url: 'https://upload.wikimedia.org/Y.jpg',
        width: 4000,
        height: 3000,
        thumburl: 'https://thumb.wikimedia.org/x/400px-Y.jpg',
        mime: 'image/jpeg',
        extmetadata: {},
      },
    ],
  };
  const item = normalize(page);
  assert.equal(item.preview, 'https://thumb.wikimedia.org/x/1920px-Y.jpg');
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
