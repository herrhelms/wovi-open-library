import { HttpError, fetchWithTimeout } from './http.js';

const RETRY_FALLBACK_MS = 2000;
const RETRY_MAX_MS = 5000;

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

function rateLimitError() {
  const err = new Error('Wikimedia Commons rate limit reached. Try again in a minute.');
  err.code = 'RATE_LIMIT';
  return err;
}

export async function fetchCommonsJson(url, deps = {}) {
  const doFetch = deps.fetchJson ?? ((target) => fetchJsonWithRetryAfter(target));
  const doSleep = deps.sleep ?? sleep;
  const limiter = deps.limiter ?? commonsLimiter;

  return limiter(async () => {
    try {
      return await doFetch(url);
    } catch (err) {
      if (err?.status !== 429) throw err;

      const seconds = Number.isFinite(err.retryAfterSeconds) ? err.retryAfterSeconds : null;
      const requested = seconds === null ? RETRY_FALLBACK_MS : seconds * 1000;
      await doSleep(Math.min(Math.max(requested, 0), RETRY_MAX_MS));
    }

    try {
      return await doFetch(url);
    } catch (err) {
      if (err?.status === 429) throw rateLimitError();
      throw err;
    }
  });
}
