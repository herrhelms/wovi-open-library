import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  normalize,
  parseSearch,
  pickOriginal,
  buildSearchUrl,
  resolveDownload,
} from '../lib/sources/archive.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, 'fixtures/archive.json'), 'utf8'));

test('archive parseSearch reads docs and total', () => {
  const result = parseSearch(fixture, 1);
  assert.equal(result.items.length, 2);
  assert.equal(result.total, 14207);
  assert.equal(result.hasMore, true);
});

test('archive normalize makes an Item', () => {
  const doc = fixture.response.docs[1];
  const item = normalize(doc);
  assert.equal(item.source, 'archive');
  assert.equal(item.id, doc.identifier);
  assert.equal(item.full, null);
  assert.equal(item.thumb, `https://archive.org/services/img/${doc.identifier}`);
  assert.equal(item.preview, item.thumb);
  assert.equal(item.pageUrl, `https://archive.org/details/${doc.identifier}`);
  assert.equal(item.date, '2009-02-19');
  assert.equal(item.width, null);
  assert.equal(item.height, null);
  assert.equal(item.license, 'See item page');
  assert.equal(item.licenseUrl, null);
});

test('archive normalize reads array fields and license', () => {
  const item = normalize({
    identifier: 'x',
    title: ['A', 'B'],
    creator: ['C'],
    date: '1999-01-01T00:00:00Z',
    description: '<p>Hello</p>',
    licenseurl: 'https://creativecommons.org/licenses/by/4.0/',
  });
  assert.equal(item.title, 'A');
  assert.equal(item.creator, 'C');
  assert.equal(item.date, '1999-01-01');
  assert.equal(item.description, 'Hello');
  assert.equal(item.license, 'CC BY 4.0');
  assert.equal(item.licenseUrl, 'https://creativecommons.org/licenses/by/4.0/');
});

test('archive pickOriginal selects the largest original image', () => {
  const result = pickOriginal({
    files: [
      { name: 'a_thumb.jpg', source: 'derivative', format: 'JPEG', size: '9437184' },
      { name: 'a.jpg', source: 'original', format: 'JPEG', size: '2097152' },
      { name: 'a.tif', source: 'original', format: 'TIFF', size: '5242880' },
      { name: 'a.xml', source: 'original', format: 'Metadata', size: '9000000' },
    ],
  });
  assert.equal(result.name, 'a.tif');
});

test('archive pickOriginal returns null without originals', () => {
  assert.equal(pickOriginal({ files: [] }), null);
  assert.equal(pickOriginal({}), null);
});

test('archive buildSearchUrl adds the media filter', () => {
  const url = buildSearchUrl('moon', 3);
  assert.ok(url.includes('page=3'));
  assert.ok(url.includes('rows=24'));
  assert.ok(url.includes('output=json'));
  assert.ok(url.includes('mediatype%3Aimage'));
});

test('archive resolveDownload rejects a bad identifier', async () => {
  await assert.rejects(resolveDownload('../x'), (err) => err.status === 400);
});
