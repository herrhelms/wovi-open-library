import { HttpError, fetchWithTimeout } from './http.js';

const MIN_GAP_MS = 250;
const RETRY_FALLBACK_MS = 5000;
const RETRY_MAX_MS = 30000;
const MAX_RETRIES = 2;
const MAX_TOTAL_WAIT_MS = 45000;
const RATE_LIMIT_MESSAGE =
  'Wikimedia Commons rate limit reached. Try again in a minute.';

/** Time in ms until which all Commons requests must wait. */
let pausedUntil = 0;
/** Start time of the last request, or null when no request was sent yet. */
let lastStart = null;

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createLimiter(concurrency) {
  const limit = Math.max(1, Math.trunc(Number(concurrency) || 1));
  let active = 0;
  const queue = [];

  function pump() {
    if (active >= limit || queue.length === 0) return;
    active += 1;
    const entry = queue.shift();
    Promise.resolve()
      .then(entry.fn)
      .then(entry.resolve, entry.reject)
      .finally(() => {
        active -= 1;
        pump();
      });
  }

  return function run(fn) {
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      pump();
    });
  };
}

export const commonsLimiter = createLimiter(2);

/**
 * Put the shared gate back into its start state. Tests call this first.
 */
export function resetCommonsGate() {
  pausedUntil = 0;
  lastStart = null;
}

async function fetchJsonWithRetryAfter(url, opts = {}) {
  const host = hostOf(url);
  const res = await fetchWithTimeout(url, {
    headers: { Accept: 'application/json', ...(opts.headers ?? {}) },
  });

  let body = '';
  try {
    body = await res.text();
  } catch {
    body = '';
  }

  if (!res.ok) {
    const err = new HttpError(`${host} answered HTTP ${res.status}`, {
      host,
      status: res.status,
      code: 'HTTP',
    });
    err.bodySnippet = body.slice(0, 2000);
    if (res.status === 429) {
      const raw = res.headers.get('retry-after');
      const seconds = raw === null ? NaN : Number(raw);
      err.retryAfterSeconds = Number.isFinite(seconds) ? seconds : null;
    }
    throw err;
  }

  try {
    return JSON.parse(body);
  } catch {
    const err = new HttpError(`${host} did not answer with JSON`, {
      host,
      status: res.status,
      code: 'NOT_JSON',
    });
    err.bodySnippet = body.slice(0, 2000);
    throw err;
  }
}

function rateLimitError(now) {
  const remaining = Math.ceil((pausedUntil - now()) / 1000);
  const seconds = Number.isFinite(remaining) ? remaining : 0;
  const err = new Error(RATE_LIMIT_MESSAGE);
  err.code = 'RATE_LIMIT';
  err.retryAfterSeconds = Math.max(5, seconds);
  return err;
}

/**
 * Wait until the shared gate lets a new request start.
 * A start needs the pause to be over, the gap after the last start, and the
 * request not to be older than the total wait limit. The check repeats after a
 * sleep, because another request can move the gate in the meantime.
 * @param {number} startedAt
 * @param {() => number} now
 * @param {(ms: number) => Promise<void>} doSleep
 */
async function waitForGate(startedAt, now, doSleep) {
  for (;;) {
    const current = now();
    const gapStart = lastStart === null ? current : lastStart + MIN_GAP_MS;
    const earliest = Math.max(current, pausedUntil, gapStart);

    if (earliest - startedAt > MAX_TOTAL_WAIT_MS) throw rateLimitError(now);

    if (earliest > current) {
      await doSleep(earliest - current);
      continue;
    }

    lastStart = current;
    return;
  }
}

export async function fetchCommonsJson(url, deps = {}) {
  const doFetch = deps.fetchJson ?? ((target) => fetchJsonWithRetryAfter(target));
  const doSleep = deps.sleep ?? sleep;
  const limiter = deps.limiter ?? commonsLimiter;
  const now = deps.now ?? Date.now;

  const startedAt = now();

  return limiter(async () => {
    let attempts = 0;

    for (;;) {
      await waitForGate(startedAt, now, doSleep);
      attempts += 1;

      try {
        return await doFetch(url);
      } catch (err) {
        if (err?.status !== 429) throw err;

        const seconds =
          Number.isFinite(err.retryAfterSeconds) && err.retryAfterSeconds >= 0
            ? err.retryAfterSeconds
            : null;
        const requested = seconds === null ? RETRY_FALLBACK_MS : seconds * 1000;
        const wait = Math.min(Math.max(requested, 0), RETRY_MAX_MS);
        const until = now() + wait;
        if (until > pausedUntil) pausedUntil = until;

        if (attempts > MAX_RETRIES) throw rateLimitError(now);
      }
    }
  });
}
