import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  buildSearchUrl,
  group,
  id,
  keyEnv,
  name,
  normalize,
  parseSearch,
  resolveDownload,
  rightsLabel,
  search,
  trustResolvedUrl,
} from '../lib/sources/dpla.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, 'fixtures/dpla.json'), 'utf8'));

const savedKey = process.env.DPLA_KEY;

function restoreKey() {
  if (savedKey === undefined) delete process.env.DPLA_KEY;
  else process.env.DPLA_KEY = savedKey;
}

function assertNeedsKey(err) {
  assert.equal(err.code, 'NEEDS_KEY');
  assert.equal(err.message, 'DPLA needs DPLA_KEY in .env');
  return true;
}

test('dpla constants', () => {
  assert.equal(id, 'dpla');
  assert.equal(name, 'DPLA');
  assert.equal(group, 'aggregators');
  assert.equal(keyEnv, 'DPLA_KEY');
  assert.equal(trustResolvedUrl, true);
});

test('dpla parseSearch reads docs and count', () => {
  const result = parseSearch(fixture.search, 1);
  assert.equal(result.items.length, 2);
  assert.equal(result.total, fixture.search.count);
  assert.equal(result.hasMore, fixture.search.start + fixture.search.docs.length < fixture.search.count);
});

test('dpla normalize makes an Item from a complete record', () => {
  const raw = fixture.search.docs[0];
  const item = normalize(raw);

  assert.equal(item.source, 'dpla');
  assert.equal(item.id, raw.id);
  assert.equal(item.title, raw.sourceResource.title[0]);
  assert.equal(item.creator, raw.sourceResource.creator[0]);
  assert.equal(item.date, raw.sourceResource.date.displayDate);
  assert.equal(item.description, raw.sourceResource.description[0]);
  assert.equal(item.thumb, raw.object);
  assert.equal(item.preview, raw.object);
  assert.equal(item.full, raw.object);
  assert.equal(item.width, null);
  assert.equal(item.height, null);
  assert.equal(item.pageUrl, raw.isShownAt);
  assert.equal(item.provider, raw.dataProvider);
  assert.equal(item.license, 'No Copyright - United States');
  assert.equal(item.licenseUrl, raw.rights);
  assert.equal(item.note, 'DPLA gives a thumbnail only. Open the partner page for the full image.');
});

test('dpla normalize reads array fields and nested dataProvider', () => {
  const raw = fixture.search.docs[1];
  const item = normalize(raw);

  assert.equal(item.title, raw.sourceResource.title[0]);
  assert.equal(item.creator, raw.sourceResource.creator[0]);
  assert.equal(item.date, raw.sourceResource.date[0].displayDate);
  assert.equal(item.description, raw.sourceResource.description[0]);
  assert.equal(item.thumb, raw.object[0]);
  assert.equal(item.preview, raw.object[0]);
  assert.equal(item.full, raw.object[0]);
  assert.equal(item.pageUrl, raw.isShownAt[0]);
  assert.equal(item.provider, raw.dataProvider.name);
  assert.equal(item.license, 'CC BY-SA 4.0');
  assert.equal(item.licenseUrl, raw.rights);
});

test('dpla normalize returns null without an object URL', () => {
  assert.equal(normalize(fixture.search.docs[2]), null);
  assert.equal(normalize({ id: 'x', sourceResource: { title: ['T'] } }), null);
});

test('dpla normalize falls back to the dp.la item page', () => {
  const item = normalize({ id: 'abc', object: 'https://x.example/a.jpg' });
  assert.equal(item.title, 'Untitled');
  assert.equal(item.creator, null);
  assert.equal(item.date, null);
  assert.equal(item.description, null);
  assert.equal(item.pageUrl, 'https://dp.la/item/abc');
  assert.equal(item.provider, null);
  assert.equal(item.license, 'See partner page');
  assert.equal(item.licenseUrl, null);
});

