import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  clearCache,
  id,
  isOpen,
  name,
  normalize,
  parseSearch,
  search,
} from './index.js';

import { getSource } from '../../lib/sources/index.js';

const {
  group,
  homepage,
  keyEnv,
} = getSource('princeton');

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, '../../test/fixtures/princeton.json'), 'utf8'));
const objects = fixture.objects;

function openSearch() {
  const json = structuredClone(fixture.search);
  json.hits.hits[1] = {
    _id: '122370',
    _source: {
      objectid: 122370,
      displaytitle: objects['122370'].displaytitle,
      displaymaker: objects['122370'].displaymaker,
      displaydate: objects['122370'].displaydate,
      primaryimage: objects['122370'].primaryimage,
    },
  };
  return json;
}

function objectUrl(objectId) {
  return `https://data.artmuseum.princeton.edu/objects/${objectId}`;
}

test('princeton constants', () => {
  assert.equal(id, 'princeton');
  assert.equal(name, 'Princeton University Art Museum');
  assert.equal(homepage, 'https://artmuseum.princeton.edu');
  assert.equal(group, 'museums');
  assert.equal(keyEnv, null);
});

test('princeton isOpen reads the object and media restrictions', () => {
  clearCache();
  assert.equal(isOpen(objects['33432']), false);
  assert.equal(isOpen(objects['122370']), true);
  assert.equal(isOpen(objects['10546']), true);

  const mediaRestricted = { ...objects['122370'], media: [{ ...objects['122370'].media[0], restrictions: 'Restricted' }] };
  assert.equal(isOpen(mediaRestricted), false);

  const copyrighted = { ...objects['122370'], creditlinerepro: '© X' };
  assert.equal(isOpen(copyrighted), false);

  const objectCopyrighted = { ...objects['122370'], creditlinerepro: '© Someone' };
  assert.equal(isOpen(objectCopyrighted), false);

  const webBlocked = { ...objects['122370'], nowebuse: 'True' };
  assert.equal(isOpen(webBlocked), false);

  assert.equal(isOpen({ ...objects['122370'], restrictions: '' }), true);
  assert.equal(isOpen(null), false);
});

test('princeton normalize makes an Item', () => {
  const item = normalize(objects['122370']);

  assert.equal(item.source, 'princeton');
  assert.equal(item.id, '122370');
  assert.equal(item.title, 'Young Indian Woman with Braids');
  assert.equal(item.creator, 'Karl Everton Moon');
  assert.equal(item.date, 'ca. 1903–14');
  assert.equal(item.description, 'Platinum print with hand coloring');
  assert.equal(
    item.thumb,
    'https://media.artmuseum.princeton.edu/iiif/3/collection/PUAMSTU2016_11424/full/400,/0/default.jpg',
  );
  assert.equal(
    item.preview,
    'https://media.artmuseum.princeton.edu/iiif/3/collection/PUAMSTU2016_11424/full/1600,/0/default.jpg',
  );
  assert.ok(item.full.endsWith('/full/max/0/default.jpg'));
  assert.equal(
    item.full,
    'https://media.artmuseum.princeton.edu/iiif/3/collection/PUAMSTU2016_11424/full/max/0/default.jpg',
  );
  assert.equal(item.width, null);
  assert.equal(item.height, null);
  assert.equal(item.license, 'Open access');
  assert.equal(item.licenseUrl, null);
  assert.equal(item.pageUrl, 'https://artmuseum.princeton.edu/collections/objects/122370');
});

test('princeton normalize returns null for a restricted object', () => {
  assert.equal(normalize(objects['33432']), null);
});

test('princeton normalize cuts the creator at a comma or semicolon', () => {
  const item = normalize(objects['10546']);
  assert.equal(item.creator, 'R. William Woiceske');
  assert.equal(item.date, null);
});

