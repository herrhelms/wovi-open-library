import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { subsetQuery, createCommonsSubset } from '../lib/bases/commons-subset.js';
import { parseSearch as commonsParseSearch, buildSearchUrl as commonsBuildSearchUrl } from '../lib/bases/commons.js';
import { getSource } from '../lib/sources/index.js';

const britishLibrary = getSource('british-library');
const gallica = getSource('gallica');
const noaa = getSource('noaa');
const bhl = getSource('bhl');

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, 'fixtures/commons.json'), 'utf8'));

const modules = [
  {
    module: britishLibrary,
    id: 'british-library',
    group: 'libraries',
    filter: 'incategory:"Images_from_the_British_Library_Mechanical_Curator_collection"',
  },
  { module: gallica, id: 'gallica', group: 'libraries', filter: 'insource:"gallica.bnf.fr"' },
  {
    module: noaa,
    id: 'noaa',
    group: 'science',
    filter: 'incategory:"Files_from_the_NOAA_Photo_Library_Flickr_stream"',
  },
  {
    module: bhl,
    id: 'bhl',
    group: 'science',
    filter: 'insource:"biodiversitylibrary.org"',
  },
];

test('subsetQuery trims the query and adds the filter', () => {
  assert.equal(subsetQuery(' moon ', 'insource:"x"'), 'moon insource:"x"');
});

for (const entry of modules) {
  const { module, id, group, filter } = entry;

  test(`${id} exports the subset fields`, () => {
    assert.equal(module.id, id);
    assert.equal(module.group, group);
    assert.equal(module.keyEnv, null);
    assert.equal(module.config.options.filter, filter);
    assert.ok(module.name.endsWith(' (via Wikimedia Commons)'));
    assert.equal(typeof module.homepage, 'string');
    assert.ok(module.homepage.startsWith('https://'));
  });

  test(`${id} builds the Commons search URL with the filter`, () => {
    const url = new URL(module.buildSearchUrl('moon', 1));
    assert.equal(url.host, 'commons.wikimedia.org');
    assert.equal(url.searchParams.get('gsrsearch'), `moon ${filter} filetype:bitmap`);
    assert.equal(url.searchParams.get('gsroffset'), '0');

    const page3 = new URL(module.buildSearchUrl('moon', 3));
    assert.equal(page3.searchParams.get('gsroffset'), '48');
  });

  test(`${id} normalize returns null without imageinfo`, () => {
    assert.equal(module.normalize({ pageid: 1, title: 'File:X.jpg' }), null);
  });
}

test('noaa parseSearch sets source and provider and keeps the Commons URLs', () => {
  const subsetResult = noaa.parseSearch(fixture, 1);
  const commonsResult = commonsParseSearch(fixture, 1);

  assert.equal(subsetResult.items.length, commonsResult.items.length);
  for (let i = 0; i < subsetResult.items.length; i += 1) {
    assert.equal(subsetResult.items[i].source, 'noaa');
    assert.equal(subsetResult.items[i].provider, 'NOAA Photo Library');
    assert.equal(subsetResult.items[i].full, commonsResult.items[i].full);
    assert.equal(subsetResult.items[i].pageUrl, commonsResult.items[i].pageUrl);
  }
});

test('factory parseSearch does not change commons items', () => {
  noaa.parseSearch(fixture, 1);
  const commonsResult = commonsParseSearch(fixture, 1);
  assert.equal(commonsResult.items[0].source, 'commons');
  assert.equal(commonsResult.items[0].provider, undefined);
});

test('noaa normalize sets the subset source and provider', () => {
  const item = noaa.normalize(fixture.query.pages['10726475']);
  assert.equal(item.source, 'noaa');
  assert.equal(item.provider, 'NOAA Photo Library');
  assert.ok(item.pageUrl.startsWith('https://commons.wikimedia.org/wiki/File:'));
});

test('noaa search uses the injected fetchJson', async () => {
  const urls = [];
  const fetchJson = async (url) => {
    urls.push(url);
    return fixture;
  };

  const result = await noaa.search('whale', 2, { fetchJson });
  assert.equal(urls.length, 1);
  const searchText = new URL(urls[0]).searchParams.get('gsrsearch');
  assert.ok(searchText.includes('whale incategory:"Files_from_the_NOAA_Photo_Library_Flickr_stream"'));
  assert.equal(new URL(urls[0]).searchParams.get('gsroffset'), '24');
  assert.ok(result.items.length > 0);
  for (const item of result.items) assert.equal(item.source, 'noaa');
});

test('factory buildSearchUrl matches commons buildSearchUrl with the subset query', () => {
  const subset = createCommonsSubset({
    id: 'demo',
    name: 'Demo',
    homepage: 'https://example.org',
    group: 'museums',
    filter: 'insource:"demo"',
  });
  assert.equal(
    subset.buildSearchUrl('moon', 2),
    commonsBuildSearchUrl('moon insource:"demo"', 2),
  );
  assert.equal(subset.name, 'Demo (via Wikimedia Commons)');
  assert.equal(subset.keyEnv, null);
});
