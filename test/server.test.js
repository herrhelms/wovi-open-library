import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createUpstream } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createServer } from '../server.js';
import { mediaIdFor } from '../lib/media-id.js';
import {
  ALLOWED_HOST_SUFFIXES,
  extFromContentType,
  isAllowedHost,
  safeFilename,
} from '../lib/download.js';

const IMAGE_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x42]);

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function rawRequest(port, path, method = 'GET') {
  return new Promise((resolve, reject) => {
    import('node:http').then(({ request }) => {
      const req = request(
        { host: '127.0.0.1', port, path, method },
        (res) => {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () =>
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: Buffer.concat(chunks).toString('utf8'),
            }),
          );
        },
      );
      req.on('error', reject);
      req.end();
    });
  });
}

function makeSources(upstreamBase) {
  const makeStub = (id, keyEnv = null, extra = {}) => ({
    id,
    name: id,
    homepage: `https://example.org/${id}`,
    keyEnv,
    ...extra,
    async search() {
      throw new Error(`${id}: not implemented`);
    },
    normalize(raw) {
      return raw;
    },
  });

  const ok = makeStub('ok');
  ok.search = async () => ({
    total: 1,
    hasMore: false,
    items: [{ id: '1', title: 'T' }],
  });

  const bad = makeStub('bad');
  bad.search = async () => {
    throw new Error('Upstream down');
  };

  const keyed = makeStub('keyed', 'TEST_KEY_X');
  const optional = makeStub('optional', 'TEST_OPTIONAL_KEY', { keyOptional: true });

  const missingCalls = { search: 0 };
  const needkey = makeStub('needkey', 'TEST_MISSING_KEY');
  needkey.search = async () => {
    missingCalls.search += 1;
    return { total: 0, hasMore: false, items: [] };
  };
  const resolveCalls = { count: 0 };
  needkey.resolveDownload = async () => {
    resolveCalls.count += 1;
    return { url: `${upstreamBase}/x.jpg` };
  };

  const met = makeStub('met');

  const nasa = makeStub('nasa');
  nasa.resolveDownload = async () => ({ url: `${upstreamBase}/x.jpg` });

  const europeana = makeStub('europeana', 'EUROPEANA_KEY', { keyOptional: true });
  europeana.trustResolvedUrl = true;
  europeana.resolveDownload = async (id) => ({ url: `${upstreamBase}/image/${id}` });

  const openverse = makeStub('openverse');
  openverse.trustResolvedUrl = true;
  openverse.resolveDownload = async (id) => ({ url: `${upstreamBase}/x.jpg` });

  return {
    sources: [ok, bad, keyed, optional, needkey, met, nasa, europeana, openverse],
    missingCalls,
    resolveCalls,
  };
}

const GROUPS_FIXTURE = [
  { id: 'aggregators', label: 'Open-licence aggregators' },
  { id: 'museums', label: 'Museums and galleries' },
];

function makeSourceList(upstreamBase) {
  return makeSources(upstreamBase).sources;
}

async function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'olf-server-'));
  const publicDir = join(root, 'public');
  mkdirSync(publicDir);
  writeFileSync(join(publicDir, 'index.html'), '<h1>hi</h1>');
  writeFileSync(join(publicDir, 'app.js'), 'console.log(1);');
  writeFileSync(join(publicDir, 'styles.css'), 'body {}');
  writeFileSync(join(root, 'secret.txt'), 'TOP-SECRET');

  const upstream = createUpstream((req, res) => {
    if (req.url === '/x.jpg' || req.url.startsWith('/image/')) {
      res.writeHead(200, {
        'Content-Type': 'image/jpeg',
        'Content-Length': IMAGE_BYTES.length,
      });
      res.end(IMAGE_BYTES);
      return;
    }
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: '/image/a' });
      res.end();
      return;
    }
    if (req.url === '/html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html>not an image</html>');
      return;
    }
    if (req.url === '/noct.jpg' || req.url === '/noct') {
      res.writeHead(200, { 'Content-Length': IMAGE_BYTES.length });
      res.end(IMAGE_BYTES);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  });

  const upstreamPort = await listen(upstream);
  const upstreamBase = `http://127.0.0.1:${upstreamPort}`;

  const thumbCacheDir = join(root, 'thumb-cache');
  const thumbFetchCalls = [];
  const thumbFetch = async (url) => {
    thumbFetchCalls.push(url);
    return new Response(IMAGE_BYTES, {
      status: 200,
      headers: { 'content-type': 'image/jpeg' },
    });
  };

  const server = createServer({
    publicDir,
    sourcesOverride: makeSourceList(upstreamBase),
    settingsDbPath: ':memory:',
    thumbCacheDir,
    thumbFetch,
  });
  const port = await listen(server);
  const base = `http://127.0.0.1:${port}`;

  return {
    root,
    publicDir,
    upstream,
    upstreamBase,
    server,
    port,
    base,
    thumbCacheDir,
    thumbFetch,
    thumbFetchCalls,
    async cleanup() {
      await close(server);
      await close(upstream);
      rmSync(root, { recursive: true, force: true });
    },
  };
}

const fixture = await createFixture();
test.after(async () => {
  await fixture.cleanup();
});

