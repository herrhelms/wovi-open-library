import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  buildQuery,
  buildSearchUrl,
  clearCache,
  normalize,
  parseBindings,
  search,
  sparqlString,
} from '../lib/sources/getty.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, 'fixtures/getty.json'), 'utf8'));

const SPARQL_URL = 'https://data.getty.edu/museum/collection/sparql';
const SPARQL_ACCEPT = 'application/sparql-results+json';
const OBJECT_ACCEPT = 'application/ld+json';

const UUIDS = Object.keys(fixture.objects);
const OBJECT_URLS = UUIDS.map(
  (uuid) => `https://data.getty.edu/museum/collection/object/${uuid}`,
);

function sparqlAnswer(bindings) {
  return {
    head: { vars: ['o', 'title'] },
    results: {
      bindings: bindings.map(({ uuid, title }) => ({
        o: {
          type: 'uri',
          value: `https://data.getty.edu/museum/collection/object/${uuid}`,
        },
        title: { type: 'literal', value: title },
      })),
    },
  };
}

function makeFake({ throwUrls = [], bindings } = {}) {
  const calls = [];
  const sparqlHeaders = [];
  const objectHeaders = [];
  const answer = bindings ?? fixture.sparql;

  async function fetchJson(url, opts = {}) {
    calls.push(url);

    if (url.startsWith(SPARQL_URL)) {
      sparqlHeaders.push(opts.headers);
      return answer;
    }

    objectHeaders.push(opts.headers);
    if (throwUrls.includes(url)) throw new Error('boom');
    const uuid = url.slice(url.lastIndexOf('/') + 1);
    const object = fixture.objects[uuid];
    if (!object) throw new Error('no fixture object');
    return object;
  }

  return { fetchJson, calls, sparqlHeaders, objectHeaders };
}

test('getty sparqlString escapes special characters', () => {
  assert.equal(sparqlString('a"b\\c'), 'a\\"b\\\\c');
  assert.equal(sparqlString('a"b\\c').length, 7);
  assert.equal(sparqlString('a\nb'), 'a\\nb');
});

test('getty buildQuery uses one FILTER term for each word', () => {
  const query = buildQuery('Swan  MOON', 1);
  assert.ok(query.includes('CONTAINS(LCASE(?t), "swan")'));
  assert.ok(query.includes('CONTAINS(LCASE(?t), "moon")'));
  assert.ok(query.includes('CONTAINS(LCASE(?t), "swan") && CONTAINS(LCASE(?t), "moon")'));
  assert.ok(query.includes('LIMIT 25 OFFSET 0'));
  assert.ok(query.includes('crm:P138i_has_representation'));
});

test('getty buildQuery pages with a 24 item offset', () => {
  assert.ok(buildQuery('x', 3).includes('OFFSET 48'));
});

test('getty buildQuery escapes quotes in words', () => {
  const query = buildQuery('say "hi"', 1);
  assert.ok(
    query.includes(
      'CONTAINS(LCASE(?t), "say") && CONTAINS(LCASE(?t), "\\"hi\\"")',
    ),
  );
  // the quotes around each literal stay unescaped; the quotes inside do not
  assert.ok(!query.includes('"hi"'));
});

test('getty buildSearchUrl encodes the query', () => {
  const url = buildSearchUrl('swan moon', 1);
  assert.ok(url.startsWith('https://data.getty.edu/museum/collection/sparql?query='));
  assert.ok(url.includes(encodeURIComponent('PREFIX crm:')));
});

test('getty parseBindings reads object URLs and titles', () => {
  const bindings = parseBindings(fixture.sparql);
  assert.equal(bindings.length, UUIDS.length);
  assert.equal(bindings[0].uuid, UUIDS[0]);
  assert.equal(
    bindings[0].objectUrl,
    `https://data.getty.edu/museum/collection/object/${UUIDS[0]}`,
  );
  assert.equal(bindings[0].title, 'A Swan Among the Reeds, by Moonlight');
  assert.deepEqual(parseBindings({ results: { bindings: [{ title: { value: 'x' } }] } }), []);
});

test('getty normalize makes an Item', () => {
  const raw = fixture.objects['6187b505-b256-4d00-9ad2-68806e1e59e6'];
  const item = normalize(raw);

  assert.equal(item.source, 'getty');
  assert.equal(item.id, '6187b505-b256-4d00-9ad2-68806e1e59e6');
  assert.equal(item.title, 'A Swan Among the Reeds, by Moonlight');
  assert.equal(item.creator, 'Carl Gustav Carus');
  assert.equal(item.date, 'September 18, 1852');
  assert.equal(item.description, null);
  assert.equal(
    item.thumb,
    'https://media.getty.edu/iiif/image/63e9cac4-9fe3-42f8-8355-fd9663c3b5d7/full/400,/0/default.jpg',
  );
  assert.equal(
    item.preview,
    'https://media.getty.edu/iiif/image/63e9cac4-9fe3-42f8-8355-fd9663c3b5d7/full/1600,/0/default.jpg',
  );
  assert.ok(item.full.endsWith('/full/max/0/default.jpg'));
  assert.equal(item.width, null);
  assert.equal(item.height, null);
  assert.ok(item.pageUrl.startsWith('https://www.getty.edu/art/collection/object/'));
  assert.equal(item.pageUrl, 'https://www.getty.edu/art/collection/object/109JB8');
  assert.equal(item.license, 'Getty Open Content (free to use)');
  assert.equal(item.licenseUrl, 'https://www.getty.edu/projects/open-content-program/');
});

