import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  buildSearchUrl,
  id,
  keyEnv,
  name,
  normalize,
  parseSearch,
  resolveDownload,
  rewriteObject,
  rightsLabel,
  search,
} from './index.js';

import { getSource } from '../../lib/sources/index.js';

const {
  group,
  trustResolvedUrl,
} = getSource('dpla');

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, '../../test/fixtures/dpla.json'), 'utf8'));

const savedKey = process.env.DPLA_KEY;

function restoreKey() {
  if (savedKey === undefined) delete process.env.DPLA_KEY;
  else process.env.DPLA_KEY = savedKey;
}

function assertNeedsKey(err) {
  assert.equal(err.code, 'NEEDS_KEY');
  assert.equal(err.message, 'DPLA needs DPLA_KEY in .env');
  return true;
}

test('dpla constants', () => {
  assert.equal(id, 'dpla');
  assert.equal(name, 'DPLA');
  assert.equal(group, 'aggregators');
  assert.equal(keyEnv, 'DPLA_KEY');
  assert.equal(trustResolvedUrl, true);
});

test('dpla parseSearch reads docs and count', () => {
  const result = parseSearch(fixture.search, 1);
  assert.equal(result.items.length, 2);
  assert.equal(result.total, fixture.search.count);
  assert.equal(result.hasMore, fixture.search.start + fixture.search.docs.length < fixture.search.count);
});

test('dpla normalize makes an Item from a complete record', () => {
  const raw = fixture.search.docs[0];
  const item = normalize(raw);

  assert.equal(item.source, 'dpla');
  assert.equal(item.id, raw.id);
  assert.equal(item.title, raw.sourceResource.title[0]);
  assert.equal(item.creator, raw.sourceResource.creator[0]);
  assert.equal(item.date, raw.sourceResource.date.displayDate);
  assert.equal(item.description, raw.sourceResource.description[0]);
  assert.equal(item.thumb, `https://dp.la/thumb/${raw.id}`);
  assert.equal(item.thumbFallback, raw.object);
  assert.equal(item.preview, `https://dp.la/thumb/${raw.id}`);
  assert.equal(item.previewFallback, raw.object);
  assert.equal(item.full, raw.object);
  assert.equal(item.width, null);
  assert.equal(item.height, null);
  assert.equal(item.pageUrl, raw.isShownAt);
  assert.equal(item.provider, raw.dataProvider);
  assert.equal(item.license, 'No Copyright - United States');
  assert.equal(item.licenseUrl, raw.rights);
  assert.equal(item.note, 'DPLA gives a thumbnail only. Open the partner page for the full image.');
});

test('dpla normalize reads array fields and nested dataProvider', () => {
  const raw = fixture.search.docs[1];
  const item = normalize(raw);

  assert.equal(item.title, raw.sourceResource.title[0]);
  assert.equal(item.creator, raw.sourceResource.creator[0]);
  assert.equal(item.date, raw.sourceResource.date[0].displayDate);
  assert.equal(item.description, raw.sourceResource.description[0]);
  assert.equal(item.thumb, `https://dp.la/thumb/${raw.id}`);
  assert.equal(item.thumbFallback, raw.object[0]);
  assert.equal(item.preview, `https://dp.la/thumb/${raw.id}`);
  assert.equal(item.previewFallback, raw.object[0]);
  assert.equal(item.full, raw.object[0]);
  assert.equal(item.pageUrl, raw.isShownAt[0]);
  assert.equal(item.provider, raw.dataProvider.name);
  assert.equal(item.license, 'CC BY-SA 4.0');
  assert.equal(item.licenseUrl, raw.rights);
});

test('dpla normalize returns null without an object URL', () => {
  assert.equal(normalize(fixture.search.docs[2]), null);
  assert.equal(normalize({ id: 'x', sourceResource: { title: ['T'] } }), null);
});