test('isAllowedHost', () => {
  assert.equal(isAllowedHost('images.metmuseum.org'), true);
  assert.equal(isAllowedHost('metmuseum.org'), true);
  assert.equal(isAllowedHost('METMUSEUM.ORG'), true);
  assert.equal(isAllowedHost('evilmetmuseum.org'), false);
  assert.equal(isAllowedHost('metmuseum.org.evil.com'), false);
  assert.equal(isAllowedHost('openaccess-cdn.clevelandart.org'), true);
  assert.equal(isAllowedHost('iip.smk.dk'), true);
  assert.equal(isAllowedHost('1.api.artsmia.org'), true);
  assert.equal(isAllowedHost('iiif.wellcomecollection.org'), true);
  assert.equal(isAllowedHost('evilsmk.dk'), false);
  assert.equal(isAllowedHost('inaturalist-open-data.s3.amazonaws.com'), true);
  assert.equal(isAllowedHost('evil.s3.amazonaws.com'), false);
  assert.equal(isAllowedHost('amazonaws.com'), false);
  assert.equal(isAllowedHost('media.getty.edu'), true);
  assert.equal(isAllowedHost('cdn.esahubble.org'), true);
  assert.equal(isAllowedHost('cdn.eso.org'), true);
  assert.equal(isAllowedHost('live.staticflickr.com'), true);
  assert.equal(isAllowedHost('www.artic.edu'), false);
  assert.equal(isAllowedHost('data.nhm.ac.uk'), true);
  assert.equal(isAllowedHost('www.nb.no'), true);
  assert.equal(isAllowedHost('iiif.digitalcommonwealth.org'), true);
  assert.equal(isAllowedHost('media.artmuseum.princeton.edu'), true);
  assert.equal(isAllowedHost('media.davidrumsey.com'), true);
  assert.equal(isAllowedHost('cdn.pixabay.com'), true);
  assert.equal(isAllowedHost('images.pexels.com'), true);
  assert.equal(isAllowedHost('images.unsplash.com'), true);
  assert.equal(isAllowedHost('nrs.harvard.edu'), true);
  assert.equal(isAllowedHost('smithsonian-open-access.s3-us-west-2.amazonaws.com'), true);
  assert.equal(isAllowedHost('SMITHSONIAN-OPEN-ACCESS.S3-US-WEST-2.AMAZONAWS.COM'), true);
  assert.equal(isAllowedHost('other-bucket.s3-us-west-2.amazonaws.com'), false);
  assert.equal(isAllowedHost('s3-us-west-2.amazonaws.com'), false);
  assert.equal(isAllowedHost('smithsonian-open-access.s3-us-west-2.amazonaws.com.evil.com'), false);
  assert.equal(isAllowedHost('princeton.edu'), false);
  assert.equal(isAllowedHost('evil-nb.no'), false);
  assert.equal(isAllowedHost('nb.no.evil.com'), false);
  assert.equal(isAllowedHost('127.0.0.1'), false);
  assert.equal(isAllowedHost('localhost'), false);
  assert.equal(isAllowedHost(''), false);
  assert.ok(ALLOWED_HOST_SUFFIXES.includes('wikimedia.org'));
});

test('extFromContentType', () => {
  assert.equal(extFromContentType('image/jpeg', '/a'), 'jpg');
  assert.equal(extFromContentType('image/jpeg; charset=utf-8', '/a'), 'jpg');
  assert.equal(extFromContentType('image/png', '/a'), 'png');
  assert.equal(extFromContentType('image/tiff', '/a'), 'tif');
  assert.equal(extFromContentType('image/jp2', '/a'), 'jp2');
  assert.equal(extFromContentType('image/jpx', '/a'), 'jp2');
  assert.equal(extFromContentType('image/gif', '/a'), 'gif');
  assert.equal(extFromContentType('image/webp', '/a'), 'webp');
  assert.equal(extFromContentType('application/octet-stream', '/x/foto.jpeg'), 'jpeg');
  assert.equal(extFromContentType('application/octet-stream', '/x/foto'), 'bin');
});

test('safeFilename', () => {
  assert.equal(
    safeFilename('met', 'Wheat Field / Cypresses', 'jpg'),
    'met-Wheat-Field-Cypresses.jpg',
  );
  assert.equal(safeFilename('nasa', '', 'jpg'), 'nasa-item.jpg');
  assert.equal(safeFilename('x', 'Café déjà vu', 'png'), 'x-Cafe-deja-vu.png');
  assert.equal(safeFilename('x', 'a'.repeat(200), 'jpg').length <= 4 + 80 + 4, true);
});

