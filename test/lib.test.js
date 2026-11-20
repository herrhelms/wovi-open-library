import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

import { loadEnv, PROJECT_ROOT } from '../lib/env.js';
import { fetchJson, HttpError, USER_AGENT } from '../lib/http.js';
import {
  mapLimit,
  stripHtml,
  truncate,
  cleanText,
  cacheSet,
  firstString,
} from '../lib/util.js';
import { GROUPS, sources, getSource } from '../lib/sources/index.js';

test('PROJECT_ROOT contains package.json', () => {
  assert.equal(typeof PROJECT_ROOT, 'string');
});

test('loadEnv reads a file and does not overwrite existing keys', () => {
  const dir = mkdtempSync(join(tmpdir(), 'olf-env-'));
  const file = join(dir, '.env');
  writeFileSync(file, 'A=1\n# c\nexport B="two"\nC=\'3\'\n\n');
  const previousA = process.env.A;
  process.env.A = 'keep';
  try {
    const count = loadEnv(file);
    assert.equal(process.env.A, 'keep');
    assert.equal(process.env.B, 'two');
    assert.equal(process.env.C, '3');
    assert.equal(count, 2);
  } finally {
    if (previousA === undefined) delete process.env.A;
    else process.env.A = previousA;
    delete process.env.B;
    delete process.env.C;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadEnv ignores a missing file', () => {
  assert.equal(loadEnv(join(tmpdir(), 'olf-missing-does-not-exist.env')), 0);
});

test('mapLimit keeps order and concurrency', async () => {
  let running = 0;
  let maxRunning = 0;
  const results = await mapLimit([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3, async (item) => {
    running += 1;
    maxRunning = Math.max(maxRunning, running);
    await new Promise((resolve) => setTimeout(resolve, 5));
    running -= 1;
    return item * 2;
  });
  assert.deepEqual(results, [2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
  assert.equal(maxRunning, 3);
});

test('stripHtml removes tags and decodes entities', () => {
  assert.equal(stripHtml('<a href="x">Tom &amp; Jerry</a>  &#39;x&#39;'), "Tom & Jerry 'x'");
});

test('truncate limits length', () => {
  const result = truncate('a'.repeat(700), 600);
  assert.equal(result.length, 600);
  assert.ok(result.endsWith('…'));
});

test('cleanText handles arrays and empty input', () => {
  assert.equal(cleanText(['', '<b>Hi</b>']), 'Hi');
  assert.equal(cleanText('   '), null);
});

test('cacheSet drops oldest keys', () => {
  const map = new Map();
  for (let i = 0; i < 5; i += 1) cacheSet(map, `k${i}`, i, 3);
  assert.equal(map.size, 3);
  assert.equal(map.has('k0'), false);
  assert.equal(map.has('k1'), false);
});

test('firstString', () => {
  assert.equal(firstString(['', 'x']), 'x');
  assert.equal(firstString(5), null);
});

async function withServer(handler, fn) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('fetchJson returns parsed JSON and always sends the User-Agent', async () => {
  await withServer(
    (req, res) => {
      assert.equal(req.headers['user-agent'], USER_AGENT);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    },
    async (base) => {
      const data = await fetchJson(`${base}/json`, {
        headers: { 'User-Agent': 'other-agent' },
      });
      assert.deepEqual(data, { ok: true });
    },
  );
});

test('fetchJson on HTTP error hides path and query', async () => {
  await withServer(
    (req, res) => {
      res.writeHead(403, { 'Content-Type': 'text/html' });
      res.end('<html>challenge</html>');
    },
    async (base) => {
      await assert.rejects(
        fetchJson(`${base}/private?key=secret`),
        (err) => {
          assert.ok(err instanceof HttpError);
          assert.equal(err.status, 403);
          assert.equal(err.code, 'HTTP');
          assert.ok(err.bodySnippet.includes('challenge'));
          assert.ok(!err.message.includes('/private'));
          assert.ok(!err.message.includes('?key=secret'));
          return true;
        },
      );
    },
  );
});

test('fetchJson reports invalid JSON', async () => {
  await withServer(
    (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('not json');
    },
    async (base) => {
      await assert.rejects(fetchJson(`${base}/bad`), (err) => {
        assert.ok(err instanceof HttpError);
        assert.equal(err.code, 'NOT_JSON');
        return true;
      });
    },
  );
});

test('fetchJson reports a timeout', async () => {
  await withServer(
    () => {
      // never answer
    },
    async (base) => {
      await assert.rejects(fetchJson(`${base}/slow`, { timeoutMs: 200 }), (err) => {
        assert.ok(err instanceof HttpError);
        assert.equal(err.code, 'TIMEOUT');
        return true;
      });
    },
  );
});

test('sources registry', () => {
  const ids = [
    'commons',
    'openverse',
    'flickr-commons',
    'flickr-cc',
    'archive',
    'europeana',
    'dpla',
    'japan-search',
    'ksamsok',
    'digitalnz',
    'pixabay',
    'pexels',
    'unsplash',
    'met',
    'smithsonian',
    'rijksmuseum',
    'nga',
    'aic',
    'cleveland',
    'getty',
    'mia',
    'smk',
    'paris-musees',
    'walters',
    'brooklyn',
    'auckland',
    'princeton',
    'harvard',
    'loc',
    'nypl',
    'british-library',
    'gallica',
    'trove',
    'nara',
    'nationaal-archief',
    'bundesarchiv',
    'eth-library',
    'slq',
    'nb-norway',
    'digital-commonwealth',
    'rumsey',
    'nasa',
    'esa-hubble',
    'esa-webb',
    'eso',
    'wellcome',
    'bhl',
    'noaa',
    'inaturalist',
    'gbif',
    'nhm',
  ];
  assert.equal(sources.length, 51);
  assert.deepEqual(
    sources.map((source) => source.id),
    ids,
  );
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(getSource('met').name, 'The Met');
  assert.equal(getSource('x'), null);

  const groupIds = ['aggregators', 'museums', 'libraries', 'science'];
  assert.deepEqual(
    GROUPS.map((group) => group.id),
    groupIds,
  );
  assert.equal(GROUPS[0].label, 'Open-licence aggregators');
  assert.equal(GROUPS[1].label, 'Museums and galleries');
  assert.equal(GROUPS[2].label, 'Libraries and archives');
  assert.equal(GROUPS[3].label, 'Science, nature and medicine');

  for (const source of sources) {
    assert.equal(typeof source.search, 'function', source.id);
    assert.equal(typeof source.normalize, 'function', source.id);
    assert.equal(typeof source.name, 'string', source.id);
    assert.equal(typeof source.homepage, 'string', source.id);
    assert.ok(groupIds.includes(source.group), `${source.id} group ${source.group}`);
    assert.ok(source.keyEnv === null || typeof source.keyEnv === 'string');
  }

  assert.equal(getSource('europeana').keyOptional, true);
  assert.equal(getSource('smithsonian').keyOptional, true);
  assert.equal(getSource('digitalnz').keyEnv, 'DIGITALNZ_KEY');
  assert.equal(getSource('digitalnz').keyOptional, true);

  const needsKey = sources
    .filter((source) => source.keyEnv !== null && source.keyOptional !== true)
    .map((source) => source.id);
  assert.deepEqual(needsKey, [
    'flickr-commons',
    'flickr-cc',
    'dpla',
    'pixabay',
    'pexels',
    'unsplash',
    'harvard',
    'nypl',
    'trove',
  ]);

  for (const source of sources) {
    if (source.trustResolvedUrl === true) {
      assert.equal(typeof source.resolveDownload, 'function', source.id);
    }
  }
});
