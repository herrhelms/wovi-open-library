import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  buildSearchUrl,
  id,
  LICENSES,
  normalize,
  PAGE_SIZE_PER_RIGHT,
  parseSearch,
  resolveDownload,
  RIGHTS,
  search,
} from './index.js';

import { getSource } from '../../lib/sources/index.js';

const {
  group,
  homepage,
  keyEnv,
  name,
  trustResolvedUrl,
} = getSource('japan-search');

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, '../../test/fixtures/japan-search.json'), 'utf8'));
const rightsFixture = JSON.parse(
  readFileSync(join(here, '../../test/fixtures/japan-search-rights.json'), 'utf8'),
);

function entryFor(rights, itemId) {
  const found = rightsFixture[rights].list.find((entry) => entry.id === itemId);
  assert.ok(found, `${rights} fixture has ${itemId}`);
  return found;
}

function fakeForRights(calls, overrides = {}) {
  const fake = async (url) => {
    const params = new URL(url).searchParams;
    calls.push(params);
    const rights = params.get('f-rights');
    if (Object.prototype.hasOwnProperty.call(overrides, rights)) {
      const value = overrides[rights];
      if (value instanceof Error) throw value;
      return value;
    }
    return rightsFixture[rights];
  };
  return fake;
}

test('japan-search constants', () => {
  assert.equal(id, 'japan-search');
  assert.equal(name, 'Japan Search');
  assert.equal(homepage, 'https://jpsearch.go.jp');
  assert.equal(group, 'aggregators');
  assert.equal(keyEnv, null);
  assert.equal(trustResolvedUrl, true);
  assert.deepEqual(RIGHTS, ['pdm', 'cc0', 'ccby', 'ccbysa']);
  assert.equal(PAGE_SIZE_PER_RIGHT, 6);
  assert.deepEqual(LICENSES, {
    pdm: {
      license: 'Public domain',
      licenseUrl: 'https://creativecommons.org/publicdomain/mark/1.0/',
    },
    cc0: {
      license: 'CC0',
      licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    },
    ccby: { license: 'CC BY', licenseUrl: null },
    ccbysa: { license: 'CC BY-SA', licenseUrl: null },
  });
});

test('japan-search notes describe the wider licence filter', () => {
  assert.deepEqual(getSource('japan-search').config.notes, [
    "Public domain, CC0, CC BY and CC BY-SA items with an image. Includes ColBase (Japan's national museums) and the National Diet Library.",
  ]);
});

test('japan-search parseSearch reads the mapps item', () => {
  const result = parseSearch(fixture.image, 1);
  assert.equal(result.total, fixture.image.hit);
  assert.equal(result.hasMore, 0 + fixture.image.list.length < fixture.image.hit);
  assert.ok(result.items.length > 0);

  const raw = fixture.image.list.find((entry) => entry.common.titleEn === 'Moon Over Izura');
  const item = result.items.find((entry) => entry.id === raw.id);

  assert.equal(item.source, 'japan-search');
  assert.equal(item.id, raw.id);
  assert.equal(item.title, 'Moon Over Izura');
  assert.equal(item.description, '五浦之月');
  assert.equal(item.thumb, raw.common.thumbnailUrl[0]);
  assert.equal(item.preview, raw.common.thumbnailUrl[0]);
  assert.equal(item.full, raw.common.thumbnailUrl[0]);
  assert.equal(item.pageUrl, raw.common.linkUrl);
  assert.equal(item.creator, '川瀬巴水 KAWASE Hasui');
  assert.ok(!item.creator.includes('\u3000'));
  assert.equal(item.date, '1952');
  assert.equal(item.license, 'Public domain');
  assert.equal(item.licenseUrl, 'https://creativecommons.org/publicdomain/mark/1.0/');
  assert.equal(item.provider, 'ZENBI');
});

