import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { HttpError } from '../lib/http.js';
import {
  licenseLabel,
  normalize,
  parseSearch,
  resolveDownload,
  search,
  trustResolvedUrl,
} from '../lib/sources/openverse.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, 'fixtures/openverse.json'), 'utf8'));

function rateError() {
  return new HttpError('api.openverse.org answered HTTP 429', {
    status: 429,
    host: 'api.openverse.org',
    code: 'HTTP',
  });
}

test('openverse trusts its resolved download URL', () => {
  assert.equal(trustResolvedUrl, true);
});

test('openverse parseSearch reads items, total and page count', () => {
  const result = parseSearch(fixture.search, 1);
  assert.equal(result.items.length, 2);
  assert.equal(result.total, fixture.search.result_count);
  assert.equal(result.hasMore, 1 < fixture.search.page_count);
});

test('openverse normalize makes an Item', () => {
  const raw = fixture.search.results[0];
  const item = normalize(raw);

  assert.equal(item.source, 'openverse');
  assert.equal(item.id, raw.id);
  assert.equal(item.title, raw.title);
  assert.equal(item.thumb, raw.thumbnail);
  assert.equal(item.preview, raw.url);
  assert.equal(item.full, raw.url);
  assert.equal(item.pageUrl, raw.foreign_landing_url);
  assert.equal(item.provider, raw.provider);
  assert.equal(item.license, licenseLabel(raw.license, raw.license_version));
  assert.equal(item.licenseUrl, raw.license_url);
  assert.equal(item.width, raw.width);
  assert.equal(item.height, raw.height);
  assert.equal(item.date, null);
  assert.equal(item.description, null);
});

test('openverse license labels', () => {
  assert.equal(licenseLabel('cc0', '1.0'), 'CC0');
  assert.equal(licenseLabel('pdm', '1.0'), 'Public domain');
  assert.equal(licenseLabel('by', '2.0'), 'CC BY 2.0');
  assert.equal(licenseLabel('by-sa', '4.0'), 'CC BY-SA 4.0');
  assert.equal(licenseLabel('by', ''), 'CC BY');
  assert.equal(licenseLabel(null), 'See item page');
});

test('openverse normalize returns null without url', () => {
  assert.equal(normalize({ id: 'x', title: 'T' }), null);
});

test('openverse search builds the search URL', async () => {
  let requested = '';
  const fake = async (url) => {
    requested = url;
    return fixture.search;
  };
  const result = await search('moon', 2, { fetchJson: fake });
  assert.equal(result.items.length, 2);
  assert.ok(requested.includes('page_size=20'));
  assert.ok(requested.includes('page=2'));
  assert.ok(requested.includes('license=cc0,pdm,by,by-sa'));
});

test('openverse search turns HTTP 429 into a rate limit error', async () => {
  const fake = async () => {
    throw rateError();
  };
  await assert.rejects(search('moon', 1, { fetchJson: fake }), (err) => {
    assert.equal(err.message, 'Openverse rate limit reached. Try again in a few minutes.');
    assert.equal(err.code, 'RATE_LIMIT');
    return true;
  });
});

test('openverse search rethrows other errors', async () => {
  const boom = new Error('network down');
  await assert.rejects(
    search('moon', 1, {
      fetchJson: async () => {
        throw boom;
      },
    }),
    (err) => err === boom,
  );
});

test('openverse resolveDownload gets the detail record', async () => {
  const id = fixture.detail.id;
  let requested = '';
  const fake = async (url) => {
    requested = url;
    return fixture.detail;
  };
  const resolved = await resolveDownload(id, { fetchJson: fake });
  assert.equal(resolved.url, fixture.detail.url);
  assert.equal(resolved.filename, fixture.detail.title);
  assert.equal(requested, `https://api.openverse.org/v1/images/${id}/`);
});

test('openverse resolveDownload rejects a bad id without a request', async () => {
  let called = false;
  const fake = async () => {
    called = true;
    return fixture.detail;
  };
  await assert.rejects(resolveDownload('../x', { fetchJson: fake }), (err) => err.status === 400);
  assert.equal(called, false);
});

test('openverse resolveDownload turns HTTP 429 into a rate limit error', async () => {
  const fake = async () => {
    throw rateError();
  };
  await assert.rejects(resolveDownload(fixture.detail.id, { fetchJson: fake }), (err) => {
    assert.equal(err.message, 'Openverse rate limit reached. Try again in a few minutes.');
    assert.equal(err.code, 'RATE_LIMIT');
    return true;
  });
});