test('dpla normalize falls back to the dp.la item page', () => {
  const item = normalize({ id: 'abc', object: 'https://x.example/a.jpg' });
  assert.equal(item.title, 'Untitled');
  assert.equal(item.creator, null);
  assert.equal(item.date, null);
  assert.equal(item.description, null);
  assert.equal(item.pageUrl, 'https://dp.la/item/abc');
  assert.equal(item.provider, null);
  assert.equal(item.license, 'See partner page');
  assert.equal(item.licenseUrl, null);
});

test('dpla rights labels', () => {
  assert.equal(rightsLabel('https://creativecommons.org/publicdomain/zero/1.0/'), 'CC0');
  assert.equal(rightsLabel('http://rightsstatements.org/vocab/InC/1.0/'), 'In Copyright');
  assert.equal(rightsLabel('https://www.rightsstatements.org/vocab/NoC-US/1.0/'), 'No Copyright - United States');
  assert.equal(rightsLabel('https://rightsstatements.org/vocab/NoC-NC/1.0/'), 'No Copyright - Non-Commercial Use Only');
  assert.equal(rightsLabel('https://rightsstatements.org/vocab/NoC-OKLR/1.0/'), 'No Copyright - Other Known Legal Restrictions');
  assert.equal(rightsLabel('https://rightsstatements.org/vocab/NKC/1.0/'), 'No Known Copyright');
  assert.equal(rightsLabel('https://rightsstatements.org/vocab/InC-EDU/1.0/'), 'In Copyright - Educational Use Permitted');
  assert.equal(rightsLabel('https://rightsstatements.org/vocab/NoC-CR/1.0/'), 'No Copyright - Contractual Restrictions');
  assert.equal(rightsLabel('https://rightsstatements.org/vocab/InC-NC/1.0/'), 'In Copyright - Non-Commercial Use Permitted');
  assert.equal(rightsLabel('https://rightsstatements.org/vocab/InC-RUU/1.0/'), 'In Copyright - Rights-holder(s) Unlocatable or Unidentifiable');
  assert.equal(rightsLabel('https://rightsstatements.org/vocab/CNE/1.0/'), 'Copyright Not Evaluated');
  assert.equal(rightsLabel('https://rightsstatements.org/vocab/UND/1.0/'), 'Copyright Undetermined');
  assert.equal(rightsLabel('https://rightsstatements.org/vocab/XYZ/1.0/'), 'Rights statement: XYZ');
  assert.equal(rightsLabel('https://creativecommons.org/publicdomain/mark/1.0/'), 'Public domain');
  assert.equal(rightsLabel('https://creativecommons.org/licenses/by-sa/4.0/'), 'CC BY-SA 4.0');
  assert.equal(rightsLabel('https://creativecommons.org/licenses/by/2.0/'), 'CC BY 2.0');
  assert.equal(rightsLabel(undefined), 'See partner page');
  assert.equal(rightsLabel('Some text'), 'See partner page');
});

test('dpla buildSearchUrl builds the documented request', () => {
  const url = new URL(buildSearchUrl('test-key', 'full moon', 2));
  assert.equal(url.origin + url.pathname, 'https://api.dp.la/v2/items');
  assert.equal(url.searchParams.get('q'), 'full moon');
  assert.equal(url.searchParams.get('api_key'), 'test-key');
  assert.equal(url.searchParams.get('sourceResource.type'), 'image');
  assert.equal(url.searchParams.get('page_size'), '24');
  assert.equal(url.searchParams.get('page'), '2');
});

test('dpla search without a key rejects and sends no request', async (t) => {
  t.after(restoreKey);
  delete process.env.DPLA_KEY;

  let called = false;
  const fake = async () => {
    called = true;
    return fixture.search;
  };

  await assert.rejects(search('moon', 1, { fetchJson: fake }), assertNeedsKey);
  assert.equal(called, false);
});

test('dpla resolveDownload without a key rejects and sends no request', async (t) => {
  t.after(restoreKey);
  delete process.env.DPLA_KEY;

  let called = false;
  const fake = async () => {
    called = true;
    return fixture.item;
  };

  await assert.rejects(resolveDownload('abc123', { fetchJson: fake }), assertNeedsKey);
  assert.equal(called, false);
});