test('japan-search parseSearch upgrades NDL IIIF thumbnails', () => {
  const result = parseSearch(fixture.ndl, 1);
  assert.equal(result.total, fixture.ndl.hit);

  const raw = fixture.ndl.list.find((entry) =>
    /\/full\/\d+,\/0\/default\.jpg$/.test(entry.common.thumbnailUrl?.[0] ?? ''),
  );
  assert.ok(raw, 'fixture has an IIIF item');

  const item = result.items.find((entry) => entry.id === raw.id);
  const base = raw.common.thumbnailUrl[0].replace(/\/full\/\d+,\/0\/default\.jpg$/, '');

  assert.ok(item.thumb.endsWith('/full/400,/0/default.jpg'));
  assert.ok(item.preview.endsWith('/full/1600,/0/default.jpg'));
  assert.ok(item.full.endsWith('/full/full/0/default.jpg'));
  assert.equal(item.thumb, `${base}/full/400,/0/default.jpg`);
  assert.equal(item.preview, `${base}/full/1600,/0/default.jpg`);
  assert.equal(item.full, `${base}/full/full/0/default.jpg`);
  assert.equal(item.pageUrl.startsWith('https://dl.ndl.go.jp/'), true);
});

test('japan-search normalize rejects entries without a supported rights type', () => {
  const raw = fixture.image.list[0];
  const unsupported = { id: raw.id, common: { ...raw.common, contentsRightsType: 'ccbync' } };
  assert.equal(normalize(unsupported), null);

  const missing = { id: raw.id, common: { ...raw.common } };
  delete missing.common.contentsRightsType;
  assert.equal(normalize(missing), null);

  const empty = { id: raw.id, common: { ...raw.common, contentsRightsType: '' } };
  assert.equal(normalize(empty), null);
});

test('japan-search normalize returns null without an image', () => {
  const entry = {
    id: 'x',
    common: { title: 'T', thumbnailUrl: null, contentsUrl: null, contentsRightsType: 'pdm' },
  };
  assert.equal(normalize(entry), null);
});

test('japan-search normalize uses the large ColBase image for full and preview', () => {
  const raw = entryFor('ccby', 'cobas-80501');
  const item = normalize(raw);
  const large = 'https://colbase.nich.go.jp/media/tnm/G-4853/image/G-4853_C0011434.jpg';
  const small =
    'https://colbase.nich.go.jp/media/tnm/G-4853/image/slideshow_s/G-4853_C0011434.jpg';

  assert.equal(item.license, 'CC BY');
  assert.equal(item.licenseUrl, null);
  assert.equal(item.full, large);
  assert.equal(item.preview, large);
  assert.equal(item.thumb, small);
});

test('japan-search normalize handles NDL items', () => {
  const raw = entryFor('pdm', 'dignl-13437516');
  const item = normalize(raw);

  assert.equal(item.license, 'Public domain');
  assert.equal(item.licenseUrl, 'https://creativecommons.org/publicdomain/mark/1.0/');
  assert.equal(
    item.full,
    'https://www.dl.ndl.go.jp/api/iiif/13437516/R0000001/full/full/0/default.jpg',
  );
  assert.equal(
    item.thumb,
    'https://www.dl.ndl.go.jp/api/iiif/13437516/R0000001/full/400,/0/default.jpg',
  );
  assert.equal(item.pageUrl, 'https://dl.ndl.go.jp/info:ndljp/pid/13437516');
});

test('japan-search normalize handles CC0 and CC BY-SA items', () => {
  const cc0 = normalize(rightsFixture.cc0.list[0]);
  assert.equal(cc0.license, 'CC0');
  assert.equal(cc0.licenseUrl, 'https://creativecommons.org/publicdomain/zero/1.0/');

  const ccbysa = normalize(rightsFixture.ccbysa.list[0]);
  assert.equal(ccbysa.license, 'CC BY-SA');
  assert.equal(ccbysa.licenseUrl, null);
});

test('japan-search buildSearchUrl encodes the query and rights', () => {
  const url = new URL(buildSearchUrl('moon', 2, 'ccby'));
  assert.equal(url.origin + url.pathname, 'https://jpsearch.go.jp/api/item/search/jps-cross');
  assert.equal(url.searchParams.get('keyword'), 'moon');
  assert.equal(url.searchParams.get('f-rights'), 'ccby');
  assert.equal(url.searchParams.get('f-contents'), 'thumb');
  assert.equal(url.searchParams.get('size'), '6');
  assert.equal(url.searchParams.get('from'), '6');
});

test('japan-search buildSearchUrl falls back to page 1 and pdm', () => {
  const badPage = new URL(buildSearchUrl('moon', 0, 'cc0'));
  assert.equal(badPage.searchParams.get('from'), '0');
  const notANumber = new URL(buildSearchUrl('moon', 'x', 'cc0'));
  assert.equal(notANumber.searchParams.get('from'), '0');
  const noRights = new URL(buildSearchUrl('moon', 1));
  assert.equal(noRights.searchParams.get('f-rights'), 'pdm');
});

