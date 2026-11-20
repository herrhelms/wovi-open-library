import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  licenseOf,
  localName,
  normalize,
  parseSearch,
  resolveDownload,
  search,
  textValue,
  trustResolvedUrl,
} from '../lib/sources/ksamsok.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, 'fixtures/ksamsok.json'), 'utf8'));

test('ksamsok trusts its resolved download URL', () => {
  assert.equal(trustResolvedUrl, true);
});

test('ksamsok localName removes the prefix', () => {
  assert.equal(localName('ns1:itemTitle'), 'itemTitle');
  assert.equal(localName('foaf:name'), 'name');
  assert.equal(localName('itemTitle'), 'itemTitle');
  assert.equal(localName('@id'), '@id');
});

test('ksamsok textValue reads strings, values and language arrays', () => {
  assert.equal(textValue('x'), 'x');
  assert.equal(textValue({ '@value': 'x' }), 'x');
  assert.equal(
    textValue([
      { '@value': 'Schwedisch', '@language': 'sv' },
      { '@value': 'English', '@language': 'en' },
    ]),
    'English',
  );
  assert.equal(textValue([]), null);
  assert.equal(textValue(null), null);
});

test('ksamsok licenseOf maps open licenses', () => {
  assert.equal(
    licenseOf('http://kulturarvsdata.se/resurser/License#pdmark').label,
    'Public domain',
  );
  assert.equal(
    licenseOf('http://kulturarvsdata.se/resurser/License#cc0').label,
    'CC0',
  );
  assert.equal(licenseOf('http://kulturarvsdata.se/resurser/License#by-nc-nd'), null);
});

test('ksamsok licenseOf takes the CC version from mediaLicenseUrl', () => {
  const bySa = licenseOf(
    'http://kulturarvsdata.se/resurser/License#by-sa',
    'http://creativecommons.org/licenses/by-sa/3.0/',
  );
  assert.equal(bySa.label, 'CC BY-SA 3.0');

  const by = licenseOf(
    'http://kulturarvsdata.se/resurser/License#by',
    'http://creativecommons.org/licenses/by/2.5/',
  );
  assert.equal(by.label, 'CC BY 2.5');

  const noVersion = licenseOf('http://kulturarvsdata.se/resurser/License#by');
  assert.equal(noVersion.label, 'CC BY');
});

test('ksamsok normalize reads the CC version and the licence URL', () => {
  const record = {
    '@graph': [
      {
        '@type': 'ns1:Entity',
        '@id': 'http://kulturarvsdata.se/X/photo/2',
        'ns1:itemLabel': 'Moon',
      },
      {
        '@type': 'ns1:Image',
        'ns1:mediaLicense': { '@id': 'http://kulturarvsdata.se/resurser/License#by-sa' },
        'ns1:mediaLicenseUrl': { '@id': 'http://creativecommons.org/licenses/by-sa/3.0/' },
        'ns1:highresSource': 'https://example.org/a.jpg',
      },
    ],
  };
  const item = normalize(record);
  assert.equal(item.license, 'CC BY-SA 3.0');
  assert.equal(item.licenseUrl, 'https://creativecommons.org/licenses/by-sa/3.0/');
});

test('ksamsok parseSearch reads the Form A record', () => {
  const result = parseSearch(fixture.search, 1);
  assert.equal(result.total, 364);
  assert.equal(result.items.length, 2);

  const item = result.items[0];
  assert.equal(item.source, 'ksamsok');
  assert.equal(item.id, 'S-TEK/photo/TEKA0164922');
  assert.equal(item.title, 'Text på baksida "Moon"');
  assert.equal(item.thumb, 'https://ems.dimu.org/image/069EJVgVTCBUL?dimension=400x400');
  assert.equal(item.thumbFallback, 'https://ems.dimu.org/image/069EJVgVTCBUL?dimension=145x105');
  assert.equal(item.preview, 'https://ems.dimu.org/image/069EJVgVTCBUL?dimension=1600x1600');
  assert.equal(item.full, 'https://ems.dimu.org/image/069EJVgVTCBUL?dimension=max');
  assert.equal(item.pageUrl, 'https://digitaltmuseum.se/0210115420674');
  assert.equal(item.license, 'Public domain');
  assert.equal(item.creator, null);
  assert.equal(item.provider, 'Tekniska museet');
  assert.equal(item.date, null);
});

