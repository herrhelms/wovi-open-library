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
  name,
  normalize,
  parseSearch,
  search,
} from '../lib/sources/nb-norway.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, 'fixtures/nb-norway.json'), 'utf8'));
const first = fixture._embedded.items[0];
const urn = first.metadata.identifiers.urn;
const base = `https://www.nb.no/services/image/resolver/${urn}`;

test('nb-norway constants', () => {
  assert.equal(id, 'nb-norway');
  assert.equal(name, 'National Library of Norway');
  assert.equal(homepage, 'https://www.nb.no');
  assert.equal(group, 'libraries');
  assert.equal(keyEnv, null);
});

test('nb-norway parseSearch removes restricted items', () => {
  const result = parseSearch(fixture, 1);
  assert.equal(result.items.length, 3);
  assert.equal(result.total, fixture.page.totalElements);
  assert.equal(result.hasMore, true);
  assert.equal(result.items.some((item) => item.id === '00000000000000000000000000000001'), false);
  assert.equal(result.items.some((item) => item.id === '00000000000000000000000000000002'), false);
});

test('nb-norway normalize makes an Item', () => {
  const item = normalize(first);

  assert.equal(item.source, 'nb-norway');
  assert.equal(item.id, first.id);
  assert.equal(item.title, first.metadata.title);
  assert.equal(item.creator, first.metadata.creators.join(', '));
  assert.equal(item.date, first.metadata.dateCreated);
  assert.equal(item.description, null);
  assert.equal(item.thumb, `${base}/full/400,/0/native.jpg`);
  assert.equal(item.preview, `${base}/full/1600,/0/native.jpg`);
  assert.ok(item.full.endsWith('/full/full/0/native.jpg'));
  assert.equal(item.full, `${base}/full/full/0/native.jpg`);
  assert.equal(item.width, null);
  assert.equal(item.height, null);
  assert.equal(item.pageUrl, `https://www.nb.no/items/${urn}`);
  assert.equal(item.license, 'Public domain');
  assert.equal(item.licenseUrl, 'https://creativecommons.org/publicdomain/mark/1.0/');
});

test('nb-norway normalize removes items that are not public domain everywhere', () => {
  const restricted = structuredClone(first);
  restricted.accessInfo.isPublicDomain = false;
  assert.equal(normalize(restricted), null);

  const norway = structuredClone(first);
  norway.accessInfo.accessAllowedFrom = 'NORWAY';
  assert.equal(normalize(norway), null);
});

test('nb-norway normalize uses the URN when thumbnail_custom is missing', () => {
  const raw = structuredClone(first);
  delete raw._links;
  const item = normalize(raw);
  assert.equal(item.thumb, `${base}/full/400,/0/native.jpg`);
  assert.equal(item.preview, `${base}/full/1600,/0/native.jpg`);
  assert.equal(item.full, `${base}/full/full/0/native.jpg`);
});

test('nb-norway normalize uses the item id on the page URL when the URN is missing', () => {
  const raw = structuredClone(first);
  delete raw.metadata.identifiers.urn;
  const item = normalize(raw);
  assert.equal(item.pageUrl, `https://www.nb.no/items/${first.id}`);
  assert.equal(item.thumb, `${base}/full/400,/0/native.jpg`);
});

test('nb-norway normalize returns null without a usable image base', () => {
  const raw = structuredClone(first);
  raw._links = {};
  raw.metadata.identifiers = {};
  assert.equal(normalize(raw), null);
});

test('nb-norway normalize makes a title fallback and no creator', () => {
  const raw = structuredClone(first);
  delete raw.metadata.creators;
  delete raw.metadata.title;
  delete raw.metadata.dateCreated;
  const item = normalize(raw);
  assert.equal(item.title, 'Untitled');
  assert.equal(item.creator, null);
  assert.equal(item.date, null);
});

test('nb-norway search builds the search URL', async () => {
  let requested = '';
  const fake = async (url) => {
    requested = url;
    return fixture;
  };
  const result = await search('måne', 2, { fetchJson: fake });
  assert.equal(result.items.length, 3);

  const url = new URL(requested);
  assert.equal(url.origin + url.pathname, 'https://api.nb.no/catalog/v1/items');
  assert.equal(url.searchParams.get('page'), '1');
  assert.equal(url.searchParams.get('size'), '24');
  assert.deepEqual(url.searchParams.getAll('filter'), [
    'mediatype:bilder',
    'contentClasses:public',
  ]);
  assert.equal(url.searchParams.get('q'), 'måne');
});

test('nb-norway parseSearch handles an answer without _embedded', () => {
  const json = { page: { number: 0, size: 24, totalElements: 0, totalPages: 0 } };
  const result = parseSearch(json, 1);
  assert.deepEqual(result.items, []);
  assert.equal(result.total, 0);
  assert.equal(result.hasMore, false);
});

test('nb-norway parseSearch handles a fully empty answer', () => {
  const result = parseSearch({}, 1);
  assert.deepEqual(result.items, []);
  assert.equal(result.total, null);
  assert.equal(result.hasMore, false);
});

test('nb-norway search rethrows errors', async () => {
  const boom = new Error('network down');
  await assert.rejects(
    search('moon', 1, {
      fetchJson: async () => {
        throw boom;
      },
    }),
    (err) => err === boom,
  );
});
