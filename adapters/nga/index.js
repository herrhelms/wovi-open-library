import fs from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { PROJECT_ROOT } from '../../lib/env.js';
import { fetchWithTimeout } from '../../lib/http.js';
import { parseCsvObjects } from '../../lib/csv.js';
import { cleanText } from '../../lib/util.js';
import { searchIndex } from '../../lib/bases/search-index.js';

export { searchIndex };

export const id = 'nga';

export const OBJECTS_URL =
  'https://raw.githubusercontent.com/NationalGalleryOfArt/opendata/main/data/objects.csv';
export const IMAGES_URL =
  'https://raw.githubusercontent.com/NationalGalleryOfArt/opendata/main/data/published_images.csv';
export const PREPARING_MESSAGE =
  'NGA data is being prepared (first use downloads ~175 MB). Try again in a minute.';

const MAX_DESCRIPTION = 600;

function preparingError() {
  const err = new Error(PREPARING_MESSAGE);
  err.code = 'PREPARING';
  return err;
}

function positiveNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return number;
}

export function normalize({ object, image } = {}) {
  if (!image || !image.iiifurl) return null;

  const objectid = String(object?.objectid ?? '');
  const base = String(image.iiifurl).replace(/\/+$/, '');

  const maxpixels = positiveNumber(image.maxpixels);
  const full = maxpixels
    ? `${base}/full/!${maxpixels},${maxpixels}/0/default.jpg`
    : `${base}/full/max/0/default.jpg`;

  // The NGA image server caps the long side at 4096 px.
  const limit = maxpixels === null ? 4096 : Math.min(maxpixels, 4096);

  let width = positiveNumber(image.width);
  let height = positiveNumber(image.height);

  if (width !== null && height !== null) {
    const longSide = Math.max(width, height);
    if (longSide > limit) {
      const factor = limit / longSide;
      width = Math.round(width * factor);
      height = Math.round(height * factor);
    }
  }

  const descriptionParts = [object?.medium, object?.classification]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter((part) => part !== '');

  return {
    source: id,
    id: objectid,
    title: object?.title || 'Untitled',
    creator: object?.attribution || null,
    date: object?.displaydate || null,
    description:
      descriptionParts.length > 0
        ? cleanText(descriptionParts.join('. '), MAX_DESCRIPTION)
        : null,
    thumb: `${base}/full/!400,400/0/default.jpg`,
    preview: `${base}/full/!1600,1600/0/default.jpg`,
    full,
    width,
    height,
    license: 'CC0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    pageUrl: `https://www.nga.gov/collection/art-object-page.${objectid}.html`,
  };
}

async function readImages(imagesPath) {
  const images = new Map();

  for await (const row of parseCsvObjects(fs.createReadStream(imagesPath))) {
    if (row.openaccess !== '1') continue;
    if (row.viewtype !== 'primary') continue;
    if (!row.iiifurl) continue;

    const key = row.depictstmsobjectid;
    const sequence = Number(row.sequence);
    const existing = images.get(key);
    if (existing && existing.sequence <= sequence) continue;

    images.set(key, {
      sequence,
      image: {
        iiifurl: row.iiifurl,
        maxpixels: row.maxpixels,
        width: row.width,
        height: row.height,
      },
    });
  }

  return images;
}

export async function buildIndex(objectsPath, imagesPath) {
  const images = await readImages(imagesPath);

  const items = [];
  const texts = [];
  const titles = [];

  for await (const object of parseCsvObjects(fs.createReadStream(objectsPath))) {
    const entry = images.get(object.objectid);
    if (!entry) continue;

    const item = normalize({ object, image: entry.image });
    if (!item) continue;

    const text = [
      object.title,
      object.attribution,
      object.medium,
      object.classification,
    ]
      .map((value) => (typeof value === 'string' ? value : ''))
      .join(' ');

    items.push(item);
    texts.push(text.toLowerCase());
    titles.push(item.title.toLowerCase());
  }

  return { items, texts, titles };
}

function isFresh(info, maxAgeDays) {
  const maxAgeMs = Number(maxAgeDays) * 24 * 60 * 60 * 1000;
  return Date.now() - info.mtimeMs < maxAgeMs;
}

async function downloadFile(url, file) {
  const part = `${file}.part`;
  try {
    const res = await fetchWithTimeout(url, { timeoutMs: 60000 });
    if (!res.ok) {
      throw new Error(`NGA download failed: HTTP ${res.status}`);
    }
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(part));
    await rename(part, file);
  } catch (err) {
    await rm(part, { force: true });
    throw err;
  }
}

export function createNgaSource({
  dataDir,
  objectsUrl = OBJECTS_URL,
  imagesUrl = IMAGES_URL,
  maxAgeDays = 30,
}) {
  let state = 'idle';
  let index = null;
  let lastError = null;

  async function ensureFile(url, file) {
    let info = null;
    try {
      info = await stat(file);
    } catch {
      info = null;
    }
    if (info && isFresh(info, maxAgeDays)) return;
    await downloadFile(url, file);
  }

  async function prepare() {
    state = 'preparing';
    const started = Date.now();

    try {
      await mkdir(dataDir, { recursive: true });

      process.stderr.write('[nga] preparing data (download if missing or older than 30 days) …\n');

      const objectsPath = join(dataDir, 'objects.csv');
      const imagesPath = join(dataDir, 'published_images.csv');

      await ensureFile(objectsUrl, objectsPath);
      await ensureFile(imagesUrl, imagesPath);

      index = await buildIndex(objectsPath, imagesPath);

      state = 'ready';
      lastError = null;

      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      process.stderr.write(
        `[nga] index ready: ${index.items.length} items in ${seconds} s\n`,
      );
    } catch (err) {
      index = null;
      lastError = err;
      state = 'idle';
    }
  }

  async function search(q, page) {
    if (state === 'ready') return searchIndex(index, q, page);

    if (state === 'preparing') throw preparingError();

    if (lastError) {
      const message = lastError?.message ?? String(lastError);
      lastError = null;
      const err = new Error(`NGA data preparation failed: ${message}`);
      err.code = 'PREPARE_FAILED';
      throw err;
    }

    prepare();
    throw preparingError();
  }

  function status() {
    return state;
  }

  return { search, status };
}

let defaultSource = null;

export async function search(q, page) {
  if (!defaultSource) {
    defaultSource = createNgaSource({
      dataDir: join(PROJECT_ROOT, 'data', 'nga'),
    });
  }
  return defaultSource.search(q, page);
}
