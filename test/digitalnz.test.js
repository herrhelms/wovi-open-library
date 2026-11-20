import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { HttpError } from '../lib/http.js';
import {
  NOTE_THUMB,
  group,
  homepage,
  id,
  keyEnv,
  keyOptional,
  normalize,
  parseSearch,
  resolveDownload,
  search,
  trustResolvedUrl,
} from '../lib/sources/digitalnz.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, 'fixtures/digitalnz.json'), 'utf8'));

const resultById = (recordId) => fixture.search.results.find((entry) => entry.id === recordId);

function withKey(value, fn) {
  const before = process.env[keyEnv];
  if (value === null) delete process.env[keyEnv];
  else process.env[keyEnv] = value;
  try {
    return fn();
  } finally {
    if (before === undefined) delete process.env[keyEnv];
    else process.env[keyEnv] = before;
  }
}

test('digitalnz constants', () => {
  assert.equal(id, 'digitalnz');
  assert.equal(group, 'aggregators');
  assert.equal(homepage, 'https://digitalnz.org');
  assert.equal(keyEnv, 'DIGITALNZ_KEY');
  assert.equal(keyOptional, true);
  assert.equal(trustResolvedUrl, true);
  assert.equal(
    NOTE_THUMB,
    'DigitalNZ gives a thumbnail only for this item. Open the partner page for the full image.',
  );
});

test('digitalnz parseSearch removes records without an image', () => {
  const result = parseSearch(fixture, 1);
  assert.equal(result.total, fixture.search.result_count);
  assert.equal(result.hasMore, 24 < fixture.search.result_count);
  assert.equal(result.items.length, fixture.search.results.length - 1);
  assert.equal(
    result.items.some((item) => item.id === '90000002'),
    false,
  );
});

test('digitalnz normalize uses the large thumbnail when object_url is missing', () => {
  const raw = resultById(33835304);
  const item = normalize(raw);

  assert.equal(item.source, 'digitalnz');
  assert.equal(item.id, String(raw.id));
  assert.equal(item.title, raw.title);
  assert.equal(item.thumb, raw.thumbnail_url);
  assert.equal(item.preview, raw.large_thumbnail_url);
  assert.equal(item.full, raw.large_thumbnail_url);
  assert.equal(item.note, NOTE_THUMB);
  assert.equal(item.pageUrl, raw.landing_url);
  assert.equal(item.provider, raw.content_partner[0]);
  assert.equal(item.creator, null);
  assert.equal(item.description, null);
  assert.equal(item.license, 'Free to reuse (commercial use OK)');
  assert.equal(item.licenseUrl, raw.rights_url[0]);
});

test('digitalnz normalize uses object_url as the full image', () => {
  const raw = resultById(90000001);
  const item = normalize(raw);

  assert.equal(item.full, raw.object_url);
  assert.equal(item.preview, raw.object_url);
  assert.equal(item.thumb, raw.thumbnail_url);
  assert.equal(item.note, null);
  assert.equal(item.creator, 'Example Maker');
  assert.equal(item.date, '1909-07-28');
});

test('digitalnz normalize reads creator, date and provider', () => {
  const raw = resultById(43346385);
  const item = normalize(raw);

  assert.equal(item.creator, 'New Zealand Graphic');
  assert.equal(item.date, '1909-07-28');
  assert.equal(item.provider, 'Auckland Libraries');
});

test('digitalnz normalize returns null without any image URL', () => {
  assert.equal(normalize(resultById(90000002)), null);
});

test('digitalnz search builds the search URL and sends no key header', async () => {
  let requested = '';
  let receivedHeaders = null;
  const fake = async (url, opts = {}) => {
    requested = url;
    receivedHeaders = opts.headers ?? {};
    return fixture;
  };

  const result = await withKey(null, () => search('moon', 2, { fetchJson: fake }));
  const parsed = new URL(requested);

  assert.equal(result.items.length, fixture.search.results.length - 1);
  assert.equal(parsed.origin + parsed.pathname, 'https://api.digitalnz.org/v3/records.json');
  assert.equal(parsed.searchParams.get('text'), 'moon');
  assert.equal(parsed.searchParams.get('and[category][]'), 'Images');
  assert.equal(parsed.searchParams.get('and[usage][]'), 'Use commercially');
  assert.equal(parsed.searchParams.get('page'), '2');
  assert.equal(parsed.searchParams.get('per_page'), '24');
  assert.ok(parsed.searchParams.get('fields').includes('large_thumbnail_url'));
  assert.equal(receivedHeaders['Authentication-Token'], undefined);
});

test('digitalnz search sends the key as a header only', async () => {
  let requested = '';
  let receivedHeaders = null;
  const fake = async (url, opts = {}) => {
    requested = url;
    receivedHeaders = opts.headers ?? {};
    return fixture;
  };

  await withKey('k', () => search('moon', 1, { fetchJson: fake }));

  assert.equal(receivedHeaders['Authentication-Token'], 'k');
  assert.equal(requested.includes('k'), false);
  assert.equal(requested.includes('DIGITALNZ_KEY'), false);
});

test('digitalnz search turns HTTP 403 into a needs key error', async () => {
  const fake = async () => {
    throw new HttpError('api.digitalnz.org answered HTTP 403', {
      status: 403,
      host: 'api.digitalnz.org',
      code: 'HTTP',
    });
  };

  await assert.rejects(withKey(null, () => search('moon', 1, { fetchJson: fake })), (err) => {
    assert.equal(err.message, 'DigitalNZ needs DIGITALNZ_KEY in .env');
    assert.equal(err.code, 'NEEDS_KEY');
    return true;
  });
});

test('digitalnz resolveDownload gets the record', async () => {
  let requested = '';
  let receivedHeaders = null;
  const fake = async (url, opts = {}) => {
    requested = url;
    receivedHeaders = opts.headers ?? {};
    return {
      record: {
        id: 59149453,
        title: 'The moon when nine days thirteen hours old',
        object_url: null,
        large_thumbnail_url:
          'https://kura.aucklandlibraries.govt.nz/digital/api/singleitem/image/photos/153879/default.jpg',
        thumbnail_url:
          'https://kura.aucklandlibraries.govt.nz/digital/api/singleitem/image/photos/153879/default.jpg',
      },
    };
  };

  const resolved = await withKey(null, () => resolveDownload('59149453', { fetchJson: fake }));

  assert.ok(requested.startsWith('https://api.digitalnz.org/v3/records/59149453.json'));
  assert.ok(requested.includes('fields='));
  assert.equal(receivedHeaders['Authentication-Token'], undefined);
  assert.equal(
    resolved.url,
    'https://kura.aucklandlibraries.govt.nz/digital/api/singleitem/image/photos/153879/default.jpg',
  );
  assert.equal(resolved.filename, 'The moon when nine days thirteen hours old');
});

test('digitalnz resolveDownload rejects a bad id without a request', async () => {
  let called = false;
  const fake = async () => {
    called = true;
    return {};
  };

  await assert.rejects(
    withKey(null, () => resolveDownload('1/2', { fetchJson: fake })),
    (err) => err.status === 400,
  );
  assert.equal(called, false);
});
