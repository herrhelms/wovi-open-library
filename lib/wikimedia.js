import { HttpError, fetchWithTimeout } from './http.js';

const MIN_GAP_MS = 500;
const RETRY_FALLBACK_MS = 5000;
const RETRY_MAX_MS = 30000;
const MAX_TOTAL_WAIT_MS = 45000;
const PAUSE_FAIL_FAST_MS = 2000;
export const COMMONS_TIMEOUT_MS = 20000;
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

export const commonsLimiter = createLimiter(1);

/**
 * Put the shared gate back into its start state. Tests call this first.
 */
export function resetCommonsGate() {
  pausedUntil = 0;
  lastStart = null;
}

async function fetchJsonWithRetryAfter(url, opts = {}) {
  const host = hostOf(url);
  const fetchOpts = {
    headers: { Accept: 'application/json', ...(opts.headers ?? {}) },
  };
  if (typeof opts.timeoutMs === 'number') fetchOpts.timeoutMs = opts.timeoutMs;
  const res = await fetchWithTimeout(url, fetchOpts);

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

function rateLimitError(now, paused = false) {
  const remaining = Math.ceil((pausedUntil - now()) / 1000);
  const seconds = Number.isFinite(remaining) ? remaining : 0;
  const err = new Error(RATE_LIMIT_MESSAGE);
  err.code = 'RATE_LIMIT';
  err.retryAfterSeconds = Math.max(5, seconds);
  if (paused) err.paused = true;
  return err;
}

/**
 * Wait until the shared gate lets a new request start.
 * A start needs the pause to be over, the gap after the last start, and the
 * request not to be older than the total wait limit. The check repeats after a
 * sleep, because another request can move the gate in the meantime. A pause of
 * more than PAUSE_FAIL_FAST_MS is not waited out: it throws the RATE_LIMIT
 * error at once, so the request does not hold the limiter. Only the 500 ms gap
 * and a pause of PAUSE_FAIL_FAST_MS or less are slept.
 * @param {number} startedAt
 * @param {() => number} now
 * @param {(ms: number) => Promise<void>} doSleep
 */
async function waitForGate(startedAt, now, doSleep) {
  for (;;) {
    const current = now();
    if (pausedUntil - current > PAUSE_FAIL_FAST_MS) throw rateLimitError(now, true);

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
  const doFetch = deps.fetchJson ?? fetchJsonWithRetryAfter;
  const doSleep = deps.sleep ?? sleep;
  const limiter = deps.limiter ?? commonsLimiter;
  const now = deps.now ?? Date.now;

  const startedAt = now();
  if (pausedUntil - startedAt > PAUSE_FAIL_FAST_MS) throw rateLimitError(now, true);

  return limiter(async () => {
    let timeoutRetries = 0;

    for (;;) {
      await waitForGate(startedAt, now, doSleep);

      try {
        return await doFetch(url, { timeoutMs: COMMONS_TIMEOUT_MS });
      } catch (err) {
        if (err?.code === 'TIMEOUT' && timeoutRetries < 1) {
          timeoutRetries += 1;
          continue;
        }
        if (err?.status !== 429) throw err;

        const seconds =
          Number.isFinite(err.retryAfterSeconds) && err.retryAfterSeconds >= 0
            ? err.retryAfterSeconds
            : null;
        const requested = seconds === null ? RETRY_FALLBACK_MS : seconds * 1000;
        const wait = Math.min(Math.max(requested, 0), RETRY_MAX_MS);
        const until = now() + wait;
        if (until > pausedUntil) pausedUntil = until;

        throw rateLimitError(now);
      }
    }
  });
}
