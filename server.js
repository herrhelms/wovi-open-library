import { createServer as createHttpServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { PROJECT_ROOT, loadEnv } from './lib/env.js';
import { isOpenLicense } from './lib/license.js';
import { GROUPS, INVALID, sources as registrySources } from './lib/sources/index.js';
import { extFromContentType, openRemote, safeFilename } from './lib/download.js';
import { mediaIdFor } from './lib/media-id.js';
import { createSearchCache, searchCacheKey } from './lib/search-cache.js';
import {
  MEDIA_ID_PATTERN,
  createThumbCache,
} from './lib/thumb-cache.js';
import { fetchWithTimeout } from './lib/http.js';
import { openSettings } from './lib/settings-db.js';

const JSON_TYPE = 'application/json; charset=utf-8';
const DEFAULT_SEARCH_CACHE_TTL_MS = 1_800_000;
const DEFAULT_THUMB_CACHE_BYTES = 500 * 1024 * 1024;
const MAX_ADAPTER_BODY_BYTES = 1024;

const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function sendJson(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': JSON_TYPE,
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    ...headers,
  });
  res.end(body);
}

function sendText(res, status, text) {
  const body = `${text}\n`;
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function parsePage(value) {
  if (value === null || value === undefined || value === '') return 1;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return 1;
  return Math.min(parsed, 500);
}

function sourceNeedsKey(source) {
  return source.keyEnv != null && source.keyOptional !== true;
}

function isKeyConfigured(keyEnv) {
  return typeof process.env[keyEnv] === 'string' && process.env[keyEnv] !== '';
}

function missingKeyError(source) {
  return {
    error: `${source.name} needs ${source.keyEnv} in .env`,
    code: 'NEEDS_KEY',
  };
}

function hasMissingKey(source) {
  return sourceNeedsKey(source) && !isKeyConfigured(source.keyEnv);
}

function sourceDefaultEnabled(source) {
  return source.config?.defaultEnabled ?? true;
}

function sourceEnabled(source, settings) {
  const stored = settings.getAdapterEnabled(source.id);
  return stored === null ? sourceDefaultEnabled(source) : stored;
}

function keyEntry(source) {
  const configKey = source.config?.key ?? null;
  let key;
  if (configKey !== null) {
    key = {
      env: configKey.env,
      required: configKey.required ?? true,
      default: configKey.default ?? null,
      signupUrl: configKey.signupUrl ?? null,
      steps: Array.isArray(configKey.steps) ? configKey.steps : [],
      limits: configKey.limits ?? null,
    };
  } else if (source.keyEnv != null) {
    key = {
      env: source.keyEnv,
      required: source.keyOptional !== true,
      default: null,
      signupUrl: null,
      steps: [],
      limits: null,
    };
  } else {
    return null;
  }
  return { ...key, configured: isKeyConfigured(key.env) };
}

function adapterEntry(source, settings) {
  const config = source.config ?? {};
  return {
    id: source.id,
    name: source.name,
    homepage: source.homepage,
    group: source.group ?? null,
    description: config.description ?? null,
    enabled: sourceEnabled(source, settings),
    defaultEnabled: sourceDefaultEnabled(source),
    openLicenses: source.openLicenses !== false,
    docsUrl: config.docsUrl ?? null,
    notes: Array.isArray(config.notes) ? config.notes : [],
    base: config.base ?? null,
    key: keyEntry(source),
  };
}

function readLimitedBody(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    let done = false;
    req.on('data', (chunk) => {
      if (done) return;
      length += chunk.length;
      if (length > max) {
        done = true;
        req.resume();
        resolve({ tooLarge: true });
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      resolve({ tooLarge: false, body: Buffer.concat(chunks).toString('utf8') });
    });
    req.on('error', (err) => {
      if (done) return;
      done = true;
      reject(err);
    });
  });
}

function isAllowedOrigin(req) {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  const port = req.socket.localPort;
  return origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
}

function isJsonContentType(req) {
  const header = req.headers['content-type'];
  if (typeof header !== 'string') return false;
  return header.split(';', 1)[0].trim().toLowerCase() === 'application/json';
}

function decodeSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

async function handleAdaptersGet(res, sourceList, groupList, invalidList, settings) {
  sendJson(res, 200, {
    groups: groupList,
    adapters: sourceList.map((source) => adapterEntry(source, settings)),
    invalid: invalidList,
  });
}