test('GET /api/sources', async () => {
  process.env.TEST_KEY_X = 'secret-value';
  try {
    const res = await fetch(`${fixture.base}/api/sources`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const text = await res.text();
    assert.ok(!text.includes('secret-value'));
    const data = JSON.parse(text);
    assert.ok(Array.isArray(data));
    assert.equal(data.length, 9);
    const keyed = data.find((entry) => entry.id === 'keyed');
    assert.equal(keyed.needsKey, true);
    assert.equal(keyed.keyConfigured, true);
    assert.equal(keyed.keyEnv, 'TEST_KEY_X');
    assert.equal(keyed.group, null);
    const ok = data.find((entry) => entry.id === 'ok');
    assert.equal(ok.needsKey, false);
    assert.equal(ok.keyConfigured, true);
    assert.equal(ok.keyEnv, null);
    const optional = data.find((entry) => entry.id === 'optional');
    assert.equal(optional.needsKey, false);
    assert.equal(optional.keyEnv, null);
    const needkey = data.find((entry) => entry.id === 'needkey');
    assert.equal(needkey.needsKey, true);
    assert.equal(needkey.keyConfigured, false);
    assert.equal(needkey.keyEnv, 'TEST_MISSING_KEY');
  } finally {
    delete process.env.TEST_KEY_X;
  }
});

test('GET /api/sources sends group', async () => {
  const sources = makeSourceList(fixture.upstreamBase).map((source) =>
    source.id === 'ok' ? { ...source, group: 'museums' } : source,
  );
  await withServer(sources, async (base) => {
    const data = await (await fetch(`${base}/api/sources`)).json();
    assert.equal(data.find((entry) => entry.id === 'ok').group, 'museums');
  });
});

test('GET /api/groups', async () => {
  const server = createServer({
    publicDir: fixture.publicDir,
    sourcesOverride: makeSourceList(fixture.upstreamBase),
    groupsOverride: GROUPS_FIXTURE,
    settingsDbPath: ':memory:',
    thumbCacheDir: fixture.thumbCacheDir,
    thumbFetch: fixture.thumbFetch,
  });
  const port = await listen(server);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/groups`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), GROUPS_FIXTURE);
  } finally {
    await close(server);
  }
});

test('GET /api/search errors', async () => {
  for (const path of [
    '/api/search?source=nope&q=x',
    '/api/search?source=ok&q=',
    '/api/search?source=ok&q=%20%20',
  ]) {
    const res = await fetch(`${fixture.base}${path}`);
    assert.equal(res.status, 400, path);
    const data = await res.json();
    assert.equal(typeof data.error, 'string');
  }
});

test('GET /api/search success and page fallback', async () => {
  const res = await fetch(`${fixture.base}/api/search?source=ok&q=moon`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.source, 'ok');
  assert.equal(data.page, 1);
  assert.equal(data.items.length, 1);

  const fallback = await fetch(`${fixture.base}/api/search?source=ok&q=moon&page=abc`);
  assert.equal(fallback.status, 200);
  assert.equal((await fallback.json()).page, 1);
});

test('GET /api/search needs a key', async () => {
  const built = makeSources(fixture.upstreamBase);
  delete process.env.TEST_MISSING_KEY;
  await withServer(built.sources, async (base) => {
    const res = await fetch(`${base}/api/search?source=needkey&q=moon`);
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.code, 'NEEDS_KEY');
    assert.equal(data.error, 'needkey needs TEST_MISSING_KEY in .env');
  });
  assert.equal(built.missingCalls.search, 0);
});

test('GET /api/download needs a key', async () => {
  const built = makeSources(fixture.upstreamBase);
  delete process.env.TEST_MISSING_KEY;
  await withServer(built.sources, async (base) => {
    const res = await fetch(`${base}/api/download?source=needkey&id=1`);
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.code, 'NEEDS_KEY');
  });
  assert.equal(built.resolveCalls.count, 0);
});

test('GET /api/search upstream error', async () => {
  const res = await fetch(`${fixture.base}/api/search?source=bad&q=moon`);
  assert.equal(res.status, 502);
  const data = await res.json();
  assert.equal(data.error, 'Upstream down');
});

test('GET /api/search sends retryAfterSeconds for a rate limit', async () => {
  const message = 'Wikimedia Commons rate limit reached. Try again in a minute.';
  const fake = fakeSource('fake', {
    searchResult: () => {
      const err = new Error(message);
      err.code = 'RATE_LIMIT';
      err.retryAfterSeconds = 12;
      throw err;
    },
  });
  await withServer([fake.source], async (base) => {
    const res = await fetch(`${base}/api/search?source=fake&q=moon`);
    assert.equal(res.status, 502);
    assert.deepEqual(await res.json(), {
      error: message,
      code: 'RATE_LIMIT',
      retryAfterSeconds: 12,
    });
  });
});

test('GET /api/search leaves out retryAfterSeconds without a number', async () => {
  const fake = fakeSource('fake', {
    searchResult: () => {
      const err = new Error('Wikimedia Commons rate limit reached.');
      err.code = 'RATE_LIMIT';
      throw err;
    },
  });
  await withServer([fake.source], async (base) => {
    const res = await fetch(`${base}/api/search?source=fake&q=moon`);
    assert.equal(res.status, 502);
    const data = await res.json();
    assert.equal(data.code, 'RATE_LIMIT');
    assert.equal('retryAfterSeconds' in data, false);
  });
});

test('GET /api/download blocks bad hosts and schemes', async () => {
  for (const url of [
    'https://evil.example.com/x.jpg',
    'https://metmuseum.org.evil.com/x.jpg',
    `http://127.0.0.1:${fixture.port}/x.jpg`,
    'file:///etc/passwd',
  ]) {
    const res = await fetch(
      `${fixture.base}/api/download?source=met&id=1&url=${encodeURIComponent(url)}`,
    );
    assert.equal(res.status, 400, url);
    const data = await res.json();
    assert.ok(typeof data.error === 'string');
  }
});

test('GET /api/download without url or resolveDownload', async () => {
  const res = await fetch(`${fixture.base}/api/download?source=met&id=1`);
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'No download URL');
});

test('GET /api/download checks resolveDownload results too', async () => {
  const res = await fetch(
    `${fixture.base}/api/download?source=nasa&id=1&title=${encodeURIComponent('Moon é')}`,
  );
  assert.equal(res.status, 400);
});

test('GET /api/download europeana ignores url and streams', async () => {
  const res = await fetch(
    `${fixture.base}/api/download?source=europeana&id=${encodeURIComponent('a/b')}&url=${encodeURIComponent('https://evil.example.com/x.jpg')}`,
  );
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/jpeg');
  assert.equal(
    res.headers.get('content-disposition'),
    'attachment; filename="europeana-a-b.jpg"',
  );
  assert.equal(res.headers.get('content-length'), String(IMAGE_BYTES.length));
  const body = Buffer.from(await res.arrayBuffer());
  assert.deepEqual(body, IMAGE_BYTES);
});

