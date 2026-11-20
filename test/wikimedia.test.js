import test from 'node:test';
import assert from 'node:assert/strict';

import { createLimiter, fetchCommonsJson } from '../lib/wikimedia.js';
import { HttpError } from '../lib/http.js';

const URL_UNDER_TEST = 'https://commons.wikimedia.org/w/api.php?action=query';

function http429(retryAfterSeconds) {
  const err = new HttpError('commons.wikimedia.org answered HTTP 429', {
    status: 429,
    host: 'commons.wikimedia.org',
    code: 'HTTP',
  });
  if (retryAfterSeconds !== undefined) err.retryAfterSeconds = retryAfterSeconds;
  return err;
}

const noLimiter = (fn) => fn();

test('createLimiter(2) runs at most two tasks at once and in FIFO order', async () => {
  const run = createLimiter(2);
  const resolvers = [];
  const started = [];
  let active = 0;
  let maxActive = 0;

  const tasks = [];
  for (let i = 0; i < 5; i += 1) {
    tasks.push(
      run(() => {
        started.push(i);
        active += 1;
        maxActive = Math.max(maxActive, active);
        return new Promise((resolve) => {
          resolvers.push(() => {
            active -= 1;
            resolve(i);
          });
        });
      }),
    );
  }

  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(started, [0, 1]);
  assert.equal(maxActive, 2);

  while (resolvers.length > 0) {
    resolvers.shift()();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  const results = await Promise.all(tasks);
  assert.deepEqual(results, [0, 1, 2, 3, 4]);
  assert.deepEqual(started, [0, 1, 2, 3, 4]);
  assert.equal(maxActive, 2);
});

test('fetchCommonsJson retries once after a 429 and sleeps 2000 ms by default', async () => {
  let calls = 0;
  const sleeps = [];
  const fetchJson = async () => {
    calls += 1;
    if (calls === 1) throw http429();
    return { ok: true };
  };

  const result = await fetchCommonsJson(URL_UNDER_TEST, {
    fetchJson,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    limiter: noLimiter,
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [2000]);
});

test('fetchCommonsJson uses Retry-After seconds', async () => {
  const sleeps = [];
  let calls = 0;
  const fetchJson = async () => {
    calls += 1;
    if (calls === 1) throw http429(3);
    return { ok: true };
  };

  const result = await fetchCommonsJson(URL_UNDER_TEST, {
    fetchJson,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    limiter: noLimiter,
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [3000]);
});

test('fetchCommonsJson caps the wait at 5000 ms', async () => {
  const sleeps = [];
  let calls = 0;
  const fetchJson = async () => {
    calls += 1;
    if (calls === 1) throw http429(60);
    return { ok: true };
  };

  const result = await fetchCommonsJson(URL_UNDER_TEST, {
    fetchJson,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    limiter: noLimiter,
  });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(sleeps, [5000]);
});

test('fetchCommonsJson gives up after a second 429', async () => {
  let calls = 0;
  let sleeps = 0;
  const fetchJson = async () => {
    calls += 1;
    throw http429();
  };

  await assert.rejects(
    fetchCommonsJson(URL_UNDER_TEST, {
      fetchJson,
      sleep: async () => {
        sleeps += 1;
      },
      limiter: noLimiter,
    }),
    (err) => {
      assert.equal(err.code, 'RATE_LIMIT');
      assert.equal(err.message, 'Wikimedia Commons rate limit reached. Try again in a minute.');
      return true;
    },
  );

  assert.equal(calls, 2);
  assert.equal(sleeps, 1);
});

test('fetchCommonsJson rethrows other errors at once without sleeping', async () => {
  let calls = 0;
  let sleeps = 0;
  const original = new HttpError('commons.wikimedia.org answered HTTP 500', {
    status: 500,
    host: 'commons.wikimedia.org',
    code: 'HTTP',
  });
  const fetchJson = async () => {
    calls += 1;
    throw original;
  };

  await assert.rejects(
    fetchCommonsJson(URL_UNDER_TEST, {
      fetchJson,
      sleep: async () => {
        sleeps += 1;
      },
      limiter: noLimiter,
    }),
    (err) => err === original,
  );

  assert.equal(calls, 1);
  assert.equal(sleeps, 0);
});

test('a throwing task does not block the limiter', async () => {
  const run = createLimiter(1);
  const failure = new Error('boom');

  const failing = run(async () => {
    throw failure;
  });
  let ran = false;
  const next = run(async () => {
    ran = true;
    return 'ok';
  });

  await assert.rejects(failing, (err) => err === failure);
  assert.equal(await next, 'ok');
  assert.equal(ran, true);
});