test('dpla search sends the key in the request', async (t) => {
  t.after(restoreKey);
  process.env.DPLA_KEY = 'test-key';

  let requested = '';
  const fake = async (url) => {
    requested = url;
    return fixture.search;
  };

  const result = await search('moon', 2, { fetchJson: fake });
  assert.equal(result.items.length, 2);

  const url = new URL(requested);
  assert.equal(url.origin + url.pathname, 'https://api.dp.la/v2/items');
  assert.equal(url.searchParams.get('api_key'), 'test-key');
  assert.equal(url.searchParams.get('q'), 'moon');
  assert.equal(url.searchParams.get('page'), '2');
  assert.equal(url.searchParams.get('page_size'), '24');
  assert.equal(url.searchParams.get('sourceResource.type'), 'image');
});

test('dpla resolveDownload gets the detail record', async (t) => {
  t.after(restoreKey);
  process.env.DPLA_KEY = 'test-key';

  let requested = '';
  const fake = async (url) => {
    requested = url;
    return fixture.item;
  };

  const resolved = await resolveDownload('abc123', {
    fetchJson: fake,
    fetch: async () => fakeResponse(200, 'image/jpeg'),
  });
  assert.equal(requested, 'https://api.dp.la/v2/items/abc123?api_key=test-key');
  assert.equal(resolved.url, fixture.item.docs[0].object);
  assert.equal(resolved.filename, fixture.item.docs[0].sourceResource.title[0]);
});

test('dpla resolveDownload rejects a bad id without a request', async () => {
  let called = false;
  const fake = async () => {
    called = true;
    return fixture.item;
  };

  await assert.rejects(resolveDownload('../x', { fetchJson: fake }), (err) => err.status === 400);
  assert.equal(called, false);
});

test('dpla resolveDownload rejects a record without an object URL', async (t) => {
  t.after(restoreKey);
  process.env.DPLA_KEY = 'test-key';

  const fake = async () => ({ docs: [{ id: 'abc123', sourceResource: {} }] });
  await assert.rejects(
    resolveDownload('abc123', { fetchJson: fake }),
    (err) => err.message === 'DPLA item has no image URL',
  );
});

test('dpla rewriteObject keeps the NYPL scheme and changes t', () => {
  assert.deepEqual(rewriteObject('https://images.nypl.org/index.php?t=t&id=1992631'), {
    preview: 'https://images.nypl.org/index.php?t=q&id=1992631',
    previewFallback: 'https://images.nypl.org/index.php?t=w&id=1992631',
    full: 'https://images.nypl.org/index.php?t=g&id=1992631',
    downloads: [
      'https://images.nypl.org/index.php?t=g&id=1992631',
      'https://iiif.nypl.org/iiif/2/1992631/full/max/0/default.jpg',
    ],
  });
});

test('dpla rewriteObject uses https for images.nypl.org', () => {
  const rewrite = rewriteObject('http://images.nypl.org/index.php?id=5&t=w');
  const preview = new URL(rewrite.preview);
  assert.equal(preview.protocol, 'https:');
  assert.equal(preview.searchParams.get('t'), 'q');
  assert.equal(preview.searchParams.get('id'), '5');
  const previewFallback = new URL(rewrite.previewFallback);
  assert.equal(previewFallback.protocol, 'https:');
  assert.equal(previewFallback.searchParams.get('t'), 'w');
  assert.equal(previewFallback.searchParams.get('id'), '5');
  const full = new URL(rewrite.full);
  assert.equal(full.protocol, 'https:');
  assert.equal(full.searchParams.get('t'), 'g');
  assert.equal(full.searchParams.get('id'), '5');
  assert.deepEqual(rewrite.downloads, [
    rewrite.full,
    'https://iiif.nypl.org/iiif/2/5/full/max/0/default.jpg',
  ]);
});

