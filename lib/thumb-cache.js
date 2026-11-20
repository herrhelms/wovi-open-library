import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { isIP } from 'node:net';
import { join } from 'node:path';

import { fetchWithTimeout } from './http.js';
import { cacheSet } from './util.js';

export const MEDIA_ID_PATTERN = /^m[0-9a-f]{24}$/;
export const MAX_THUMB_BYTES = 10 * 1024 * 1024;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

function blockedIpv4(parts) {
  const [a, b, c, d] = parts;
  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 0 && b === 0 && c === 0 && d === 0) return true;
  return false;
}

function parseIpv6(input) {
  let value = input;
  if (value.startsWith('[') && value.endsWith(']')) value = value.slice(1, -1);
  const zone = value.indexOf('%');
  if (zone !== -1) value = value.slice(0, zone);

  // An embedded IPv4 tail becomes two IPv6 groups.
  const lastColon = value.lastIndexOf(':');
  if (lastColon !== -1) {
    const tail = value.slice(lastColon + 1);
    if (tail.includes('.')) {
      if (isIP(tail) !== 4) return null;
      const parts = tail.split('.').map(Number);
      const high = ((parts[0] << 8) | parts[1]).toString(16);
      const low = ((parts[2] << 8) | parts[3]).toString(16);
      value = `${value.slice(0, lastColon + 1)}${high}:${low}`;
    }
  }

  const doubleAt = value.indexOf('::');
  let groups;
  if (doubleAt !== -1) {
    if (value.indexOf('::', doubleAt + 2) !== -1) return null;
    const left = value.slice(0, doubleAt);
    const right = value.slice(doubleAt + 2);
    const head = left === '' ? [] : left.split(':');
    const tail = right === '' ? [] : right.split(':');
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    groups = [...head, ...new Array(missing).fill('0'), ...tail];
  } else {
    groups = value.split(':');
    if (groups.length !== 8) return null;
  }

  const parsed = [];
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
    parsed.push(Number.parseInt(group, 16));
  }
  return parsed;
}

function blockedIpv6(groups) {
  if (groups.every((group) => group === 0)) return true; // ::
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) {
    return true; // ::1
  }
  if ((groups[0] & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((groups[0] & 0xffc0) === 0xfe80) return true; // fe80::/10
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    // ::ffff:0:0/96 (IPv4-mapped)
    const a = groups[6] >> 8;
    const b = groups[6] & 0xff;
    const c = groups[7] >> 8;
    const d = groups[7] & 0xff;
    return blockedIpv4([a, b, c, d]);
  }
  return false;
}

/**
 * Tell whether a host must not be fetched (loopback, private, link-local).
 *
 * @param {unknown} hostname
 * @returns {boolean}
 */
export function isBlockedHost(hostname) {
  if (typeof hostname !== 'string') return true;
  let host = hostname.trim().toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (host === '') return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;

  const version = isIP(host);
  if (version === 4) return blockedIpv4(host.split('.').map(Number));
  if (version === 6) {
    const groups = parseIpv6(host);
    return groups === null ? false : blockedIpv6(groups);
  }
  return false;
}

function normalizeContentType(value) {
  return String(value ?? '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
}

async function cancelBody(res) {
  try {
    await res.body?.cancel();
  } catch {
    // Ignore a body that cannot be cancelled.
  }
}

async function readLimited(res, limit) {
  if (!res.body) {
    const bytes = Buffer.from(await res.arrayBuffer());
    return bytes.length > limit ? null : bytes;
  }

  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        try {
          await reader.cancel();
        } catch {
          // Ignore.
        }
        return null;
      }
      chunks.push(Buffer.from(value));
    }
  } catch (err) {
    try {
      await reader.cancel();
    } catch {
      // Ignore.
    }
    throw err;
  }
  return Buffer.concat(chunks, total);
}