test('dpla rights labels', () => {
  assert.equal(rightsLabel('https://creativecommons.org/publicdomain/zero/1.0/'), 'CC0');
  assert.equal(rightsLabel('http://rightsstatements.org/vocab/InC/1.0/'), 'In Copyright');
  assert.equal(rightsLabel('https://www.rightsstatements.org/vocab/NoC-US/1.0/'), 'No Copyright - United States');
  assert.equal(rightsLabel('https://rightsstatements.org/vocab/NoC-NC/1.0/'), 'No Copyright - Non-Commercial Use Only');
  assert.equal(rightsLabel('https://rightsstatements.org/vocab/NoC-OKLR/1.0/'), 'No Copyright - Other Known Legal Restrictions');
  assert.equal(rightsLabel('https://rightsstatements.org/vocab/NKC/1.0/'), 'No Known Copyright');
  assert.equal(rightsLabel('https://rightsstatements.org/vocab/InC-EDU/1.0/'), 'In Copyright - Educational Use Permitted');
  assert.equal(rightsLabel('https://rightsstatements.org/vocab/CNE/1.0/'), 'Copyright Not Evaluated');
  assert.equal(rightsLabel('https://rightsstatements.org/vocab/UND/1.0/'), 'Copyright Undetermined');
  assert.equal(rightsLabel('https://rightsstatements.org/vocab/XYZ/1.0/'), 'Rights statement: XYZ');
  assert.equal(rightsLabel('https://creativecommons.org/publicdomain/mark/1.0/'), 'Public domain');
  assert.equal(rightsLabel('https://creativecommons.org/licenses/by-sa/4.0/'), 'CC BY-SA 4.0');
  assert.equal(rightsLabel('https://creativecommons.org/licenses/by/2.0/'), 'CC BY 2.0');
  assert.equal(rightsLabel(undefined), 'See partner page');
  assert.equal(rightsLabel('Some text'), 'See partner page');
});

test('dpla buildSearchUrl builds the documented request', () => {
  const url = new URL(buildSearchUrl('test-key', 'full moon', 2));
  assert.equal(url.origin + url.pathname, 'https://api.dp.la/v2/items');
  assert.equal(url.searchParams.get('q'), 'full moon');
  assert.equal(url.searchParams.get('api_key'), 'test-key');
  assert.equal(url.searchParams.get('sourceResource.type'), 'image');
  assert.equal(url.searchParams.get('page_size'), '24');
  assert.equal(url.searchParams.get('page'), '2');
});

test('dpla search without a key rejects and sends no request', async (t) => {
  t.after(restoreKey);
  delete process.env.DPLA_KEY;

  let called = false;
  const fake = async () => {
    called = true;
    return fixture.search;
  };

  await assert.rejects(search('moon', 1, { fetchJson: fake }), assertNeedsKey);
  assert.equal(called, false);
});

test('dpla resolveDownload without a key rejects and sends no request', async (t) => {
  t.after(restoreKey);
  delete process.env.DPLA_KEY;

  let called = false;
  const fake = async () => {
    called = true;
    return fixture.item;
  };

  await assert.rejects(resolveDownload('abc123', { fetchJson: fake }), assertNeedsKey);
  assert.equal(called, false);
});

test('dpla search sends the key in the request', async (t) => {
  t.after(restoreKey);
  process.env.DPLA_KEY = 'test-key';

  let requested = '';
  const fake = async (url) => {
    requested = url;
    return fixture.search;
  };

  const result = await search('moon', 2, { fetchJson: fake });
  assert.equal(result.items.length, 2);

  const url = new URL(requested);
  assert.equal(url.origin + url.pathname, 'https://api.dp.la/v2/items');
  assert.equal(url.searchParams.get('api_key'), 'test-key');
  assert.equal(url.searchParams.get('q'), 'moon');
  assert.equal(url.searchParams.get('page'), '2');
  assert.equal(url.searchParams.get('page_size'), '24');
  assert.equal(url.searchParams.get('sourceResource.type'), 'image');
});

test('dpla resolveDownload gets the detail record', async (t) => {
  t.after(restoreKey);
  process.env.DPLA_KEY = 'test-key';

  let requested = '';
  const fake = async (url) => {
    requested = url;
    return fixture.item;
  };

  const resolved = await resolveDownload('abc123', { fetchJson: fake });
  assert.equal(requested, 'https://api.dp.la/v2/items/abc123?api_key=test-key');
  assert.equal(resolved.url, fixture.item.docs[0].object);
  assert.equal(resolved.filename, fixture.item.docs[0].sourceResource.title[0]);
});

test('dpla resolveDownload rejects a bad id without a request', async () => {
  let called = false;
  const fake = async () => {
    called = true;
    return fixture.item;
  };

  await assert.rejects(resolveDownload('../x', { fetchJson: fake }), (err) => err.status === 400);
  assert.equal(called, false);
});

test('dpla resolveDownload rejects a record without an object URL', async (t) => {
  t.after(restoreKey);
  process.env.DPLA_KEY = 'test-key';

  const fake = async () => ({ docs: [{ id: 'abc123', sourceResource: {} }] });
  await assert.rejects(
    resolveDownload('abc123', { fetchJson: fake }),
    (err) => err.message === 'DPLA item has no image URL',
  );
});
