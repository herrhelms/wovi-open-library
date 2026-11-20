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
} = getSource('mia');

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, '../../test/fixtures/mia.json'), 'utf8'));

test('mia metadata', () => {
  assert.equal(id, 'mia');
  assert.equal(name, 'Minneapolis Institute of Art');
  assert.equal(homepage, 'https://collections.artsmia.org');
  assert.equal(keyEnv, null);
});

test('mia parseSearch removes non-public-domain records', () => {
  const result = parseSearch(fixture, 1);
  assert.equal(result.items.length, 1);
  assert.equal(result.total, fixture.hits.total.value);
  const item = result.items[0];
  const record = fixture.hits.hits.find(
    (hit) => hit._source.rights_type === 'Public Domain',
  )._source;
  assert.equal(item.id, String(record.id));
  assert.equal(item.source, 'mia');
  assert.equal(item.thumb, `https://1.api.artsmia.org/400/${record.id}.jpg`);
  assert.equal(item.preview, `https://1.api.artsmia.org/full/${record.id}.jpg`);
  assert.equal(item.previewFallback, `https://1.api.artsmia.org/800/${record.id}.jpg`);
  assert.equal(item.full, `https://1.api.artsmia.org/full/${record.id}.jpg`);
  assert.equal(item.pageUrl, `https://collections.artsmia.org/art/${record.id}`);
  assert.equal(item.license, 'Public domain');
  assert.equal(item.licenseUrl, 'https://creativecommons.org/publicdomain/mark/1.0/');
  assert.equal(item.width, record.image_width);
  assert.equal(item.height, record.image_height);
  assert.equal(item.creator, record.artist);
  assert.equal(item.date, record.dated);
});

test('mia normalize id 1218 uses the full image as preview', () => {
  const item = normalize({ id: 1218, rights_type: 'Public Domain', title: 'Test' });
  assert.equal(item.preview, 'https://1.api.artsmia.org/full/1218.jpg');
  assert.equal(item.previewFallback, 'https://1.api.artsmia.org/800/1218.jpg');
  assert.equal(item.full, 'https://1.api.artsmia.org/full/1218.jpg');
});

test('mia normalize rejects unknown rights', () => {
  assert.equal(normalize({ id: 1, rights_type: 'Unknown' }), null);
  assert.equal(normalize({ rights_type: 'Public Domain' }), null);
});

test('mia parseSearch accepts a numeric hits.total', () => {
  const result = parseSearch({ hits: { total: 5, hits: [] } }, 1);
  assert.equal(result.total, 5);
});

test('mia search uses the encoded query and paginates', async () => {
  const calls = [];
  async function fetchJson(url) {
    calls.push(url);
    return fixture;
  }

  const result = await search('moon', 2, { fetchJson });
  assert.equal(calls.length, 1);
  const url = calls[0];
  assert.ok(url.startsWith('https://search.artsmia.org/'));
  assert.ok(url.includes('from=24'));
  assert.ok(url.includes('size=24'));
  const path = decodeURIComponent(new URL(url).pathname.slice(1));
  assert.ok(path.includes('moon public_access:1 image:valid rights_type:"Public Domain"'));
  assert.equal(result.items.length, 1);
  assert.equal(result.total, fixture.hits.total.value);
});
