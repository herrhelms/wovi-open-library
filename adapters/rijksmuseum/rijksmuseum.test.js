import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { normalize, search } from './index.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, '../../test/fixtures/rijksmuseum.json'), 'utf8'));

const SEARCH = 'https://data.rijksmuseum.nl/search/collection';

function ids(slug, start, count) {
  return Array.from(
    { length: count },
    (_, i) => `https://id.rijksmuseum.nl/${slug}-${start + i}`,
  );
}

function searchPage(items, nextUrl) {
  return {
    orderedItems: items.map((id) => ({ id, type: 'HumanMadeObject' })),
    partOf: { totalItems: 100 },
    ...(nextUrl ? { next: { id: nextUrl } } : {}),
  };
}

function makeFake({ slug, firstCount = 24, secondCount = 6, throwIndexes = [], fallback = false }) {
  const calls = [];
  const objectHeaders = [];

  async function fetchJson(url, opts = {}) {
    calls.push(url);

    if (url.startsWith(SEARCH)) {
      if (url.includes('description=')) {
        if (fallback) return {};
        if (url.includes('page=2')) {
          return searchPage(ids(slug, firstCount + 1, secondCount), null);
        }
        const next = `${SEARCH}?description=x&imageAvailable=true&page=2`;
        return searchPage(ids(slug, 1, firstCount), next);
      }
      if (url.includes('title=')) {
        return searchPage(ids(slug, 1, 2), null);
      }
      return {};
    }

    if (url.endsWith('/digital')) {
      const token = url.slice(url.lastIndexOf('/') + 1).replace('digital', 'iiif');
      return {
        ...fixture.digitalObject,
        id: url,
        access_point: [{ id: `https://iiif.micr.io/${token}/full/max/0/default.jpg` }],
      };
    }

    if (url.endsWith('/visual')) {
      return {
        ...fixture.visualItem,
        id: url,
        digitally_shown_by: [{ id: url.replace(/\/visual$/, '/digital') }],
      };
    }

    objectHeaders.push(opts.headers);
    const n = Number(url.slice(url.lastIndexOf('-') + 1));
    if (throwIndexes.includes(n)) throw new Error('boom');

    return {
      ...fixture.object,
      id: url,
      shows: [{ id: `${url}/visual` }],
    };
  }

  return { fetchJson, calls, objectHeaders };
}

test('rijksmuseum normalize makes an Item', () => {
  const item = normalize({
    object: fixture.object,
    visualItem: fixture.visualItem,
    digitalObject: fixture.digitalObject,
  });

  assert.equal(item.source, 'rijksmuseum');
  assert.equal(item.id, '200106518');
  assert.equal(item.title, 'Guanyin');
  assert.equal(item.creator, 'anonymous');
  assert.equal(item.date, 'c. 1100 - c. 1200');
  assert.ok(item.description.startsWith('Houten Guanyin'));
  assert.equal(item.full, 'https://iiif.micr.io/blmqI/full/max/0/default.jpg');
  assert.equal(item.thumb, 'https://iiif.micr.io/blmqI/full/400,/0/default.jpg');
  assert.equal(item.preview, 'https://iiif.micr.io/blmqI/full/1600,/0/default.jpg');
  assert.equal(item.width, null);
  assert.equal(item.height, null);
  assert.equal(item.pageUrl, 'https://www.rijksmuseum.nl/en/collection/AK-MAK-84');
  assert.equal(item.license, 'Public domain');
  assert.equal(item.licenseUrl, 'https://creativecommons.org/publicdomain/mark/1.0/');
});

test('rijksmuseum normalize marks "niet downloadbaar" as In copyright (hand-made from a live record)', () => {
  const { object, visualItem, digitalObject } = fixture.appel;
  const item = normalize({ object, visualItem, digitalObject });

  assert.deepEqual(
    digitalObject.referred_to_by.map((entry) => entry.content),
    ['niet downloadbaar', 'zichtbaar'],
  );
  assert.equal(item.license, 'In copyright');
  assert.equal(item.licenseUrl, 'https://rightsstatements.org/vocab/InC/1.0/');
});

test('rijksmuseum normalize marks "downloadbaar" as Public domain', () => {
  const item = normalize({
    object: fixture.object,
    visualItem: fixture.visualItem,
    digitalObject: {
      ...fixture.digitalObject,
      referred_to_by: [
        { type: 'LinguisticObject', content: 'downloadbaar' },
        { type: 'LinguisticObject', content: 'zichtbaar' },
      ],
    },
  });
  assert.equal(item.license, 'Public domain');
  assert.equal(item.licenseUrl, 'https://creativecommons.org/publicdomain/mark/1.0/');
});

test('rijksmuseum normalize marks a missing referred_to_by as Public domain', () => {
  const digitalObject = { ...fixture.digitalObject };
  delete digitalObject.referred_to_by;
  const item = normalize({
    object: fixture.object,
    visualItem: fixture.visualItem,
    digitalObject,
  });
  assert.equal(item.license, 'Public domain');
  assert.equal(item.licenseUrl, 'https://creativecommons.org/publicdomain/mark/1.0/');
});

test('rijksmuseum normalize reads an InC rights statement', () => {
  const item = normalize({
    object: fixture.object,
    visualItem: fixture.visualItem,
    digitalObject: {
      ...fixture.digitalObject,
      referred_to_by: [
        {
          type: 'LinguisticObject',
          content: 'https://rightsstatements.org/vocab/InC/1.0/',
        },
      ],
    },
  });
  assert.equal(item.license, 'In copyright');
  assert.equal(item.licenseUrl, 'https://rightsstatements.org/vocab/InC/1.0/');
});

test('rijksmuseum normalize returns null without an access point', () => {
  assert.equal(
    normalize({
      object: fixture.object,
      visualItem: fixture.visualItem,
      digitalObject: { ...fixture.digitalObject, access_point: [] },
    }),
    null,
  );
});

test('rijksmuseum search collects ids across API pages', async () => {
  const fake = makeFake({ slug: 'pages', firstCount: 24, secondCount: 6 });

  const first = await search('pages', 1, { fetchJson: fake.fetchJson });
  assert.equal(first.items.length, 12);
  assert.equal(first.hasMore, true);
  assert.equal(first.total, 100);

  const third = await search('pages', 3, { fetchJson: fake.fetchJson });
  assert.equal(third.items.length, 6);
  assert.equal(third.hasMore, false);

  assert.ok(fake.objectHeaders.length > 0);
  assert.equal(fake.objectHeaders[0].Accept, 'application/ld+json');
});

test('rijksmuseum search removes items that fail', async () => {
  const fake = makeFake({ slug: 'fail', firstCount: 24, secondCount: 6, throwIndexes: [13] });
  const result = await search('fail', 2, { fetchJson: fake.fetchJson });
  assert.equal(result.items.length, 11);
});

test('rijksmuseum search falls back to the title field', async () => {
  const fake = makeFake({ slug: 'fallback', fallback: true });
  const result = await search('fallback', 1, { fetchJson: fake.fetchJson });

  assert.equal(result.items.length, 2);
  assert.ok(fake.calls[0].includes('description='));
  assert.ok(fake.calls[1].includes('title='));
});