test('GET /api/download europeana rejects non-images', async () => {
  const sources = makeSourceList(fixture.upstreamBase).map((source) =>
    source.id === 'europeana'
      ? {
          ...source,
          resolveDownload: async () => ({ url: `${fixture.upstreamBase}/html` }),
        }
      : source,
  );
  const server = createServer({
    publicDir: fixture.publicDir,
    sourcesOverride: sources,
    settingsDbPath: ':memory:',
    thumbCacheDir: fixture.thumbCacheDir,
    thumbFetch: fixture.thumbFetch,
  });
  const port = await listen(server);
  try {
    const res = await fetch(
      `http://127.0.0.1:${port}/api/download?source=europeana&id=a`,
    );
    assert.equal(res.status, 502);
    assert.match((await res.json()).error, /not an image/);
  } finally {
    await close(server);
  }
});

test('GET /api/download europeana follows redirects', async () => {
  const sources = makeSourceList(fixture.upstreamBase).map((source) =>
    source.id === 'europeana'
      ? {
          ...source,
          resolveDownload: async () => ({ url: `${fixture.upstreamBase}/redirect` }),
        }
      : source,
  );
  const server = createServer({
    publicDir: fixture.publicDir,
    sourcesOverride: sources,
    settingsDbPath: ':memory:',
    thumbCacheDir: fixture.thumbCacheDir,
    thumbFetch: fixture.thumbFetch,
  });
  const port = await listen(server);
  try {
    const res = await fetch(
      `http://127.0.0.1:${port}/api/download?source=europeana&id=a`,
    );
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/jpeg');
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), IMAGE_BYTES);
  } finally {
    await close(server);
  }
});

test('static files and content types', async () => {
  const index = await fetch(`${fixture.base}/`);
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type'), /^text\/html/);
  assert.ok((await index.text()).includes('<h1>hi</h1>'));

  const js = await fetch(`${fixture.base}/app.js`);
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type'), /^text\/javascript/);

  const css = await fetch(`${fixture.base}/styles.css`);
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type'), /^text\/css/);

  const missing = await fetch(`${fixture.base}/missing.html`);
  assert.equal(missing.status, 404);
});

test('path traversal is blocked', async () => {
  for (const path of ['/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt']) {
    const res = await rawRequest(fixture.port, path);
    assert.ok(res.status === 403 || res.status === 404, `${path} -> ${res.status}`);
    assert.ok(!res.body.includes('TOP-SECRET'));
  }
});

test('POST is not allowed', async () => {
  const res = await fetch(`${fixture.base}/api/sources`, { method: 'POST' });
  assert.equal(res.status, 405);
});

async function withServer(sources, fn, extra = {}) {
  const server = createServer({
    publicDir: fixture.publicDir,
    sourcesOverride: sources,
    settingsDbPath: ':memory:',
    thumbCacheDir: fixture.thumbCacheDir,
    thumbFetch: fixture.thumbFetch,
    ...extra,
  });
  const port = await listen(server);
  try {
    await fn(`http://127.0.0.1:${port}`, port);
  } finally {
    await close(server);
  }
}

test('GET /api/download openverse needs an id', async () => {
  const res = await fetch(
    `${fixture.base}/api/download?source=openverse&url=${encodeURIComponent('https://evil.example.com/x.jpg')}`,
  );
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'Missing id');
});

test('GET /api/download openverse ignores url and streams', async () => {
  const res = await fetch(
    `${fixture.base}/api/download?source=openverse&id=abc&url=${encodeURIComponent('https://evil.example.com/x.jpg')}`,
  );
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/jpeg');
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), IMAGE_BYTES);
});

test('GET /api/download does not hard-code the europeana id', async () => {
  const sources = makeSourceList(fixture.upstreamBase).map((source) =>
    source.id === 'europeana'
      ? { ...source, trustResolvedUrl: undefined }
      : source,
  );
  await withServer(sources, async (base) => {
    const res = await fetch(
      `${base}/api/download?source=europeana&id=1&url=${encodeURIComponent('https://evil.example.com/x.jpg')}`,
    );
    assert.equal(res.status, 400);
  });
});

test('GET /api/download accepts a missing Content-Type with an image extension', async () => {
  const sources = makeSourceList(fixture.upstreamBase).map((source) =>
    source.id === 'openverse'
      ? {
          ...source,
          resolveDownload: async () => ({ url: `${fixture.upstreamBase}/noct.jpg` }),
        }
      : source,
  );
  await withServer(sources, async (base) => {
    const res = await fetch(`${base}/api/download?source=openverse&id=abc`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/jpeg');
    assert.match(res.headers.get('content-disposition'), /\.jpg"$/);
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), IMAGE_BYTES);
  });
});

test('GET /api/download rejects a missing Content-Type without a known extension', async () => {
  const sources = makeSourceList(fixture.upstreamBase).map((source) =>
    source.id === 'openverse'
      ? {
          ...source,
          resolveDownload: async () => ({ url: `${fixture.upstreamBase}/noct` }),
        }
      : source,
  );
  await withServer(sources, async (base) => {
    const res = await fetch(`${base}/api/download?source=openverse&id=abc`);
    assert.equal(res.status, 502);
    assert.match((await res.json()).error, /not an image/);
  });
});

function fakeSource(id, { searchResult, openLicenses, ...rest } = {}) {
  const calls = [];
  const source = {
    id,
    name: id,
    homepage: `https://example.org/${id}`,
    async search(q, page, deps) {
      calls.push({ q, page, deps, args: arguments.length });
      const result =
        typeof searchResult === 'function'
          ? searchResult(q, page, deps)
          : searchResult;
      return result ?? { total: 0, hasMore: false, items: [] };
    },
    ...rest,
  };
  if (openLicenses !== undefined) source.openLicenses = openLicenses;
  return { source, calls };
}

