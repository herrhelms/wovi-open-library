import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  createDjangoplicitySource,
  SEARCH_TIMEOUT_MS,
  ITEM_TIMEOUT_MS,
  parseFormats,
  parseImageList,
  parseTotal,
  pickDownload,
} from '../lib/sources/djangoplicity.js';
import * as hubble from '../lib/sources/esa-hubble.js';
import * as webb from '../lib/sources/esa-webb.js';
import * as eso from '../lib/sources/eso.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(here, 'fixtures', name), 'utf8');

const hubbleHtml = fixture('djangoplicity-hubble.html');
const esoHtml = fixture('djangoplicity-eso.html');
const webbItemHtml = fixture('djangoplicity-item-webb.html');
const hubbleItemHtml = fixture('djangoplicity-item-hubble.html');

test('parseImageList reads the live Hubble list', () => {
  const list = parseImageList(hubbleHtml);
  assert.equal(list.length, 3);
  assert.equal(list[0].id, 'heic2017a');
  assert.equal(list[0].title, "Hubble's View of Jupiter and Europa in August 2020");
  assert.equal(list[0].width, 1663);
  assert.equal(typeof list[0].width, 'number');
});

test('parseImageList decodes escapes and accepts both trailing comma forms', () => {
  const escaped = parseImageList("var images = [ { id: 'a', title: 'It\\'s a test', width: 1, height: 2, src: 's', url: 'u', potw: '' } ];");
  assert.equal(escaped[0].title, "It's a test");

  const noTrailing = 'var images = [\n  { id: \'b\', title: \'B\', width: 1, height: 2, src: \'s\', url: \'u\', potw: \'\' }\n];';
  assert.equal(parseImageList(noTrailing).length, 1);

  const withTrailing = 'var images = [\n  { id: \'c\', title: \'C\', width: 1, height: 2, src: \'s\', url: \'u\', potw: \'\' },\n];';
  assert.equal(parseImageList(withTrailing).length, 1);
});

test('parseImageList returns [] without a list', () => {
  assert.deepEqual(parseImageList('<html>no list here</html>'), []);
});

test('parseImageList keeps complete objects before a cut', () => {
  const cut = "var images = [\n  { id: 'a', title: 'A', width: 1, height: 2, src: 's', url: 'u', potw: '' },\n  { id: 'b', title: 'B', wid";
  const list = parseImageList(cut);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'a');
});

test('parseTotal reads the status line', () => {
  assert.equal(parseTotal('Showing 1 to 50 of 314'), 314);
  assert.equal(parseTotal('Showing 1 to 50 of 572'), 572);
  assert.equal(parseTotal('nothing'), null);
});

test('esa-hubble normalize makes an Item', () => {
  const entry = parseImageList(hubbleHtml)[0];
  const item = hubble.normalize(entry);
  assert.equal(item.id, 'heic2017a');
  assert.equal(item.title, "Hubble's View of Jupiter and Europa in August 2020");
  assert.equal(item.thumb, entry.src);
  assert.equal(item.preview, 'https://cdn.esahubble.org/archives/images/large/heic2017a.jpg');
  assert.equal(item.previewFallback, 'https://cdn.esahubble.org/archives/images/screen/heic2017a.jpg');
  assert.equal(item.full, null);
  assert.equal(item.pageUrl, 'https://esahubble.org/images/heic2017a/');
  assert.equal(item.license, 'CC BY 4.0');
  assert.equal(item.creator, 'ESA/Hubble');
  assert.equal(item.width, 1663);
  assert.equal(item.height, 1375);
});

test('normalize uses publicationjpg for a width above 4000', () => {
  const item = hubble.normalize({ id: 'abc123', title: 'Large', width: 6000, height: 4000 });
  assert.equal(item.preview, 'https://cdn.esahubble.org/archives/images/publicationjpg/abc123.jpg');
  assert.equal(item.previewFallback, 'https://cdn.esahubble.org/archives/images/screen/abc123.jpg');
});