test('princeton parseSearch reads total and hasMore', () => {
  const result = parseSearch(fixture.search, 1);
  assert.equal(result.total, 366);
  assert.equal(result.hasMore, true);

  const lastPage = parseSearch({ hits: { total: 3, hits: [] } }, 2);
  assert.equal(lastPage.total, 3);
  assert.equal(lastPage.hasMore, false);

  const es7 = parseSearch({ hits: { total: { value: 100 }, hits: [] } }, 6);
  assert.equal(es7.total, 100);
  assert.equal(es7.hasMore, false);

  const empty = parseSearch({}, 1);
  assert.equal(empty.total, null);
  assert.equal(empty.hasMore, false);
  assert.deepEqual(empty.items, []);
});

test('princeton search removes restricted objects and keeps the order', async () => {
  clearCache();
  const calls = [];
  async function fetchJson(url) {
    calls.push(url);
    if (url.includes('/search?')) return openSearch();
    const found = url.match(/\/objects\/(\d+)$/);
    return objects[found[1]];
  }

  const result = await search('moon', 1, { fetchJson });
  assert.equal(result.total, 366);
  assert.equal(result.hasMore, true);
  assert.deepEqual(
    result.items.map((item) => item.id),
    ['122370', '10546'],
  );

  assert.ok(calls[0].includes('type=artobjects'));
  assert.ok(calls[0].includes('size=24'));
  assert.ok(calls[0].includes('from=0'));
  assert.ok(calls[0].includes('q=moon'));

  const objectCalls = calls.filter((url) => url.includes('/objects/'));
  assert.deepEqual(objectCalls.sort(), [
    objectUrl('10546'),
    objectUrl('122370'),
    objectUrl('33432'),
  ]);
});

test('princeton search uses the cache for a second search', async () => {
  clearCache();
  const objectCalls = [];
  async function fetchJson(url) {
    if (url.includes('/search?')) return openSearch();
    objectCalls.push(url);
    return objects[url.match(/\/objects\/(\d+)$/)[1]];
  }

  await search('moon', 1, { fetchJson });
  assert.equal(objectCalls.length, 3);

  await search('moon', 1, { fetchJson });
  assert.equal(objectCalls.length, 3);
});

test('princeton search does not request one object twice at the same time', async () => {
  clearCache();
  const objectCalls = [];
  async function fetchJson(url) {
    if (url.includes('/search?')) return openSearch();
    objectCalls.push(url);
    await new Promise((resolve) => setTimeout(resolve, 5));
    return objects[url.match(/\/objects\/(\d+)$/)[1]];
  }

  const [first, second] = await Promise.all([
    search('moon', 1, { fetchJson }),
    search('moon', 1, { fetchJson }),
  ]);

  assert.equal(objectCalls.length, 3);
  assert.deepEqual(first.items.map((item) => item.id), second.items.map((item) => item.id));
});

test('princeton search removes a failed object and retries it on the next search', async () => {
  clearCache();
  let failed = false;
  async function fetchJson(url) {
    if (url.includes('/search?')) return openSearch();
    const objectId = url.match(/\/objects\/(\d+)$/)[1];
    if (objectId === '10546' && !failed) {
      failed = true;
      throw new Error('network down');
    }
    return objects[objectId];
  }

  const first = await search('moon', 1, { fetchJson });
  assert.deepEqual(first.items.map((item) => item.id), ['122370']);

  const second = await search('moon', 1, { fetchJson });
  assert.deepEqual(second.items.map((item) => item.id), ['122370', '10546']);
});

test('princeton search offset moves with the page', async () => {
  clearCache();
  let searchUrl = '';
  async function fetchJson(url) {
    if (url.includes('/search?')) {
      searchUrl = url;
      return { hits: { total: 100, hits: [] } };
    }
    return null;
  }

  const result = await search('moon', 3, { fetchJson });
  assert.ok(searchUrl.includes('from=48'));
  assert.ok(searchUrl.includes('size=24'));
  assert.equal(result.items.length, 0);
  assert.equal(result.total, 100);
  assert.equal(result.hasMore, true);
});