test('GET /api/sources sends openLicenses', async () => {
  const plain = fakeSource('plain');
  const limited = fakeSource('limited', { openLicenses: false });
  await withServer([plain.source, limited.source], async (base) => {
    const data = await (await fetch(`${base}/api/sources`)).json();
    assert.equal(data.find((entry) => entry.id === 'plain').openLicenses, true);
    assert.equal(data.find((entry) => entry.id === 'limited').openLicenses, false);
  });
});

test('GET /api/search sets open without the filter', async () => {
  const fake = fakeSource('fake', {
    searchResult: {
      total: 2,
      hasMore: true,
      items: [
        { id: '1', license: 'CC0', licenseUrl: null },
        { id: '2', license: 'In Copyright', licenseUrl: null },
      ],
    },
  });
  await withServer([fake.source], async (base) => {
    const data = await (await fetch(`${base}/api/search?source=fake&q=moon`)).json();
    assert.deepEqual(data.items.map((item) => item.open), [true, false]);
    assert.equal(data.total, 2);
    assert.equal(data.hasMore, true);
    assert.equal(fake.calls.length, 1);
    assert.equal(fake.calls[0].args <= 2 || fake.calls[0].deps?.openOnly !== true, true);
  });
});

test('GET /api/search keeps open set by the module', async () => {
  const fake = fakeSource('fake', {
    searchResult: {
      total: 1,
      hasMore: false,
      items: [{ id: '1', license: 'CC0', open: false }],
    },
  });
  await withServer([fake.source], async (base) => {
    const data = await (await fetch(`${base}/api/search?source=fake&q=moon`)).json();
    assert.equal(data.items[0].open, false);
  });
});

test('GET /api/search filters with open=1', async () => {
  const fake = fakeSource('fake', {
    searchResult: {
      total: 3,
      hasMore: true,
      items: [
        { id: '1', license: 'CC0' },
        { id: '2', license: 'In Copyright' },
        { id: '3', license: 'CC BY 4.0' },
      ],
    },
  });
  await withServer([fake.source], async (base) => {
    const data = await (await fetch(`${base}/api/search?source=fake&q=moon&open=1`)).json();
    assert.equal(fake.calls.length, 1);
    assert.equal(fake.calls[0].deps.openOnly, true);
    assert.deepEqual(data.items.map((item) => item.id), ['1', '3']);
    assert.equal(data.total, null);
    assert.equal(data.hasMore, true);
  });
});

test('GET /api/search keeps total with open=1 when nothing is removed', async () => {
  const fake = fakeSource('fake', {
    searchResult: {
      total: 2,
      hasMore: false,
      items: [
        { id: '1', license: 'CC0' },
        { id: '2', license: 'Public domain' },
      ],
    },
  });
  await withServer([fake.source], async (base) => {
    const data = await (await fetch(`${base}/api/search?source=fake&q=moon&open=1`)).json();
    assert.equal(data.total, 2);
  });
});

test('GET /api/search skips a source without licence data with open=1', async () => {
  const fake = fakeSource('limited', {
    openLicenses: false,
    searchResult: { total: 5, hasMore: true, items: [{ id: '1', license: 'CC0' }] },
  });
  await withServer([fake.source], async (base) => {
    const res = await fetch(`${base}/api/search?source=limited&q=moon&open=1`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.total, 0);
    assert.equal(data.hasMore, false);
    assert.deepEqual(data.items, []);
    assert.equal(data.excluded, 'open');
    assert.equal(fake.calls.length, 0);
  });
});

test('GET /api/search treats open=0 like no filter', async () => {
  const fake = fakeSource('fake', {
    searchResult: {
      total: 2,
      hasMore: false,
      items: [
        { id: '1', license: 'CC0' },
        { id: '2', license: 'In Copyright' },
      ],
    },
  });
  await withServer([fake.source], async (base) => {
    const data = await (await fetch(`${base}/api/search?source=fake&q=moon&open=0`)).json();
    assert.equal(fake.calls[0].deps, undefined);
    assert.deepEqual(data.items.map((item) => item.open), [true, false]);
    assert.equal(data.total, 2);
  });
});

test('GET /api/search caches identical requests and sends the header', async () => {
  let calls = 0;
  const fake = fakeSource('cached', {
    searchResult: () => {
      calls += 1;
      return { total: 1, hasMore: false, items: [{ id: '1' }] };
    },
  });
  await withServer([fake.source], async (base) => {
    const first = await fetch(`${base}/api/search?source=cached&q=moon`);
    assert.equal(first.headers.get('x-search-cache'), 'miss');
    const second = await fetch(`${base}/api/search?source=cached&q=moon`);
    assert.equal(second.headers.get('x-search-cache'), 'hit');
    assert.equal(calls, 1);
  });
});

test('GET /api/search caches page, open and q separately', async () => {
  let calls = 0;
  const fake = fakeSource('cached', {
    searchResult: () => {
      calls += 1;
      return { total: 1, hasMore: false, items: [{ id: '1', license: 'CC0' }] };
    },
  });
  await withServer([fake.source], async (base) => {
    await fetch(`${base}/api/search?source=cached&q=moon`);
    await fetch(`${base}/api/search?source=cached&q=moon&page=2`);
    await fetch(`${base}/api/search?source=cached&q=moon&open=1`);
    await fetch(`${base}/api/search?source=cached&q=sun`);
    assert.equal(calls, 4);
  });
});

