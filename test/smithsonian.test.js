import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { normalize, parseSearch, buildSearchUrl } from '../lib/sources/smithsonian.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, 'fixtures/smithsonian.json'), 'utf8'));

test('smithsonian parseSearch reads rows and total', () => {
  const result = parseSearch(fixture, 1);
  assert.equal(result.items.length, 3);
  assert.equal(result.total, 2119);
  assert.equal(result.hasMore, true);
});

test('smithsonian normalize makes an Item (query form)', () => {
  const item = normalize(fixture.response.rows[0]);
  assert.equal(item.source, 'smithsonian');
  assert.equal(item.title, 'Moon and Clouds, Terni, Italy');
  assert.equal(item.full, 'https://ids.si.edu/ids/deliveryService?id=CHSDM-23484_03-000001');
  assert.ok(item.thumb.endsWith('&max=400'));
  assert.ok(item.preview.endsWith('&max=1600'));
  assert.equal(item.width, 6720);
  assert.equal(item.height, 3838);
  assert.ok(item.creator.startsWith('Frederic Edwin Church'));
  assert.equal(item.date, 'October 1, 1868');
  assert.equal(item.license, 'CC0');
  assert.equal(
    item.licenseUrl,
    'https://creativecommons.org/publicdomain/zero/1.0/',
  );
  assert.equal(
    item.pageUrl,
    'https://collection.cooperhewitt.org/view/objects/asitem/id/23484',
  );
});

test('smithsonian normalize handles the path form', () => {
  const item = normalize(fixture.response.rows[1]);
  assert.equal(item.thumb, `${item.full}/400`);
  assert.equal(item.preview, `${item.full}/1600`);
});

test('smithsonian normalize returns null without images', () => {
  assert.equal(
    normalize({ id: 'x', title: 'T', content: { descriptiveNonRepeating: {} } }),
    null,
  );
});

test('smithsonian buildSearchUrl encodes the filter and paging', () => {
  const url = buildSearchUrl('moon', 2, 'K');
  assert.ok(url.includes('start=24'));
  assert.ok(url.includes('rows=24'));
  assert.ok(url.includes('api_key=K'));
  assert.ok(url.includes('media_usage%3ACC0') || url.includes('media_usage%3aCC0'));
});
