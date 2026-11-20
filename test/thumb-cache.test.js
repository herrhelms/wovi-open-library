import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  MAX_THUMB_BYTES,
  MEDIA_ID_PATTERN,
  createThumbCache,
  isBlockedHost,
} from '../lib/thumb-cache.js';

const ID_A = `m${'a'.repeat(24)}`;
const ID_B = `m${'b'.repeat(24)}`;
const ID_C = `m${'c'.repeat(24)}`;

function imageResponse(bytes, type = 'image/jpeg', headers = {}) {
  return new Response(bytes, {
    status: 200,
    headers: { 'content-type': type, ...headers },
  });
}

function redirectResponse(location, status = 302) {
  return new Response(null, { status, headers: { location } });
}

function makeDir() {
  const dir = mkdtempSync(join(tmpdir(), 'olf-thumb-'));
  return {
    dir,
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function makeCache(overrides = {}) {
  const temp = makeDir();
  const logs = [];
  const cache = createThumbCache({
    dir: temp.dir,
    log: (line) => logs.push(line),
    ...overrides,
  });
  return {
    cache,
    dir: temp.dir,
    logs,
    cleanup() {
      temp.cleanup();
    },
  };
}

function publicUrl(path = '') {
  return `https://img.example.org/a.jpg${path}`;
}

test('isBlockedHost', () => {
  for (const host of [
    'localhost',
    'LOCALHOST.',
    'a.localhost',
    '127.0.0.1',
    '127.9.9.9',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '0.0.0.0',
    '::1',
    '[::1]',
    '::',
    'fd00::1',
    'fe80::1',
    '[::ffff:7f00:1]',
    '',
  ]) {
    assert.equal(isBlockedHost(host), true, host);
  }

  for (const host of [
    'example.org',
    '172.32.0.1',
    '8.8.8.8',
    '2001:db8::1',
    'localhost.example.org',
  ]) {
    assert.equal(isBlockedHost(host), false, host);
  }
});

test('warm for an unregistered ID is unknown and does not fetch', async () => {
  let calls = 0;
  const ctx = makeCache({
    fetch: async () => {
      calls += 1;
      return imageResponse(Buffer.from([1]));
    },
  });
  try {
    assert.equal(ctx.cache.warm(ID_A), 'unknown');
    await ctx.cache.idle();
    assert.equal(calls, 0);
  } finally {
    ctx.cleanup();
  }
});

test('register + warm stores image and JSON then reports cached', async () => {
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x42]);
  let calls = 0;
  const ctx = makeCache({
    fetch: async () => {
      calls += 1;
      return imageResponse(bytes, 'image/jpeg; charset=binary');
    },
  });
  try {
    assert.equal(MEDIA_ID_PATTERN.test(ID_A), true);
    ctx.cache.register(ID_A, publicUrl());
    assert.equal(ctx.cache.has(ID_A), false);
    assert.equal(ctx.cache.warm(ID_A), 'queued');
    await ctx.cache.idle();

    assert.equal(calls, 1);
    assert.equal(ctx.cache.has(ID_A), true);
    assert.deepEqual(readFileSync(join(ctx.dir, ID_A)), bytes);
    const meta = JSON.parse(readFileSync(join(ctx.dir, `${ID_A}.json`), 'utf8'));
    assert.equal(meta.url, publicUrl());
    assert.equal(meta.contentType, 'image/jpeg');
    assert.equal(meta.bytes, bytes.length);
    assert.equal(typeof meta.storedAt, 'number');
    assert.equal(ctx.cache.warm(ID_A), 'cached');
    assert.equal(ctx.cache.totalBytes(), bytes.length);
  } finally {
    ctx.cleanup();
  }
});

test('two warm calls for the same ID before idle give one fetch', async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const ctx = makeCache({
    fetch: async () => {
      calls += 1;
      await gate;
      return imageResponse(Buffer.from([1, 2, 3]));
    },
  });
  try {
    ctx.cache.register(ID_A, publicUrl());
    assert.equal(ctx.cache.warm(ID_A), 'queued');
    assert.equal(ctx.cache.warm(ID_A), 'queued');
    release();
    await ctx.cache.idle();
    assert.equal(calls, 1);
  } finally {
    ctx.cleanup();
  }
});

test('SVG is not kept and logs one line', async () => {
  const ctx = makeCache({
    fetch: async () => imageResponse('<svg/>', 'image/svg+xml'),
  });
  try {
    ctx.cache.register(ID_A, publicUrl());
    ctx.cache.warm(ID_A);
    await ctx.cache.idle();
    assert.equal(ctx.cache.has(ID_A), false);
    assert.equal(ctx.logs.length, 1);
    assert.match(ctx.logs[0], /^\[thumb m[a-f0-9]{24}\] img\.example\.org: /);
  } finally {
    ctx.cleanup();
  }
});