test('normalize uses large for a width of 4000 or less', () => {
  const item = eso.normalize({ id: 'eso42', title: 'Small', width: 3000, height: 2000 });
  assert.equal(item.preview, 'https://cdn.eso.org/images/large/eso42.jpg');
  assert.equal(item.previewFallback, 'https://cdn.eso.org/images/screen/eso42.jpg');
});

test('normalize uses screen when the width is missing', () => {
  const item = eso.normalize({ id: 'eso43', title: 'Unknown' });
  assert.equal(item.preview, 'https://cdn.eso.org/images/screen/eso43.jpg');
  assert.equal(item.previewFallback, undefined);
});

test('eso normalize makes an Item', () => {
  const entry = parseImageList(esoHtml)[0];
  const item = eso.normalize(entry);
  assert.equal(item.preview, 'https://cdn.eso.org/images/publicationjpg/eso1907a.jpg');
  assert.equal(item.previewFallback, 'https://cdn.eso.org/images/screen/eso1907a.jpg');
  assert.ok(item.pageUrl.startsWith('https://www.eso.org/public/images/'));
  assert.equal(item.creator, 'ESO');
});

test('search URLs use the djangoplicity paths', () => {
  const webbFactory = createDjangoplicitySource({
    id: 'esa-webb',
    name: 'ESA/Webb',
    homepage: 'https://esawebb.org',
    origin: 'https://esawebb.org',
    imagesPath: '/images/',
    cdn: 'https://cdn.esawebb.org/archives/images/',
    creator: 'ESA/Webb',
  });
  assert.equal(webbFactory.buildSearchUrl('moon', 1), 'https://esawebb.org/images/?search=moon');

  const esoFactory = createDjangoplicitySource({
    id: 'eso',
    name: 'ESO',
    homepage: 'https://www.eso.org',
    origin: 'https://www.eso.org',
    imagesPath: '/public/images/',
    cdn: 'https://cdn.eso.org/images/',
    creator: 'ESO',
  });
  assert.equal(esoFactory.buildSearchUrl('moon', 3), 'https://www.eso.org/public/images/page/3/?search=moon');
});

test('parseSearch sets hasMore from the list length', () => {
  const three = eso.parseSearch(esoHtml, 1);
  assert.equal(three.items.length, 3);
  assert.equal(three.hasMore, false);
  assert.equal(three.total, 572);

  const entries = [];
  for (let i = 0; i < 50; i += 1) {
    entries.push(`{ id: 'x${i}', title: 'X', width: 1, height: 2, src: 's', url: '/u/', potw: '' }`);
  }
  const fifty = `var images = [\n${entries.join(',\n')}\n];\nShowing 1 to 50 of 120`;
  const result = eso.parseSearch(fifty, 1);
  assert.equal(result.items.length, 50);
  assert.equal(result.hasMore, true);
  assert.equal(result.total, 120);
});

test('parseFormats and pickDownload choose the large JPEG (Webb)', () => {
  const formats = parseFormats(webbItemHtml, 'https://esawebb.org');
  assert.ok(formats.length > 0);
  assert.equal(pickDownload(formats), 'https://cdn.esawebb.org/archives/images/large/potm2504a.jpg');
});

test('parseFormats and pickDownload choose the large JPEG (Hubble)', () => {
  const formats = parseFormats(hubbleItemHtml, 'https://esahubble.org');
  assert.equal(pickDownload(formats), 'https://cdn.esahubble.org/archives/images/large/heic2017a.jpg');
});

test('pickDownload falls back to publicationjpg then screen', () => {
  const publication = [
    { url: 'https://cdn.example.org/publicationjpg/x.jpg', label: 'Publication JPEG' },
    { url: 'https://cdn.example.org/screen/x.jpg', label: 'Screensize JPEG' },
  ];
  assert.equal(pickDownload(publication), 'https://cdn.example.org/publicationjpg/x.jpg');

  const screen = [{ url: 'https://cdn.example.org/screen/x.jpg', label: 'Screensize JPEG' }];
  assert.equal(pickDownload(screen), 'https://cdn.example.org/screen/x.jpg');

  assert.equal(pickDownload([]), null);
});

