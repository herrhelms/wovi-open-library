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

test('fetchCommonsJson waits Retry-After seconds after a 429', async () => {
  resetCommonsGate();
  const clock = fakeClock();
  const startTimes = [];
  let calls = 0;
  const fetchJson = async () => {
    calls += 1;
    startTimes.push(clock.now());
    if (calls === 1) {
      const at = clock.now();
      throw Object.assign(http429(12), { at });
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
  assert.equal(startTimes[1] - startTimes[0], 12_000);
});

test('fetchCommonsJson uses 5000 ms when Retry-After is missing', async () => {
  resetCommonsGate();
  const clock = fakeClock();
  const startTimes = [];
  let calls = 0;
  const fetchJson = async () => {
    calls += 1;
    startTimes.push(clock.now());
    if (calls === 1) throw http429();
    return { ok: true };
  };

  const result = await fetchCommonsJson(URL_UNDER_TEST, {
    fetchJson,
    sleep: clock.sleep,
    now: clock.now,
    limiter: noLimiter,
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(startTimes[1] - startTimes[0], 5000);
});

test('fetchCommonsJson caps the pause at 30 000 ms', async () => {
  resetCommonsGate();
  const clock = fakeClock();
  const startTimes = [];
  let calls = 0;
  const fetchJson = async () => {
    calls += 1;
    startTimes.push(clock.now());
    if (calls === 1) throw http429(60);
    return { ok: true };
  };

  await fetchCommonsJson(URL_UNDER_TEST, {
    fetchJson,
    sleep: clock.sleep,
    now: clock.now,
    limiter: noLimiter,
  });

  assert.equal(startTimes[1] - startTimes[0], 30_000);
});

test('fetchCommonsJson gives up after five 429 answers', async () => {
  resetCommonsGate();
  const clock = fakeClock();
  let calls = 0;
  const fetchJson = async () => {
    calls += 1;
    throw http429(1);
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
      assert.equal(err.message, MESSAGE);
      assert.equal(typeof err.retryAfterSeconds, 'number');
      assert.ok(err.retryAfterSeconds >= 5);
      return true;
    },
  );

  assert.equal(calls, 5);
});

test('fetchCommonsJson stops before the third fetch when the total wait is too long', async () => {
  resetCommonsGate();
  const clock = fakeClock();
  let calls = 0;
  const fetchJson = async () => {
    calls += 1;
    throw http429(30);
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
      assert.equal(err.message, MESSAGE);
      return true;
    },
  );

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

test('a 429 pauses other queued requests', async () => {
  resetCommonsGate();
  const clock = fakeClock(5_000_000);
  const limiter = createLimiter(2);
  const startTimes = new Map();

  let noteASleep = null;
  const aSleeping = new Promise((resolve) => {
    noteASleep = resolve;
  });

  const calls = { a: 0, b: 0, c: 0 };
  const fetcher = (name) => async () => {
    calls[name] += 1;
    startTimes.set(`${name}${calls[name]}`, clock.now());
    if (name === 'a' && calls.a === 1) throw http429(10);
    return { ok: name };
  };

  const deps = (name) => ({
    fetchJson: fetcher(name),
    sleep: async (ms) => {
      if (name === 'a') noteASleep();
      await clock.sleep(ms);
    },
    now: clock.now,
    limiter,
  });

  const a = fetchCommonsJson(URL_UNDER_TEST, deps('a'));
  // A has sent its first request and is now paused for 10 s.
  await aSleeping;
  const b = fetchCommonsJson(URL_UNDER_TEST, deps('b'));
  const c = fetchCommonsJson(URL_UNDER_TEST, deps('c'));

  const [ra, rb, rc] = await Promise.all([a, b, c]);

  assert.deepEqual(ra, { ok: 'a' });
  assert.deepEqual(rb, { ok: 'b' });
  assert.deepEqual(rc, { ok: 'c' });

  const limitAt = startTimes.get('a1') + 10_000;
  assert.ok(startTimes.get('b1') >= limitAt);
  assert.ok(startTimes.get('c1') >= limitAt);
  assert.ok(startTimes.get('a2') >= limitAt);
});

test('resetCommonsGate removes the pause of an old 429', async () => {
  resetCommonsGate();
  const clock = fakeClock();
  let calls = 0;
  const startTimes = [];
  const fetchJson = async () => {
    calls += 1;
    startTimes.push(clock.now());
    if (calls <= 3) throw http429(20);
    return { ok: true };
  };

  await assert.rejects(
    fetchCommonsJson(URL_UNDER_TEST, {
      fetchJson,
      sleep: clock.sleep,
      now: clock.now,
      limiter: noLimiter,
    }),
  );

  resetCommonsGate();
  const before = clock.now();
  await fetchCommonsJson(URL_UNDER_TEST, {
    fetchJson,
    sleep: clock.sleep,
    now: clock.now,
    limiter: noLimiter,
  });

  assert.equal(startTimes.at(-1), before);
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

test('fetchCommonsJson resolves after four 429 answers', async () => {
  resetCommonsGate();
  const clock = fakeClock();
  let calls = 0;
  const fetchJson = async () => {
    calls += 1;
    if (calls <= 4) throw http429(1);
    return { ok: true };
  };

  const result = await fetchCommonsJson(URL_UNDER_TEST, {
    fetchJson,
    sleep: clock.sleep,
    now: clock.now,
    limiter: noLimiter,
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(calls, 5);
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

test('one 429 then one TIMEOUT then success resolves', async () => {
  resetCommonsGate();
  const clock = fakeClock();
  let calls = 0;
  const fetchJson = async () => {
    calls += 1;
    if (calls === 1) throw http429(1);
    if (calls === 2) {
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
  assert.equal(calls, 3);
});
