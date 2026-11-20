import { createHash } from 'node:crypto';

/**
 * Normalize an image URL so that equivalent URLs give the same result.
 *
 * The protocol `http:` becomes `https:`, the fragment is removed and the
 * query stays. A string that `new URL` cannot parse is returned trimmed.
 *
 * @param {unknown} url
 * @returns {string | null} the normalized URL, or null for non-strings and empty strings
 */
export function normalizeMediaUrl(url) {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (trimmed === '') return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:') parsed.protocol = 'https:';
    parsed.hash = '';
    return parsed.href;
  } catch {
    return trimmed;
  }
}

/**
 * Build a stable media ID for an image URL.
 *
 * The ID is `"m"` followed by the first 24 hex characters of the SHA-256
 * digest of the normalized URL (UTF-8).
 *
 * @param {unknown} url
 * @returns {string | null} the media ID, or null when the URL is not usable
 */
export function mediaIdFor(url) {
  const normalized = normalizeMediaUrl(url);
  if (normalized === null) return null;
  const digest = createHash('sha256').update(normalized, 'utf8').digest('hex');
  return `m${digest.slice(0, 24)}`;
}