async function handleAdapterToggle(req, res, id, sourceList, settings) {
  if (!isAllowedOrigin(req)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }
  if (!isJsonContentType(req)) {
    sendJson(res, 415, { error: 'Content-Type must be application/json' });
    return;
  }

  const { tooLarge, body } = await readLimitedBody(req, MAX_ADAPTER_BODY_BYTES);
  if (tooLarge) {
    sendJson(res, 413, { error: 'Body is too large' });
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON' });
    return;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)
    || typeof parsed.enabled !== 'boolean') {
    sendJson(res, 400, { error: 'Body must have a boolean enabled' });
    return;
  }

  const source = sourceList.find((entry) => entry.id === id) ?? null;
  if (!source) {
    sendJson(res, 404, { error: 'Unknown adaptor' });
    return;
  }

  settings.setAdapterEnabled(id, parsed.enabled);
  sendJson(res, 200, adapterEntry(source, settings));
}

async function handleSources(res, sourceList, settings) {
  const enabledList = sourceList.filter((source) => sourceEnabled(source, settings));
  const data = enabledList.map((source) => {
    const needsKey = sourceNeedsKey(source);
    const keyEnv = needsKey ? source.keyEnv : null;
    const keyConfigured = keyEnv === null || isKeyConfigured(keyEnv);
    return {
      id: source.id,
      name: source.name,
      homepage: source.homepage,
      group: source.group ?? null,
      needsKey,
      keyConfigured,
      keyEnv,
      openLicenses: source.openLicenses !== false,
    };
  });
  sendJson(res, 200, data);
}

async function handleSearch(url, res, sourceList, searchCache, thumbCache, settings) {
  const sourceId = url.searchParams.get('source');
  const source = sourceId ? sourceList.find((entry) => entry.id === sourceId) : null;
  if (!source) {
    sendJson(res, 400, { error: 'Unknown source' });
    return;
  }

  if (!sourceEnabled(source, settings)) {
    sendJson(res, 404, { error: 'Adaptor is deactivated', code: 'DISABLED' });
    return;
  }

  const q = (url.searchParams.get('q') ?? '').trim();
  if (q === '') {
    sendJson(res, 400, { error: 'Query is empty' });
    return;
  }
  if (q.length > 200) {
    sendJson(res, 400, { error: 'Query is too long' });
    return;
  }

  if (hasMissingKey(source)) {
    sendJson(res, 400, missingKeyError(source));
    return;
  }

  const page = parsePage(url.searchParams.get('page'));
  const openOnly = url.searchParams.get('open') === '1';

  if (openOnly && source.openLicenses === false) {
    sendJson(res, 200, {
      source: source.id,
      page,
      total: 0,
      hasMore: false,
      items: [],
      excluded: 'open',
    });
    return;
  }

  try {
    const key = searchCacheKey({ sourceId: source.id, openOnly, page, q });
    const { value: result, hit } = await searchCache.get(key, () =>
      openOnly
        ? source.search(q, page, { openOnly: true })
        : source.search(q, page),
    );

    const rawItems = Array.isArray(result?.items) ? result.items : [];
    let items = [];
    for (const raw of rawItems) {
      if (!raw || typeof raw !== 'object') continue;
      const item = { ...raw };
      if (typeof item.open !== 'boolean') {
        item.open = isOpenLicense(item.license, item.licenseUrl);
      }
      item.uid = `${source.id}:${item.id}`;
      item.thumbSource = raw.thumb ?? null;
      item.mediaId = mediaIdFor(raw.thumb);
      items.push(item);
    }

    let total = result?.total ?? null;
    if (openOnly) {
      const kept = items.filter((item) => item.open === true);
      if (kept.length !== items.length) total = null;
      items = kept;
    }

    const seenUids = new Set();
    const seenMedia = new Set();
    const unique = [];
    for (const item of items) {
      if (seenUids.has(item.uid)) continue;
      if (item.mediaId !== null && seenMedia.has(item.mediaId)) continue;
      seenUids.add(item.uid);
      if (item.mediaId !== null) seenMedia.add(item.mediaId);
      unique.push(item);
    }
    items = unique;

    for (const item of items) {
      if (item.mediaId === null) {
        item.thumbCached = false;
        continue;
      }
      thumbCache.register(item.mediaId, item.thumbSource);
      if (thumbCache.has(item.mediaId)) {
        item.thumb = `/api/thumb/${item.mediaId}`;
        item.thumbCached = true;
      } else {
        item.thumb = item.thumbSource;
        item.thumbCached = false;
      }
    }

    sendJson(
      res,
      200,
      {
        source: source.id,
        page,
        total,
        hasMore: Boolean(result?.hasMore),
        items,
      },
      { 'X-Search-Cache': hit ? 'hit' : 'miss' },
    );
  } catch (err) {
    const message = err?.message ?? 'Search failed';
    process.stderr.write(`[search ${source.id}] ${message}\n`);
    const body = { error: message, code: err?.code ?? null };
    if (err?.code === 'RATE_LIMIT' && Number.isFinite(err.retryAfterSeconds)) {
      body.retryAfterSeconds = err.retryAfterSeconds;
    }
    sendJson(res, 502, body);
  }
}

