import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import fixture from './fixtures/nga.json' with { type: 'json' };
import {
  normalize,
  buildIndex,
  searchIndex,
  createNgaSource,
  PREPARING_MESSAGE,
  OBJECTS_URL,
  IMAGES_URL,
} from '../lib/sources/nga.js';

const IMAGES_HEADER =
  'uuid,iiifurl,iiifthumburl,viewtype,sequence,width,height,maxpixels,openaccess,created,modified,depictstmsobjectid,assistivetext';
const OBJECTS_HEADER =
  'objectid,accessionnum,title,displaydate,medium,attribution,classification,provenancetext';

function imageRow({
  uuid,
  iiifurl,
  viewtype = 'primary',
  sequence = '0',
  openaccess = '1',
  objectid,
}) {
  return [
    uuid,
    iiifurl,
    '',
    viewtype,
    sequence,
    '1000',
    '1200',
    '',
    openaccess,
    '',
    '',
    objectid,
    '',
  ].join(',');
}

const IMAGES_CSV = [
  IMAGES_HEADER,
  imageRow({
    uuid: 'uuid-1',
    iiifurl: 'https://api.nga.gov/iiif/uuid-1',
    objectid: '1',
  }),
  imageRow({
    uuid: 'uuid-2',
    iiifurl: 'https://api.nga.gov/iiif/uuid-2',
    openaccess: '0',
    objectid: '2',
  }),
  imageRow({
    uuid: 'uuid-3',
    iiifurl: 'https://api.nga.gov/iiif/uuid-3',
    viewtype: 'alternate',
    objectid: '3',
  }),
  imageRow({
    uuid: 'uuid-4-seq-1',
    iiifurl: 'https://api.nga.gov/iiif/uuid-4-seq-1',
    sequence: '1',
    objectid: '4',
  }),
  imageRow({
    uuid: 'uuid-4-seq-0',
    iiifurl: 'https://api.nga.gov/iiif/uuid-4-seq-0',
    sequence: '0',
    objectid: '4',
  }),
  imageRow({
    uuid: 'uuid-5',
    iiifurl: 'https://api.nga.gov/iiif/uuid-5',
    objectid: '5',
  }),
  '',
].join('\n');

const OBJECTS_CSV = [
  OBJECTS_HEADER,
  '1,1955.1,Moon over the Sea,1900,,Jane Doe,,',
  '2,1955.2,Moon Two,1901,,, ,',
  '3,1955.3,Moon Three,1902,,, ,',
  '4,1955.4,Harbor,1903,,Moonlight Painter,,',
  '5,1955.5,Tree,1904,,,,"A note, with a comma, ""quotes""\nand a newline."',
  '',
].join('\n');

async function makeTempDir() {
  return mkdtemp(join(tmpdir(), 'olf-nga-'));
}

async function writeCsvFiles(dir) {
  const objectsPath = join(dir, 'objects.csv');
  const imagesPath = join(dir, 'published_images.csv');
  await writeFile(objectsPath, OBJECTS_CSV);
  await writeFile(imagesPath, IMAGES_CSV);
  return { objectsPath, imagesPath };
}

function waitFor(predicate, timeoutMs = 5000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - started > timeoutMs) {
        return reject(new Error('waitFor timed out'));
      }
      setTimeout(tick, 20);
    };
    tick();
  });
}

async function withServer(handler, fn) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    return await fn(`http://127.0.0.1:${port}`, server);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('normalize maps a fixture object and image', () => {
  const item = normalize({ object: fixture.object, image: fixture.image });

  assert.equal(item.source, 'nga');
  assert.equal(item.id, '17387');
  assert.equal(item.title, 'Two Jugs');
  assert.equal(
    item.full,
    'https://api.nga.gov/iiif/00007f61-4922-417b-8f27-893ea328206c/full/max/0/default.jpg',
  );
  assert.ok(item.thumb.endsWith('/full/!400,400/0/default.jpg'));
  assert.ok(item.preview.endsWith('/full/!1600,1600/0/default.jpg'));
  // Native 3365x4332 is scaled so that the long side is at most 4096.
  assert.equal(item.width, 3182);
  assert.equal(item.height, 4096);
  assert.equal(item.license, 'CC0');
  assert.equal(
    item.licenseUrl,
    'https://creativecommons.org/publicdomain/zero/1.0/',
  );
  assert.equal(
    item.pageUrl,
    'https://www.nga.gov/collection/art-object-page.17387.html',
  );
  assert.equal(item.description, 'watercolor and graphite on paper. Drawing');
  assert.equal(item.creator, 'Index of American Design');
  assert.equal(item.date, 'c. 1938');
});

