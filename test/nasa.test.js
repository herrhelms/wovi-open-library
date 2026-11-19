import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { normalize, parseSearch, pickOriginal, resolveDownload } from '../lib/sources/nasa.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, 'fixtures/nasa.json'), 'utf8'));

test('nasa parseSearch reads the fixture', () => {
  const result = parseSearch(fixture.search);
  assert.equal(result.items.length, 2);
  assert.equal(result.total, 20299);
  assert.equal(result.hasMore, true);
});

test('nasa normalize makes an Item', () => {
  const item = normalize(fixture.search.collection.items[0]);
  assert.equal(item.source, 'nasa');
  assert.equal(item.id, 'PIA12235');
  assert.equal(item.title, 'Nearside of the Moon');
  assert.equal(item.creator, 'ISRO/NASA/JPL-Caltech/Brown Univ.');
  assert.equal(item.date, '2009-09-24');
  assert.equal(item.description, 'Nearside of the Moon');
  assert.ok(item.thumb.endsWith('~thumb.jpg'));
  assert.ok(item.preview.endsWith('~medium.jpg'));
  assert.equal(item.full, 'https://images-assets.nasa.gov/image/PIA12235/PIA12235~orig.jpg');
  assert.equal(item.width, 2000);
  assert.equal(item.height, 1400);
  assert.equal(item.license, 'Public domain (NASA)');
  assert.equal(
    item.licenseUrl,
    'https://www.nasa.gov/nasa-brand-center/images-and-media/',
  );
  assert.equal(item.pageUrl, 'https://images.nasa.gov/details/PIA12235');
});

test('nasa normalize uses canonical when there is no medium link', () => {
  const item = normalize(fixture.search.collection.items[1]);
  assert.ok(item.preview.endsWith('~orig.jpg'));
  assert.ok(!item.preview.startsWith('http://'));
});

test('nasa normalize returns null without a nasa_id', () => {
  assert.equal(normalize({ data: [{}], links: [] }), null);
});

test('nasa pickOriginal selects the original image', () => {
  assert.equal(
    pickOriginal(fixture.collectionJson),
    'https://images-assets.nasa.gov/image/PIA12235/PIA12235~orig.jpg',
  );
  assert.equal(
    pickOriginal(['https://x/y~large.jpg', 'https://x/y.json']),
    'https://x/y~large.jpg',
  );
  assert.equal(pickOriginal(['https://x/y.json']), null);
});

test('nasa resolveDownload rejects a bad id', async () => {
  await assert.rejects(resolveDownload('../x'), (err) => err.status === 400);
  await assert.rejects(resolveDownload('a/b'), (err) => err.status === 400);
});

test('nasa resolveDownload picks the original from collection.json', async () => {
  const result = await resolveDownload('PIA12235', {
    fetchJson: async (url) => {
      assert.ok(url.endsWith('/image/PIA12235/collection.json'));
      return fixture.collectionJson;
    },
  });
  assert.equal(
    result.url,
    'https://images-assets.nasa.gov/image/PIA12235/PIA12235~orig.jpg',
  );
  assert.equal(result.filename, null);
});
