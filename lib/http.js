import { installExtraRootCAs } from './tls.js';

installExtraRootCAs();

export const USER_AGENT = 'OpenLibraryFetch/0.1 (+https://github.com/herrhelms/wovi-open-library)';

export class HttpError extends Error {
  constructor(message, { status = null, host = '', code = null } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.host = host;
    this.code = code;
  }
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

export async function fetchWithTimeout(url, opts = {}) {
  const {
    headers = {},
    timeoutMs = 15000,
    redirect = 'follow',
    method = 'GET',
    signal: externalSignal,
  } = opts;

  const host = hostOf(url);
  const controller = new AbortController();
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    return await fetch(url, {
      method,
      redirect,
      headers: {
        ...Object.fromEntries(
          Object.entries(headers).filter(([k]) => k.toLowerCase() !== 'user-agent'),
        ),
        'User-Agent': USER_AGENT,
      },
      signal: controller.signal,
    });
  } catch (err) {
    if (timedOut) {
      const seconds = timeoutMs / 1000;
      throw new HttpError(`${host} did not answer in ${seconds} s`, {
        host,
        code: 'TIMEOUT',
      });
    }
    if (externalSignal?.aborted) throw err;
    const cause = err?.cause?.message ?? err?.message ?? 'unknown error';
    throw new HttpError(`${host} request failed: ${cause}`, {
      host,
      code: 'NETWORK',
    });
  } finally {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
  }
}

async function readBody(res) {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

export async function fetchJson(url, opts = {}) {
  const { headers = {}, ...rest } = opts;
  const host = hostOf(url);

  const res = await fetchWithTimeout(url, {
    ...rest,
    headers: { Accept: 'application/json', ...headers },
  });

  if (!res.ok) {
    const bodySnippet = (await readBody(res)).slice(0, 2000);
    const err = new HttpError(`${host} answered HTTP ${res.status}`, {
      host,
      status: res.status,
      code: 'HTTP',
    });
    err.bodySnippet = bodySnippet;
    throw err;
  }

  const body = await readBody(res);
  const bodySnippet = body.slice(0, 2000);
  try {
    return JSON.parse(body);
  } catch {
    const err = new HttpError(`${host} did not answer with JSON`, {
      host,
      status: res.status,
      code: 'NOT_JSON',
    });
    err.bodySnippet = bodySnippet;
    throw err;
  }
}
