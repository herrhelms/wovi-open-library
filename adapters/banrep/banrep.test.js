import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  id,
  COLLECTIONS,
  cleanQuery,
  buildSearchUrl,
  parseSearch,
  normalize,
  search,
} from './index.js';

import { getSource } from '../../lib/sources/index.js';

const { name, homepage, group, keyEnv, config } = getSource('banrep');

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, '../../test/fixtures/banrep.json'), 'utf8'));

const SEARCH_TEMPLATE =
  'https://babel.banrepcultural.org/digital/bl/dmwebservices/index.php?q=dmQuery/' +
  'p17054coll40!hidalgos!p17054coll13!p17054coll16!r_rendon/' +
  'CISOSEARCHALL^<q>^all^and!rights^dominio^all^and/title!creato!date!rights/nosort/24/<start>/0/0/0/0/json';

test('banrep metadata', () => {
  assert.equal(id, 'banrep');
  assert.equal(name, 'Banco de la República (Colombia)');
  assert.equal(group, 'libraries');
  assert.equal(keyEnv, null);
  assert.equal(config.order, 413);
  assert.equal(homepage, 'https://www.banrepcultural.org/biblioteca-virtual');
  assert.equal(config.notes.length, 2);
});

test('banrep collections', () => {
  assert.deepEqual(COLLECTIONS, [
    'p17054coll40',
    'hidalgos',
    'p17054coll13',
    'p17054coll16',
    'r_rendon',
  ]);
});

test('banrep cleanQuery removes special characters', () => {
  assert.equal(cleanQuery('luna^llena!/x\\y'), 'luna llena x y');
  assert.equal(cleanQuery('  retrato   mujer  '), 'retrato mujer');
});

test('banrep buildSearchUrl', () => {
  const url = buildSearchUrl('retrato mujer', 2);
  assert.equal(
    url,
    SEARCH_TEMPLATE.replace('<q>', 'retrato%20mujer').replace('<start>', '25'),
  );
  assert.equal(buildSearchUrl('retrato', 1), SEARCH_TEMPLATE.replace('<q>', 'retrato').replace('<start>', '1'));
  assert.equal(buildSearchUrl('retrato', 0), SEARCH_TEMPLATE.replace('<q>', 'retrato').replace('<start>', '1'));
  assert.equal(buildSearchUrl('retrato', 'x'), SEARCH_TEMPLATE.replace('<q>', 'retrato').replace('<start>', '1'));
  assert.equal(buildSearchUrl('^!', 1), null);
});

test('banrep search with an empty query makes no request', async () => {
  let calls = 0;
  async function fetchJson() {
    calls += 1;
    return fixture;
  }
  const result = await search('^!', 1, { fetchJson });
  assert.deepEqual(result, { total: 0, hasMore: false, items: [] });
  assert.equal(calls, 0);
});

test('banrep search drops compound objects', async () => {
  const calls = [];
  async function fetchJson(url) {
    calls.push(url);
    return fixture;
  }
  const result = await search('retrato', 1, { fetchJson });
  assert.equal(calls.length, 1);
  assert.equal(result.total, 1149);
  assert.equal(result.hasMore, true);
  assert.equal(result.items.length, 22);

  const first = result.items[0];
  assert.equal(first.id, 'p17054coll40:524');
  assert.equal(first.title, 'Manuel J. Vega y José T. Gaibrois');
  assert.equal(first.creator, 'Faccini, Antonio, 1840-1897');
  assert.equal(first.date, '1882');
  assert.equal(first.license, 'Public domain');
  assert.equal(first.licenseUrl, 'https://creativecommons.org/publicdomain/mark/1.0/');
  assert.equal(
    first.full,
    'https://babel.banrepcultural.org/iiif/2/p17054coll40:524/full/max/0/default.jpg',
  );
  assert.equal(
    first.preview,
    'https://babel.banrepcultural.org/iiif/2/p17054coll40:524/full/1600,/0/default.jpg',
  );
  assert.equal(
    first.thumb,
    'https://babel.banrepcultural.org/iiif/2/p17054coll40:524/full/400,/0/default.jpg',
  );
  assert.equal(
    first.pageUrl,
    'https://babel.banrepcultural.org/digital/collection/p17054coll40/id/524',
  );
});

test('banrep parseSearch handles missing values', () => {
  assert.deepEqual(parseSearch({}, 1), { total: 0, hasMore: false, items: [] });
});

test('banrep normalize keeps public domain in any case and without accents', () => {
  const record = structuredClone(fixture.records[0]);
  record.rights = 'DOMINIO PUBLICO';
  assert.ok(normalize(record));
});

test('banrep normalize drops records that are not public domain', () => {
  const record = structuredClone(fixture.records[0]);
  record.rights = '© Derechos reservados';
  assert.equal(normalize(record), null);
});

test('banrep normalize drops pdf and cpd files', () => {
  const pdf = structuredClone(fixture.records[0]);
  pdf.filetype = 'pdf';
  assert.equal(normalize(pdf), null);

  const cpd = structuredClone(fixture.records[0]);
  cpd.filetype = 'cpd';
  assert.equal(normalize(cpd), null);
});

test('banrep normalize keeps a single page of a compound object', () => {
  const record = structuredClone(fixture.records[0]);
  record.parentobject = 82;
  assert.ok(normalize(record));
});

test('banrep normalize gives a null creator for white space', () => {
  const record = structuredClone(fixture.records[0]);
  record.creato = ' ';
  assert.equal(normalize(record).creator, null);
});

test('banrep normalize moves a long date to the description', () => {
  const record = structuredClone(fixture.records[0]);
  record.date = 'x'.repeat(41);
  const item = normalize(record);
  assert.equal(item.date, null);
  assert.equal(item.description, record.date);
});

test('banrep normalize uses the fallback title', () => {
  const record = structuredClone(fixture.records[0]);
  record.title = '  ';
  assert.equal(normalize(record).title, 'Untitled');
});