test('GET /api/search expires the cache after the TTL', async () => {
  let clock = 0;
  let calls = 0;
  const fake = fakeSource('cached', {
    searchResult: () => {
      calls += 1;
      return { total: 1, hasMore: false, items: [{ id: '1' }] };
    },
  });
  const server = createServer({
    publicDir: fixture.publicDir,
    sourcesOverride: [fake.source],
    searchCacheTtlMs: 1000,
    settingsDbPath: ':memory:',
    now: () => clock,
    thumbCacheDir: fixture.thumbCacheDir,
    thumbFetch: fixture.thumbFetch,
  });
  const port = await listen(server);
  const base = `http://127.0.0.1:${port}`;
  try {
    await fetch(`${base}/api/search?source=cached&q=moon`);
    const hit = await fetch(`${base}/api/search?source=cached&q=moon`);
    assert.equal(hit.headers.get('x-search-cache'), 'hit');
    assert.equal(calls, 1);

    clock = 1000;
    const expired = await fetch(`${base}/api/search?source=cached&q=moon`);
    assert.equal(expired.headers.get('x-search-cache'), 'miss');
    assert.equal(calls, 2);
  } finally {
    await close(server);
  }
});

test('GET /api/search does not cache an error', async () => {
  let calls = 0;
  const fake = fakeSource('thrower', {
    searchResult: () => {
      calls += 1;
      throw new Error('Nope');
    },
  });
  await withServer([fake.source], async (base) => {
    const first = await fetch(`${base}/api/search?source=thrower&q=moon`);
    assert.equal(first.status, 502);
    const second = await fetch(`${base}/api/search?source=thrower&q=moon`);
    assert.equal(second.status, 502);
    assert.equal(calls, 2);
  });
});

test('GET /api/search does not change the cached raw items', async () => {
  const raw = { id: '1', thumb: 'https://img.example/a.jpg', license: 'CC0' };
  const result = { total: 1, hasMore: false, items: [raw] };
  const fake = fakeSource('cached', { searchResult: () => result });
  await withServer([fake.source], async (base) => {
    await fetch(`${base}/api/search?source=cached&q=moon`);
    await fetch(`${base}/api/search?source=cached&q=moon`);
    assert.equal(raw.uid, undefined);
    assert.equal(raw.mediaId, undefined);
    assert.equal(raw.thumbSource, undefined);
    assert.equal(raw.open, undefined);
    assert.deepEqual(raw, {
      id: '1',
      thumb: 'https://img.example/a.jpg',
      license: 'CC0',
    });
  });
});

test('GET /api/search adds uid, thumbSource and mediaId', async () => {
  const fake = fakeSource('ok', {
    searchResult: {
      total: 1,
      hasMore: false,
      items: [{ id: '1', thumb: 'http://img.example/a.jpg' }],
    },
  });
  await withServer([fake.source], async (base) => {
    const data = await (await fetch(`${base}/api/search?source=ok&q=moon`)).json();
    const item = data.items[0];
    assert.equal(item.uid, 'ok:1');
    assert.equal(item.thumbSource, 'http://img.example/a.jpg');
    assert.equal(item.mediaId, mediaIdFor('https://img.example/a.jpg'));
    assert.equal(item.thumb, 'http://img.example/a.jpg');
  });
});

test('GET /api/search drops duplicate uid and mediaId items', async () => {
  const fake = fakeSource('dup', {
    searchResult: {
      total: 4,
      hasMore: false,
      items: [
        { id: '1', thumb: 'https://x.example/a.jpg' },
        { id: '1', thumb: 'https://x.example/b.jpg' },
        { id: '2', thumb: 'http://x.example/a.jpg' },
        { id: '3', thumb: 'https://x.example/c.jpg' },
      ],
    },
  });
  await withServer([fake.source], async (base) => {
    const data = await (await fetch(`${base}/api/search?source=dup&q=moon`)).json();
    assert.deepEqual(data.items.map((item) => item.id), ['1', '3']);
    assert.equal(data.total, 4);
  });
});

test('GET /api/search keeps items without a thumb', async () => {
  const fake = fakeSource('nothumb', {
    searchResult: {
      total: 2,
      hasMore: false,
      items: [{ id: '1' }, { id: '2' }],
    },
  });
  await withServer([fake.source], async (base) => {
    const data = await (await fetch(`${base}/api/search?source=nothumb&q=moon`)).json();
    assert.deepEqual(data.items.map((item) => item.id), ['1', '2']);
    assert.equal(data.items[0].mediaId, null);
    assert.equal(data.items[0].thumbSource, null);
  });
});

