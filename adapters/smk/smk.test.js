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
} = getSource('smk');

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, '../../test/fixtures/smk.json'), 'utf8'));

const withIiif = fixture.items.find((record) => record.image_iiif_id);
const withoutIiif = fixture.items.find((record) => !record.image_iiif_id);

test('smk metadata', () => {
  assert.equal(id, 'smk');
  assert.equal(name, 'SMK – National Gallery of Denmark');
  assert.equal(homepage, 'https://open.smk.dk');
  assert.equal(keyEnv, null);
});

test('smk parseSearch builds items from the fixture', () => {
  const result = parseSearch(fixture, 1);
  assert.equal(result.items.length, 2);
  assert.equal(result.total, fixture.found);
});

test('smk normalize builds IIIF urls when image_iiif_id exists', () => {
  const item = normalize(withIiif);
  assert.equal(item.source, 'smk');
  assert.equal(item.id, withIiif.object_number);
  assert.equal(item.thumb, `${withIiif.image_iiif_id}/full/400,/0/default.jpg`);
  assert.equal(item.preview, `${withIiif.image_iiif_id}/full/1600,/0/default.jpg`);
  assert.equal(item.full, withIiif.image_native);
  assert.equal(item.license, 'Public domain');
  assert.equal(item.licenseUrl, withIiif.rights);
  assert.equal(item.pageUrl, withIiif.frontend_url);
  assert.equal(item.width, withIiif.image_width);
  assert.equal(item.height, withIiif.image_height);
});

test('smk normalize falls back to the native image without image_iiif_id', () => {
  const item = normalize(withoutIiif);
  assert.equal(item.thumb, withoutIiif.image_native);
  assert.equal(item.preview, withoutIiif.image_native);
  assert.equal(item.full, withoutIiif.image_native);
  assert.equal(item.id, withoutIiif.object_number);
});

test('smk normalize returns null without any image', () => {
  assert.equal(normalize({ object_number: 'X', titles: [{ title: 'X' }] }), null);
});

test('smk normalize prefers the English title', () => {
  const item = normalize({
    object_number: 'X1',
    image_native: 'https://api.smk.dk/x.jpg',
    titles: [
      { title: 'Månelys', language: 'dansk' },
      { title: 'Moonlight', language: 'engelsk' },
    ],
  });
  assert.equal(item.title, 'Moonlight');

  const fallback = normalize({
    object_number: 'X2',
    image_native: 'https://api.smk.dk/x.jpg',
    titles: [{ title: 'Månelys', language: 'dansk' }],
  });
  assert.equal(fallback.title, 'Månelys');
});

test('smk normalize builds the creator name', () => {
  const base = { object_number: 'X', image_native: 'https://api.smk.dk/x.jpg' };
  assert.equal(
    normalize({
      ...base,
      production: [
        { creator: 'Neer, Aert van der', creator_forename: 'Aert van der', creator_surname: 'Neer' },
      ],
    }).creator,
    'Aert van der Neer',
  );
  assert.equal(
    normalize({ ...base, production: [{ creator: 'Rosa, Salvator' }] }).creator,
    'Rosa, Salvator',
  );
  assert.equal(normalize(base).creator, null);
});

test('smk normalize handles date and description', () => {
  const item = normalize({
    object_number: 'X',
    image_native: 'https://api.smk.dk/x.jpg',
    production_date: [{ period: '1618-1905' }],
    content_description: ['<p>Moon &amp; light</p>'],
  });
  assert.equal(item.date, '1618-1905');
  assert.equal(item.description, 'Moon & light');
});

test('smk search encodes filters and paginates', async () => {
  const calls = [];
  async function fetchJson(url) {
    calls.push(url);
    return fixture;
  }

  const result = await search('moon', 2, { fetchJson });
  assert.equal(calls.length, 1);
  const url = calls[0];
  assert.ok(url.includes('%5Bhas_image:true%5D'));
  assert.ok(url.includes('%5Bpublic_domain:true%5D'));
  assert.ok(url.includes('offset=24'));
  assert.ok(url.includes('rows=24'));
  assert.ok(!url.includes('['));
  assert.ok(!url.includes(']'));
  assert.equal(result.items.length, 2);
});
