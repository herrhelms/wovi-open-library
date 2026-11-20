import { fetchWithTimeout } from './http.js';

export const ALLOWED_HOST_SUFFIXES = [
  'wikimedia.org',
  'europeana.eu',
  'archive.org',
  'loc.gov',
  'si.edu',
  'micr.io',
  'rijksmuseum.nl',
  'metmuseum.org',
  'nypl.org',
  'nasa.gov',
  'nga.gov',
  'clevelandart.org',
  'smk.dk',
  'artsmia.org',
  'wellcomecollection.org',
  'inaturalist-open-data.s3.amazonaws.com',
  'inaturalist.org',
  'getty.edu',
  'esahubble.org',
  'esawebb.org',
  'eso.org',
  'staticflickr.com',
  'flickr.com',
];

export function isAllowedHost(hostname) {
  if (typeof hostname !== 'string' || hostname === '') return false;
  const host = hostname.toLowerCase();
  return ALLOWED_HOST_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  );
}

const CONTENT_TYPE_EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/tiff': 'tif',
  'image/jp2': 'jp2',
  'image/jpx': 'jp2',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

function extensionFromPath(urlPath) {
  if (typeof urlPath !== 'string') return null;

  let path = urlPath;
  try {
    path = new URL(urlPath, 'http://localhost').pathname;
  } catch {
    path = urlPath.split(/[?#]/, 1)[0];
  }

  const match = /\.([A-Za-z0-9]{2,5})$/.exec(path);
  return match ? match[1].toLowerCase() : null;
}

export function extFromContentType(contentType, urlPath) {
  if (typeof contentType === 'string') {
    const type = contentType.split(';', 1)[0].trim().toLowerCase();
    const mapped = CONTENT_TYPE_EXTENSIONS[type];
    if (mapped) return mapped;
  }
  return extensionFromPath(urlPath) ?? 'bin';
}

export function safeFilename(source, titleOrId, ext) {
  const raw = titleOrId === null || titleOrId === undefined ? '' : String(titleOrId);
  const ascii = raw.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const slug = ascii
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80)
    .replace(/^[-.]+|[-.]+$/g, '');

  return `${source}-${slug === '' ? 'item' : slug}.${ext}`;
}

function makeError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export async function openRemote(
  url,
  { checkHosts, maxRedirects = 5, signal } = {},
) {
  let current;
  try {
    current = new URL(url);
  } catch {
    throw makeError('Invalid URL', 400);
  }

  if (current.protocol !== 'http:' && current.protocol !== 'https:') {
    throw makeError('Only http and https URLs are allowed', 400);
  }

  let redirects = 0;
  while (true) {
    if (checkHosts && !isAllowedHost(current.hostname)) {
      throw makeError(`Host not allowed: ${current.hostname}`, 400);
    }

    const res = await fetchWithTimeout(current.href, {
      redirect: 'manual',
      timeoutMs: 60000,
      signal,
    });

    if (REDIRECT_STATUSES.has(res.status)) {
      const location = res.headers.get('location');
      if (!location) {
        throw makeError(`Remote file answered HTTP ${res.status}`, 502);
      }
      if (redirects >= maxRedirects) {
        throw makeError('Too many redirects', 502);
      }
      redirects += 1;
      try {
        current = new URL(location, current);
      } catch {
        throw makeError('Invalid redirect URL', 502);
      }
      if (current.protocol !== 'http:' && current.protocol !== 'https:') {
        throw makeError('Only http and https URLs are allowed', 400);
      }
      try {
        await res.body?.cancel();
      } catch {
        // Ignore a body that cannot be cancelled.
      }
      continue;
    }

    if (!res.ok) {
      try {
        await res.body?.cancel();
      } catch {
        // Ignore a body that cannot be cancelled.
      }
      throw makeError(`Remote file answered HTTP ${res.status}`, 502);
    }

    return res;
  }
}
