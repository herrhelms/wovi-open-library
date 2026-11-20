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
  search,
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
  assert.equal(item.thumb, `https://iiif.archive.org/iiif/${doc.identifier}/full/400,/0/default.jpg`);
  assert.equal(item.thumbFallback, `https://archive.org/services/img/${doc.identifier}`);
  assert.equal(item.preview, `https://iiif.archive.org/iiif/${doc.identifier}/full/1600,/0/default.jpg`);
  assert.equal(item.previewFallback, item.thumbFallback);
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

test('archive normalize builds IIIF thumb and preview and reads the license', () => {
  const item = normalize({
    identifier: 'abc',
    licenseurl: 'http://creativecommons.org/licenses/by-nc/4.0/',
  });
  assert.equal(item.thumb, 'https://iiif.archive.org/iiif/abc/full/400,/0/default.jpg');
  assert.equal(item.thumbFallback, 'https://archive.org/services/img/abc');
  assert.equal(item.preview, 'https://iiif.archive.org/iiif/abc/full/1600,/0/default.jpg');
  assert.equal(item.previewFallback, item.thumbFallback);
  assert.equal(item.license, 'CC BY-NC 4.0');
});

test('archive normalize maps licenseurl values to short labels', () => {
  const label = (licenseurl) => normalize({ identifier: 'abc', licenseurl }).license;
  assert.equal(label('http://creativecommons.org/publicdomain/zero/1.0/'), 'CC0');
  assert.equal(label('http://creativecommons.org/publicdomain/mark/1.0/'), 'Public domain');
  assert.equal(label('http://creativecommons.org/licenses/by-sa/3.0/'), 'CC BY-SA 3.0');
  assert.equal(label('http://creativecommons.org/licenses/by-nc-nd/4.0/'), 'CC BY-NC-ND 4.0');
  assert.equal(label('https://creativecommons.org/licenses/by/4.0/'), 'CC BY 4.0');
  assert.equal(label(undefined), 'See item page');
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
  assert.equal(new URL(url).searchParams.get('q'), '(moon) AND mediatype:image');
});

test('archive buildSearchUrl adds the open filter', () => {
  const url = buildSearchUrl('moon', 1, true);
  assert.equal(
    new URL(url).searchParams.get('q'),
    '(moon) AND mediatype:image AND (licenseurl:*publicdomain* OR licenseurl:*creativecommons.org\\/licenses*)',
  );
});

test('archive search uses the open URL when openOnly is true', async () => {
  const requested = [];
  const fake = async (url) => {
    requested.push(url);
    return { response: { numFound: 0, docs: [] } };
  };

  await search('moon', 1, { fetchJson: fake });
  await search('moon', 1, { fetchJson: fake, openOnly: true });

  assert.equal(new URL(requested[0]).searchParams.get('q'), '(moon) AND mediatype:image');
  assert.equal(
    new URL(requested[1]).searchParams.get('q'),
    '(moon) AND mediatype:image AND (licenseurl:*publicdomain* OR licenseurl:*creativecommons.org\\/licenses*)',
  );
});

test('archive resolveDownload rejects a bad identifier', async () => {
  await assert.rejects(resolveDownload('../x'), (err) => err.status === 400);
});