function errorStatus(err) {
  return err?.status === 400 ? 400 : 502;
}

const IMAGE_TYPES_BY_EXTENSION = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  jp2: 'image/jp2',
  gif: 'image/gif',
  webp: 'image/webp',
};

function imageExtensionFromUrl(url) {
  let path = '';
  try {
    path = new URL(url).pathname;
  } catch {
    path = String(url ?? '').split(/[?#]/, 1)[0];
  }
  const match = /\.([A-Za-z0-9]{2,5})$/.exec(path);
  return match ? match[1].toLowerCase() : null;
}

async function handleDownload(url, req, res, sourceList, settings) {
  const sourceId = url.searchParams.get('source');
  const source = sourceId ? sourceList.find((entry) => entry.id === sourceId) : null;
  if (!source) {
    sendJson(res, 400, { error: 'Unknown source' });
    return;
  }

  if (!sourceEnabled(source, settings)) {
    sendJson(res, 404, { error: 'Adaptor is deactivated', code: 'DISABLED' });
    return;
  }

  if (hasMissingKey(source)) {
    sendJson(res, 400, missingKeyError(source));
    return;
  }

  const itemId = url.searchParams.get('id');
  const explicitUrl = url.searchParams.get('url');
  const title = url.searchParams.get('title');
  const trustResolvedUrl = source.trustResolvedUrl === true;

  if (trustResolvedUrl) {
    if (!itemId) {
      sendJson(res, 400, { error: 'Missing id' });
      return;
    }
  } else if (!itemId && !explicitUrl) {
    sendJson(res, 400, { error: 'Missing id or url' });
    return;
  }

  let remoteUrl;
  let checkHosts;
  let resolvedFilename = null;

  try {
    if (trustResolvedUrl) {
      if (typeof source.resolveDownload !== 'function') {
        sendJson(res, 400, { error: 'No download URL' });
        return;
      }
      const resolved = await source.resolveDownload(itemId);
      if (!resolved?.url) {
        sendJson(res, 400, { error: 'No download URL' });
        return;
      }
      remoteUrl = resolved.url;
      resolvedFilename = resolved.filename ?? null;
      checkHosts = false;
    } else if (explicitUrl) {
      remoteUrl = explicitUrl;
      checkHosts = true;
    } else if (typeof source.resolveDownload === 'function') {
      const resolved = await source.resolveDownload(itemId);
      if (!resolved?.url) {
        sendJson(res, 400, { error: 'No download URL' });
        return;
      }
      remoteUrl = resolved.url;
      resolvedFilename = resolved.filename ?? null;
      checkHosts = true;
    } else {
      sendJson(res, 400, { error: 'No download URL' });
      return;
    }
  } catch (err) {
    sendJson(res, errorStatus(err), { error: err?.message ?? 'Download failed' });
    return;
  }

  const controller = new AbortController();
  const onClose = () => controller.abort();
  res.on('close', onClose);

  let remote;
  try {
    remote = await openRemote(remoteUrl, { checkHosts, signal: controller.signal });
  } catch (err) {
    res.removeListener('close', onClose);
    sendJson(res, errorStatus(err), { error: err?.message ?? 'Download failed' });
    return;
  }

  const finalUrl = remote.url || remoteUrl;

  let contentType = remote.headers.get('content-type') ?? '';
  let normalizedType = contentType.split(';', 1)[0].trim().toLowerCase();
  if (normalizedType === '') {
    const extension = imageExtensionFromUrl(finalUrl);
    const derived = extension ? IMAGE_TYPES_BY_EXTENSION[extension] : null;
    if (derived) {
      normalizedType = derived;
      contentType = derived;
    }
  }

  if (!normalizedType.startsWith('image/') && normalizedType !== 'application/octet-stream') {
    try {
      await remote.body?.cancel();
    } catch {
      // Ignore a body that cannot be cancelled.
    }
    res.removeListener('close', onClose);
    sendJson(res, 502, {
      error: `Remote file is not an image (${normalizedType || 'unknown'})`,
    });
    return;
  }

  let urlPath = '';
  try {
    urlPath = new URL(finalUrl).pathname;
  } catch {
    urlPath = finalUrl;
  }
  const ext = extFromContentType(normalizedType, urlPath);
  const filename = safeFilename(
    source.id,
    title || resolvedFilename || itemId || 'item',
    ext,
  );

  const headers = {
    'Content-Type': contentType,
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
  };
  const contentLength = remote.headers.get('content-length');
  if (contentLength) headers['Content-Length'] = contentLength;

  res.writeHead(200, headers);

  if (req.method === 'HEAD' || !remote.body) {
    try {
      await remote.body?.cancel();
    } catch {
      // Ignore.
    }
    res.end();
    res.removeListener('close', onClose);
    return;
  }

  try {
    await pipeline(Readable.fromWeb(remote.body), res);
  } catch {
    // Client disconnected or the upstream stream failed; the response is gone.
    controller.abort();
  } finally {
    res.removeListener('close', onClose);
  }
}

function thumbCacheHeaders(entry) {
  return {
    'Content-Type': entry.contentType,
    'Content-Length': entry.bytes,
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
  };
}

async function handleThumbGet(req, res, mediaId, thumbCache) {
  const found = thumbCache.entry(mediaId);
  if (!found) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }

  let info;
  try {
    info = await stat(found.file);
  } catch {
    info = null;
  }
  if (!info || !info.isFile()) {
    thumbCache.remove(mediaId);
    sendJson(res, 404, { error: 'Not found' });
    return;
  }

  res.writeHead(200, thumbCacheHeaders(found));

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  try {
    await pipeline(createReadStream(found.file), res);
  } catch {
    // The client disconnected.
  }
}

function handleThumbWarm(res, mediaId, thumbCache) {
  const result = thumbCache.warm(mediaId);
  if (result === 'unknown') {
    sendJson(res, 404, { error: 'Unknown thumbnail' });
    return;
  }
  if (result === 'cached') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (result === 'full') {
    sendJson(res, 503, { error: 'Thumbnail queue is full' });
    return;
  }
  sendJson(res, 202, { status: 'queued' });
}

function resolveStaticPath(publicDir, rawPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return { status: 400 };
  }
  if (decoded.includes('\0')) return { status: 400 };

  const pathname = decoded.split('?', 1)[0];
  const relativePath = pathname.replace(/^\/+/, '');
  const root = resolve(publicDir);
  const target = resolve(root, relativePath);

  const rel = relative(root, target);
  if (rel !== '' && (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))) {
    return { status: 403 };
  }
  return { file: target === root ? join(target, 'index.html') : target };
}

