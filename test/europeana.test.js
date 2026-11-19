import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  normalize,
  parseSearch,
  buildSearchUrl,
  licenseLabel,
  resolveDownload,
} from '../lib/sources/europeana.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, 'fixtures/europeana.json'), 'utf8'));

test('europeana parseSearch reads items and total', () => {
  const result = parseSearch(fixture, 1);
  assert.equal(result.items.length, 2);
  assert.equal(result.total, 5386);
  assert.equal(result.hasMore, true);
});

test('europeana normalize makes an Item', () => {
  const item = normalize(fixture.items[0]);
  assert.equal(item.source, 'europeana');
  assert.equal(item.id, '1316/https___www_searchculture_gr_aggregator_edm_momus_000179_17673');
  assert.equal(item.title, 'Purple Moon');
  assert.equal(item.creator, 'Antonakos, Stephen (1926-2013)');
  assert.equal(item.date, '1987');
  assert.equal(item.license, 'CC BY-SA 4.0');
  assert.equal(
    item.full,
    'http://dam.momus.gr/files/original/6fa436aa7c74f752f4e1168e16aa6b12fcbf1a5c.jpg',
  );
  assert.equal(item.preview, item.full);
  assert.ok(item.thumb.startsWith('https://api.europeana.eu/thumbnail/'));
  assert.ok(!item.pageUrl.includes('utm_'));
  assert.ok(!item.pageUrl.endsWith('?'));
});

test('europeana normalize returns null without image', () => {
  assert.equal(normalize({ id: '/x/y', title: ['T'] }), null);
});

test('europeana license labels', () => {
  assert.equal(licenseLabel('http://creativecommons.org/publicdomain/zero/1.0/'), 'CC0');
  assert.equal(licenseLabel('http://creativecommons.org/publicdomain/mark/1.0/'), 'Public domain');
  assert.equal(licenseLabel('http://creativecommons.org/licenses/by/4.0/'), 'CC BY 4.0');
  assert.equal(licenseLabel('http://creativecommons.org/licenses/by-sa/4.0/'), 'CC BY-SA 4.0');
  assert.equal(
    licenseLabel('http://rightsstatements.org/vocab/NoC-OKLR/1.0/'),
    'No copyright (NoC-OKLR)',
  );
  assert.equal(licenseLabel('https://example.org/other'), 'See item page');
});

test('europeana buildSearchUrl uses start and rows', () => {
  const url = buildSearchUrl('a b', 2, 'k');
  assert.ok(url.includes('start=25'));
  assert.ok(url.includes('rows=24'));
  assert.ok(url.includes('wskey=k'));
  assert.ok(url.includes('query=a+b'));
});

test('europeana resolveDownload rejects a bad id', async () => {
  await assert.rejects(resolveDownload('../etc/passwd'), (err) => err.status === 400);
});