function safeHost(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * Create the thumbnail disk cache.
 *
 * @param {{
 *   dir: string,
 *   maxBytes?: number,
 *   fetch?: (url: string, opts?: object) => Promise<Response>,
 *   now?: () => number,
 *   maxConcurrent?: number,
 *   maxQueue?: number,
 *   maxRegistered?: number,
 *   log?: (line: string) => void,
 * }} options
 */
export function createThumbCache({
  dir,
  maxBytes = 500 * 1024 * 1024,
  fetch = fetchWithTimeout,
  now = Date.now,
  maxConcurrent = 4,
  maxQueue = 500,
  maxRegistered = 20_000,
  log = (line) => process.stderr.write(line),
} = {}) {
  if (typeof dir !== 'string' || dir === '') {
    throw new TypeError('createThumbCache needs a dir');
  }

  const index = new Map();
  const registered = new Map();
  const pending = new Set();
  const queue = [];
  const idleWaiters = [];
  let running = 0;
  let dirReady = false;

  function ensureDir() {
    if (dirReady) return;
    mkdirSync(dir, { recursive: true });
    dirReady = true;
  }

  // Read the directory one time at start. A missing directory is empty.
  try {
    const names = readdirSync(dir);
    const nameSet = new Set(names);
    for (const name of names) {
      if (!MEDIA_ID_PATTERN.test(name)) continue;
      const jsonName = `${name}.json`;
      if (!nameSet.has(jsonName)) continue;
      let meta;
      try {
        meta = JSON.parse(readFileSync(join(dir, jsonName), 'utf8'));
      } catch {
        continue;
      }
      if (!meta || typeof meta !== 'object') continue;
      if (typeof meta.contentType !== 'string') continue;
      if (typeof meta.bytes !== 'number' || !Number.isFinite(meta.bytes)) continue;
      if (typeof meta.storedAt !== 'number' || !Number.isFinite(meta.storedAt)) continue;
      index.set(name, {
        file: join(dir, name),
        contentType: meta.contentType,
        bytes: meta.bytes,
        storedAt: meta.storedAt,
      });
    }
  } catch {
    // No directory yet.
  }

  function totalBytes() {
    let total = 0;
    for (const entry of index.values()) total += entry.bytes;
    return total;
  }

  function writeAtomic(name, data) {
    ensureDir();
    const target = join(dir, name);
    const temp = join(dir, `.tmp-${randomUUID()}-${name}`);
    try {
      writeFileSync(temp, data);
      renameSync(temp, target);
    } catch (err) {
      try {
        rmSync(temp, { force: true });
      } catch {
        // Ignore.
      }
      throw err;
    }
  }

  function remove(mediaId) {
    if (!index.has(mediaId)) return false;
    index.delete(mediaId);
    try {
      rmSync(join(dir, mediaId), { force: true });
    } catch {
      // Ignore.
    }
    try {
      rmSync(join(dir, `${mediaId}.json`), { force: true });
    } catch {
      // Ignore.
    }
    return true;
  }

  function evict(keepId) {
    if (totalBytes() <= maxBytes) return;
    const target = maxBytes * 0.9;
    const oldest = [...index.entries()].sort(
      (a, b) => a[1].storedAt - b[1].storedAt,
    );
    for (const [id, entry] of oldest) {
      if (totalBytes() <= target) break;
      if (id === keepId && entry.bytes <= target) continue;
      remove(id);
    }
  }

  function logFailure(mediaId, host, reason) {
    log(`[thumb ${mediaId}] ${host}: ${reason}\n`);
  }

  async function fetchThumb(mediaId, url) {
    let current;
    try {
      current = new URL(url);
    } catch {
      logFailure(mediaId, '', 'invalid URL');
      return;
    }

    try {
      if (current.protocol !== 'http:' && current.protocol !== 'https:') {
        logFailure(mediaId, current.hostname, 'bad protocol');
        return;
      }

      let redirects = 0;
      let res;
      while (true) {
        if (isBlockedHost(current.hostname)) {
          logFailure(mediaId, current.hostname, 'blocked host');
          return;
        }

        res = await fetch(current.href, { redirect: 'manual', timeoutMs: 20000 });

        if (REDIRECT_STATUSES.has(res.status)) {
          const location = res.headers.get('location');
          await cancelBody(res);
          if (!location) {
            logFailure(mediaId, current.hostname, 'redirect without location');
            return;
          }
          if (redirects >= MAX_REDIRECTS) {
            logFailure(mediaId, current.hostname, 'too many redirects');
            return;
          }
          redirects += 1;
          let next;
          try {
            next = new URL(location, current);
          } catch {
            logFailure(mediaId, current.hostname, 'invalid redirect');
            return;
          }
          if (next.protocol !== 'http:' && next.protocol !== 'https:') {
            logFailure(mediaId, current.hostname, 'bad redirect scheme');
            return;
          }
          current = next;
          continue;
        }
        break;
      }

      if (res.status !== 200) {
        await cancelBody(res);
        logFailure(mediaId, current.hostname, `HTTP ${res.status}`);
        return;
      }

      const contentType = normalizeContentType(res.headers.get('content-type'));
      if (!contentType.startsWith('image/') || contentType === 'image/svg+xml') {
        await cancelBody(res);
        logFailure(mediaId, current.hostname, 'not an image');
        return;
      }

      const contentLength = Number(res.headers.get('content-length'));
      if (Number.isFinite(contentLength) && contentLength > MAX_THUMB_BYTES) {
        await cancelBody(res);
        logFailure(mediaId, current.hostname, 'too large');
        return;
      }

      let bytes;
      try {
        bytes = await readLimited(res, MAX_THUMB_BYTES);
      } catch {
        logFailure(mediaId, current.hostname, 'body read failed');
        return;
      }
      if (bytes === null) {
        logFailure(mediaId, current.hostname, 'too large');
        return;
      }

      const storedAt = now();
      const meta = { url, contentType, bytes: bytes.length, storedAt };
      writeAtomic(mediaId, bytes);
      writeAtomic(`${mediaId}.json`, Buffer.from(JSON.stringify(meta), 'utf8'));
      index.set(mediaId, {
        file: join(dir, mediaId),
        contentType,
        bytes: bytes.length,
        storedAt,
      });
      evict(mediaId);
    } catch (err) {
      const host = safeHost(current.href);
      const reason =
        typeof err?.code === 'string' && err.code !== '' ? err.code : 'request failed';
      logFailure(mediaId, host, reason);
    }
  }

  function pump() {
    while (running < maxConcurrent && queue.length > 0) {
      const mediaId = queue.shift();
      const url = registered.get(mediaId);
      running += 1;
      const job = (url ? fetchThumb(mediaId, url) : Promise.resolve())
        .catch(() => {
          // fetchThumb never throws, but a job must not break the queue.
        })
        .finally(() => {
          running -= 1;
          pending.delete(mediaId);
          pump();
          if (running === 0 && queue.length === 0) {
            while (idleWaiters.length > 0) idleWaiters.shift()();
          }
        });
      void job;
    }
  }

  function register(mediaId, url) {
    if (typeof mediaId !== 'string' || !MEDIA_ID_PATTERN.test(mediaId)) return;
    if (typeof url !== 'string' || url.trim() === '') return;
    cacheSet(registered, mediaId, url, maxRegistered);
  }

  function has(mediaId) {
    return index.has(mediaId);
  }

  function entry(mediaId) {
    const found = index.get(mediaId);
    if (!found) return null;
    return { ...found };
  }

  function warm(mediaId) {
    if (typeof mediaId !== 'string' || !registered.has(mediaId)) return 'unknown';
    if (index.has(mediaId)) return 'cached';
    if (pending.has(mediaId)) return 'queued';
    if (queue.length >= maxQueue) return 'full';
    pending.add(mediaId);
    queue.push(mediaId);
    pump();
    return 'queued';
  }

  function idle() {
    if (running === 0 && queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => idleWaiters.push(resolve));
  }

  return {
    register,
    has,
    entry,
    warm,
    totalBytes,
    idle,
    remove,
  };
}
