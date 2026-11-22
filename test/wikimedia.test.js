import test from 'node:test';
import assert from 'node:assert/strict';

import {
  COMMONS_TIMEOUT_MS,
  commonsLimiter,
  createLimiter,
  fetchCommonsJson,
  resetCommonsGate,
} from '../lib/wikimedia.js';
import { HttpError } from '../lib/http.js';

const URL_UNDER_TEST = 'https://commons.wikimedia.org/w/api.php?action=query';
const MESSAGE = 'Wikimedia Commons rate limit reached. Try again in a minute.';

const noLimiter = (fn) => fn();

function http429(retryAfterSeconds) {
  const err = new HttpError('commons.wikimedia.org answered HTTP 429', {
    status: 429,
    host: 'commons.wikimedia.org',
    code: 'HTTP',
  });
  if (retryAfterSeconds !== undefined) err.retryAfterSeconds = retryAfterSeconds;
  return err;
}

function fakeClock(start = 1_000_000) {
  let time = start;
  const sleeps = [];
  return {
    now: () => time,
    sleep: async (ms) => {
      sleeps.push(ms);
      time += ms;
    },
    advance: (ms) => {
      time += ms;
    },
    sleeps,
    time: () => time,
  };
}

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

test('paused gate answers RATE_LIMIT without a fetch', async () => {
  resetCommonsGate();
  const clock = fakeClock();
  let calls = 0;
  const fetchJson = async () => {
    calls += 1;
    throw http429(10);
  };
  const deps = {
    fetchJson,
    sleep: clock.sleep,
    now: clock.now,
    limiter: noLimiter,
  };

  await assert.rejects(fetchCommonsJson(URL_UNDER_TEST, deps), (err) => {
    assert.equal(err.code, 'RATE_LIMIT');
    return true;
  });
  assert.equal(calls, 1);

  await assert.rejects(fetchCommonsJson(URL_UNDER_TEST, deps), (err) => {
    assert.equal(err.code, 'RATE_LIMIT');
    assert.ok(err.retryAfterSeconds >= 9);
    return true;
  });

  assert.equal(calls, 1);
  assert.deepEqual(clock.sleeps, []);
});

test('429 sets the pause and throws at once', async () => {
  resetCommonsGate();
  const clock = fakeClock();
  let calls = 0;
  const fetchJson = async () => {
    calls += 1;
    throw http429(12);
  };
  const deps = {
    fetchJson,
    sleep: clock.sleep,
    now: clock.now,
    limiter: noLimiter,
  };

  await assert.rejects(fetchCommonsJson(URL_UNDER_TEST, deps), (err) => {
    assert.equal(err.code, 'RATE_LIMIT');
    assert.equal(err.message, MESSAGE);
    assert.equal(err.retryAfterSeconds, 12);
    return true;
  });
  assert.equal(calls, 1);
  assert.deepEqual(clock.sleeps, []);

  clock.advance(5000);
  await assert.rejects(fetchCommonsJson(URL_UNDER_TEST, deps), (err) => {
    assert.equal(err.code, 'RATE_LIMIT');
    return true;
  });
  assert.equal(calls, 1);
});

test('429 without Retry-After falls back to 5000 ms', async () => {
  resetCommonsGate();
  const clock = fakeClock();
  let calls = 0;
  const fetchJson = async () => {
    calls += 1;
    throw http429();
  };

  await assert.rejects(
    fetchCommonsJson(URL_UNDER_TEST, {
      fetchJson,
      sleep: clock.sleep,
      now: clock.now,
      limiter: noLimiter,
    }),
    (err) => {
      assert.equal(err.code, 'RATE_LIMIT');
      assert.equal(err.retryAfterSeconds, 5);
      return true;
    },
  );

  assert.equal(calls, 1);
});

test('429 with Retry-After 120 caps the pause at 30 000 ms', async () => {
  resetCommonsGate();
  const clock = fakeClock();
  let calls = 0;
  const fetchJson = async () => {
    calls += 1;
    throw http429(120);
  };

  await assert.rejects(
    fetchCommonsJson(URL_UNDER_TEST, {
      fetchJson,
      sleep: clock.sleep,
      now: clock.now,
      limiter: noLimiter,
    }),
    (err) => {
      assert.equal(err.code, 'RATE_LIMIT');
      assert.equal(err.retryAfterSeconds, 30);
      return true;
    },
  );

  assert.equal(calls, 1);
});