test('dpla rewriteObject sets max=1600 for ids.si.edu', () => {
  const rewrite = rewriteObject('https://ids.si.edu/ids/deliveryService?id=X');
  const preview = new URL(rewrite.preview);
  assert.equal(preview.searchParams.get('id'), 'X');
  assert.equal(preview.searchParams.get('max'), '1600');
  const full = new URL(rewrite.full);
  assert.equal(full.searchParams.get('id'), 'X');
  assert.equal(full.searchParams.has('max'), false);
  assert.deepEqual(rewrite.downloads, [rewrite.full]);
  assert.equal('previewFallback' in rewrite, false);
});

test('dpla rewriteObject removes an existing max for ids.si.edu', () => {
  const rewrite = rewriteObject('https://ids.si.edu/ids/deliveryService?id=X&max=150');
  const full = new URL(rewrite.full);
  assert.equal(full.searchParams.has('max'), false);
});

test('dpla rewriteObject expands self-hosted CONTENTdm links', () => {
  const rewrite = rewriteObject(
    'http://digitalcollections.hclib.org/utils/getthumbnail/collection/MplsPhotos/id/51644',
  );
  assert.deepEqual(rewrite, {
    preview: 'http://digitalcollections.hclib.org/digital/iiif/MplsPhotos/51644/full/1600,/0/default.jpg',
    full: 'http://digitalcollections.hclib.org/digital/iiif/MplsPhotos/51644/full/max/0/default.jpg',
    downloads: [
      'http://digitalcollections.hclib.org/digital/iiif/MplsPhotos/51644/full/max/0/default.jpg',
    ],
  });
  assert.equal('previewFallback' in rewrite, false);
});

test('dpla rewriteObject expands IIIF image URLs', () => {
  const washington = rewriteObject(
    'http://digitalcollections.lib.washington.edu/digital/iiif/sayre/18475/full/500,/0/default.jpg',
  );
  assert.equal(
    washington.preview,
    'http://digitalcollections.lib.washington.edu/digital/iiif/sayre/18475/full/1600,/0/default.jpg',
  );
  assert.equal(
    washington.full,
    'http://digitalcollections.lib.washington.edu/digital/iiif/sayre/18475/full/max/0/default.jpg',
  );

  const virginia = rewriteObject(
    'https://iiif.lib.virginia.edu/iiif/uva-lib:2514633/full/!125,200/0/default.jpg',
  );
  assert.equal(
    virginia.preview,
    'https://iiif.lib.virginia.edu/iiif/uva-lib:2514633/full/1600,/0/default.jpg',
  );
  assert.equal(
    virginia.full,
    'https://iiif.lib.virginia.edu/iiif/uva-lib:2514633/full/max/0/default.jpg',
  );

  const duke = rewriteObject(
    'https://repository.duke.edu/iiif/ark:/87924/r42v2hn18/full/!350,350/0/default.jpg',
  );
  assert.equal(
    duke.preview,
    'https://repository.duke.edu/iiif/ark:/87924/r42v2hn18/full/1600,/0/default.jpg',
  );
  assert.equal(duke.full, 'https://repository.duke.edu/iiif/ark:/87924/r42v2hn18/full/max/0/default.jpg');

  for (const rewrite of [washington, virginia, duke]) {
    assert.deepEqual(rewrite.downloads, [rewrite.full]);
    assert.equal('previewFallback' in rewrite, false);
  }
});

test('dpla rewriteObject rewrites indiana thumbnail links', () => {
  const rewrite = rewriteObject(
    'http://purl.dlib.indiana.edu/iudl/lilly/devincent/thumbnail/LL-SDV-218020-01-01',
  );
  assert.deepEqual(rewrite, {
    preview: 'http://purl.dlib.indiana.edu/iudl/lilly/devincent/large/LL-SDV-218020-01-01',
    full: 'http://purl.dlib.indiana.edu/iudl/lilly/devincent/large/LL-SDV-218020-01-01',
    downloads: ['http://purl.dlib.indiana.edu/iudl/lilly/devincent/large/LL-SDV-218020-01-01'],
  });
  assert.equal('previewFallback' in rewrite, false);
});