test('GET /api/search excluded answer has no cache header', async () => {
  const fake = fakeSource('limited', {
    openLicenses: false,
    searchResult: { total: 5, hasMore: true, items: [{ id: '1', license: 'CC0' }] },
  });
  await withServer([fake.source], async (base) => {
    const res = await fetch(`${base}/api/search?source=limited&q=moon&open=1`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-search-cache'), null);
    assert.equal(fake.calls.length, 0);
  });
});

function validMediaId(seed) {
  return mediaIdFor(`https://img.example/${seed}.jpg`);
}

async function waitForThumb(base, mediaId, deadline = 2000) {
  const start = Date.now();
  while (Date.now() - start < deadline) {
    const res = await fetch(`${base}/api/thumb/${mediaId}`);
    if (res.ok) return res;
    await res.arrayBuffer();
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return fetch(`${base}/api/thumb/${mediaId}`);
}

test('POST /api/thumb warm for an unregistered ID is 404', async () => {
  const id = validMediaId('unregistered');
  const res = await fetch(`${fixture.base}/api/thumb/${id}/warm`, { method: 'POST' });
  assert.equal(res.status, 404);
  assert.equal(typeof (await res.json()).error, 'string');
  assert.equal(fixture.thumbFetchCalls.length, 0);
});

test('thumb routes validate the media ID', async () => {
  const badWarm = await fetch(`${fixture.base}/api/thumb/bad/warm`, { method: 'POST' });
  assert.equal(badWarm.status, 400);
  const badGet = await fetch(`${fixture.base}/api/thumb/bad`);
  assert.equal(badGet.status, 400);
  const unknown = validMediaId('unknown-route');
  const missing = await fetch(`${fixture.base}/api/thumb/${unknown}`);
  assert.equal(missing.status, 404);
  const warmGet = await fetch(`${fixture.base}/api/thumb/${unknown}/warm`);
  assert.equal(warmGet.status, 405);
});

test('thumb warm stores the image and serves it', async () => {
  const thumb = 'https://img.example/a.jpg';
  const id = mediaIdFor(thumb);
  const fake = fakeSource('thumbed', {
    searchResult: {
      total: 1,
      hasMore: false,
      items: [
        {
          id: '1',
          license: 'CC0',
          thumb,
          preview: thumb,
          previewFallback: thumb,
          thumbFallback: thumb,
          full: thumb,
        },
      ],
    },
  });
  await withServer([fake.source], async (base) => {
    const before = await (await fetch(`${base}/api/search?source=thumbed&q=moon`)).json();
    assert.equal(before.items[0].thumb, thumb);
    assert.equal(before.items[0].thumbCached, false);
    assert.equal(before.items[0].thumbSource, thumb);
    assert.equal(before.items[0].preview, thumb);

    const warm = await fetch(`${base}/api/thumb/${id}/warm`, { method: 'POST' });
    assert.equal(warm.status, 202);
    await warm.json();

    const served = await waitForThumb(base, id);
    assert.equal(served.status, 200);
    assert.equal(served.headers.get('content-type'), 'image/jpeg');
    assert.equal(served.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.equal(served.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(served.headers.get('content-length'), String(IMAGE_BYTES.length));
    assert.deepEqual(Buffer.from(await served.arrayBuffer()), IMAGE_BYTES);

    const head = await fetch(`${base}/api/thumb/${id}`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-length'), String(IMAGE_BYTES.length));
    assert.equal((await head.arrayBuffer()).byteLength, 0);

    const again = await fetch(`${base}/api/thumb/${id}/warm`, { method: 'POST' });
    assert.equal(again.status, 204);
    assert.equal((await again.arrayBuffer()).byteLength, 0);

    const after = await (await fetch(`${base}/api/search?source=thumbed&q=moon`)).json();
    assert.equal(after.items[0].thumb, `/api/thumb/${id}`);
    assert.equal(after.items[0].thumbCached, true);
    assert.equal(after.items[0].thumbSource, thumb);
    assert.equal(after.items[0].preview, thumb);
  });
});

test('POST on other routes stays 405', async () => {
  const res = await fetch(`${fixture.base}/api/sources`, { method: 'POST' });
  assert.equal(res.status, 405);
});

function postJson(port, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    import('node:http').then(({ request }) => {
      const payload = typeof body === 'string' ? body : JSON.stringify(body);
      const req = request(
        {
          host: '127.0.0.1',
          port,
          path,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
            ...headers,
          },
        },
        (res) => {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () =>
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: Buffer.concat(chunks).toString('utf8'),
            }),
          );
        },
      );
      req.on('error', reject);
      req.end(payload);
    });
  });
}

test('GET /api/groups uses the group list', async () => {
  await withServer(
    makeSourceList(fixture.upstreamBase),
    async (base) => {
      const data = await (await fetch(`${base}/api/groups`)).json();
      assert.deepEqual(data, GROUPS_FIXTURE);
    },
    { groupsOverride: GROUPS_FIXTURE },
  );
});