test('normalize caps the long side at 4096 without maxpixels', () => {
  const make = (width, height, maxpixels = '') =>
    normalize({
      object: { ...fixture.object, objectid: '1' },
      image: { ...fixture.image, width: String(width), height: String(height), maxpixels },
    });

  const large = make(8000, 6000);
  assert.equal(large.width, 4096);
  assert.equal(large.height, 3072);

  const small = make(3000, 2000);
  assert.equal(small.width, 3000);
  assert.equal(small.height, 2000);

  const capped = make(10000, 5000, '3000');
  assert.equal(capped.width, 3000);
  assert.equal(capped.height, 1500);

  const portrait = make(5000, 10000, '6000');
  assert.equal(portrait.width, 2048);
  assert.equal(portrait.height, 4096);
});

test('normalize uses maxpixels for full and scales the size', () => {
  const item = normalize({
    object: { ...fixture.object, objectid: '19245' },
    image: fixture.imageWithMaxpixels,
  });

  assert.ok(item.full.endsWith('/full/!3000,3000/0/default.jpg'));
  assert.equal(item.height, 3000);
  assert.equal(item.width, 2240);
});

test('normalize returns null without an image', () => {
  assert.equal(normalize({ object: fixture.object, image: undefined }), null);
  assert.equal(
    normalize({ object: fixture.object, image: { iiifurl: '' } }),
    null,
  );
});