test('getty normalize returns null without a representation', () => {
  assert.equal(normalize({ id: 'https://x/object/abc', representation: [] }), null);
  assert.equal(normalize({}), null);
});

test('getty normalize accepts /full/max/ and other image URLs', () => {
  const raw = fixture.objects['6187b505-b256-4d00-9ad2-68806e1e59e6'];
  const asMax = normalize({
    ...raw,
    representation: [
      { ...raw.representation[0], id: raw.representation[0].id.replace('/full/full/', '/full/max/') },
    ],
  });
  assert.equal(asMax.full, raw.representation[0].id.replace('/full/full/', '/full/max/'));

  const other = normalize({
    ...raw,
    representation: [{ id: 'https://media.getty.edu/iiif/image/abc/info.json' }],
  });
  assert.equal(other.thumb, 'https://media.getty.edu/iiif/image/abc/info.json');
  assert.equal(other.preview, 'https://media.getty.edu/iiif/image/abc/info.json');
  assert.equal(other.full, 'https://media.getty.edu/iiif/image/abc/info.json');
});

test('getty search loads SPARQL then the objects in order', async () => {
  clearCache();
  const fake = makeFake();
  const result = await search('swan moon', 1, { fetchJson: fake.fetchJson });

  assert.equal(result.total, null);
  assert.equal(result.hasMore, false);
  assert.equal(result.items.length, UUIDS.length);
  assert.deepEqual(
    result.items.map((item) => item.id),
    UUIDS,
  );
  assert.equal(fake.sparqlHeaders.length, 1);
  assert.equal(fake.sparqlHeaders[0].Accept, SPARQL_ACCEPT);
  assert.ok(fake.objectHeaders.length === UUIDS.length);
  for (const headers of fake.objectHeaders) {
    assert.equal(headers.Accept, OBJECT_ACCEPT);
  }
  assert.ok(fake.calls[0].startsWith(SPARQL_URL));
});

test('getty search removes an item when its object request fails', async () => {
  clearCache();
  const fake = makeFake({ throwUrls: [OBJECT_URLS[0]] });
  const result = await search('swan moon', 1, { fetchJson: fake.fetchJson });

  assert.equal(result.items.length, UUIDS.length - 1);
  assert.deepEqual(
    result.items.map((item) => item.id),
    UUIDS.slice(1),
  );
});

test('getty search caches objects', async () => {
  clearCache();
  const fake = makeFake();
  await search('swan moon', 1, { fetchJson: fake.fetchJson });
  const firstObjectCalls = fake.objectHeaders.length;
  assert.ok(firstObjectCalls > 0);

  const second = await search('swan moon', 1, { fetchJson: fake.fetchJson });
  assert.equal(fake.objectHeaders.length, firstObjectCalls);
  assert.equal(second.items.length, UUIDS.length);

  clearCache();
  await search('swan moon', 1, { fetchJson: fake.fetchJson });
  assert.equal(fake.objectHeaders.length, firstObjectCalls * 2);
});

test('getty search uses 24 items and sets hasMore for 25 bindings', async () => {
  clearCache();
  const bindings = Array.from({ length: 25 }, (_, i) => {
    const uuid = `${String(i).padStart(8, '0')}-0000-0000-0000-000000000000`;
    return { uuid, title: `Title ${i}` };
  });
  const objects = {};
  for (const binding of bindings) {
    objects[binding.uuid] = {
      ...fixture.objects['6187b505-b256-4d00-9ad2-68806e1e59e6'],
      id: `https://data.getty.edu/museum/collection/object/${binding.uuid}`,
    };
  }

  const requested = [];
  const fake = async (url) => {
    if (url.startsWith(SPARQL_URL)) return sparqlAnswer(bindings);
    const uuid = url.slice(url.lastIndexOf('/') + 1);
    requested.push(uuid);
    return objects[uuid];
  };

  const result = await search('anything', 1, { fetchJson: fake });
  assert.equal(result.hasMore, true);
  assert.equal(requested.length, 24);
  assert.equal(result.items.length, 24);
});

test('getty search with no words sends no request', async () => {
  clearCache();
  let called = false;
  const fake = async () => {
    called = true;
    return fixture.sparql;
  };
  const result = await search('   ', 1, { fetchJson: fake });
  assert.equal(called, false);
  assert.equal(result.items.length, 0);
  assert.equal(result.total, null);
  assert.equal(result.hasMore, false);
});
