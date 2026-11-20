import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { normalize, parseSearch, search } from '../lib/sources/wellcome.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, 'fixtures/wellcome.json'), 'utf8'));

test('wellcome parseSearch reads items, total and nextPage', () => {
  const result = parseSearch(fixture, 1);
  assert.equal(result.items.length, 2);
  assert.equal(result.total, fixture.totalResults);
  assert.equal(result.hasMore, true);
});

test('wellcome normalize makes an Item', () => {
  const raw = fixture.results[0];
  const loc = raw.locations[0];
  const base = loc.url.replace(/\/info\.json$/, '');
  const item = normalize(raw);

  assert.equal(item.source, 'wellcome');
  assert.equal(item.id, raw.id);
  assert.equal(item.title, raw.source.title);
  assert.equal(item.thumb, `${base}/full/400,/0/default.jpg`);
  assert.equal(item.preview, `${base}/full/1600,/0/default.jpg`);
  assert.equal(item.full, `${base}/full/full/0/default.jpg`);
  assert.ok(!item.full.includes('/max/'));
  assert.equal(item.width, null);
  assert.equal(item.height, null);
  assert.equal(item.license, 'Public domain');
  assert.equal(item.licenseUrl, loc.license.url);
  assert.equal(
    item.pageUrl,
    `https://wellcomecollection.org/works/${raw.source.id}/images?id=${raw.id}`,
  );
  assert.equal(item.creator, null);
  assert.equal(item.date, null);
  assert.equal(item.description, null);
});

test('wellcome normalize uses short licence labels', () => {
  const raw = structuredClone(fixture.results[0]);
  raw.locations[0].license = { id: 'pdm', label: 'Public Domain Mark' };
  assert.equal(normalize(raw).license, 'Public domain');

  raw.locations[0].license = { id: 'cc-0' };
  assert.equal(normalize(raw).license, 'CC0');

  raw.locations[0].license = { id: 'cc-by', label: 'Attribution 4.0 International (CC BY 4.0)' };
  assert.equal(normalize(raw).license, 'CC BY 4.0');

  raw.locations[0].license = { id: 'x', label: 'Other' };
  assert.equal(normalize(raw).license, 'Other');

  delete raw.locations[0].license;
  assert.equal(normalize(raw).license, 'See item page');
});

test('wellcome normalize uses a credit that is not Wellcome Collection', () => {
  const raw = structuredClone(fixture.results[0]);
  raw.locations[0].credit = 'Jane Doe';
  assert.equal(normalize(raw).creator, 'Jane Doe');
});

test('wellcome normalize returns null without locations', () => {
  const raw = structuredClone(fixture.results[0]);
  delete raw.locations;
  assert.equal(normalize(raw), null);
});

test('wellcome parseSearch without nextPage has no more pages', () => {
  const json = structuredClone(fixture);
  delete json.nextPage;
  assert.equal(parseSearch(json, 1).hasMore, false);
});

test('wellcome search builds the search URL', async () => {
  let requested = '';
  const fake = async (url) => {
    requested = url;
    return fixture;
  };
  const result = await search('moon', 2, { fetchJson: fake });
  assert.equal(result.items.length, 2);
  assert.ok(requested.includes('query=moon'));
  assert.ok(requested.includes('pageSize=24'));
  assert.ok(requested.includes('page=2'));
  assert.ok(requested.includes('locations.license=pdm,cc-0,cc-by'));
});