test('buildIndex keeps open access primary images with the lowest sequence', async () => {
  const dir = await makeTempDir();
  try {
    const { objectsPath, imagesPath } = await writeCsvFiles(dir);
    const index = await buildIndex(objectsPath, imagesPath);

    assert.equal(index.items.length, 3);
    assert.equal(index.texts.length, 3);
    assert.equal(index.titles.length, 3);
    assert.deepEqual(
      index.items.map((item) => item.id),
      ['1', '4', '5'],
    );
    assert.ok(index.items[1].full.includes('uuid-4-seq-0'));
    assert.ok(!index.items[1].full.includes('uuid-4-seq-1'));
    assert.equal(index.items[2].title, 'Tree');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('searchIndex matches words, sorts title matches first and pages', async () => {
  const dir = await makeTempDir();
  try {
    const { objectsPath, imagesPath } = await writeCsvFiles(dir);
    const index = await buildIndex(objectsPath, imagesPath);

    const moon = searchIndex(index, 'moon', 1);
    assert.equal(moon.total, 2);
    assert.equal(moon.hasMore, false);
    assert.deepEqual(
      moon.items.map((item) => item.id),
      ['1', '4'],
    );

    assert.equal(searchIndex(index, 'moon sea', 1).total, 1);
    assert.equal(searchIndex(index, '   ', 1).total, 0);

    const first = searchIndex(index, 'moon', 1, 1);
    assert.equal(first.items.length, 1);
    assert.equal(first.hasMore, true);

    const second = searchIndex(index, 'moon', 2, 1);
    assert.equal(second.items.length, 1);
    assert.equal(second.hasMore, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('createNgaSource downloads once, reuses fresh files and searches', async () => {
  const dir = await makeTempDir();
  let requests = 0;

  try {
    await withServer(
      (req, res) => {
        requests += 1;
        if (req.url === '/objects.csv') {
          res.writeHead(200, { 'Content-Type': 'text/csv' });
          res.end(OBJECTS_CSV);
        } else if (req.url === '/images.csv') {
          res.writeHead(200, { 'Content-Type': 'text/csv' });
          res.end(IMAGES_CSV);
        } else {
          res.writeHead(404);
          res.end();
        }
      },
      async (base) => {
        const source = createNgaSource({
          dataDir: dir,
          objectsUrl: `${base}/objects.csv`,
          imagesUrl: `${base}/images.csv`,
        });

        assert.equal(source.status(), 'idle');

        const results = await Promise.allSettled([
          source.search('moon', 1),
          source.search('moon', 1),
          source.search('moon', 1),
        ]);
        for (const result of results) {
          assert.equal(result.status, 'rejected');
          assert.equal(result.reason.code, 'PREPARING');
          assert.equal(result.reason.message, PREPARING_MESSAGE);
        }

        await waitFor(() => source.status() === 'ready');
        assert.equal(source.status(), 'ready');

        const found = await source.search('moon', 1);
        assert.equal(found.total, 2);
        assert.equal(requests, 2);

        await waitFor(() => source.status() === 'ready');
        const second = createNgaSource({
          dataDir: dir,
          objectsUrl: `${base}/objects.csv`,
          imagesUrl: `${base}/images.csv`,
        });
        await assert.rejects(second.search('moon', 1), { code: 'PREPARING' });
        await waitFor(() => second.status() === 'ready');
        assert.equal((await second.search('moon', 1)).total, 2);
        assert.equal(requests, 2);

        const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
        await utimes(join(dir, 'objects.csv'), old, old);
        await utimes(join(dir, 'published_images.csv'), old, old);

        const third = createNgaSource({
          dataDir: dir,
          objectsUrl: `${base}/objects.csv`,
          imagesUrl: `${base}/images.csv`,
        });
        await assert.rejects(third.search('moon', 1), { code: 'PREPARING' });
        await waitFor(() => third.status() === 'ready');
        assert.equal((await third.search('moon', 1)).total, 2);
        assert.equal(requests, 4);
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('createNgaSource reports a failed preparation once and retries later', async () => {
  const dir = await makeTempDir();
  let failImages = true;

  try {
    await withServer(
      (req, res) => {
        if (req.url === '/objects.csv') {
          res.writeHead(200, { 'Content-Type': 'text/csv' });
          res.end(OBJECTS_CSV);
        } else if (req.url === '/images.csv' && failImages) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('error');
        } else if (req.url === '/images.csv') {
          res.writeHead(200, { 'Content-Type': 'text/csv' });
          res.end(IMAGES_CSV);
        } else {
          res.writeHead(404);
          res.end();
        }
      },
      async (base) => {
        const source = createNgaSource({
          dataDir: dir,
          objectsUrl: `${base}/objects.csv`,
          imagesUrl: `${base}/images.csv`,
        });

        await assert.rejects(source.search('moon', 1), { code: 'PREPARING' });
        await waitFor(() => source.status() !== 'preparing');
        assert.equal(source.status(), 'idle');

        await assert.rejects(source.search('moon', 1), (err) => {
          assert.equal(err.code, 'PREPARE_FAILED');
          assert.match(err.message, /^NGA data preparation failed: /);
          assert.match(err.message, /HTTP 500/);
          return true;
        });

        await assert.rejects(source.search('moon', 1), { code: 'PREPARING' });
        await waitFor(() => source.status() !== 'preparing');

        const files = await readdir(dir);
        assert.ok(!files.some((file) => file.endsWith('.part')));

        // The retried preparation failed again, so report it one time.
        await assert.rejects(source.search('moon', 1), { code: 'PREPARE_FAILED' });

        failImages = false;
        await assert.rejects(source.search('moon', 1), { code: 'PREPARING' });
        await waitFor(() => source.status() === 'ready');
        assert.equal((await source.search('moon', 1)).total, 2);
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('exported URLs point to the NGA open data repository', async () => {
  assert.match(OBJECTS_URL, /NationalGalleryOfArt\/opendata\/.*objects\.csv$/);
  assert.match(IMAGES_URL, /NationalGalleryOfArt\/opendata\/.*published_images\.csv$/);
});