test('text/html is not kept', async () => {
  const ctx = makeCache({
    fetch: async () => imageResponse('<html></html>', 'text/html'),
  });
  try {
    ctx.cache.register(ID_A, publicUrl());
    ctx.cache.warm(ID_A);
    await ctx.cache.idle();
    assert.equal(ctx.cache.has(ID_A), false);
    assert.equal(ctx.logs.length, 1);
  } finally {
    ctx.cleanup();
  }
});

test('status 404 is not kept', async () => {
  const ctx = makeCache({
    fetch: async () => new Response('missing', { status: 404 }),
  });
  try {
    ctx.cache.register(ID_A, publicUrl());
    ctx.cache.warm(ID_A);
    await ctx.cache.idle();
    assert.equal(ctx.cache.has(ID_A), false);
  } finally {
    ctx.cleanup();
  }
});

test('a content-length above the limit is not read', async () => {
  let cancelled = false;
  const body = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(1));
    },
    cancel() {
      cancelled = true;
    },
  });
  const ctx = makeCache({
    fetch: async () =>
      new Response(body, {
        status: 200,
        headers: {
          'content-type': 'image/jpeg',
          'content-length': String(MAX_THUMB_BYTES + 1),
        },
      }),
  });
  try {
    ctx.cache.register(ID_A, publicUrl());
    ctx.cache.warm(ID_A);
    await ctx.cache.idle();
    assert.equal(ctx.cache.has(ID_A), false);
    assert.equal(cancelled, true);
  } finally {
    ctx.cleanup();
  }
});

test('a streamed body above the limit is not kept', async () => {
  const chunk = new Uint8Array(1024 * 1024);
  let sent = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (sent >= MAX_THUMB_BYTES + 1024 * 1024) {
        controller.close();
        return;
      }
      sent += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });
  const ctx = makeCache({
    fetch: async () =>
      new Response(body, {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      }),
  });
  try {
    ctx.cache.register(ID_A, publicUrl());
    ctx.cache.warm(ID_A);
    await ctx.cache.idle();
    assert.equal(ctx.cache.has(ID_A), false);
    assert.equal(ctx.logs.length, 1);
  } finally {
    ctx.cleanup();
  }
});

test('a blocked first URL sends no request', async () => {
  let calls = 0;
  const ctx = makeCache({
    fetch: async () => {
      calls += 1;
      return imageResponse(Buffer.from([1]));
    },
  });
  try {
    ctx.cache.register(ID_A, 'http://127.0.0.1/a.jpg');
    ctx.cache.warm(ID_A);
    await ctx.cache.idle();
    assert.equal(calls, 0);
    assert.equal(ctx.cache.has(ID_A), false);
  } finally {
    ctx.cleanup();
  }
});

test('a redirect to a blocked host sends only the first request', async () => {
  let calls = 0;
  const ctx = makeCache({
    fetch: async () => {
      calls += 1;
      return redirectResponse('http://127.0.0.1/x');
    },
  });
  try {
    ctx.cache.register(ID_A, 'https://img.example.org/a.jpg');
    ctx.cache.warm(ID_A);
    await ctx.cache.idle();
    assert.equal(calls, 1);
    assert.equal(ctx.cache.has(ID_A), false);
  } finally {
    ctx.cleanup();
  }
});

test('a redirect to a public host is kept', async () => {
  const seen = [];
  const ctx = makeCache({
    fetch: async (url) => {
      seen.push(url);
      if (seen.length === 1) return redirectResponse('https://cdn.example.net/b.jpg');
      return imageResponse(Buffer.from([9, 9]));
    },
  });
  try {
    ctx.cache.register(ID_A, 'https://img.example.org/a.jpg');
    ctx.cache.warm(ID_A);
    await ctx.cache.idle();
    assert.equal(seen.length, 2);
    assert.equal(seen[1], 'https://cdn.example.net/b.jpg');
    assert.equal(ctx.cache.has(ID_A), true);
  } finally {
    ctx.cleanup();
  }
});

test('six redirects are refused', async () => {
  let calls = 0;
  const ctx = makeCache({
    fetch: async () => {
      calls += 1;
      return redirectResponse(`https://cdn.example.net/r${calls}`);
    },
  });
  try {
    ctx.cache.register(ID_A, 'https://img.example.org/a.jpg');
    ctx.cache.warm(ID_A);
    await ctx.cache.idle();
    assert.equal(calls, 6);
    assert.equal(ctx.cache.has(ID_A), false);
  } finally {
    ctx.cleanup();
  }
});

