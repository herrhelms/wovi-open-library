import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import * as aic from './index.js';
import {
  AIC_USER_AGENT,
  id,
  normalize,
  parseSearch,
  search,
} from './index.js';

import { getSource } from '../../lib/sources/index.js';
import { USER_AGENT } from '../../lib/http.js';

const {
  group,
  keyEnv,
  name,
} = getSource('aic');

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, '../../test/fixtures/aic.json'), 'utf8'));

const IIIF = 'https://www.artic.edu/iiif/2';

test('aic constants', () => {
  assert.equal(id, 'aic');
  assert.equal(name, 'Art Institute of Chicago');
  assert.equal(group, 'museums');
  assert.equal(keyEnv, null);
  assert.equal(
    AIC_USER_AGENT,
    'OpenLibraryFetch/0.1 (local research tool)',
  );
  assert.equal(AIC_USER_AGENT, USER_AGENT);
  assert.equal(typeof aic.resolveDownload, 'undefined');
  assert.equal(typeof aic.trustResolvedUrl, 'undefined');
});

test('aic parseSearch reads the live records and removes records without image_id', () => {
  const result = parseSearch(fixture, 1);
  assert.equal(result.items.length, 3);
  assert.equal(result.total, fixture.pagination.total);
  assert.equal(result.hasMore, true);
  assert.ok(result.items.every((item) => item.id !== '999999'));
});

test('aic normalize makes an Item with direct download', () => {
  const raw = fixture.data[0];
  const item = normalize(raw);

  assert.equal(item.source, 'aic');
  assert.equal(item.id, String(raw.id));
  assert.equal(item.title, raw.title);
  assert.equal(item.thumb, `${IIIF}/${raw.image_id}/full/400,/0/default.jpg`);
  assert.ok(item.preview.endsWith('/full/843,/0/default.jpg'));
  assert.ok(item.full.endsWith('/full/1877,/0/default.jpg'));
  assert.equal(item.directDownload, true);
  assert.equal(item.note, 'Opens the image from artic.edu; save it from there.');
  assert.equal(item.pageUrl, `https://www.artic.edu/artworks/${raw.id}`);
  assert.equal(item.license, 'CC0');
  assert.equal(item.licenseUrl, 'https://creativecommons.org/publicdomain/zero/1.0/');
  assert.equal(item.creator, 'George Inness (American, 1825–1894)');
  assert.equal(item.date, '1891');
  assert.equal(item.description, 'A work made of oil on canvas.');
  assert.equal(item.width, 1877);
  assert.equal(item.height, 2250);
});

test('aic normalize caps the full width at 3000', () => {
  const item = normalize({
    id: 1,
    title: 'Big',
    image_id: 'abc',
    is_public_domain: true,
    thumbnail: { width: 5000, height: 4000 },
  });
  assert.ok(item.full.endsWith('/full/3000,/0/default.jpg'));
  assert.equal(item.width, 3000);
  assert.equal(item.height, 2400);
});

test('aic normalize without thumbnail uses 3000 and no size', () => {
  const item = normalize({ id: 2, title: 'No thumb', image_id: 'def', is_public_domain: true });
  assert.ok(item.full.endsWith('/full/3000,/0/default.jpg'));
  assert.equal(item.width, null);
  assert.equal(item.height, null);
  assert.equal(item.description, null);
});

test('aic normalize uses the first line of artist_display', () => {
  const item = normalize({
    id: 3,
    title: 'T',
    image_id: 'ghi',
    is_public_domain: true,
    artist_display: 'A\nB',
  });
  assert.equal(item.creator, 'A');
});

test('aic normalize rejects non public domain records and records without image_id', () => {
  assert.equal(
    normalize({ id: 4, title: 'T', image_id: 'x', is_public_domain: false }),
    null,
  );
  assert.equal(normalize({ id: 5, title: 'T', image_id: null, is_public_domain: true }), null);
  assert.equal(normalize(null), null);
});

test('aic search builds the search URL and sends the AIC-User-Agent header', async () => {
  let requested = '';
  let headers = null;
  const fake = async (url, opts) => {
    requested = url;
    headers = opts?.headers ?? null;
    return fixture;
  };

  const result = await search('moon', 2, { fetchJson: fake });
  assert.equal(result.items.length, 3);
  assert.ok(requested.startsWith('https://api.artic.edu/api/v1/artworks/search?q=moon'));
  assert.ok(requested.includes('query%5Bterm%5D%5Bis_public_domain%5D=true'));
  assert.ok(requested.includes('limit=24'));
  assert.ok(requested.includes('page=2'));
  assert.equal(headers?.['AIC-User-Agent'], AIC_USER_AGENT);
});
