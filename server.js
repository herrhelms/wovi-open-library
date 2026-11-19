import { createServer as createHttpServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { PROJECT_ROOT, loadEnv } from './lib/env.js';
import { sources as registrySources } from './lib/sources/index.js';
import { extFromContentType, openRemote, safeFilename } from './lib/download.js';

const JSON_TYPE = 'application/json; charset=utf-8';

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

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': JSON_TYPE,
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
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

async function handleSources(res, sourceList) {
  const data = sourceList.map((source) => {
    const keyEnv = source.keyEnv ?? null;
    const keyConfigured =
      keyEnv === null || (typeof process.env[keyEnv] === 'string' && process.env[keyEnv] !== '');
    return {
      id: source.id,
      name: source.name,
      homepage: source.homepage,
      needsKey: keyEnv !== null,
      keyConfigured,
    };
  });
  sendJson(res, 200, data);
}

async function handleSearch(url, res, sourceList) {
  const sourceId = url.searchParams.get('source');
  const source = sourceId ? sourceList.find((entry) => entry.id === sourceId) : null;
  if (!source) {
    sendJson(res, 400, { error: 'Unknown source' });
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

  const page = parsePage(url.searchParams.get('page'));

  try {
    const result = await source.search(q, page);
    sendJson(res, 200, {
      source: source.id,
      page,
      total: result?.total ?? null,
      hasMore: Boolean(result?.hasMore),
      items: Array.isArray(result?.items) ? result.items : [],
    });
  } catch (err) {
    const message = err?.message ?? 'Search failed';
    process.stderr.write(`[search ${source.id}] ${message}\n`);
    sendJson(res, 502, { error: message, code: err?.code ?? null });
  }
}

function errorStatus(err) {
  return err?.status === 400 ? 400 : 502;
}

async function handleDownload(url, req, res, sourceList) {
  const sourceId = url.searchParams.get('source');
  const source = sourceId ? sourceList.find((entry) => entry.id === sourceId) : null;
  if (!source) {
    sendJson(res, 400, { error: 'Unknown source' });
    return;
  }

  const itemId = url.searchParams.get('id');
  const explicitUrl = url.searchParams.get('url');
  const title = url.searchParams.get('title');
  const isEuropeana = source.id === 'europeana';

  if (!itemId && !explicitUrl) {
    sendJson(res, 400, { error: 'Missing id or url' });
    return;
  }
  if (isEuropeana && !itemId) {
    sendJson(res, 400, { error: 'Missing id' });
    return;
  }

  let remoteUrl;
  let checkHosts;
  let resolvedFilename = null;

  try {
    if (isEuropeana) {
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

  const contentType = remote.headers.get('content-type') ?? '';
  const normalizedType = contentType.split(';', 1)[0].trim().toLowerCase();
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
    urlPath = new URL(remoteUrl).pathname;
  } catch {
    urlPath = remoteUrl;
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
  if (rawPath === '/' || rawPath === '') file = join(resolve(publicDir), 'index.html');

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

export function createServer({ publicDir = join(PROJECT_ROOT, 'public'), sourcesOverride } = {}) {
  const sourceList = Array.isArray(sourcesOverride) ? sourcesOverride : registrySources;

  return createHttpServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendText(res, 405, 'Method not allowed');
        return;
      }

      if (url.pathname === '/api/sources') {
        await handleSources(res, sourceList);
        return;
      }
      if (url.pathname === '/api/search') {
        await handleSearch(url, res, sourceList);
        return;
      }
      if (url.pathname === '/api/download') {
        await handleDownload(url, req, res, sourceList);
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
