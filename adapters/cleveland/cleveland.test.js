import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  id,
  normalize,
  parseSearch,
  search,
} from './index.js';

import { getSource } from '../../lib/sources/index.js';

const {
  name,
  homepage,
  keyEnv,
} = getSource('cleveland');

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, '../../test/fixtures/cleveland.json'), 'utf8'));

test('cleveland metadata', () => {
  assert.equal(id, 'cleveland');
  assert.equal(name, 'Cleveland Museum of Art');
  assert.equal(homepage, 'https://www.clevelandart.org');
  assert.equal(keyEnv, null);
});

test('cleveland parseSearch builds items from the fixture', () => {
  const result = parseSearch(fixture, 1);
  assert.equal(result.items.length, 2);
  assert.equal(result.total, fixture.info.total);
  assert.equal(result.hasMore, true);
});

test('cleveland normalize makes an Item', () => {
  const record = fixture.data[0];
  const item = normalize(record);
  assert.equal(item.source, 'cleveland');
  assert.equal(item.id, String(record.id));
  assert.equal(typeof item.id, 'string');
  assert.ok(item.thumb.endsWith('_web.jpg'));
  assert.ok(item.preview.endsWith('_print.jpg'));
  assert.ok(item.full.endsWith('_print.jpg'));
  assert.ok(item.fullTiff.endsWith('_full.tif'));
  assert.equal(item.width, Number(record.images.print.width));
  assert.equal(item.height, Number(record.images.print.height));
  assert.equal(item.license, 'CC0');
  assert.equal(item.licenseUrl, 'https://creativecommons.org/publicdomain/zero/1.0/');
  assert.ok(item.pageUrl.startsWith('https://clevelandart.org/art/'));
  assert.equal(item.creator, record.creators[0].description);
  assert.equal(item.title, record.title);
  assert.equal(item.date, record.creation_date);
});

test('cleveland normalize falls back to the web image without print', () => {
  const record = structuredClone(fixture.data[0]);
  delete record.images.print;
  const item = normalize(record);
  assert.equal(item.full, record.images.web.url);
  assert.equal(item.preview, record.images.web.url);
  assert.equal(item.width, Number(record.images.web.width));
  assert.equal(item.height, Number(record.images.web.height));
});

test('cleveland normalize handles a missing full TIFF', () => {
  const record = structuredClone(fixture.data[0]);
  delete record.images.full;
  assert.equal(normalize(record).fullTiff, null);
});

test('cleveland normalize returns null without images', () => {
  const record = structuredClone(fixture.data[0]);
  delete record.images;
  assert.equal(normalize(record), null);
});

test('cleveland normalize cleans HTML in the description', () => {
  const record = structuredClone(fixture.data[0]);
  record.description = '<p>A &amp; B</p>';
  assert.equal(normalize(record).description, 'A & B');
});

test('cleveland search paginates and reports the last page', async () => {
  const calls = [];
  async function fetchJson(url) {
    calls.push(url);
    return { info: { total: 48 }, data: fixture.data };
  }

  const result = await search('moon', 3, { fetchJson });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes('skip=48'));
  assert.ok(calls[0].includes('limit=24'));
  assert.ok(calls[0].includes('has_image=1'));
  assert.ok(calls[0].includes('cc0=1'));
  assert.equal(result.hasMore, false);
});