test('dpla rewriteObject rewrites Digital Commonwealth thumbnail links', () => {
  const rewrite = rewriteObject('https://ark.digitalcommonwealth.org/ark:/50959/fn10dd60v/thumbnail');
  assert.deepEqual(rewrite, {
    preview: 'https://ark.digitalcommonwealth.org/ark:/50959/fn10dd60v/large_image',
    full: 'https://ark.digitalcommonwealth.org/ark:/50959/fn10dd60v/large_image',
    downloads: ['https://ark.digitalcommonwealth.org/ark:/50959/fn10dd60v/large_image'],
  });
  assert.equal('previewFallback' in rewrite, false);
});

test('dpla rewriteObject returns null for unknown or invalid objects', () => {
  assert.equal(
    rewriteObject(
      'http://twudigital.contentdm.oclc.org/utils/getthumbnail/collection/p1281coll6/id/2349',
    ),
    null,
  );
  assert.equal(
    rewriteObject(
      'http://cdm17176.contentdm.oclc.org/digital/iiif/asotin/7454/full/500,/0/default.jpg',
    ),
    null,
  );
  assert.equal(
    rewriteObject(
      'https://s3.amazonaws.com/NARAprodstorage/lz/stillpix/255-grc/Batch013/255-GRC-1990-C-12366.JPG',
    ),
    null,
  );
  assert.equal(rewriteObject('https://thumbnails.calisphere.org/x.jpg'), null);
  assert.equal(rewriteObject(null), null);
  assert.equal(rewriteObject(''), null);
  assert.equal(rewriteObject('not a url'), null);
});

test('dpla normalize uses the dp.la thumb for NARA records', () => {
  const raw = fixture.nara;
  const item = normalize(raw);

  assert.equal(item.thumb, 'https://dp.la/thumb/02356839048efd39ec158c7b5bc70858');
  assert.equal(item.thumbFallback, raw.object);
  assert.equal(item.preview, 'https://dp.la/thumb/02356839048efd39ec158c7b5bc70858');
  assert.equal(item.previewFallback, raw.object);
  assert.equal(item.full, raw.object);
  assert.equal(item.note, 'DPLA gives a thumbnail only. Open the partner page for the full image.');
});

test('dpla normalize rewrites the NYPL record', () => {
  const raw = fixture.nypl;
  const item = normalize(raw);

  assert.equal(item.thumb, 'https://dp.la/thumb/61380d0c7159c9e8c282178701d2b68b');
  assert.equal(item.thumbFallback, raw.object);
  assert.equal(item.preview, 'https://images.nypl.org/index.php?t=q&id=1992631');
  assert.equal(item.previewFallback, 'https://images.nypl.org/index.php?t=w&id=1992631');
  assert.equal(item.full, 'https://images.nypl.org/index.php?t=g&id=1992631');
  assert.equal(item.note, null);
});

test('dpla buildSearchUrl adds the open filter only when requested', () => {
  const plain = new URL(buildSearchUrl('k', 'moon', 1));
  assert.equal(plain.searchParams.has('rightsCategory'), false);

  const open = new URL(buildSearchUrl('k', 'moon', 1, true));
  assert.equal(
    open.searchParams.get('rightsCategory'),
    '"Unlimited Re-Use" OR "Re-use With Conditions"',
  );
});

test('dpla search sends the open filter when openOnly is true', async (t) => {
  t.after(restoreKey);
  process.env.DPLA_KEY = 'fake-key';

  let requested = '';
  const fake = async (url) => {
    requested = url;
    return fixture.search;
  };

  await search('moon', 1, { fetchJson: fake, openOnly: true });
  assert.equal(
    new URL(requested).searchParams.get('rightsCategory'),
    '"Unlimited Re-Use" OR "Re-use With Conditions"',
  );

  await search('moon', 1, { fetchJson: fake });
  assert.equal(new URL(requested).searchParams.has('rightsCategory'), false);
});

function fakeResponse(status, contentType) {
  return {
    status,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? contentType : null) },
    body: { cancel: async () => {} },
  };
}

function nyplDetail() {
  return { docs: [fixture.nypl] };
}