test('short pause of 1.5 s is waited', async () => {
  resetCommonsGate();
  const clock = fakeClock();
  let calls = 0;
  const fetchJson = async () => {
    calls += 1;
    if (calls === 1) throw http429(2);
    return { ok: true };
  };
  const deps = {
    fetchJson,
    sleep: clock.sleep,
    now: clock.now,
    limiter: noLimiter,
  };

  await assert.rejects(fetchCommonsJson(URL_UNDER_TEST, deps), (err) => {
    assert.equal(err.code, 'RATE_LIMIT');
    return true;
  });

  clock.advance(500);
  const result = await fetchCommonsJson(URL_UNDER_TEST, deps);

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(clock.sleeps, [1500]);
  assert.equal(calls, 2);
});

test('fetchCommonsJson rethrows other errors at once without sleeping', async () => {
  resetCommonsGate();
  const clock = fakeClock();
  let calls = 0;
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
      sleep: clock.sleep,
      now: clock.now,
      limiter: noLimiter,
    }),
    (err) => err === original,
  );

  assert.equal(calls, 1);
  assert.deepEqual(clock.sleeps, []);
});

test('fetchCommonsJson leaves at least 500 ms between two starts', async () => {
  resetCommonsGate();
  const clock = fakeClock();
  const startTimes = [];
  const fetchJson = async () => {
    startTimes.push(clock.now());
    return { ok: true };
  };

  const deps = {
    fetchJson,
    sleep: clock.sleep,
    now: clock.now,
    limiter: noLimiter,
  };

  await fetchCommonsJson(URL_UNDER_TEST, deps);
  await fetchCommonsJson(URL_UNDER_TEST, deps);

  assert.equal(startTimes.length, 2);
  assert.ok(startTimes[1] - startTimes[0] >= 500);
});

test('queued request fails fast when another request sets a pause', async () => {
  resetCommonsGate();
  const clock = fakeClock();
  const limiter = createLimiter(1);
  let calls = 0;
  const fetchJson = async () => {
    calls += 1;
    throw http429(20);
  };
  const deps = {
    fetchJson,
    sleep: clock.sleep,
    now: clock.now,
    limiter,
  };

  const a = fetchCommonsJson(URL_UNDER_TEST, deps);
  const b = fetchCommonsJson(URL_UNDER_TEST, deps);

  await assert.rejects(a, (err) => {
    assert.equal(err.code, 'RATE_LIMIT');
    return true;
  });
  await assert.rejects(b, (err) => {
    assert.equal(err.code, 'RATE_LIMIT');
    assert.ok(err.retryAfterSeconds >= 19);
    return true;
  });

  assert.equal(calls, 1);
  assert.deepEqual(clock.sleeps, []);
});

test('after the pause is over the next call fetches again', async () => {
  resetCommonsGate();
  const clock = fakeClock();
  let calls = 0;
  const fetchJson = async () => {
    calls += 1;
    if (calls === 1) throw http429(2);
    return { ok: true };
  };
  const deps = {
    fetchJson,
    sleep: clock.sleep,
    now: clock.now,
    limiter: noLimiter,
  };

  await assert.rejects(fetchCommonsJson(URL_UNDER_TEST, deps), (err) => {
    assert.equal(err.code, 'RATE_LIMIT');
    return true;
  });

  clock.advance(2500);
  const result = await fetchCommonsJson(URL_UNDER_TEST, deps);

  assert.deepEqual(result, { ok: true });
  assert.equal(calls, 2);
});