test('japan-search search requests every rights value and joins the results', async () => {
  const calls = [];
  const result = await search('moon', 1, { fetchJson: fakeForRights(calls) });

  assert.equal(calls.length, 4);
  assert.deepEqual(
    calls.map((params) => params.get('f-rights')),
    ['pdm', 'cc0', 'ccby', 'ccbysa'],
  );
  for (const params of calls) {
    assert.equal(params.get('keyword'), 'moon');
    assert.equal(params.get('f-contents'), 'thumb');
    assert.equal(params.get('size'), '6');
    assert.equal(params.get('from'), '0');
  }

  const expectedHit =
    rightsFixture.pdm.hit + rightsFixture.cc0.hit + rightsFixture.ccby.hit + rightsFixture.ccbysa.hit;
  assert.equal(result.total, expectedHit);
  assert.equal(expectedHit, 5924 + 827 + 10856 + 3);
  assert.equal(result.hasMore, true);

  const expectedIds = RIGHTS.flatMap((rights) =>
    rightsFixture[rights].list.map((entry) => entry.id),
  );
  assert.deepEqual(
    result.items.map((item) => item.id),
    expectedIds,
  );
});

test('japan-search search keeps partial results when some requests fail', async () => {
  const calls = [];
  const cc0Error = new Error('cc0 failed');
  const ccbysaError = new Error('ccbysa failed');
  const result = await search('moon', 1, {
    fetchJson: fakeForRights(calls, { cc0: cc0Error, ccbysa: ccbysaError }),
  });

  assert.equal(calls.length, 4);
  assert.equal(result.total, rightsFixture.pdm.hit + rightsFixture.ccby.hit);
  assert.equal(result.hasMore, true);

  const expectedIds = [...rightsFixture.pdm.list, ...rightsFixture.ccby.list].map(
    (entry) => entry.id,
  );
  assert.deepEqual(
    result.items.map((item) => item.id),
    expectedIds,
  );
  assert.equal(
    result.items.some((item) => rightsFixture.cc0.list.some((raw) => raw.id === item.id)),
    false,
  );
  assert.equal(
    result.items.some((item) => rightsFixture.ccbysa.list.some((raw) => raw.id === item.id)),
    false,
  );
});

test('japan-search search rejects with the pdm error when all requests fail', async () => {
  const calls = [];
  const errors = {
    pdm: new Error('pdm failed'),
    cc0: new Error('cc0 failed'),
    ccby: new Error('ccby failed'),
    ccbysa: new Error('ccbysa failed'),
  };
  await assert.rejects(search('moon', 1, { fetchJson: fakeForRights(calls, errors) }), (err) => {
    assert.equal(err, errors.pdm);
    assert.equal(err.message, 'pdm failed');
    return true;
  });
  assert.equal(calls.length, 4);
});

test('japan-search search reports hasMore false when all lists are short', async () => {
  const calls = [];
  const short = {};
  for (const rights of RIGHTS) {
    short[rights] = {
      hit: rightsFixture[rights].list.length,
      list: rightsFixture[rights].list,
    };
  }
  const result = await search('moon', 1, { fetchJson: fakeForRights(calls, short) });
  assert.equal(result.hasMore, false);
});

test('japan-search resolveDownload gets the item record', async () => {
  const raw = fixture.image.list.find((entry) => entry.id === 'apmoa_mapps-18690');
  let requested = '';
  const fake = async (url) => {
    requested = url;
    return { id: raw.id, common: raw.common };
  };
  const resolved = await resolveDownload('apmoa_mapps-18690', { fetchJson: fake });
  assert.equal(requested, 'https://jpsearch.go.jp/api/item/apmoa_mapps-18690');
  assert.equal(resolved.url, raw.common.thumbnailUrl[0]);
  assert.equal(resolved.filename, 'Moon Over Izura');
});

test('japan-search resolveDownload rejects a bad id without a request', async () => {
  let called = false;
  const fake = async () => {
    called = true;
    return { common: {} };
  };
  await assert.rejects(resolveDownload('a/b', { fetchJson: fake }), (err) => err.status === 400);
  assert.equal(called, false);
});
