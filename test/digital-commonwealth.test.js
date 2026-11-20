import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  group,
  homepage,
  id,
  keyEnv,
  licenseLabel,
  name,
  normalize,
  parseSearch,
  search,
} from '../lib/sources/digital-commonwealth.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(here, 'fixtures/digital-commonwealth.json'), 'utf8'),
);

test('digital-commonwealth constants', () => {
  assert.equal(id, 'digital-commonwealth');
  assert.equal(name, 'Digital Commonwealth (Massachusetts)');
  assert.equal(homepage, 'https://www.digitalcommonwealth.org');
  assert.equal(group, 'libraries');
  assert.equal(keyEnv, null);
});

test('digital-commonwealth parseSearch removes unusable records', () => {
  const result = parseSearch(fixture, 1);
  assert.equal(fixture.data.length, 4);
  assert.equal(result.items.length, 2);
  assert.equal(result.total, fixture.meta.pages.total_count);
  assert.equal(result.hasMore, true);

  const ids = result.items.map((item) => item.id);
  assert.ok(!ids.includes('commonwealth:restricted0001'));
  assert.ok(!ids.includes('commonwealth:noimage0001'));
});

test('digital-commonwealth normalize makes an Item', () => {
  const raw = fixture.data[0];
  const attributes = raw.attributes;
  const item = normalize(raw);

  assert.equal(item.source, 'digital-commonwealth');
  assert.equal(item.id, raw.id);
  assert.equal(item.title, attributes.title_info_primary_tsi);
  assert.equal(item.creator, null);
  assert.equal(item.date, attributes.date_tsim[0]);
  assert.equal(item.description, null);
  assert.equal(
    item.thumb,
    `https://iiif.digitalcommonwealth.org/iiif/2/${attributes.exemplary_image_ssi}/full/400,/0/default.jpg`,
  );
  assert.ok(item.preview.endsWith('/full/1600,/0/default.jpg'));
  assert.ok(item.full.endsWith('/full/full/0/default.jpg'));
  assert.equal(item.width, null);
  assert.equal(item.height, null);
  assert.equal(item.license, 'No known restrictions');
  assert.equal(item.licenseUrl, null);
  assert.equal(item.pageUrl, `https://www.digitalcommonwealth.org/search/${raw.id}`);
  assert.equal(item.provider, attributes.institution_name_ssi);
});

test('digital-commonwealth normalize uses the first name', () => {
  const item = normalize(fixture.data[1]);
  assert.equal(item.creator, 'Bierstadt, Charles, 1819-1903');
  assert.equal(item.provider, 'Boston Public Library');
});

test('digital-commonwealth normalize rejects unusable records', () => {
  assert.equal(normalize(fixture.data[2]), null);
  assert.equal(normalize(fixture.data[3]), null);
  assert.equal(normalize({ id: 'x', attributes: null }), null);
  assert.equal(normalize({ id: 'x', attributes: {} }), null);
});

test('digital-commonwealth license labels', () => {
  assert.equal(licenseLabel('No known restrictions on use.', null), 'No known restrictions');
  assert.equal(licenseLabel(null, 'No known copyright restrictions.'), 'No known restrictions');
  assert.equal(licenseLabel('CC BY 4.0', null), 'CC BY 4.0');
  assert.equal(licenseLabel(null, 'All rights reserved.'), 'All rights reserved.');
  assert.equal(licenseLabel(null, null), 'See item page');
  assert.equal(licenseLabel('a'.repeat(100), null).length, 80);
});

test('digital-commonwealth normalize gives CC0 a label and URL', () => {
  const raw = structuredClone(fixture.data[0]);
  raw.attributes.license_ss = 'This work has been released into the public domain using CC0.';
  const item = normalize(raw);
  assert.equal(item.license, 'CC0');
  assert.equal(item.licenseUrl, 'https://creativecommons.org/publicdomain/zero/1.0/');

  const noKnown = structuredClone(fixture.data[0]);
  noKnown.attributes.license_ss = 'No known restrictions on use.';
  const itemNoKnown = normalize(noKnown);
  assert.equal(itemNoKnown.license, 'No known restrictions');
  assert.equal(itemNoKnown.licenseUrl, null);
});

test('digital-commonwealth search builds the search URL', async () => {
  let requested = '';
  const fake = async (url) => {
    requested = url;
    return fixture;
  };
  const result = await search('moon', 2, { fetchJson: fake });

  assert.equal(result.items.length, 2);
  const url = new URL(requested);
  assert.equal(url.origin + url.pathname, 'https://www.digitalcommonwealth.org/search.json');
  assert.equal(url.searchParams.get('q'), 'moon');
  assert.equal(url.searchParams.get('page'), '2');
  assert.equal(url.searchParams.get('per_page'), '24');
  assert.equal(url.searchParams.get('f[reuse_allowed_ssi][]'), 'no restrictions');
  assert.ok(requested.includes('f%5Breuse_allowed_ssi%5D%5B%5D=no+restrictions'));
});

test('digital-commonwealth hasMore is false without a next page', () => {
  const lastPage = {
    meta: { pages: { current_page: 58, next_page: null, total_count: 173 } },
    data: fixture.data,
  };
  assert.equal(parseSearch(lastPage, 58).hasMore, false);

  const missing = { meta: {}, data: [] };
  const result = parseSearch(missing, 1);
  assert.equal(result.hasMore, false);
  assert.equal(result.total, null);
  assert.deepEqual(result.items, []);
});