test('POST /api/adapters/<id> and GET /api/adapters', async () => {
  const sources = makeSourceList(fixture.upstreamBase);
  await withServer(
    sources,
    async (base, port) => {
      const res = await fetch(`${base}/api/adapters`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.deepEqual(data.groups, GROUPS_FIXTURE);
      assert.equal(data.adapters.length, sources.length);
      assert.deepEqual(data.invalid, []);
      for (const entry of data.adapters) {
        assert.equal(entry.enabled, true, entry.id);
        assert.equal(entry.defaultEnabled, true, entry.id);
        assert.equal(entry.description, null, entry.id);
        assert.equal(entry.docsUrl, null, entry.id);
        assert.equal(entry.base, null, entry.id);
        assert.deepEqual(entry.notes, [], entry.id);
      }

      const toggle = await postJson(port, '/api/adapters/ok', { enabled: false });
      assert.equal(toggle.status, 200);
      const toggled = JSON.parse(toggle.body);
      assert.equal(toggled.id, 'ok');
      assert.equal(toggled.enabled, false);

      const afterList = await (await fetch(`${base}/api/adapters`)).json();
      assert.equal(afterList.adapters.find((entry) => entry.id === 'ok').enabled, false);

      const sourcesAfter = await (await fetch(`${base}/api/sources`)).json();
      assert.equal(sourcesAfter.some((entry) => entry.id === 'ok'), false);

      const search = await fetch(`${base}/api/search?source=ok&q=x`);
      assert.equal(search.status, 404);
      assert.deepEqual(await search.json(), {
        error: 'Adaptor is deactivated',
        code: 'DISABLED',
      });

      const download = await fetch(`${base}/api/download?source=ok&id=1`);
      assert.equal(download.status, 404);
      assert.equal((await download.json()).code, 'DISABLED');

      const back = await postJson(port, '/api/adapters/ok', { enabled: true });
      assert.equal(back.status, 200);
      assert.equal(JSON.parse(back.body).enabled, true);
      const sourcesBack = await (await fetch(`${base}/api/sources`)).json();
      assert.equal(sourcesBack.some((entry) => entry.id === 'ok'), true);
    },
    { groupsOverride: GROUPS_FIXTURE },
  );
});

test('GET /api/adapters never sends a key value', async () => {
  process.env.TEST_KEY_X = 'secret-value';
  try {
    await withServer(makeSourceList(fixture.upstreamBase), async (base) => {
      const res = await fetch(`${base}/api/adapters`);
      const text = await res.text();
      assert.ok(!text.includes('secret-value'));
      const data = JSON.parse(text);
      const keyed = data.adapters.find((entry) => entry.id === 'keyed');
      assert.equal(keyed.key.configured, true);
      assert.equal(keyed.key.env, 'TEST_KEY_X');
      assert.equal(keyed.key.required, true);
      const optional = data.adapters.find((entry) => entry.id === 'optional');
      assert.equal(optional.key.required, false);
      const met = data.adapters.find((entry) => entry.id === 'met');
      assert.equal(met.key, null);
    });
  } finally {
    delete process.env.TEST_KEY_X;
  }
});

test('a source with defaultEnabled false is off at start', async () => {
  const off = { ...makeSourceList(fixture.upstreamBase)[0], id: 'off', config: { defaultEnabled: false } };
  await withServer([off], async (base) => {
    const sources = await (await fetch(`${base}/api/sources`)).json();
    assert.equal(sources.some((entry) => entry.id === 'off'), false);
    const data = await (await fetch(`${base}/api/adapters`)).json();
    const entry = data.adapters.find((item) => item.id === 'off');
    assert.equal(entry.enabled, false);
    assert.equal(entry.defaultEnabled, false);
  });
});

test('GET /api/adapters reports invalid folders from invalidOverride', async () => {
  await withServer(
    makeSourceList(fixture.upstreamBase),
    async (base) => {
      const data = await (await fetch(`${base}/api/adapters`)).json();
      assert.deepEqual(data.invalid, [{ folder: 'x', error: 'bad' }]);
    },
    { invalidOverride: [{ folder: 'x', error: 'bad' }] },
  );
});

test('POST /api/adapters checks Origin, Content-Type, size, JSON and ID', async () => {
  const sources = makeSourceList(fixture.upstreamBase);
  await withServer(sources, async (base, port) => {
    const foreign = await postJson(
      port,
      '/api/adapters/ok',
      { enabled: false },
      { Origin: 'http://evil.example' },
    );
    assert.equal(foreign.status, 403);

    const same = await postJson(
      port,
      '/api/adapters/ok',
      { enabled: true },
      { Origin: `http://127.0.0.1:${port}` },
    );
    assert.equal(same.status, 200);

    const localhost = await postJson(
      port,
      '/api/adapters/ok',
      { enabled: true },
      { Origin: `http://localhost:${port}` },
    );
    assert.equal(localhost.status, 200);

    const noOrigin = await postJson(port, '/api/adapters/ok', { enabled: true });
    assert.equal(noOrigin.status, 200);

    const textPlain = await postJson(
      port,
      '/api/adapters/ok',
      { enabled: false },
      { 'Content-Type': 'text/plain' },
    );
    assert.equal(textPlain.status, 415);

    const tooLarge = await postJson(
      port,
      '/api/adapters/ok',
      { enabled: false, pad: 'x'.repeat(2000) },
    );
    assert.equal(tooLarge.status, 413);

    const notJson = await postJson(port, '/api/adapters/ok', 'not json');
    assert.equal(notJson.status, 400);

    const notBoolean = await postJson(port, '/api/adapters/ok', { enabled: 'yes' });
    assert.equal(notBoolean.status, 400);

    const arrayBody = await postJson(port, '/api/adapters/ok', []);
    assert.equal(arrayBody.status, 400);

    const unknown = await postJson(port, '/api/adapters/nope', { enabled: false });
    assert.equal(unknown.status, 404);

    const getAdapter = await fetch(`${base}/api/adapters/ok`);
    assert.equal(getAdapter.status, 405);

    const postSources = await fetch(`${base}/api/sources`, { method: 'POST' });
    assert.equal(postSources.status, 405);
  });
});

test('thumb routes give 400 for a bad percent escape', async () => {
  const get = await fetch(`${fixture.base}/api/thumb/%zz`);
  assert.equal(get.status, 400);
  const warm = await fetch(`${fixture.base}/api/thumb/%zz/warm`, { method: 'POST' });
  assert.equal(warm.status, 400);
});

test('adapter settings stay after a server restart', async () => {
  const root = mkdtempSync(join(tmpdir(), 'olf-settings-server-'));
  const dbPath = join(root, 'settings.sqlite');
  try {
    const first = createServer({
      publicDir: fixture.publicDir,
      sourcesOverride: makeSourceList(fixture.upstreamBase),
      settingsDbPath: dbPath,
      thumbCacheDir: fixture.thumbCacheDir,
      thumbFetch: fixture.thumbFetch,
    });
    const firstPort = await listen(first);
    try {
      const res = await postJson(firstPort, '/api/adapters/ok', { enabled: false });
      assert.equal(res.status, 200);
    } finally {
      await close(first);
    }

    const second = createServer({
      publicDir: fixture.publicDir,
      sourcesOverride: makeSourceList(fixture.upstreamBase),
      settingsDbPath: dbPath,
      thumbCacheDir: fixture.thumbCacheDir,
      thumbFetch: fixture.thumbFetch,
    });
    const secondPort = await listen(second);
    try {
      const data = await (await fetch(`http://127.0.0.1:${secondPort}/api/adapters`)).json();
      assert.equal(data.adapters.find((entry) => entry.id === 'ok').enabled, false);
    } finally {
      await close(second);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
