import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  SEARCH_URL,
  buildSearchBody,
  foldQuery,
  id,
  normalize,
  parseSearch,
  search,
} from './index.js';

import { getSource } from '../../lib/sources/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, '../../test/fixtures/fortepan.json'), 'utf8'));

test('fortepan is registered with the expected config', () => {
  const source = getSource('fortepan');
  assert.ok(source);
  assert.equal(id, 'fortepan');
  assert.equal(source.name, 'Fortepan (Hungary)');
  assert.equal(source.homepage, 'https://fortepan.hu');
  assert.equal(source.group, 'libraries');
  assert.equal(source.keyEnv, null);
  assert.equal(source.config.order, 412);
  assert.equal(source.config.notes.length, 2);
});

test('fortepan foldQuery strips accents and folds whitespace', () => {
  assert.equal(foldQuery('  Portré  Ádám '), 'portre adam');
});

test('fortepan buildSearchBody builds the Elasticsearch body', () => {
  const body = buildSearchBody('Portré', 3);
  assert.equal(body.size, 24);
  assert.equal(body.from, 48);
  assert.equal(body.track_total_hits, true);
  const match = body.query.bool.must[0].multi_match;
  assert.equal(match.query, 'portre');
  assert.deepEqual(match.fields, [
    'description_search',
    'cimke_en_search',
    'orszag_en_search',
    'varos_en_search',
    'helyszin_en_search',
    'szerzo_search',
  ]);
  assert.equal(match.type, 'bool_prefix');
  assert.equal(match.operator, 'and');
  assert.equal(buildSearchBody('x', 0).from, 0);
  assert.equal(buildSearchBody('x', 'nope').from, 0);
});

test('fortepan search sends one POST and parses the fixture', async () => {
  const calls = [];
  async function fetchJson(url, opts) {
    calls.push({ url, opts });
    return fixture;
  }

  const result = await search('portré', 1, { fetchJson });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, SEARCH_URL);
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[0].opts.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].opts.body), buildSearchBody('portré', 1));

  assert.equal(result.total, 210);
  assert.equal(result.hasMore, true);
  assert.equal(result.items.length, 6);
});

test('fortepan search skips the request for an empty query', async () => {
  let called = false;
  const fetchJson = async () => {
    called = true;
    return fixture;
  };
  const result = await search('  ', 1, { fetchJson });
  assert.deepEqual(result, { total: 0, hasMore: false, items: [] });
  assert.equal(called, false);
});

test('fortepan parseSearch maps the first item', () => {
  const result = parseSearch(fixture, 1);
  const item = result.items[0];
  assert.equal(item.id, '107309');
  assert.equal(item.title.startsWith('Dutka Ákos költő'), true);
  assert.equal(item.creator, 'FORTEPAN / Hunyady József');
  assert.equal(item.description, null);
  assert.equal(item.date, '1964');
  assert.equal(item.thumb, 'https://fortepan.download/file/fortepan-eu/480/fortepan_107309.jpg');
  assert.equal(item.preview, 'https://fortepan.download/file/fortepan-eu/1600/fortepan_107309.jpg');
  assert.equal(item.full, 'https://fortepan.download/file/fortepan-eu/download/fortepan_107309.jpg');
  assert.equal(item.width, null);
  assert.equal(item.height, null);
  assert.equal(item.license, 'CC BY-SA 3.0');
  assert.equal(item.licenseUrl, 'https://creativecommons.org/licenses/by-sa/3.0/');
  assert.equal(item.pageUrl, 'https://fortepan.hu/en/photos/?id=107309');
  assert.equal(item.source, 'fortepan');
});

test('fortepan parseSearch maps the photographer of the last item', () => {
  const result = parseSearch(fixture, 1);
  const item = result.items[result.items.length - 1];
  assert.equal(item.id, '129019');
  assert.equal(item.creator, 'FORTEPAN / Gyimesi Kinga');
  assert.equal(item.description, 'Photographer: Bánovszky Miklós');
});

test('fortepan parseSearch handles missing values', () => {
  assert.deepEqual(parseSearch({}, 2), { total: 0, hasMore: false, items: [] });
});

test('fortepan normalize builds a title from tags and place', () => {
  const item = normalize({ mid: [5], year: [1950], cimke_en: ['tram'], varos_en: ['Budapest'] });
  assert.equal(item.title, 'tram · Budapest · 1950');
  assert.equal(item.creator, 'FORTEPAN');
  assert.equal(item.id, '5');
  assert.equal(item.date, '1950');
  assert.equal(item.description, null);
});

test('fortepan normalize falls back to the mid title', () => {
  const item = normalize({ mid: [5] });
  assert.equal(item.title, 'Fortepan 5');
  assert.equal(normalize({}), null);
});