test('ksamsok parseSearch reads the Form B record', () => {
  const result = parseSearch(fixture.search, 1);
  const item = result.items[1];
  assert.ok(item);
  assert.equal(item.id, 'SMVK-EM/name/27658603');
  assert.equal(item.title, 'Moon, Carl');
  assert.ok(item.thumb.startsWith('https://collections.smvk.se/'));
  assert.ok(item.preview.startsWith('https://collections.smvk.se/'));
  assert.equal(item.full, item.preview);
  assert.equal(item.license, 'Public domain');
  assert.equal(item.creator, null);
  assert.equal(item.pageUrl, 'https://collections.smvk.se/carlotta-em/web/object/27658603');
});

test('ksamsok normalize returns null when the only image is not open', () => {
  const record = {
    '@graph': [
      {
        '@type': 'ns1:Entity',
        '@id': 'http://kulturarvsdata.se/X/photo/1',
        'ns1:itemTitle': 'Closed',
      },
      {
        '@type': 'ns1:Image',
        'ns1:mediaLicense': { '@id': 'http://kulturarvsdata.se/resurser/License#by-nc' },
        'ns1:highresSource': 'https://example.org/a.jpg',
      },
    ],
  };
  assert.equal(normalize(record), null);
});

test('ksamsok normalize returns null without an image or an entity', () => {
  assert.equal(normalize({ '@graph': [] }), null);
  assert.equal(
    normalize({
      '@graph': [{ '@type': 'ns1:Entity', '@id': 'http://kulturarvsdata.se/X/photo/1' }],
    }),
    null,
  );
});

test('ksamsok search builds the search URL', async () => {
  let requested = '';
  let headers = {};
  const fake = async (url, opts = {}) => {
    requested = url;
    headers = opts.headers ?? {};
    return fixture.search;
  };

  const result = await search('moon', 2, { fetchJson: fake });
  assert.equal(result.items.length, 2);

  const params = new URL(requested).searchParams;
  assert.equal(params.get('method'), 'search');
  assert.equal(
    params.get('query'),
    'text=moon and thumbnailExists=j and (mediaLicense="http://kulturarvsdata.se/resurser/License#pdmark" or mediaLicense="http://kulturarvsdata.se/resurser/License#cc0" or mediaLicense="http://kulturarvsdata.se/resurser/License#by" or mediaLicense="http://kulturarvsdata.se/resurser/License#by-sa")',
  );
  assert.equal(params.get('startRecord'), '25');
  assert.equal(params.get('hitsPerPage'), '24');
  assert.equal(new URL(requested).host, 'kulturarvsdata.se');
  assert.equal(headers.Accept, 'application/json');
});

test('ksamsok resolveDownload reads the record answer', async () => {
  let requested = '';
  let headers = {};
  const fake = async (url, opts = {}) => {
    requested = url;
    headers = opts.headers ?? {};
    return fixture.record;
  };

  const resolved = await resolveDownload('S-TEK/photo/TEKA0164922', { fetchJson: fake });
  assert.equal(requested, 'https://kulturarvsdata.se/S-TEK/photo/TEKA0164922');
  assert.equal(resolved.url, 'https://ems.dimu.org/image/069EJVgVTCBUL?dimension=max');
  assert.equal(resolved.filename, 'Text på baksida "Moon"');
  assert.equal(headers.Accept, 'application/json');
});

test('ksamsok resolveDownload rejects a bad id without a request', async () => {
  let called = false;
  const fake = async () => {
    called = true;
    return fixture.record;
  };
  await assert.rejects(resolveDownload('../x', { fetchJson: fake }), (err) => err.status === 400);
  assert.equal(called, false);
});

test('ksamsok resolveDownload rejects a record without an open image', async () => {
  await assert.rejects(
    resolveDownload('S-TEK/photo/TEKA0164922', {
      fetchJson: async () => ({ '@graph': [] }),
    }),
    /K-samsök record has no open image/,
  );
});