async function handleStatic(req, res, publicDir) {
  const rawPath = (req.url ?? '/').split('?', 1)[0];
  const resolved = resolveStaticPath(publicDir, rawPath);
  if (resolved.status) {
    sendText(res, resolved.status, resolved.status === 403 ? 'Forbidden' : 'Bad request');
    return;
  }

  let file = resolved.file;
  if (rawPath === '/' || rawPath === '' || rawPath === '/saved') {
    file = join(resolve(publicDir), 'index.html');
  }

  let info;
  try {
    info = await stat(file);
  } catch {
    sendText(res, 404, 'Not found');
    return;
  }
  if (!info.isFile()) {
    sendText(res, 404, 'Not found');
    return;
  }

  const type = STATIC_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': info.size,
  });

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  try {
    await pipeline(createReadStream(file), res);
  } catch {
    // The client disconnected.
  }
}

export function createServer({
  publicDir = join(PROJECT_ROOT, 'public'),
  sourcesOverride,
  groupsOverride,
  invalidOverride,
  searchCacheTtlMs,
  now,
  settingsDbPath = join(PROJECT_ROOT, 'data', 'settings.sqlite'),
  thumbCacheDir = join(PROJECT_ROOT, 'data', 'thumb-cache'),
  thumbCacheMaxBytes = DEFAULT_THUMB_CACHE_BYTES,
  thumbFetch = fetchWithTimeout,
} = {}) {
  const sourceList = Array.isArray(sourcesOverride) ? sourcesOverride : registrySources;
  const groupList = Array.isArray(groupsOverride) ? groupsOverride : GROUPS;
  const invalidList = Array.isArray(invalidOverride) ? invalidOverride : INVALID;
  const settings = openSettings(settingsDbPath);

  const ttlMs =
    typeof searchCacheTtlMs === 'number' && searchCacheTtlMs > 0
      ? searchCacheTtlMs
      : DEFAULT_SEARCH_CACHE_TTL_MS;
  const clock = typeof now === 'function' ? now : Date.now;
  const searchCache = createSearchCache({ ttlMs, now: clock });
  const cacheBytes =
    typeof thumbCacheMaxBytes === 'number' && thumbCacheMaxBytes > 0
      ? thumbCacheMaxBytes
      : DEFAULT_THUMB_CACHE_BYTES;
  const thumbCache = createThumbCache({
    dir: thumbCacheDir,
    maxBytes: cacheBytes,
    fetch: thumbFetch,
    now: clock,
  });

  const server = createHttpServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');

      if (req.method === 'POST') {
        const warmMatch = /^\/api\/thumb\/([^/]+)\/warm$/.exec(url.pathname);
        if (warmMatch) {
          const mediaId = decodeSegment(warmMatch[1]);
          if (mediaId === null) {
            sendJson(res, 400, { error: 'Invalid media ID' });
            return;
          }
          if (!MEDIA_ID_PATTERN.test(mediaId)) {
            sendJson(res, 400, { error: 'Invalid media ID' });
            return;
          }
          handleThumbWarm(res, mediaId, thumbCache);
          return;
        }

        const adapterMatch = /^\/api\/adapters\/([^/]+)$/.exec(url.pathname);
        if (adapterMatch) {
          const id = decodeSegment(adapterMatch[1]);
          if (id === null) {
            sendJson(res, 400, { error: 'Invalid adaptor ID' });
            return;
          }
          await handleAdapterToggle(req, res, id, sourceList, settings);
          return;
        }

        sendText(res, 405, 'Method not allowed');
        return;
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendText(res, 405, 'Method not allowed');
        return;
      }

      if (/^\/api\/thumb\/[^/]+\/warm$/.test(url.pathname)) {
        sendText(res, 405, 'Method not allowed');
        return;
      }

      if (/^\/api\/adapters\/[^/]+$/.test(url.pathname)) {
        sendText(res, 405, 'Method not allowed');
        return;
      }

      const thumbMatch = /^\/api\/thumb\/([^/]+)$/.exec(url.pathname);
      if (thumbMatch) {
        const mediaId = decodeSegment(thumbMatch[1]);
        if (mediaId === null) {
          sendJson(res, 400, { error: 'Invalid media ID' });
          return;
        }
        if (!MEDIA_ID_PATTERN.test(mediaId)) {
          sendJson(res, 400, { error: 'Invalid media ID' });
          return;
        }
        await handleThumbGet(req, res, mediaId, thumbCache);
        return;
      }

      if (url.pathname === '/api/adapters') {
        await handleAdaptersGet(res, sourceList, groupList, invalidList, settings);
        return;
      }
      if (url.pathname === '/api/sources') {
        await handleSources(res, sourceList, settings);
        return;
      }
      if (url.pathname === '/api/groups') {
        sendJson(res, 200, groupList);
        return;
      }
      if (url.pathname === '/api/search') {
        await handleSearch(url, res, sourceList, searchCache, thumbCache, settings);
        return;
      }
      if (url.pathname === '/api/download') {
        await handleDownload(url, req, res, sourceList, settings);
        return;
      }
      if (url.pathname.startsWith('/api/')) {
        sendJson(res, 404, { error: 'Not found' });
        return;
      }

      await handleStatic(req, res, publicDir);
    } catch (err) {
      if (!res.headersSent) {
        sendJson(res, 500, { error: 'Internal server error' });
      } else {
        res.destroy();
      }
    }
  });

  server.on('close', () => {
    settings.close();
  });

  return server;
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  loadEnv();
  const port = Number(process.env.PORT) || 5173;
  const server = createServer();
  server.listen(port, '127.0.0.1', () => {
    process.stdout.write(`Open Library Fetch: http://127.0.0.1:${port}/\n`);
  });
}
