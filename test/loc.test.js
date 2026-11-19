import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { normalize, parseSearch, buildSearchUrl, toBlockedError } from '../lib/sources/loc.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, 'fixtures/loc.json'), 'utf8'));

test('loc parseSearch reads results and pagination', () => {
  const result = parseSearch(fixture, 1);
  assert.equal(result.items.length, 1);
  assert.equal(result.hasMore, true);
  assert.equal(result.total, 1500);
});

test('loc normalize makes an Item', () => {
  const item = normalize(fixture.results[0]);
  assert.equal(item.source, 'loc');
  assert.equal(item.id, '2002695295');
  assert.ok(item.thumb.endsWith('3b48001r.jpg'));
  assert.ok(item.full.endsWith('3b48001v.jpg'));
  assert.equal(item.preview, item.full);
  assert.ok(!item.thumb.includes('#'));
  assert.ok(!item.full.includes('#'));
  assert.equal(item.width, 808);
  assert.equal(item.height, 1024);
  assert.equal(item.creator, 'lick observatory');
  assert.equal(item.date, '1890');
  assert.equal(item.description, 'Photograph of the moon at first quarter.');
  assert.ok(item.pageUrl.startsWith('https://'));
  assert.equal(item.license, 'No known restrictions (see item)');
  assert.equal(item.licenseUrl, null);
});

test('loc normalize returns null without images', () => {
  assert.equal(normalize(fixture.results[1]), null);
  assert.equal(normalize({ title: 'x' }), null);
});

test('loc buildSearchUrl has the loc parameters', () => {
  const url = buildSearchUrl('moon', 2);
  assert.ok(url.startsWith('https://www.loc.gov/photos/?'));
  assert.ok(url.includes('q=moon'));
  assert.ok(url.includes('fo=json'));
  assert.ok(url.includes('c=24'));
  assert.ok(url.includes('sp=2'));
  assert.ok(url.includes('at=results%2Cpagination'));
});

test('loc toBlockedError detects a Cloudflare challenge', () => {
  const error = toBlockedError({
    code: 'HTTP',
    status: 403,
    bodySnippet: '<html>Just a moment...</html>',
  });
  assert.equal(
    error.message,
    'Library of Congress blocked the request (Cloudflare challenge). Try again later or from another network.',
  );
  assert.equal(error.code, 'BLOCKED');
});

test('loc toBlockedError returns null for other errors', () => {
  assert.equal(toBlockedError({ code: 'HTTP', status: 500, bodySnippet: 'oops' }), null);
  assert.equal(toBlockedError({ code: 'NETWORK', status: null }), null);
});
