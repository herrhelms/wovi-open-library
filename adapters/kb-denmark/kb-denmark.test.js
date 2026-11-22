import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  id,
  cleanQuery,
  buildSearchUrl,
  parseSearch,
  normalize,
  search,
} from './index.js';

import { getSource } from '../../lib/sources/index.js';

const {
  group,
  keyEnv,
  name,
  config,
  trustResolvedUrl,
} = getSource('kb-denmark');

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, '../../test/fixtures/kb-denmark.json'), 'utf8'));
const first = fixture.search.response.docs[0];

test('kb-denmark metadata', () => {
  assert.equal(name, 'Royal Danish Library');
  assert.equal(group, 'libraries');
  assert.equal(keyEnv, null);
  assert.equal(trustResolvedUrl, false);
  assert.equal(config.order, 411);
});

test('kb-denmark cleanQuery removes Solr special characters', () => {
  assert.equal(cleanQuery('a+b (c) "d" e:f/g\\h'), 'a b c d e f g h');
  assert.equal(cleanQuery('  ()  '), '');
});

test('kb-denmark buildSearchUrl builds the query', () => {
  const raw = buildSearchUrl('portræt', 2);
  const url = new URL(raw);

  assert.equal(url.host, 'digitalesamlinger.kb.dk');
  assert.equal(url.pathname, '/catalog.json');
  assert.equal(
    url.searchParams.get('q'),
    '(portræt) AND (rights_tsim:"fri af ophavsret" OR rights_tsim:"CC BY")',
  );
  assert.equal(url.searchParams.get('search_field'), 'all_fields');
  assert.equal(url.searchParams.get('f[medium_ssi][]'), 'images');
  assert.equal(url.searchParams.get('per_page'), '24');
  assert.equal(url.searchParams.get('page'), '2');
  assert.ok(raw.includes('f%5Bmedium_ssi%5D%5B%5D=images'));
});

test('kb-denmark buildSearchUrl starts at page 1 for a bad page', () => {
  for (const page of [0, -3, 'nope', undefined, null]) {
    const url = new URL(buildSearchUrl('portræt', page));
    assert.equal(url.searchParams.get('page'), '1');
  }
});

test('kb-denmark buildSearchUrl returns null for an empty query', () => {
  assert.equal(buildSearchUrl('()', 1), null);
  assert.equal(buildSearchUrl('   ', 1), null);
});

test('kb-denmark search with an empty query makes no request', async () => {
  let calls = 0;
  const result = await search('()', 1, {
    fetchJson: async () => {
      calls += 1;
      return fixture.search;
    },
  });

  assert.deepEqual(result, { total: 0, hasMore: false, items: [] });
  assert.equal(calls, 0);
});

test('kb-denmark search reads the fixture', async () => {
  const requested = [];
  const result = await search('portræt', 1, {
    fetchJson: async (url) => {
      requested.push(url);
      return fixture.search;
    },
  });

  assert.equal(requested.length, 1);
  assert.equal(new URL(requested[0]).searchParams.get('page'), '1');
  assert.equal(result.total, 90040);
  assert.equal(result.hasMore, true);
  assert.equal(result.items.length, 6);
});

test('kb-denmark normalize makes an Item', () => {
  const item = normalize(first);
  const full = 'https://kb-images.kb.dk/DAMJP2/DAM/Samlingsbilleder/0002/048/943/DT128592_001/full/full/0/native.jpg';

  assert.equal(item.source, 'kb-denmark');
  assert.equal(item.id, '/images/billed/2010/okt/billeder/object2048943');
  assert.equal(item.title, 'Portræt');
  assert.ok(item.creator.startsWith('Møller, J.'));
  assert.equal(item.date, '1885-1935');
  assert.equal(item.description, null);
  assert.equal(item.license, 'Public domain');
  assert.equal(item.licenseUrl, 'https://creativecommons.org/publicdomain/mark/1.0/');
  assert.equal(item.full, full);
  assert.equal(item.preview, 'https://kb-images.kb.dk/DAMJP2/DAM/Samlingsbilleder/0002/048/943/DT128592_001/full/1600,/0/native.jpg');
  assert.equal(item.thumb, 'https://kb-images.kb.dk/DAMJP2/DAM/Samlingsbilleder/0002/048/943/DT128592_001/full/!400,/0/native.jpg');
  assert.equal(item.width, null);
  assert.equal(item.height, null);
  assert.equal(
    item.pageUrl,
    'https://digitalesamlinger.kb.dk/images/billed/2010/okt/billeder/object2048943/da/',
  );
});

test('kb-denmark normalize gives CC BY a label and no URL', () => {
  const item = normalize(fixture.ccby.response.docs[0]);
  assert.equal(item.license, 'CC BY');
  assert.equal(item.licenseUrl, null);
});

test('kb-denmark normalize drops records that are not free or CC BY', () => {
  const ccByNc = structuredClone(first);
  ccByNc.rights_tsim = ['CC BY-NC'];
  assert.equal(normalize(ccByNc), null);

  const noRights = structuredClone(first);
  delete noRights.rights_tsim;
  assert.equal(normalize(noRights), null);

  const noFull = structuredClone(first);
  delete noFull.full_image_url_ssm;
  assert.equal(normalize(noFull), null);
});

test('kb-denmark normalize falls back for title, creator, date, thumb and title element', () => {
  const raw = structuredClone(first);
  delete raw.full_title_tsi;
  delete raw.creator_display_tsim;
  delete raw.readable_dat_string_tsim;
  delete raw.thumbnail_url_ssm;
  const item = normalize(raw);

  assert.equal(item.title, raw.title_tdsim[0]);
  assert.equal(item.creator, null);
  assert.equal(item.date, raw.pub_dat_tsi);
  assert.ok(item.thumb.endsWith('/full/!400,/0/native.jpg'));

  const untitled = structuredClone(first);
  delete untitled.full_title_tsi;
  delete untitled.title_tdsim;
  assert.equal(normalize(untitled).title, 'Untitled');
});

test('kb-denmark parseSearch reads total and hasMore', () => {
  const result = parseSearch(fixture.search);
  assert.equal(result.total, 90040);
  assert.equal(result.hasMore, true);
  assert.equal(result.items.length, 6);

  const lastPage = structuredClone(fixture.search);
  lastPage.response.pages.next_page = null;
  assert.equal(parseSearch(lastPage).hasMore, false);

  const empty = parseSearch({});
  assert.deepEqual(empty, { total: 0, hasMore: false, items: [] });
});