test('parseFormats makes relative hrefs absolute', () => {
  const html =
    '<div class="archive_download"><span class="archive_dl_text"><a href="/media/archives/images/original/x.tif">Fullsize Original</a></span></div>';
  const formats = parseFormats(html, 'https://www.eso.org');
  assert.equal(formats[0].url, 'https://www.eso.org/media/archives/images/original/x.tif');
  assert.equal(formats[0].label, 'Fullsize Original');
});

test('search uses the longer timeout', async () => {
  let options;
  const fake = async (_url, opts) => {
    options = opts;
    return { status: 200, text: async () => hubbleHtml };
  };
  await hubble.search('moon', 1, { fetch: fake });
  assert.equal(SEARCH_TIMEOUT_MS, 45000);
  assert.equal(options.timeoutMs, 45000);
});

test('resolveDownload uses the item timeout', async () => {
  let options;
  const fake = async (_url, opts) => {
    options = opts;
    return { status: 200, text: async () => hubbleItemHtml };
  };
  await hubble.resolveDownload('heic2017a', { fetch: fake });
  assert.equal(ITEM_TIMEOUT_MS, 30000);
  assert.equal(options.timeoutMs, 30000);
});

test('resolveDownload rejects a bad id without a request', async () => {
  let called = false;
  const fake = async () => {
    called = true;
    return { status: 200, text: async () => '' };
  };
  await assert.rejects(hubble.resolveDownload('../x', { fetch: fake }), (err) => err.status === 400);
  assert.equal(called, false);
});

test('search rejects on a non-200 status', async () => {
  const fake = async () => ({ status: 503, text: async () => '' });
  await assert.rejects(eso.search('moon', 1, { fetch: fake }), /ESO answered HTTP 503/);
});

test('search cancels the body on a non-200 status', async () => {
  let cancelled = false;
  const fake = async () => ({
    status: 503,
    body: {
      cancel() {
        cancelled = true;
      },
    },
    text: async () => '',
  });
  await assert.rejects(eso.search('moon', 1, { fetch: fake }), /ESO answered HTTP 503/);
  assert.equal(cancelled, true);
});

test('resolveDownload cancels the body on a non-200 status', async () => {
  let cancelled = false;
  const fake = async () => ({
    status: 503,
    body: {
      cancel() {
        cancelled = true;
      },
    },
    text: async () => '',
  });
  await assert.rejects(
    webb.resolveDownload('potm2504a', { fetch: fake }),
    /ESA\/Webb answered HTTP 503/,
  );
  assert.equal(cancelled, true);
});

test('resolveDownload returns the picked URL', async () => {
  let requested = '';
  const fake = async (url) => {
    requested = url;
    return { status: 200, text: async () => webbItemHtml };
  };
  const resolved = await webb.resolveDownload('potm2504a', { fetch: fake });
  assert.equal(resolved.url, 'https://cdn.esawebb.org/archives/images/large/potm2504a.jpg');
  assert.equal(resolved.filename, 'potm2504a');
  assert.equal(requested, 'https://esawebb.org/images/potm2504a/');
});

for (const [label, mod, sourceId] of [
  ['esa-hubble', hubble, 'esa-hubble'],
  ['esa-webb', webb, 'esa-webb'],
  ['eso', eso, 'eso'],
]) {
  test(`${label} module shape`, () => {
    assert.equal(mod.id, sourceId);
    assert.equal(mod.group, 'science');
    assert.equal(mod.keyEnv, null);
    assert.equal(typeof mod.search, 'function');
    assert.equal(typeof mod.resolveDownload, 'function');
    assert.equal(typeof mod.normalize, 'function');
  });
}
