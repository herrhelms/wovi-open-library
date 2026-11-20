import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { getSource } from '../lib/sources/index.js';

const parisMusees = getSource('paris-musees');
const walters = getSource('walters');
const brooklyn = getSource('brooklyn');
const auckland = getSource('auckland');
const nara = getSource('nara');
const nationaalArchief = getSource('nationaal-archief');
const bundesarchiv = getSource('bundesarchiv');
const ethLibrary = getSource('eth-library');
const slq = getSource('slq');

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(here, 'fixtures/commons-paris-musees.json'), 'utf8'),
);

const modules = [
  {
    module: parisMusees,
    id: 'paris-musees',
    name: 'Paris Musées',
    homepage: 'https://www.parismusees.paris.fr',
    group: 'museums',
    filter: 'incategory:"Images_from_Paris_Musées"',
  },
  {
    module: walters,
    id: 'walters',
    name: 'Walters Art Museum',
    homepage: 'https://art.thewalters.org',
    group: 'museums',
    filter: 'deepcat:"Media contributed by the Walters Art Museum"',
  },
  {
    module: brooklyn,
    id: 'brooklyn',
    name: 'Brooklyn Museum',
    homepage: 'https://www.brooklynmuseum.org',
    group: 'museums',
    filter: 'deepcat:"Media contributed by the Brooklyn Museum"',
  },
  {
    module: auckland,
    id: 'auckland',
    name: 'Auckland Museum',
    homepage: 'https://www.aucklandmuseum.com',
    group: 'museums',
    filter: 'incategory:"Images_from_Auckland_Museum"',
  },
  {
    module: nara,
    id: 'nara',
    name: 'US National Archives',
    homepage: 'https://www.archives.gov',
    group: 'libraries',
    filter: 'incategory:"Images_from_the_National_Archives_and_Records_Administration"',
  },
  {
    module: nationaalArchief,
    id: 'nationaal-archief',
    name: 'Nationaal Archief (Netherlands)',
    homepage: 'https://www.nationaalarchief.nl',
    group: 'libraries',
    filter: 'incategory:"Images_from_Nationaal_Archief"',
  },
  {
    module: bundesarchiv,
    id: 'bundesarchiv',
    name: 'German Federal Archive',
    homepage: 'https://www.bundesarchiv.de',
    group: 'libraries',
    filter: 'incategory:"Images_from_the_German_Federal_Archive"',
  },
  {
    module: ethLibrary,
    id: 'eth-library',
    name: 'ETH Library Zurich',
    homepage: 'https://library.ethz.ch',
    group: 'libraries',
    filter: 'incategory:"Media_contributed_by_the_ETH-Bibliothek"',
  },
  {
    module: slq,
    id: 'slq',
    name: 'State Library of Queensland',
    homepage: 'https://www.slq.qld.gov.au',
    group: 'libraries',
    filter: 'incategory:"Images_from_the_State_Library_of_Queensland"',
  },
];

for (const entry of modules) {
  const { module, id, name, homepage, group, filter } = entry;

  test(`${id} exports the subset fields`, () => {
    assert.equal(module.id, id);
    assert.equal(module.name, `${name} (via Wikimedia Commons)`);
    assert.equal(module.homepage, homepage);
    assert.equal(module.group, group);
    assert.equal(module.keyEnv, null);
    assert.equal(module.config.options.filter, filter);
  });

  test(`${id} builds the Commons search URL with the filter`, () => {
    const url = new URL(module.buildSearchUrl('moon', 1));
    assert.equal(url.host, 'commons.wikimedia.org');
    assert.equal(url.searchParams.get('gsrsearch'), `moon ${filter} filetype:bitmap`);
    assert.equal(url.searchParams.get('gsroffset'), '0');

    const page2 = new URL(module.buildSearchUrl('moon', 2));
    assert.equal(page2.searchParams.get('gsroffset'), '24');
  });
}

test('the nine batch 5 ids are unique', () => {
  const ids = modules.map((entry) => entry.module.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('paris-musees parseSearch sets source and provider and keeps the Commons URLs', () => {
  const result = parisMusees.parseSearch(fixture, 1);
  assert.ok(result.items.length >= 1);
  for (const item of result.items) {
    assert.equal(item.source, 'paris-musees');
    assert.equal(item.provider, 'Paris Musées');
    assert.equal(new URL(item.full).host, 'upload.wikimedia.org');
    assert.equal(new URL(item.pageUrl).host, 'commons.wikimedia.org');
  }
});

test('nara search uses the injected fetchJson and sets the source', async () => {
  const urls = [];
  const fetchJson = async (url) => {
    urls.push(url);
    return fixture;
  };

  const result = await nara.search('moon', 1, { fetchJson });
  assert.equal(urls.length, 1);
  assert.ok(
    urls[0].includes(
      'incategory%3A%22Images_from_the_National_Archives_and_Records_Administration%22',
    ),
  );
  assert.ok(result.items.length > 0);
  for (const item of result.items) assert.equal(item.source, 'nara');
});
