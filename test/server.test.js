import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createUpstream } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createServer } from '../server.js';
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

  const server = createServer({
    publicDir,
    sourcesOverride: makeSourceList(upstreamBase),
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
  const server = createServer({ publicDir: fixture.publicDir, sourcesOverride: sources });
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
  const server = createServer({ publicDir: fixture.publicDir, sourcesOverride: sources });
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

async function withServer(sources, fn) {
  const server = createServer({ publicDir: fixture.publicDir, sourcesOverride: sources });
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