test('dpla resolveDownload uses the NYPL IIIF when t=g is missing', async (t) => {
  t.after(restoreKey);
  process.env.DPLA_KEY = 'test-key';

  const requested = [];
  const fetchJsonFake = async () => nyplDetail();
  const fetchFake = async (url) => {
    requested.push(url);
    if (url === 'https://images.nypl.org/index.php?t=g&id=1992631') {
      return fakeResponse(404, 'text/html');
    }
    return fakeResponse(200, 'image/jpeg');
  };

  const resolved = await resolveDownload('abc123', { fetchJson: fetchJsonFake, fetch: fetchFake });
  assert.deepEqual(requested, [
    'https://images.nypl.org/index.php?t=g&id=1992631',
    'https://iiif.nypl.org/iiif/2/1992631/full/max/0/default.jpg',
  ]);
  assert.equal(resolved.url, 'https://iiif.nypl.org/iiif/2/1992631/full/max/0/default.jpg');
});

test('dpla resolveDownload uses t=g when it is an image and stops', async (t) => {
  t.after(restoreKey);
  process.env.DPLA_KEY = 'test-key';

  const requested = [];
  const fetchFake = async (url) => {
    requested.push(url);
    return fakeResponse(200, 'image/jpeg');
  };

  const resolved = await resolveDownload('abc123', {
    fetchJson: async () => nyplDetail(),
    fetch: fetchFake,
  });
  assert.deepEqual(requested, ['https://images.nypl.org/index.php?t=g&id=1992631']);
  assert.equal(resolved.url, 'https://images.nypl.org/index.php?t=g&id=1992631');
});

test('dpla resolveDownload falls back to the object when t=g and IIIF fail', async (t) => {
  t.after(restoreKey);
  process.env.DPLA_KEY = 'test-key';

  const object = fixture.nypl.object;
  const requested = [];
  const fetchFake = async (url) => {
    requested.push(url);
    if (url === object) return fakeResponse(200, 'image/gif');
    return fakeResponse(404, 'text/html');
  };

  const resolved = await resolveDownload('abc123', {
    fetchJson: async () => nyplDetail(),
    fetch: fetchFake,
  });
  assert.deepEqual(requested, [
    'https://images.nypl.org/index.php?t=g&id=1992631',
    'https://iiif.nypl.org/iiif/2/1992631/full/max/0/default.jpg',
    object,
  ]);
  assert.equal(resolved.url, object);
});

test('dpla resolveDownload uses the dp.la thumb when all candidates fail', async (t) => {
  t.after(restoreKey);
  process.env.DPLA_KEY = 'test-key';

  const requested = [];
  const replies = [
    async () => fakeResponse(404, 'text/html'),
    async () => fakeResponse(200, 'text/html'),
    async () => {
      throw new Error('network down');
    },
  ];
  for (const reply of replies) {
    const resolved = await resolveDownload('abc123', {
      fetchJson: async () => nyplDetail(),
      fetch: async (url) => {
        requested.push(url);
        return reply();
      },
    });
    assert.equal(resolved.url, 'https://dp.la/thumb/abc123');
  }
  assert.equal(requested.includes('https://dp.la/thumb/abc123'), false);
});

test('dpla resolveDownload checks the object for a record without a rewrite', async (t) => {
  t.after(restoreKey);
  process.env.DPLA_KEY = 'test-key';

  const object = 'https://nohc.catalogaccess.com/objects/abc';
  const fetchJsonFake = async () => ({ docs: [{ ...fixture.nara, object }] });

  const forbidden = await resolveDownload('abc123', {
    fetchJson: fetchJsonFake,
    fetch: async () => fakeResponse(403, 'text/html'),
  });
  assert.equal(forbidden.url, 'https://dp.la/thumb/abc123');

  const requested = [];
  const ok = await resolveDownload('abc123', {
    fetchJson: fetchJsonFake,
    fetch: async (url) => {
      requested.push(url);
      return fakeResponse(200, 'image/jpeg');
    },
  });
  assert.deepEqual(requested, [object]);
  assert.equal(ok.url, object);
});
