import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  group,
  keyEnv,
  normalize,
  parseSearch,
  photoLicense,
  resolveDownload,
  search,
  thumbUrl,
  trustResolvedUrl,
} from '../lib/sources/gbif.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, 'fixtures/gbif.json'), 'utf8'));

test('gbif constants', () => {
  assert.equal(group, 'science');
  assert.equal(keyEnv, null);
  assert.equal(trustResolvedUrl, true);
});

test('gbif photoLicense reads open licenses', () => {
  assert.deepEqual(photoLicense('Frederic Heron (cc-by-sa)'), {
    label: 'CC BY-SA 4.0',
    url: 'https://creativecommons.org/licenses/by-sa/4.0/',
  });
  assert.deepEqual(photoLicense('http://creativecommons.org/licenses/by/4.0/'), {
    label: 'CC BY 4.0',
    url: 'https://creativecommons.org/licenses/by/4.0/',
  });
  assert.deepEqual(photoLicense('http://creativecommons.org/publicdomain/zero/1.0/'), {
    label: 'CC0',
    url: 'https://creativecommons.org/publicdomain/zero/1.0/',
  });
  assert.deepEqual(photoLicense('Public domain'), {
    label: 'Public domain',
    url: 'https://creativecommons.org/publicdomain/mark/1.0/',
  });
});

test('gbif photoLicense rejects closed and unknown licenses', () => {
  assert.equal(photoLicense('CC BY-NC 4.0'), null);
  assert.equal(photoLicense('http://creativecommons.org/licenses/by-nc-sa/4.0/'), null);
  assert.equal(photoLicense('http://creativecommons.org/licenses/by-nd/4.0/'), null);
  assert.equal(
    photoLicense(
      'Copyright by the creator. For license and creator details, see https://example.org/x',
    ),
    null,
  );
  assert.equal(photoLicense('All rights reserved'), null);
  assert.equal(photoLicense(undefined), null);
  assert.equal(photoLicense(''), null);
});

test('gbif thumbUrl uses the md5 of the identifier', () => {
  assert.equal(
    thumbUrl(
      5109511068,
      'https://bs.plantnet.org/image/o/e547663cfaa29ba78daf26e90f15e6cfce2e933d',
    ),
    'https://api.gbif.org/v1/image/cache/200x/occurrence/5109511068/media/289645a700038115559fa646d846fb3c',
  );
});

test('gbif parseSearch removes non-open records', () => {
  const result = parseSearch(fixture, 1);
  assert.equal(result.items.length, 2);
  assert.equal(result.total, fixture.count);
  assert.equal(result.hasMore, true);

  const closed = fixture.results.find((entry) => entry.key === 9999999999);
  assert.ok(closed);
  assert.equal(normalize(closed), null);
  assert.equal(normalize(fixture.results[2]), null);

  for (const item of result.items) {
    const raw = fixture.results.find((entry) => String(entry.key) === item.id);
    assert.ok(raw);
    assert.equal(item.pageUrl, `https://www.gbif.org/occurrence/${raw.key}`);
    assert.equal(item.full, raw.media[0].identifier);
    assert.equal(item.preview, raw.media[0].identifier);
    assert.ok(
      item.thumb.startsWith('https://api.gbif.org/v1/image/cache/200x/occurrence/'),
    );
    assert.equal(item.source, 'gbif');
    assert.equal(item.width, null);
    assert.equal(item.height, null);
  }
});

test('gbif normalize makes an Item', () => {
  const raw = fixture.results[0];
  const item = normalize(raw);

  assert.equal(item.id, '5109511068');
  assert.equal(item.title, 'Aphyllanthes monspeliensis L.');
  assert.equal(item.creator, 'Frederic Heron');
  assert.equal(item.date, '2023-05-14');
  assert.equal(item.description, 'France');
  assert.equal(item.license, 'CC BY-SA 4.0');
  assert.equal(item.licenseUrl, 'https://creativecommons.org/licenses/by-sa/4.0/');
});

test('gbif normalize puts the scientific name in brackets', () => {
  const raw = {
    key: 42,
    scientificName: 'Ardea cinerea Linnaeus, 1758',
    vernacularName: 'Grey Heron',
    media: [
      {
        type: 'StillImage',
        identifier: 'https://example.org/heron.jpg',
        license: 'http://creativecommons.org/publicdomain/zero/1.0/',
      },
    ],
  };
  assert.equal(normalize(raw).title, 'Grey Heron (Ardea cinerea Linnaeus, 1758)');
});

test('gbif normalize uses the first open media entry', () => {
  const raw = {
    key: 7,
    scientificName: 'Ardea cinerea',
    media: [
      { type: 'StillImage', identifier: 'https://example.org/closed.jpg', license: 'CC BY-NC 4.0' },
      {
        type: 'StillImage',
        identifier: 'https://example.org/open.jpg',
        license: 'http://creativecommons.org/publicdomain/zero/1.0/',
      },
    ],
  };
  const item = normalize(raw);
  assert.equal(item.full, 'https://example.org/open.jpg');
  assert.equal(item.license, 'CC0');
});

test('gbif normalize returns null without an open image', () => {
  assert.equal(normalize({ key: 1, scientificName: 'X' }), null);
  assert.equal(normalize({ key: 1, media: [] }), null);
});

test('gbif search builds the search URL', async () => {
  let requested = '';
  const fake = async (url) => {
    requested = url;
    return fixture;
  };
  const result = await search('heron', 3, { fetchJson: fake });

  const url = new URL(requested);
  assert.equal(url.origin + url.pathname, 'https://api.gbif.org/v1/occurrence/search');
  assert.equal(url.searchParams.get('q'), 'heron');
  assert.equal(url.searchParams.get('offset'), '48');
  assert.equal(url.searchParams.get('limit'), '24');
  assert.equal(url.searchParams.get('mediaType'), 'StillImage');
  assert.deepEqual(url.searchParams.getAll('license'), ['CC0_1_0', 'CC_BY_4_0']);
  assert.equal(result.items.length, 2);
});

test('gbif resolveDownload gets the occurrence record', async () => {
  const raw = fixture.results[0];
  let requested = '';
  const fake = async (url) => {
    requested = url;
    return raw;
  };
  const resolved = await resolveDownload(String(raw.key), { fetchJson: fake });

  assert.equal(requested, 'https://api.gbif.org/v1/occurrence/5109511068');
  assert.equal(resolved.url, raw.media[0].identifier);
  assert.equal(resolved.filename, 'Aphyllanthes monspeliensis L.');
});

test('gbif resolveDownload rejects a bad id without a request', async () => {
  let called = false;
  const fake = async () => {
    called = true;
    return fixture.results[0];
  };
  await assert.rejects(resolveDownload('x/../1', { fetchJson: fake }), (err) => err.status === 400);
  assert.equal(called, false);
});

test('gbif resolveDownload errors when the record has no open image', async () => {
  const fake = async () => ({
    key: 5,
    scientificName: 'X',
    media: [{ type: 'StillImage', identifier: 'https://example.org/a.jpg', license: 'CC BY-NC 4.0' }],
  });
  await assert.rejects(
    resolveDownload('5', { fetchJson: fake }),
    (err) => err.message === 'GBIF record has no open image',
  );
});