test('resetCommonsGate removes the pause of an old 429', async () => {
  resetCommonsGate();
  const clock = fakeClock();
  let calls = 0;
  const fetchJson = async () => {
    calls += 1;
    if (calls === 1) throw http429(20);
    return { ok: true };
  };
  const deps = {
    fetchJson,
    sleep: clock.sleep,
    now: clock.now,
    limiter: noLimiter,
  };

  await assert.rejects(fetchCommonsJson(URL_UNDER_TEST, deps), (err) => {
    assert.equal(err.code, 'RATE_LIMIT');
    return true;
  });

  resetCommonsGate();
  const result = await fetchCommonsJson(URL_UNDER_TEST, deps);

  assert.deepEqual(result, { ok: true });
  assert.equal(calls, 2);
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

test('commonsLimiter(1) runs one task at a time in FIFO order', async () => {
  const started = [];
  const resolvers = [];
  let active = 0;
  let maxActive = 0;

  const tasks = [];
  for (let i = 0; i < 3; i += 1) {
    tasks.push(
      commonsLimiter(() => {
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
  assert.deepEqual(started, [0]);

  resolvers.shift()();
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
  assert.deepEqual(started, [0, 1]);

  resolvers.shift()();
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
  assert.deepEqual(started, [0, 1, 2]);

  resolvers.shift()();
  const results = await Promise.all(tasks);
  assert.deepEqual(results, [0, 1, 2]);
  assert.equal(maxActive, 1);
});

test('two fetchCommonsJson calls in sequence keep a 500 ms gap', async () => {
  resetCommonsGate();
  const clock = fakeClock();
  const startTimes = [];
  const fetchJson = async () => {
    startTimes.push(clock.now());
    return { ok: true };
  };

  const deps = {
    fetchJson,
    sleep: clock.sleep,
    now: clock.now,
    limiter: noLimiter,
  };

  await fetchCommonsJson(URL_UNDER_TEST, deps);
  await fetchCommonsJson(URL_UNDER_TEST, deps);

  assert.equal(startTimes.length, 2);
  assert.ok(startTimes[1] - startTimes[0] >= 500);
  assert.deepEqual(clock.sleeps, [500]);
});

test('a TIMEOUT is retried once after the gap', async () => {
  resetCommonsGate();
  const clock = fakeClock();
  const startTimes = [];
  let calls = 0;
  const fetchJson = async () => {
    calls += 1;
    startTimes.push(clock.now());
    if (calls === 1) {
      throw new HttpError('commons.wikimedia.org did not answer in 20 s', {
        host: 'commons.wikimedia.org',
        code: 'TIMEOUT',
      });
    }
    return { ok: true };
  };

  const result = await fetchCommonsJson(URL_UNDER_TEST, {
    fetchJson,
    sleep: clock.sleep,
    now: clock.now,
    limiter: noLimiter,
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(calls, 2);
  assert.equal(startTimes[1] - startTimes[0], 500);
});

test('a second TIMEOUT is thrown unchanged', async () => {
  resetCommonsGate();
  const clock = fakeClock();
  let calls = 0;
  const fetchJson = async () => {
    calls += 1;
    throw new HttpError('commons.wikimedia.org did not answer in 20 s', {
      host: 'commons.wikimedia.org',
      code: 'TIMEOUT',
    });
  };

  await assert.rejects(
    fetchCommonsJson(URL_UNDER_TEST, {
      fetchJson,
      sleep: clock.sleep,
      now: clock.now,
      limiter: noLimiter,
    }),
    (err) => {
      assert.equal(err.code, 'TIMEOUT');
      return true;
    },
  );
  assert.equal(calls, 2);
});

test('total-wait limit still applies after waiting in the limiter', async () => {
  resetCommonsGate();
  const clock = fakeClock();
  const limiter = createLimiter(1);
  let releaseA;
  const aGate = new Promise((resolve) => {
    releaseA = resolve;
  });
  const fetchJsonA = async () => {
    await aGate;
    clock.advance(50_000);
    return { ok: 'a' };
  };
  const fetchJsonB = async () => ({ ok: 'b' });

  const a = fetchCommonsJson(URL_UNDER_TEST, {
    fetchJson: fetchJsonA,
    sleep: clock.sleep,
    now: clock.now,
    limiter,
  });
  const b = fetchCommonsJson(URL_UNDER_TEST, {
    fetchJson: fetchJsonB,
    sleep: clock.sleep,
    now: clock.now,
    limiter,
  });

  releaseA();

  assert.deepEqual(await a, { ok: 'a' });
  await assert.rejects(b, (err) => {
    assert.equal(err.code, 'RATE_LIMIT');
    assert.equal(err.message, MESSAGE);
    return true;
  });

  assert.deepEqual(clock.sleeps, []);
});

test('fetchCommonsJson passes the Commons timeout to the default fetch', async () => {
  resetCommonsGate();
  let seenOptions = null;
  const fetchJson = async (url, opts) => {
    seenOptions = opts;
    return { ok: true };
  };

  await fetchCommonsJson(URL_UNDER_TEST, {
    fetchJson,
    sleep: async () => {},
    now: () => 0,
    limiter: noLimiter,
  });

  assert.equal(COMMONS_TIMEOUT_MS, 20000);
  assert.deepEqual(seenOptions, { timeoutMs: 20000 });
});

