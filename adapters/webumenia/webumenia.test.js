import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildSearchUrl, id, normalize, parseSearch, search } from './index.js';
import { getSource } from '../../lib/sources/index.js';

const { name, group, keyEnv, config } = getSource('webumenia');

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(here, '../../test/fixtures/webumenia.json'), 'utf8'),
);

test('webumenia metadata', () => {
  assert.equal(id, 'webumenia');
  assert.equal(name, 'Web umenia (Slovak and Czech galleries)');
  assert.equal(group, 'museums');
  assert.equal(keyEnv, null);
  assert.equal(config.order, 281);
});

test('webumenia buildSearchUrl sets the free and image filters', () => {
  const url = new URL(buildSearchUrl('portrét', 3));
  assert.equal(url.host, 'www.webumenia.sk');
  assert.equal(url.pathname, '/api/v1/items');
  assert.equal(url.searchParams.get('q'), 'portrét');
  assert.equal(url.searchParams.get('filter[is_free]'), 'true');
  assert.equal(url.searchParams.get('filter[has_image]'), 'true');
  assert.equal(url.searchParams.get('size'), '24');
  assert.equal(url.searchParams.get('page'), '3');
});

test('webumenia buildSearchUrl treats a bad page as page 1', () => {
  assert.equal(new URL(buildSearchUrl('x', 0)).searchParams.get('page'), '1');
  assert.equal(new URL(buildSearchUrl('x', -2)).searchParams.get('page'), '1');
  assert.equal(new URL(buildSearchUrl('x', 'abc')).searchParams.get('page'), '1');
});

test('webumenia parseSearch reads the fixture', () => {
  const result = parseSearch(fixture);
  assert.equal(result.total, 29);
  assert.equal(result.hasMore, true);
  assert.equal(result.items.length, 6);
  assert.ok(result.items.every((item) => item.source === 'webumenia'));
  assert.ok(result.items.every((item) => item.license === 'Public domain'));
});

test('webumenia parseSearch with an empty answer', () => {
  assert.deepEqual(
    parseSearch({ data: [], total: 0, current_page: 1, last_page: 1 }),
    { total: 0, hasMore: false, items: [] },
  );
});

test('webumenia normalize makes the first item', () => {
  const item = normalize(fixture.data[0]);
  const enc = 'SVK%3AOGD.O_475';

  assert.equal(item.id, 'SVK:OGD.O_475');
  assert.equal(item.title, 'Mesiac');
  assert.equal(item.creator, 'Neznámy autor');
  assert.equal(item.date, '19. storočie, 1. polovica');
  assert.equal(item.full, `https://www.webumenia.sk/dielo/${enc}/stiahnut`);
  assert.equal(item.preview, `https://www.webumenia.sk/dielo/nahlad/${enc}/800`);
  assert.equal(item.thumb, `https://www.webumenia.sk/dielo/nahlad/${enc}/400`);
  assert.equal(item.pageUrl, `https://www.webumenia.sk/dielo/${enc}`);
  assert.equal(item.provider, 'Oravská galéria, OGD');
  assert.equal(item.license, 'Public domain');
  assert.equal(item.licenseUrl, 'https://creativecommons.org/publicdomain/mark/1.0/');
  assert.equal(item.width, null);
  assert.equal(item.height, null);
  assert.equal(item.description, null);
});

test('webumenia normalize keeps only free works with an image', () => {
  const notFree = structuredClone(fixture.data[0]);
  notFree.content.is_free = false;
  assert.equal(normalize(notFree), null);

  const noImage = structuredClone(fixture.data[0]);
  noImage.content.has_image = false;
  assert.equal(normalize(noImage), null);

  assert.equal(normalize(null), null);
  assert.equal(normalize({ id: 'x' }), null);
});

test('webumenia normalize falls back to the numeric date range', () => {
  const raw = structuredClone(fixture.data[0]);
  raw.content.dating = '';
  raw.content.date_earliest = 1801;
  raw.content.date_latest = 1850;
  assert.equal(normalize(raw).date, '1801–1850');

  raw.content.date_latest = 1801;
  assert.equal(normalize(raw).date, '1801');

  delete raw.content.date_latest;
  assert.equal(normalize(raw).date, '1801');
});

test('webumenia normalize cleans the description', () => {
  const item = normalize(fixture.data[3]);
  assert.ok(item.description.length > 0);
  assert.ok(!item.description.includes('<p>'));
  assert.ok(item.description.length <= 600);
});

test('webumenia search uses the injected fetchJson once', async () => {
  let calls = 0;
  let requested = '';
  const fake = async (url) => {
    calls += 1;
    requested = url;
    return fixture;
  };

  const result = await search('mesiac', 1, { fetchJson: fake });
  assert.equal(calls, 1);
  assert.equal(result.total, 29);
  assert.equal(result.hasMore, true);
  assert.equal(result.items.length, 6);
  assert.ok(requested.includes('q=mesiac'));
  assert.ok(requested.includes('page=1'));
});
