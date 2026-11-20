import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { HttpError } from '../lib/http.js';
import {
  group,
  id,
  keyEnv,
  normalize,
  parseSearch,
  search,
} from '../lib/sources/inaturalist.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, 'fixtures/inaturalist.json'), 'utf8'));

function rateError() {
  return new HttpError('api.inaturalist.org answered HTTP 429', {
    status: 429,
    host: 'api.inaturalist.org',
    code: 'HTTP',
  });
}

test('inaturalist constants', () => {
  assert.equal(id, 'inaturalist');
  assert.equal(group, 'science');
  assert.equal(keyEnv, null);
});

test('inaturalist parseSearch reads items and total', () => {
  const result = parseSearch(fixture, 1);
  assert.equal(result.items.length, 2);
  assert.equal(result.total, fixture.total_results);
  assert.equal(result.hasMore, true);
});

test('inaturalist parseSearch makes no more pages on the last page', () => {
  const result = parseSearch({ ...fixture, total_results: 48 }, 2);
  assert.equal(result.hasMore, false);
});

test('inaturalist normalize makes an Item', () => {
  const raw = fixture.results[0];
  const photo = raw.photos[0];
  const item = normalize(raw);

  assert.equal(item.source, 'inaturalist');
  assert.equal(item.id, String(raw.id));
  assert.equal(item.title, 'Great Blue Heron (Ardea herodias)');
  assert.equal(item.creator, raw.user.login);
  assert.equal(item.date, raw.observed_on);
  assert.equal(item.description, photo.attribution);
  assert.ok(item.thumb.endsWith('/medium.jpg'));
  assert.ok(item.preview.endsWith('/large.jpg'));
  assert.ok(item.full.endsWith('/original.jpg'));
  assert.equal(new URL(item.thumb).host, 'inaturalist-open-data.s3.amazonaws.com');
  assert.ok(item.pageUrl.startsWith('https://www.inaturalist.org/observations/'));
  assert.equal(item.license, 'CC BY 4.0');
  assert.equal(item.licenseUrl, 'https://creativecommons.org/licenses/by/4.0/');
  assert.equal(item.width, photo.original_dimensions.width);
  assert.equal(item.height, photo.original_dimensions.height);
  assert.equal(typeof item.width, 'number');
  assert.equal(typeof item.height, 'number');
});

test('inaturalist normalize skips photos without an open license', () => {
  const raw = fixture.results[2];
  assert.equal(normalize(raw), null);
});

test('inaturalist normalize uses the first open photo', () => {
  const record = {
    id: 1,
    photos: [
      {
        license_code: 'cc-by-nc',
        url: 'https://inaturalist-open-data.s3.amazonaws.com/photos/1/square.jpg',
      },
      {
        license_code: 'cc0',
        url: 'https://inaturalist-open-data.s3.amazonaws.com/photos/2/square.jpeg',
      },
    ],
  };
  const item = normalize(record);
  assert.equal(item.license, 'CC0');
  assert.equal(item.licenseUrl, 'https://creativecommons.org/publicdomain/zero/1.0/');
  assert.ok(item.thumb.endsWith('/medium.jpeg'));
  assert.ok(item.preview.endsWith('/large.jpeg'));
  assert.ok(item.full.endsWith('/original.jpeg'));
  assert.equal(item.title, 'Untitled');
  assert.equal(item.creator, null);
  assert.equal(item.date, null);
  assert.equal(item.description, null);
  assert.equal(item.pageUrl, 'https://www.inaturalist.org/observations/1');
});

test('inaturalist normalize accepts cc-by-sa', () => {
  const item = normalize({
    id: 2,
    photos: [
      {
        license_code: 'cc-by-sa',
        url: 'https://inaturalist-open-data.s3.amazonaws.com/photos/3/square.jpg',
      },
    ],
  });
  assert.equal(item.license, 'CC BY-SA 4.0');
  assert.equal(item.licenseUrl, 'https://creativecommons.org/licenses/by-sa/4.0/');
});

test('inaturalist normalize keeps the URL when there is no square segment', () => {
  const url = 'https://static.inaturalist.org/photos/4/original.jpg';
  const item = normalize({ id: 3, photos: [{ license_code: 'cc-by', url }] });
  assert.equal(item.thumb, url);
  assert.equal(item.preview, url);
  assert.equal(item.full, url);
});

test('inaturalist title falls back to the scientific name', () => {
  const item = normalize({
    id: 4,
    taxon: { name: 'Ardea herodias' },
    photos: [
      {
        license_code: 'cc-by',
        url: 'https://inaturalist-open-data.s3.amazonaws.com/photos/5/square.jpg',
      },
    ],
  });
  assert.equal(item.title, 'Ardea herodias');
});

test('inaturalist title falls back to species_guess', () => {
  const item = normalize({
    id: 5,
    species_guess: 'Heron',
    photos: [
      {
        license_code: 'cc-by',
        url: 'https://inaturalist-open-data.s3.amazonaws.com/photos/6/square.jpg',
      },
    ],
  });
  assert.equal(item.title, 'Heron');
});

test('inaturalist search builds the search URL', async () => {
  let requested = '';
  const fake = async (url) => {
    requested = url;
    return fixture;
  };
  const result = await search('heron', 2, { fetchJson: fake });
  assert.equal(result.items.length, 2);
  assert.ok(requested.includes('q=heron'));
  assert.ok(requested.includes('page=2'));
  assert.ok(requested.includes('per_page=24'));
  assert.ok(requested.includes('quality_grade=research'));
  const decoded = decodeURIComponent(requested);
  assert.ok(decoded.includes('photo_license=cc0,cc-by,cc-by-sa'));
});

test('inaturalist search turns HTTP 429 into a rate limit error', async () => {
  const fake = async () => {
    throw rateError();
  };
  await assert.rejects(search('heron', 1, { fetchJson: fake }), (err) => {
    assert.equal(err.message, 'iNaturalist rate limit reached. Try again in a minute.');
    assert.equal(err.code, 'RATE_LIMIT');
    return true;
  });
});

test('inaturalist search rethrows other errors', async () => {
  const boom = new Error('network down');
  await assert.rejects(
    search('heron', 1, {
      fetchJson: async () => {
        throw boom;
      },
    }),
    (err) => err === boom,
  );
});
