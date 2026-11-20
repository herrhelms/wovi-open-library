import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  LICENSE,
  NOTE,
  SEARCH_TIMEOUT_MS,
  buildSearchUrl,
  group,
  homepage,
  id,
  keyEnv,
  name,
  normalize,
  parseSearch,
  resolveDownload,
  search,
} from '../lib/sources/rumsey.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, 'fixtures/rumsey.json'), 'utf8'));

const FIRST_ID = 'RUMSEY~8~1~384464~90150261';
const IIIF = 'https://www.davidrumsey.com/luna/servlet/iiif';

test('rumsey constants', () => {
  assert.equal(id, 'rumsey');
  assert.equal(name, 'David Rumsey Map Collection');
  assert.equal(homepage, 'https://www.davidrumsey.com');
  assert.equal(group, 'libraries');
  assert.equal(keyEnv, null);
  assert.equal(LICENSE, 'CC BY-NC-SA 3.0 (non-commercial)');
  assert.ok(NOTE.includes('Non-commercial'));
});

test('rumsey parseSearch reads the fixture', () => {
  const result = parseSearch(fixture.search, 1);
  assert.equal(typeof result.total, 'number');
  assert.ok(result.total > 0);
  assert.equal(result.items.length, fixture.search.results.length);
  assert.equal(result.hasMore, fixture.search.results.length < result.total);
});

test('rumsey normalize makes an Item', () => {
  const raw = fixture.search.results[0];
  const item = normalize(raw);

  assert.equal(item.source, 'rumsey');
  assert.equal(item.id, raw.id);
  assert.equal(item.title, raw.displayName);
  assert.equal(item.creator, 'Neurath, Marie');
  assert.equal(item.date, '1953');
  assert.equal(item.thumb, raw.urlSize2);
  assert.equal(item.preview, `${IIIF}/${raw.id}/full/1600,/0/default.jpg`);
  assert.equal(item.full, null);
  assert.equal(item.width, null);
  assert.equal(item.height, null);
  assert.equal(item.license, LICENSE);
  assert.equal(item.licenseUrl, 'https://creativecommons.org/licenses/by-nc-sa/3.0/');
  assert.equal(item.note, NOTE);
  assert.equal(item.pageUrl, `https://www.davidrumsey.com/luna/servlet/detail/${raw.id}`);
  assert.equal(item.description, cleanFixtureDescription(raw));
  assert.ok(item.description.length <= 600);
});

function cleanFixtureDescription(raw) {
  const fullTitle = raw.fieldValues.find((entry) => entry['Full Title'])?.['Full Title']?.[0];
  const note = raw.fieldValues.find((entry) => entry.Note)?.Note?.[0];
  return fullTitle && fullTitle !== raw.displayName ? fullTitle : note;
}

test('rumsey normalize returns null without id or with another media type', () => {
  assert.equal(normalize({ displayName: 'No id' }), null);
  assert.equal(
    normalize({ id: FIRST_ID, mediaType: 'Document', urlSize2: 'https://x/y.jpg' }),
    null,
  );
  assert.equal(normalize(null), null);
});

test('rumsey normalize falls back for missing image fields', () => {
  const item = normalize({ id: FIRST_ID, fieldValues: [] });
  assert.equal(item.title, 'Untitled');
  assert.equal(item.creator, null);
  assert.equal(item.date, null);
  assert.equal(item.description, null);
  assert.equal(item.thumb, `${IIIF}/${FIRST_ID}/full/400,/0/default.jpg`);
});

test('rumsey search builds the search URL', async () => {
  let requested = '';
  const fake = async (url) => {
    requested = url;
    return fixture.search;
  };
  const result = await search('moon', 3, { fetchJson: fake });
  assert.ok(result.items.length > 0);

  const url = new URL(requested);
  assert.equal(url.origin + url.pathname, 'https://www.davidrumsey.com/luna/servlet/as/search');
  assert.equal(url.searchParams.get('q'), 'moon');
  assert.equal(url.searchParams.get('lc'), 'RUMSEY~8~1');
  assert.equal(url.searchParams.get('bs'), '24');
  assert.equal(url.searchParams.get('os'), '48');
  assert.ok(buildSearchUrl('moon', 1).includes('os=0'));
});

test('rumsey search passes the longer timeout', async () => {
  let opts;
  const fake = async (_url, requestOpts) => {
    opts = requestOpts;
    return fixture.search;
  };
  await search('moon', 1, { fetchJson: fake });
  assert.equal(SEARCH_TIMEOUT_MS, 40000);
  assert.equal(opts.timeoutMs, 40000);
});

test('rumsey resolveDownload uses the IIIF width', async () => {
  let requested = '';
  let opts;
  const fake = async (url, requestOpts) => {
    requested = url;
    opts = requestOpts;
    return fixture.info;
  };
  const resolved = await resolveDownload(FIRST_ID, { fetchJson: fake });
  assert.equal(requested, `${IIIF}/${FIRST_ID}/info.json`);
  assert.equal(opts.timeoutMs, 20000);
  assert.equal(resolved.url, `${IIIF}/${FIRST_ID}/full/8007,/0/default.jpg`);
  assert.equal(resolved.filename, FIRST_ID);
});

test('rumsey resolveDownload falls back without width', async () => {
  const fake = async () => ({ '@id': `${IIIF}/${FIRST_ID}` });
  const resolved = await resolveDownload(FIRST_ID, { fetchJson: fake });
  assert.equal(resolved.url, `${IIIF}/${FIRST_ID}/full/full/0/default.jpg`);
});

test('rumsey resolveDownload rejects a bad id without a request', async () => {
  let called = false;
  const fake = async () => {
    called = true;
    return fixture.info;
  };
  await assert.rejects(resolveDownload('x', { fetchJson: fake }), (err) => err.status === 400);
  await assert.rejects(
    resolveDownload('RUMSEY~8~1~1~../x', { fetchJson: fake }),
    (err) => err.status === 400,
  );
  assert.equal(called, false);
});
