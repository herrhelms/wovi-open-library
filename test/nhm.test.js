import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  RESOURCE_ID,
  group,
  homepage,
  id,
  keyEnv,
  name,
  normalize,
  parseSearch,
  search,
} from '../lib/sources/nhm.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, 'fixtures/nhm.json'), 'utf8'));
const RESOURCE_ID_EXPECTED = '05ff2255-c38a-40c9-b657-4ccb55ab2feb';

test('nhm constants', () => {
  assert.equal(id, 'nhm');
  assert.equal(name, 'Natural History Museum, London');
  assert.equal(homepage, 'https://data.nhm.ac.uk');
  assert.equal(group, 'science');
  assert.equal(keyEnv, null);
  assert.equal(RESOURCE_ID, RESOURCE_ID_EXPECTED);
});

test('nhm parseSearch reads items, total and hasMore', () => {
  const result = parseSearch(fixture, 1);
  assert.equal(result.items.length, 2);
  assert.equal(result.total, fixture.result.total);
  assert.equal(result.hasMore, true);
  assert.equal(parseSearch({ success: true, result: { total: 0, records: [] } }, 1).hasMore, false);
  assert.equal(parseSearch({ success: true, result: {} }, 1).total, null);
});

test('nhm parseSearch removes records without an image', () => {
  const result = parseSearch(fixture, 1);
  assert.equal(fixture.result.records.length, 3);
  assert.ok(result.items.every((item) => item.id !== '3000000'));
});

test('nhm normalize makes an Item', () => {
  const raw = fixture.result.records[0];
  const media = raw.associatedMedia[0];
  const item = normalize(raw);

  assert.equal(item.source, 'nhm');
  assert.equal(item.id, raw._id);
  assert.equal(item.title, `${raw.scientificName} (${raw.catalogNumber})`);
  assert.equal(item.creator, null);
  assert.equal(item.date, null);
  assert.equal(item.description, media.title);
  assert.equal(item.thumb, `${media.identifier}/thumbnail`);
  assert.equal(item.preview, `${media.identifier}/preview`);
  assert.equal(item.full, `${media.identifier}/full/max/0/default.jpg`);
  assert.equal(item.fullTiff, `${media.identifier}/original`);
  for (const key of ['thumb', 'preview', 'full', 'fullTiff']) {
    assert.ok(item[key].startsWith('https://data.nhm.ac.uk/media/'), key);
  }
  assert.ok(item.thumb.endsWith('/thumbnail'));
  assert.ok(item.preview.endsWith('/preview'));
  assert.ok(item.full.endsWith('/full/max/0/default.jpg'));
  assert.ok(item.fullTiff.endsWith('/original'));
  assert.equal(item.width, 2828);
  assert.equal(item.height, 2268);
  assert.equal(item.license, 'CC BY 4.0');
  assert.equal(item.licenseUrl, media.license);
  assert.equal(item.pageUrl, `https://data.nhm.ac.uk/object/${raw.occurrenceID}`);
  assert.equal(item.provider, null);
});

test('nhm normalize falls back to the media title without scientificName', () => {
  const raw = {
    _id: '1',
    occurrenceID: 'abc',
    associatedMedia: [
      {
        identifier: 'https://data.nhm.ac.uk/media/asset-1',
        title: 'Register page 1',
        license: 'http://creativecommons.org/publicdomain/zero/1.0/',
        PixelXDimension: '0',
        PixelYDimension: '',
      },
    ],
  };
  const item = normalize(raw);
  assert.equal(item.title, 'Register page 1');
  assert.equal(item.description, 'Register page 1');
  assert.equal(item.width, null);
  assert.equal(item.height, null);
  assert.equal(item.license, 'CC0');
});

test('nhm normalize uses the fallback page URL without occurrenceID', () => {
  const item = normalize({
    _id: '42',
    scientificName: 'Test',
    associatedMedia: [{ identifier: 'https://data.nhm.ac.uk/media/x' }],
  });
  assert.equal(
    item.pageUrl,
    `https://data.nhm.ac.uk/dataset/collection-specimens/resource/${RESOURCE_ID_EXPECTED}/record/42`,
  );
  assert.equal(item.license, 'CC BY 4.0');
  assert.equal(item.licenseUrl, 'https://creativecommons.org/licenses/by/4.0/');
});

test('nhm normalize returns null without usable media', () => {
  assert.equal(normalize({ _id: '1', associatedMedia: [] }), null);
  assert.equal(normalize({ _id: '2' }), null);
  assert.equal(
    normalize({ _id: '3', associatedMedia: [{ identifier: 'https://evil.example.com/x' }] }),
    null,
  );
});

test('nhm search builds the search URL', async () => {
  let requested = '';
  const fake = async (url) => {
    requested = url;
    return fixture;
  };
  const result = await search('heron', 2, { fetchJson: fake });
  assert.equal(result.items.length, 2);

  const url = new URL(requested);
  assert.equal(url.origin + url.pathname, 'https://data.nhm.ac.uk/api/3/action/datastore_search');
  const params = url.searchParams;
  assert.equal(params.get('resource_id'), RESOURCE_ID_EXPECTED);
  assert.equal(params.get('q'), 'heron');
  assert.equal(params.get('offset'), '24');
  assert.equal(params.get('limit'), '24');
  assert.deepEqual(JSON.parse(params.get('filters')), { _has_image: true });
});

test('nhm search rejects an unsuccessful answer', async () => {
  const fake = async () => ({ success: false, error: { message: 'Resource not found' } });
  await assert.rejects(search('heron', 1, { fetchJson: fake }), (err) => {
    assert.ok(err.message.startsWith('NHM Data Portal:'));
    assert.ok(err.message.includes('Resource not found'));
    return true;
  });
});
