import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  id,
  normalize,
  parseSearch,
  resolveDownload,
  search,
} from './index.js';

import { getSource } from '../../lib/sources/index.js';

const {
  group,
  homepage,
  keyEnv,
  name,
  trustResolvedUrl,
} = getSource('japan-search');

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, '../../test/fixtures/japan-search.json'), 'utf8'));

test('japan-search constants', () => {
  assert.equal(id, 'japan-search');
  assert.equal(name, 'Japan Search');
  assert.equal(homepage, 'https://jpsearch.go.jp');
  assert.equal(group, 'aggregators');
  assert.equal(keyEnv, null);
  assert.equal(trustResolvedUrl, true);
});

test('japan-search parseSearch reads the mapps item', () => {
  const result = parseSearch(fixture.image, 1);
  assert.equal(result.total, fixture.image.hit);
  assert.equal(result.hasMore, 0 + fixture.image.list.length < fixture.image.hit);
  assert.ok(result.items.length > 0);

  const raw = fixture.image.list.find((entry) => entry.common.titleEn === 'Moon Over Izura');
  const item = result.items.find((entry) => entry.id === raw.id);

  assert.equal(item.source, 'japan-search');
  assert.equal(item.id, raw.id);
  assert.equal(item.title, 'Moon Over Izura');
  assert.equal(item.description, '五浦之月');
  assert.equal(item.thumb, raw.common.thumbnailUrl[0]);
  assert.equal(item.preview, raw.common.thumbnailUrl[0]);
  assert.equal(item.full, raw.common.thumbnailUrl[0]);
  assert.equal(item.pageUrl, raw.common.linkUrl);
  assert.equal(item.creator, '川瀬巴水 KAWASE Hasui');
  assert.ok(!item.creator.includes('\u3000'));
  assert.equal(item.date, '1952');
  assert.equal(item.license, 'Public domain');
  assert.equal(item.licenseUrl, 'https://creativecommons.org/publicdomain/mark/1.0/');
  assert.equal(item.provider, 'ZENBI');
});

test('japan-search parseSearch upgrades NDL IIIF thumbnails', () => {
  const result = parseSearch(fixture.ndl, 1);
  assert.equal(result.total, fixture.ndl.hit);

  const raw = fixture.ndl.list.find((entry) =>
    /\/full\/\d+,\/0\/default\.jpg$/.test(entry.common.thumbnailUrl?.[0] ?? ''),
  );
  assert.ok(raw, 'fixture has an IIIF item');

  const item = result.items.find((entry) => entry.id === raw.id);
  const base = raw.common.thumbnailUrl[0].replace(/\/full\/\d+,\/0\/default\.jpg$/, '');

  assert.ok(item.thumb.endsWith('/full/400,/0/default.jpg'));
  assert.ok(item.preview.endsWith('/full/1600,/0/default.jpg'));
  assert.ok(item.full.endsWith('/full/full/0/default.jpg'));
  assert.equal(item.thumb, `${base}/full/400,/0/default.jpg`);
  assert.equal(item.preview, `${base}/full/1600,/0/default.jpg`);
  assert.equal(item.full, `${base}/full/full/0/default.jpg`);
  assert.equal(item.pageUrl.startsWith('https://dl.ndl.go.jp/'), true);
});

test('japan-search normalize rejects other rights', () => {
  const raw = fixture.image.list[0];
  const entry = { id: raw.id, common: { ...raw.common, contentsRightsType: 'ccby' } };
  assert.equal(normalize(entry), null);
});

test('japan-search normalize returns null without an image', () => {
  const entry = {
    id: 'x',
    common: { title: 'T', thumbnailUrl: null, contentsUrl: null, contentsRightsType: 'pdm' },
  };
  assert.equal(normalize(entry), null);
});

test('japan-search search builds the search URL', async () => {
  let requested = '';
  const fake = async (url) => {
    requested = url;
    return fixture.image;
  };
  const result = await search('moon', 3, { fetchJson: fake });
  assert.ok(result.items.length > 0);
  assert.ok(requested.startsWith('https://jpsearch.go.jp/api/item/search/jps-cross?'));
  assert.ok(requested.includes('keyword=moon'));
  assert.equal(new URL(requested).searchParams.getAll('f-rights').length, 1);
  assert.equal(new URL(requested).searchParams.get('f-rights'), 'pdm');
  assert.equal(new URL(requested).searchParams.get('f-contents'), 'image');
  assert.equal(new URL(requested).searchParams.get('size'), '24');
  assert.equal(new URL(requested).searchParams.get('from'), '48');
});

test('japan-search resolveDownload gets the item record', async () => {
  const raw = fixture.image.list.find((entry) => entry.id === 'apmoa_mapps-18690');
  let requested = '';
  const fake = async (url) => {
    requested = url;
    return { id: raw.id, common: raw.common };
  };
  const resolved = await resolveDownload('apmoa_mapps-18690', { fetchJson: fake });
  assert.equal(requested, 'https://jpsearch.go.jp/api/item/apmoa_mapps-18690');
  assert.equal(resolved.url, raw.common.thumbnailUrl[0]);
  assert.equal(resolved.filename, 'Moon Over Izura');
});

test('japan-search resolveDownload rejects a bad id without a request', async () => {
  let called = false;
  const fake = async () => {
    called = true;
    return { common: {} };
  };
  await assert.rejects(resolveDownload('a/b', { fetchJson: fake }), (err) => err.status === 400);
  assert.equal(called, false);
});