test('the log line has no path or query', async () => {
  const ctx = makeCache({
    fetch: async () => new Response('no', { status: 404 }),
  });
  try {
    ctx.cache.register(ID_A, 'https://img.example.org/secret/path.jpg?token=abc');
    ctx.cache.warm(ID_A);
    await ctx.cache.idle();
    assert.equal(ctx.logs.length, 1);
    assert.ok(!ctx.logs[0].includes('/secret'));
    assert.ok(!ctx.logs[0].includes('token'));
    assert.ok(ctx.logs[0].includes('img.example.org'));
  } finally {
    ctx.cleanup();
  }
});

test('maxConcurrent limits running fetches', async () => {
  const gates = [];
  let active = 0;
  let peak = 0;
  const ctx = makeCache({
    maxConcurrent: 1,
    fetch: async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => gates.push(resolve));
      active -= 1;
      return imageResponse(Buffer.from([1]));
    },
  });
  try {
    for (const id of [ID_A, ID_B, ID_C]) {
      ctx.cache.register(id, publicUrl());
      assert.equal(ctx.cache.warm(id), 'queued');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(active, 1);
    while (gates.length > 0) {
      gates.shift()();
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await ctx.cache.idle();
    assert.equal(peak, 1);
  } finally {
    ctx.cleanup();
  }
});

test('a full queue answers full', async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const ctx = makeCache({
    maxConcurrent: 1,
    maxQueue: 1,
    fetch: async () => {
      await gate;
      return imageResponse(Buffer.from([1]));
    },
  });
  try {
    ctx.cache.register(ID_A, publicUrl());
    ctx.cache.register(ID_B, publicUrl());
    ctx.cache.register(ID_C, publicUrl());
    assert.equal(ctx.cache.warm(ID_A), 'queued');
    assert.equal(ctx.cache.warm(ID_B), 'queued');
    assert.equal(ctx.cache.warm(ID_C), 'full');
    release();
    await ctx.cache.idle();
  } finally {
    ctx.cleanup();
  }
});

test('eviction removes the oldest entries', async () => {
  let clock = 0;
  const ctx = makeCache({
    maxBytes: 1000,
    now: () => {
      clock += 1;
      return clock;
    },
    fetch: async () => imageResponse(Buffer.alloc(400, 1)),
  });
  try {
    for (const id of [ID_A, ID_B, ID_C]) {
      ctx.cache.register(id, publicUrl());
      ctx.cache.warm(id);
      await ctx.cache.idle();
    }
    assert.ok(ctx.cache.totalBytes() <= 900);
    assert.equal(ctx.cache.has(ID_A), false);
    assert.equal(existsSync(join(ctx.dir, ID_A)), false);
    assert.equal(existsSync(join(ctx.dir, `${ID_A}.json`)), false);
    assert.equal(ctx.cache.has(ID_B), true);
    assert.equal(ctx.cache.has(ID_C), true);
  } finally {
    ctx.cleanup();
  }
});

test('a new cache reads the index again and ignores stray files', async () => {
  const bytes = Buffer.from([7, 7, 7]);
  const ctx = makeCache({
    fetch: async () => imageResponse(bytes),
  });
  try {
    ctx.cache.register(ID_A, publicUrl());
    ctx.cache.warm(ID_A);
    await ctx.cache.idle();
    assert.equal(ctx.cache.has(ID_A), true);

    writeFileSync(join(ctx.dir, 'foo.txt'), 'x');
    writeFileSync(join(ctx.dir, ID_B), 'no json');
    writeFileSync(join(ctx.dir, `${ID_C}.json`), '{broken');
    writeFileSync(join(ctx.dir, ID_C), 'bytes');

    const reopened = createThumbCache({ dir: ctx.dir, log: () => {} });
    assert.equal(reopened.has(ID_A), true);
    assert.equal(reopened.has(ID_B), false);
    assert.equal(reopened.has(ID_C), false);
    assert.equal(reopened.totalBytes(), bytes.length);
    assert.equal(reopened.entry(ID_A).contentType, 'image/jpeg');
  } finally {
    ctx.cleanup();
  }
});

test('a missing directory starts empty', () => {
  const dir = join(tmpdir(), `olf-thumb-missing-${process.pid}-${Date.now()}`);
  const cache = createThumbCache({ dir, log: () => {} });
  assert.equal(cache.totalBytes(), 0);
  assert.equal(cache.has(ID_A), false);
});
